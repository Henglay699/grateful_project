import { eq, sql, type SQL } from 'drizzle-orm';
import {
  BILLING_DOC_SCHEMAS,
  BILLING_PACK_TYPES,
  STATEMENT_KIND_LABEL,
  fromCents,
  toCents,
  toMoneyString,
  type BillingClient,
  type BillingClientMonth,
  type BillingDoc,
  type BillingDocSlot,
  type BillingDraftsResult,
  type BillingIssueResult,
  type BillingOverview,
  type BillingPack,
  type BillingPackType,
  type BillingShipmentRow,
  type BillingStage,
  type BillingStatement,
  type OfficialReceipt,
  type Paginated,
  type StatementKind,
  type StatementLine,
  type TransportMode,
  type receiptInputSchema,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db, type DbOrTx } from '../../db/client';
import { clients, officialReceipts } from '../../db/schema';
import { audit } from '../../lib/audit';
import { clientCondition } from '../../lib/clientScope';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { isoTs, likePattern, paginate, queryRows, toPaginated, whereAll } from '../../lib/listing';
import { formatNumber, nextNumber } from '../../lib/numbering';
import { parse } from '../../lib/validate';
import { createDoc, getDoc, issueDoc, previewDoc } from './docs';
import { prefill, previousLines, summaryLines } from './prefill';

/*
 * Client Billing: one client's month, the way the Excel pack (e.g. "09-JR-INV") had it.
 * A shipment belongs to the month of its Monthly Ledger invoice date; a document with no
 * ledger entry (a monthly service-fee debit note) to the month of its own date. The account
 * statements are read from the issued documents — and from numbers typed in the ledger for
 * documents made outside the system — so they always match; only receipts are stored.
 */

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** "2026-09" → "SEP-2026", as printed on the statements and receipts. */
export const periodLabel = (month: string) =>
  `${MON[Number(month.slice(5, 7)) - 1]}-${month.slice(0, 4)}`;

const inMonth = (col: SQL, month: string) =>
  sql`${col} >= ${`${month}-01`}::date AND ${col} < (${`${month}-01`}::date + interval '1 month')`;
const money = (cents: number) => toMoneyString(fromCents(cents));
const emptyByType = <T>(make: () => T): Record<BillingPackType, T> => ({
  'tax-invoices': make(),
  disbursements: make(),
  'debit-notes': make(),
});
/** "NON" (no house bill) and blanks don't identify a shipment on a statement. */
const realRef = (v: string | null | undefined) =>
  v && v.trim() && v.trim().toUpperCase() !== 'NON' ? v.trim() : null;

interface LedgerPart {
  recordId: string;
  invDate: string;
  declareNo: string;
  shipmentId: string;
  shipmentReference: string;
  direction: 'IMPORT' | 'EXPORT';
  transportMode: TransportMode;
  hbl: string | null;
  containers: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  invRevenue: string;
  vat: string;
  disTotal: string;
  dnTotal: string;
  /** Approved through Chea Payments: its numbers are for documents made here, not typed ones. */
  fromChea: boolean;
}
interface DocPart extends BillingDocSlot {
  recordId: string | null;
  hbl: string | null;
  reference: string | null;
}

const RECEIPT_COLUMNS = sql`
  r.id, r.receipt_no AS "receiptNo", r.client_id AS "clientId", c.code AS "clientCode", c.name AS "clientName",
  upper(coalesce(c.legal_name, c.name)) AS "receivedFrom", to_char(r.period_month, 'YYYY-MM') AS month, r.kind,
  to_char(r.receipt_date, 'YYYY-MM-DD') AS "receiptDate", r.amount::text AS amount, r.payment_method AS "paymentMethod",
  r.payment_ref AS "paymentRef", r.note, r.status, u.full_name AS "createdByName", ${isoTs('r.created_at')} AS "createdAt"`;
const RECEIPT_FROM = sql`
  FROM official_receipts r JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.created_by_id`;

async function loadClient(clientId: string): Promise<BillingClient> {
  const [c] = await queryRows<BillingClient>(
    db,
    sql`SELECT id, code, name, legal_name AS "legalName", legal_name_km AS "legalNameKm", address, vattin
        FROM clients WHERE id = ${clientId} AND deleted_at IS NULL`,
  );
  if (!c) throw notFound('Client');
  return c;
}

/** The shipments (ledger entries) of the month, their documents, statements and receipts. */
export async function clientMonth(clientId: string, month: string): Promise<BillingClientMonth> {
  const client = await loadClient(clientId);
  const ledger = await queryRows<LedgerPart>(
    db,
    sql`
    SELECT a.id AS "recordId", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", d.declare_no AS "declareNo",
           s.id AS "shipmentId", s.reference AS "shipmentReference", s.direction,
           s.transport_mode AS "transportMode", s.hbl_no AS hbl,
           (SELECT string_agg(container_no, ', ' ORDER BY sort_order) FROM containers WHERE shipment_id = s.id) AS containers,
           s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
           a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo", a.inv_revenue::text AS "invRevenue",
           a.vat::text AS vat, a.dis_total::text AS "disTotal", a.dn_total::text AS "dnTotal",
           EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.accounting_record_id = a.id AND cn.status <> 'VOID') AS "fromChea"
    FROM accounting_records a
    JOIN customs_declarations d ON d.id = a.declaration_id JOIN shipments s ON s.id = d.shipment_id
    WHERE a.client_id = ${clientId} AND ${inMonth(sql`a.inv_date`, month)}
    ORDER BY a.inv_date, d.declare_no`,
  );
  const linked = ledger.length
    ? sql`t.accounting_record_id IN (${sql.join(
        ledger.map((l) => sql`${l.recordId}::uuid`),
        sql`, `,
      )})`
    : sql`false`;
  const part = (type: BillingPackType, table: string, no: string, date: string, ref: string) => sql`
    SELECT ${type} AS type, t.id, t.${sql.raw(no)} AS number, to_char(t.${sql.raw(date)}, 'YYYY-MM-DD') AS date,
           t.status::text AS status, t.total::text AS total, t.accounting_record_id AS "recordId",
           t.hbl, ${sql.raw(ref)} AS reference, t.created_at
    FROM ${sql.raw(table)} t
    WHERE t.client_id = ${clientId} AND t.status <> 'VOID'
      AND (${linked} OR (t.accounting_record_id IS NULL AND ${inMonth(sql.raw(`t.${date}`), month)}))`;
  const docs = await queryRows<DocPart>(
    db,
    sql`SELECT * FROM (
      ${part('tax-invoices', 'tax_invoices', 'invoice_no', 'invoice_date', 'NULL::text')}
      UNION ALL ${part('disbursements', 'disbursements', 'dis_no', 'dis_date', 't.reference')}
      UNION ALL ${part('debit-notes', 'debit_notes', 'dn_no', 'dn_date', 't.reference')}
    ) x ORDER BY date, number NULLS LAST, created_at`,
  );
  const receipts = await queryRows<OfficialReceipt>(
    db,
    sql`SELECT ${RECEIPT_COLUMNS} ${RECEIPT_FROM}
        WHERE r.client_id = ${clientId} AND r.period_month = ${`${month}-01`}::date
        ORDER BY r.receipt_date, r.receipt_no`,
  );

  const slot = (d: DocPart): BillingDocSlot => ({
    id: d.id,
    type: d.type,
    number: d.number,
    date: d.date,
    status: d.status,
    total: d.total,
  });
  const byRecord = new Map<string, DocPart[]>();
  const others: DocPart[] = [];
  for (const d of docs) {
    if (d.recordId) byRecord.set(d.recordId, [...(byRecord.get(d.recordId) ?? []), d]);
    else others.push(d);
  }

  const rows: (BillingShipmentRow & { _docs: DocPart[] })[] = ledger.map((l) => {
    const own = byRecord.get(l.recordId) ?? [];
    const docsByType = emptyByType<BillingDocSlot[]>(() => []);
    for (const d of own) docsByType[d.type].push(slot(d));
    const typed: Record<BillingPackType, [string | null, number]> = {
      'tax-invoices': [l.invNo, toCents(l.invRevenue) + toCents(l.vat)],
      disbursements: [l.disNo, toCents(l.disTotal)],
      'debit-notes': [l.dnNo, toCents(l.dnTotal)],
    };
    const manual = emptyByType<{ number: string; total: string } | null>(() => null);
    for (const type of BILLING_PACK_TYPES) {
      const [number, cents] = typed[type];
      // A number typed in the ledger for a document made outside the system (the Excel days).
      if (number && !l.fromChea && !docsByType[type].some((d) => d.status === 'ISSUED'))
        manual[type] = { number, total: money(cents) };
    }
    return {
      recordId: l.recordId,
      invDate: l.invDate,
      declareNo: l.declareNo,
      shipmentId: l.shipmentId,
      shipmentReference: l.shipmentReference,
      direction: l.direction,
      hbl: l.hbl,
      containers: l.containers,
      quantity: l.quantity,
      quantityUnit: l.quantityUnit,
      transportMode: l.transportMode,
      docs: docsByType,
      manual,
      _docs: own,
    };
  });

  /* ----- Statements ----- */
  // Issued documents and drafts (marked DRAFT, so a month can be printed for checking first).
  // A $0.00 draft has nothing to bill yet and stays off.
  const billable = (d: DocPart) =>
    d.status === 'ISSUED' || (d.status === 'DRAFT' && toCents(d.total) > 0);
  const issued = (list: DocPart[], type: BillingPackType) =>
    list.filter((d) => d.type === type && billable(d));
  const isDraft = (list: DocPart[]) => list.some((d) => d.status === 'DRAFT');
  const invLines: (StatementLine & { cents: number })[] = [];
  const dnLines: (StatementLine & { cents: number })[] = [];
  for (const r of rows) {
    const inv = issued(r._docs, 'tax-invoices');
    const dis = issued(r._docs, 'disbursements');
    const ref = realRef(inv[0]?.hbl ?? dis[0]?.hbl) ?? realRef(r.hbl) ?? r.declareNo;
    const invPart = inv.length
      ? { nos: inv.map((d) => d.number), cents: inv.reduce((s, d) => s + toCents(d.total), 0) }
      : r.manual['tax-invoices'] && {
          nos: [r.manual['tax-invoices'].number],
          cents: toCents(r.manual['tax-invoices'].total),
          manual: true,
        };
    const disPart = dis.length
      ? { nos: dis.map((d) => d.number), cents: dis.reduce((s, d) => s + toCents(d.total), 0) }
      : r.manual.disbursements && {
          nos: [r.manual.disbursements.number],
          cents: toCents(r.manual.disbursements.total),
          manual: true,
        };
    if (invPart || disPart) {
      const cents = (invPart ? invPart.cents : 0) + (disPart ? disPart.cents : 0);
      invLines.push({
        date: inv[0]?.date ?? dis[0]?.date ?? r.invDate,
        invNo: invPart ? invPart.nos.join(', ') : null,
        disNo: disPart ? disPart.nos.join(', ') : null,
        dnNo: null,
        ref,
        amount: money(cents),
        manual: !!(invPart && 'manual' in invPart) || !!(disPart && 'manual' in disPart),
        draft: isDraft(inv) || isDraft(dis),
        cents,
      });
    }
    const dns = issued(r._docs, 'debit-notes');
    for (const dn of dns)
      dnLines.push({
        date: dn.date,
        invNo: null,
        disNo: null,
        dnNo: dn.number,
        ref: realRef(dn.hbl) ?? realRef(r.hbl) ?? r.declareNo,
        amount: dn.total,
        manual: false,
        draft: dn.status === 'DRAFT',
        cents: toCents(dn.total),
      });
    if (!dns.length && r.manual['debit-notes'])
      dnLines.push({
        date: r.invDate,
        invNo: null,
        disNo: null,
        dnNo: r.manual['debit-notes'].number,
        ref: realRef(r.hbl) ?? r.declareNo,
        amount: r.manual['debit-notes'].total,
        manual: true,
        draft: false,
        cents: toCents(r.manual['debit-notes'].total),
      });
  }
  for (const d of others.filter(billable)) {
    const line = {
      date: d.date,
      invNo: d.type === 'tax-invoices' ? d.number : null,
      disNo: d.type === 'disbursements' ? d.number : null,
      dnNo: d.type === 'debit-notes' ? d.number : null,
      ref: realRef(d.hbl) ?? realRef(d.reference) ?? 'NON',
      amount: d.total,
      manual: false,
      draft: d.status === 'DRAFT',
      cents: toCents(d.total),
    };
    (d.type === 'debit-notes' ? dnLines : invLines).push(line);
  }
  const byDate = (a: StatementLine, b: StatementLine) =>
    a.date.localeCompare(b.date) ||
    (a.invNo ?? a.disNo ?? a.dnNo ?? '').localeCompare(b.invNo ?? b.disNo ?? b.dnNo ?? '');
  const statement = (
    kind: StatementKind,
    lines: (StatementLine & { cents: number })[],
  ): BillingStatement => {
    const mine = receipts.filter((r) => r.kind === kind);
    const totalC = lines.reduce((s, l) => s + l.cents, 0);
    const receivedC = mine
      .filter((r) => r.status === 'ISSUED')
      .reduce((s, r) => s + toCents(r.amount), 0);
    return {
      kind,
      lines: lines.sort(byDate).map(({ cents: _c, ...l }) => l),
      total: money(totalC),
      received: money(receivedC),
      balance: money(totalC - receivedC),
      receipts: mine,
      drafts: lines.filter((l) => l.draft).length,
    };
  };
  const statements = {
    INVOICE: statement('INVOICE', invLines),
    DEBIT_NOTE: statement('DEBIT_NOTE', dnLines),
  };

  /* ----- Summary ----- */
  const all = [...rows.flatMap((r) => r._docs), ...others];
  const missing = emptyByType(() => 0);
  let manual = 0;
  for (const r of rows)
    for (const type of BILLING_PACK_TYPES)
      if (!r.docs[type].length) {
        if (r.manual[type]) manual += 1;
        else missing[type] += 1;
      }
  const billedC = toCents(statements.INVOICE.total) + toCents(statements.DEBIT_NOTE.total);
  const receivedC = toCents(statements.INVOICE.received) + toCents(statements.DEBIT_NOTE.received);
  const drafts = all.filter((d) => d.status === 'DRAFT').length;
  const stage: BillingStage =
    !rows.length && !others.length && !billedC && !receivedC
      ? 'EMPTY'
      : missing['tax-invoices'] > 0
        ? 'NOT_INVOICED'
        : drafts > 0
          ? 'DRAFTS'
          : billedC <= 0
            ? 'EMPTY'
            : receivedC <= 0
              ? 'AWAITING_PAYMENT'
              : receivedC < billedC
                ? 'PARTLY_PAID'
                : 'PAID';
  return {
    client,
    month,
    rows: rows.map(({ _docs, ...r }) => r),
    others: others.map((d) => ({ ...slot(d), reference: d.reference })),
    statements,
    summary: {
      shipments: rows.length,
      issued: all.filter((d) => d.status === 'ISSUED').length,
      drafts,
      manual,
      missing,
      billed: money(billedC),
      received: money(receivedC),
      balance: money(billedC - receivedC),
      stage,
    },
  };
}

/** Every client with billing in the month (shipments, documents or receipts), A→Z by code. */
export async function overview(month: string, clientIds?: string[]): Promise<BillingOverview> {
  const scoped = clientCondition(sql`x.client_id`, clientIds);
  const loose = (table: string, date: string) =>
    sql`SELECT client_id FROM ${sql.raw(table)} WHERE accounting_record_id IS NULL AND status <> 'VOID' AND ${inMonth(sql.raw(date), month)}`;
  const active = await queryRows<{ id: string }>(
    db,
    sql`
    SELECT c.id FROM clients c WHERE c.deleted_at IS NULL AND c.id IN (
      SELECT x.client_id FROM (
        SELECT client_id FROM accounting_records WHERE ${inMonth(sql`inv_date`, month)}
        UNION ${loose('tax_invoices', 'invoice_date')}
        UNION ${loose('disbursements', 'dis_date')}
        UNION ${loose('debit_notes', 'dn_date')}
        UNION SELECT client_id FROM official_receipts WHERE period_month = ${`${month}-01`}::date
      ) x ${scoped ? sql`WHERE ${scoped}` : sql``}
    ) ORDER BY c.code`,
  );
  const months = await Promise.all(active.map((c) => clientMonth(c.id, month)));
  const rows = months.map((m) => ({
    clientId: m.client.id,
    clientCode: m.client.code,
    clientName: m.client.legalName ?? m.client.name,
    invoiceTotal: m.statements.INVOICE.total,
    debitNoteTotal: m.statements.DEBIT_NOTE.total,
    ...m.summary,
  }));
  const sum = (k: 'billed' | 'received' | 'balance') =>
    money(rows.reduce((s, r) => s + toCents(r[k]), 0));
  return {
    month,
    rows,
    totals: {
      clients: rows.length,
      shipments: rows.reduce((s, r) => s + r.shipments, 0),
      drafts: rows.reduce((s, r) => s + r.drafts, 0),
      notInvoiced: rows.reduce((s, r) => s + r.missing['tax-invoices'], 0),
      billed: sum('billed'),
      received: sum('received'),
      balance: sum('balance'),
    },
  };
}

/**
 * Drafts for every shipment of the month that has no document of a chosen type (nor a
 * number typed in the ledger), filled from the shipment like "+ Tax Invoice" on a ledger row.
 */
export async function createDrafts(
  clientId: string,
  input: { month: string; types: BillingPackType[]; lines: 'previous' | 'ledger' },
  req: Request,
): Promise<BillingDraftsResult> {
  const m = await clientMonth(clientId, input.month);
  const created: BillingDraftsResult['created'] = [];
  for (const r of m.rows)
    for (const type of BILLING_PACK_TYPES) {
      if (!input.types.includes(type) || r.docs[type].length || r.manual[type]) continue;
      const draft = await prefill(type, r.recordId);
      let copiedFrom: string | null = null;
      // A checked record summary's lines win over copying the last document.
      const fromSummary =
        (type === 'disbursements' || type === 'debit-notes') &&
        !!(await summaryLines(type, r.recordId));
      if (input.lines === 'previous' && !fromSummary) {
        const prev = await previousLines(type, clientId, r.recordId);
        if (prev) {
          draft.lines = prev.lines;
          copiedFrom = prev.number;
        }
      }
      const values = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, draft) as Parameters<
        typeof createDoc
      >[1];
      const id = await createDoc(type, values, req);
      created.push({ type, id, number: (await getDoc(type, id)).number, copiedFrom });
    }
  return { created };
}

const DOC_TABLE: Record<BillingPackType, string> = {
  'tax-invoices': 'tax_invoices',
  disbursements: 'disbursements',
  'debit-notes': 'debit_notes',
};

/**
 * A record summary checked in Expense to Clients: the shipment's Tax Invoice, Disbursement and
 * Debit Note drafts are made for it, filled from the ledger and the summary's lines, so nobody
 * has to press "Create draft". A type the shipment already has (draft or issued), one with
 * nothing to bill, or one whose number the ledger hasn't given yet (Chea payment not checked:
 * its draft is made when it is) is left alone. Nothing without a checked record summary.
 */
export async function autoDraftsFor(recordId: string, req: Request): Promise<string[]> {
  const made: string[] = [];
  const [r] = await queryRows<{ summary: boolean } & Record<string, string | null>>(
    db,
    sql`SELECT a.inv_no AS "tax-invoices", a.dis_no AS disbursements, a.dn_no AS "debit-notes",
               EXISTS (SELECT 1 FROM record_summaries s WHERE s.accounting_record_id = a.id
                 AND s.status = 'ISSUED' AND s.review_status = 'CHECKED') AS summary
        FROM accounting_records a WHERE a.id = ${recordId}`,
  );
  if (!r?.summary) return made;
  for (const type of BILLING_PACK_TYPES) {
    if (!r[type]) continue;
    const [has] = await queryRows<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM ${sql.raw(DOC_TABLE[type])}
          WHERE accounting_record_id = ${recordId} AND status <> 'VOID'`,
    );
    if (has!.n) continue;
    const draft = await prefill(type, recordId);
    const lines = (draft.lines ?? []) as { qty: string; unitPrice: string }[];
    if (!lines.some((l) => Number(l.qty) * Number(l.unitPrice) > 0)) continue;
    const values = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, draft) as Parameters<
      typeof createDoc
    >[1];
    made.push(await createDoc(type, values, req));
  }
  return made;
}

/** Issues every draft of the month; drafts with a $0.00 total are left for a look. */
export async function issueDrafts(
  clientId: string,
  month: string,
  req: Request,
): Promise<BillingIssueResult> {
  const m = await clientMonth(clientId, month);
  const drafts = [
    ...m.rows.flatMap((r) => BILLING_PACK_TYPES.flatMap((t) => r.docs[t])),
    ...m.others,
  ]
    .filter((d) => d.status === 'DRAFT')
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        BILLING_PACK_TYPES.indexOf(a.type) - BILLING_PACK_TYPES.indexOf(b.type),
    );
  const result: BillingIssueResult = { issued: [], skipped: [] };
  for (const d of drafts) {
    const ref = { type: d.type, id: d.id, number: d.number };
    if (toCents(d.total) <= 0) {
      result.skipped.push({ ...ref, reason: 'The total is $0.00' });
      continue;
    }
    try {
      await issueDoc(d.type, d.id, req);
      result.issued.push(ref);
    } catch (err) {
      const pg = (err as { cause?: { code?: string } }).cause ?? (err as { code?: string });
      result.skipped.push({
        ...ref,
        reason:
          pg?.code === '23505'
            ? 'Its number is already on another Monthly Ledger entry'
            : err instanceof Error
              ? err.message
              : 'Could not be issued',
      });
    }
  }
  return result;
}

/**
 * The month plus every document in full, in the order the pack is printed: each shipment's
 * tax invoice, disbursement and debit note together, as the sheets were. Drafts are included
 * (they print marked DRAFT), as on the statements. A document whose number was typed in the
 * Monthly Ledger (made outside the system) and that has no document of its own here prints
 * from the ledger: its number, date and amount, with the shipment's details, as the statement
 * counts it.
 */
export async function pack(
  clientId: string,
  month: string,
  /** One shipment's row only. */
  recordId?: string,
): Promise<BillingPack> {
  const m = await clientMonth(clientId, month);
  const live = (list: BillingDocSlot[]) =>
    Promise.all(list.filter((d) => d.status !== 'VOID').map((d) => getDoc(d.type, d.id)));
  const docs: BillingDoc[] = [];
  if (recordId) {
    for (const r of m.rows.filter((x) => x.recordId === recordId))
      for (const t of BILLING_PACK_TYPES) docs.push(...(await live(r.docs[t])));
    return { ...m, docs };
  }
  for (const r of m.rows)
    for (const t of BILLING_PACK_TYPES) {
      const own = await live(r.docs[t]);
      if (own.length) docs.push(...own);
      else if (r.manual[t]) {
        const draft = (await prefill(t, r.recordId)) as Parameters<typeof previewDoc>[1];
        docs.push(
          previewDoc(t, draft, {
            number: r.manual[t]!.number,
            date: r.invDate,
            clientCode: m.client.code,
            clientName: m.client.name,
            declareNo: r.declareNo,
            recordId: r.recordId,
          }),
        );
      }
    }
  for (const t of BILLING_PACK_TYPES)
    docs.push(...(await live(m.others.filter((d) => d.type === t))));
  return { ...m, docs };
}

/* ------------------------------ Official receipts ------------------------------ */

export async function getReceipt(id: string): Promise<OfficialReceipt> {
  const [r] = await queryRows<OfficialReceipt>(
    db,
    sql`SELECT ${RECEIPT_COLUMNS} ${RECEIPT_FROM} WHERE r.id = ${id}`,
  );
  if (!r) throw notFound('Official receipt');
  return r;
}

async function received(tx: DbOrTx, clientId: string, month: string, kind: StatementKind) {
  const [r] = await queryRows<{ cents: string }>(
    tx,
    sql`SELECT coalesce(sum(amount) * 100, 0)::bigint::text AS cents FROM official_receipts
        WHERE client_id = ${clientId} AND period_month = ${`${month}-01`}::date AND kind = ${kind} AND status = 'ISSUED'`,
  );
  return Number(r?.cents ?? 0);
}

/**
 * Records a payment against one of the month's statements and issues its receipt
 * (OR26-001…). It can't be more than what is still due on that statement.
 */
export async function createReceipt(
  input: z.output<typeof receiptInputSchema>,
  req: Request,
): Promise<string> {
  return db.transaction(async (tx) => {
    // One receipt at a time per client, so two people can't both take the same balance.
    const [c] = await tx.select().from(clients).where(eq(clients.id, input.clientId)).for('update');
    if (!c || c.deletedAt) throw businessRule('The selected client does not exist');
    const st = (await clientMonth(input.clientId, input.month)).statements[input.kind];
    const label = `${STATEMENT_KIND_LABEL[input.kind].toLowerCase()} statement for ${periodLabel(input.month)}`;
    const dueC = toCents(st.total) - (await received(tx, input.clientId, input.month, input.kind));
    if (toCents(st.total) <= 0) throw businessRule(`There is nothing on the ${label} to pay yet`);
    if (dueC <= 0) throw businessRule(`The ${label} is already paid in full`);
    if (toCents(input.amount) > dueC)
      throw businessRule(
        `The amount is more than the $${toMoneyString(fromCents(dueC))} still due on the ${label}`,
      );
    const receiptNo = formatNumber.receipt(
      input.receiptDate.slice(2, 4),
      await nextNumber(tx, `RECEIPT:${input.receiptDate.slice(0, 4)}`),
    );
    const [row] = await tx
      .insert(officialReceipts)
      .values({
        receiptNo,
        clientId: input.clientId,
        periodMonth: `${input.month}-01`,
        kind: input.kind,
        receiptDate: input.receiptDate,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paymentRef: input.paymentRef,
        note: input.note,
        status: 'ISSUED',
        createdById: req.auth!.userId,
      })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'official_receipt', entityId: row!.id, after: row },
      req,
    );
    return row!.id;
  });
}

/** Void keeps the receipt and its number; the amount is due again on the statement. */
export async function voidReceipt(id: string, reason: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(officialReceipts)
      .where(eq(officialReceipts.id, id))
      .for('update');
    if (!r) throw notFound('Official receipt');
    if (r.status === 'VOID') throw conflict('Already cancelled');
    await tx.update(officialReceipts).set({ status: 'VOID' }).where(eq(officialReceipts.id, id));
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'official_receipt',
        entityId: id,
        before: { status: r.status },
        after: { status: 'VOID' },
        reason,
      },
      req,
    );
  });
}

export async function listReceipts(p: {
  page: number;
  pageSize: number;
  q?: string | undefined;
  clientId?: string | undefined;
  clientIds?: string[] | undefined;
  month?: string | undefined;
  status?: string | undefined;
}): Promise<Paginated<OfficialReceipt>> {
  const c = [sql`true`];
  if (p.clientId) c.push(sql`r.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`r.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.month) c.push(inMonth(sql`r.receipt_date`, p.month));
  if (p.status) c.push(sql`r.status = ${p.status}`);
  if (p.q) {
    const like = likePattern(p.q);
    c.push(
      sql`(r.receipt_no ILIKE ${like} OR c.code ILIKE ${like} OR c.name ILIKE ${like} OR r.payment_ref ILIKE ${like})`,
    );
  }
  const rows = await queryRows<OfficialReceipt & { total_count: string }>(
    db,
    sql`SELECT ${RECEIPT_COLUMNS}, count(*) OVER () AS total_count ${RECEIPT_FROM}
        ${whereAll(c)} ORDER BY r.receipt_date DESC, r.receipt_no DESC ${paginate(p.page, p.pageSize)}`,
  );
  return toPaginated(rows, p.page, p.pageSize);
}
