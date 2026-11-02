import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  BILLING_DOC_SCHEMAS,
  chargeLineAmount,
  computeChargeLinesTotal,
  computeLinesTotal,
  computeTaxDocument,
  computeTaxLine,
  DEFAULT_VAT_PERCENT,
  ledgerInputSchema,
  lineAmount,
  recordSummaryLedger,
  toMoneyString,
  usdToKhr,
  vatMark,
  type BillingDoc,
  type BillingDocListItem,
  type BillingDocType,
  type BillingLineInput,
  type CreditNoteMessage,
  type RecordSummaryMessage,
  type CreditNoteReviewCounts,
  type CreditNoteReviewRow,
  type CreditNoteReviewStatus,
  type RecordSummaryReviewRow,
  type Paginated,
  type ReleasedInvoiceSet,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db, type Tx } from '../../db/client';
import {
  accountingRecords,
  clients,
  creditNoteLines,
  creditNotes,
  debitNoteLines,
  debitNotes,
  disbursementLines,
  disbursements,
  recordSummaries,
  recordSummaryLines,
  taxInvoiceLines,
  taxInvoices,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { likePattern, paginate, queryRows, toPaginated, whereAll } from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';
import { nextNumber } from '../../lib/numbering';
import { issueDateFor } from '../../lib/issueDate';
import { insertLedger, rateOn, recompute, vatRateOn } from './ledger';
import {
  assignNumbers,
  lockNumbering,
  numberEligible,
  periodOf,
  releaseNumber,
  resequence,
  syncInvoiceNumber,
  takeNumber,
  type AssignedNumbers,
  type NumberKind,
} from './numbers';

type Row = Record<string, unknown>;
type Input = z.output<(typeof BILLING_DOC_SCHEMAS)[BillingDocType]> & Row;

interface Config {
  table: PgTable;
  lines: PgTable;
  fk: string;
  /** SQL names, for raw list queries. */
  sqlTable: string;
  numberCol: string | null;
  numberSql: string | null;
  dateCol: string;
  dateSql: string;
  billToSql: string;
  /** Allocate the next number when the user didn't type one. */
  allocate: ((tx: Tx, date: string, clientCode: string) => Promise<string>) | null;
  kind: 'tax' | 'khr' | 'plain';
  /** Credit notes and record summaries: the processing fee line carries VAT on top. */
  vatOnFee?: true;
  /** Issuing writes the number (when the ledger has a column for it) + total into the ledger. */
  ledger: {
    numberCol: 'invNo' | 'disNo' | 'dnNo' | null;
    totalCol: 'invRevenue' | 'disTotal' | 'dnTotal' | 'clearFee';
  } | null;
}

const CONFIG: Record<BillingDocType, Config> = {
  'tax-invoices': {
    table: taxInvoices,
    lines: taxInvoiceLines,
    fk: 'taxInvoiceId',
    sqlTable: 'tax_invoices',
    numberCol: 'invoiceNo',
    numberSql: 'invoice_no',
    dateCol: 'invoiceDate',
    dateSql: 'invoice_date',
    billToSql: 'customer_name_en',
    kind: 'tax',
    allocate: async (tx, date, code) => (await takeNumber(tx, 'INV', date, code, null)).number,
    ledger: { numberCol: 'invNo', totalCol: 'invRevenue' },
  },
  disbursements: {
    table: disbursements,
    lines: disbursementLines,
    fk: 'disbursementId',
    sqlTable: 'disbursements',
    numberCol: 'disNo',
    numberSql: 'dis_no',
    dateCol: 'disDate',
    dateSql: 'dis_date',
    billToSql: 'customer_name_en',
    kind: 'khr',
    // One company-wide sequence (every client), restarting at DIS001 each January.
    allocate: async (tx, date, code) => (await takeNumber(tx, 'DIS', date, code, null)).number,
    ledger: { numberCol: 'disNo', totalCol: 'disTotal' },
  },
  'debit-notes': {
    table: debitNotes,
    lines: debitNoteLines,
    fk: 'debitNoteId',
    sqlTable: 'debit_notes',
    numberCol: 'dnNo',
    numberSql: 'dn_no',
    dateCol: 'dnDate',
    dateSql: 'dn_date',
    billToSql: 'bill_to',
    kind: 'plain',
    allocate: async (tx, date, code) => (await takeNumber(tx, 'DN', date, code, null)).number,
    ledger: { numberCol: 'dnNo', totalCol: 'dnTotal' },
  },
  'credit-notes': {
    table: creditNotes,
    lines: creditNoteLines,
    fk: 'creditNoteId',
    sqlTable: 'credit_notes',
    numberCol: 'cnNo',
    numberSql: 'cn_no',
    dateCol: 'cnDate',
    dateSql: 'cn_date',
    billToSql: 'bill_to',
    kind: 'plain',
    vatOnFee: true,
    allocate: async (tx, date) =>
      `CN${date.slice(2, 4)}-${String(await nextNumber(tx, `CREDIT_NOTE:${date.slice(0, 4)}`)).padStart(3, '0')}`,
    // "Submit to Monthly": the broker's credit note total is that declaration's Clear Fee.
    ledger: { numberCol: null, totalCol: 'clearFee' },
  },
  'record-summaries': {
    table: recordSummaries,
    lines: recordSummaryLines,
    fk: 'recordSummaryId',
    sqlTable: 'record_summaries',
    numberCol: null,
    numberSql: null,
    dateCol: 'summaryDate',
    dateSql: 'summary_date',
    billToSql: 'declare_no',
    kind: 'plain',
    vatOnFee: true,
    allocate: null,
    ledger: null,
  },
};

const col = (t: PgTable, name: string) => (t as unknown as Record<string, PgColumn>)[name]!;

/** Documents that charge VAT keep the percent of their date in vat_rate. */
const hasVat = (cfg: Config) => cfg.kind === 'tax' || !!cfg.vatOnFee;

/**
 * The numbering period a document's date falls in: debit notes run per client per month
 * (JR2610001), tax invoices (GS26-...), DIS and credit notes per year.
 */
const numberPeriod = (type: BillingDocType, date: string) =>
  type === 'debit-notes' ? date.slice(0, 7) : date.slice(0, 4);

/** Compute stored totals and line amounts with the shared formulas, at the document's VAT percent. */
function totals(
  kind: Config['kind'],
  lines: Input['lines'],
  rate: string | null,
  vatOnFee = false,
  vatRate: string = String(DEFAULT_VAT_PERCENT),
) {
  if (kind === 'tax') {
    const t = computeTaxDocument(
      lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
      rate,
      vatRate,
    );
    return {
      header: {
        subtotal: toMoneyString(t.subtotal),
        vat: toMoneyString(t.vat),
        total: toMoneyString(t.total),
        subtotalKhr: String(t.subtotalKhr),
        vatKhr: String(t.vatKhr),
        totalKhr: String(t.totalKhr),
      },
      lines: lines.map((l) => {
        const lt = computeTaxLine({ qty: l.qty, unitPrice: l.unitPrice }, vatRate);
        return {
          subtotal: toMoneyString(lt.subtotal),
          vat: toMoneyString(lt.vat),
          amount: toMoneyString(lt.amount),
        };
      }),
      ledgerTotal: toMoneyString(t.subtotal),
    };
  }
  const amount = (l: Input['lines'][number]) =>
    vatOnFee ? chargeLineAmount(l, vatRate) : lineAmount(l.qty, l.unitPrice);
  const total = vatOnFee
    ? computeChargeLinesTotal(lines, vatRate)
    : computeLinesTotal(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));
  return {
    header:
      kind === 'khr'
        ? { total: toMoneyString(total), totalKhr: String(usdToKhr(total, rate)) }
        : { total: toMoneyString(total) },
    lines: lines.map((l) => ({ subtotal: toMoneyString(amount(l)) })),
    ledgerTotal: toMoneyString(total),
  };
}

function friendlyUnique(err: unknown, type: BillingDocType): never {
  const c =
    (err as { cause?: { code?: string; detail?: string } }).cause ??
    (err as { code?: string; detail?: string });
  if (c?.code === '23505') {
    const v = /\)=\((.*)\)/.exec(c.detail ?? '')?.[1];
    throw conflict(
      `Number ${v ?? ''} is already used by another ${type.replace(/-/g, ' ').replace(/s$/, '')}`.replace(
        '  ',
        ' ',
      ),
    );
  }
  throw err;
}

async function loadClient(tx: Tx, clientId: string) {
  const [c] = await tx.select().from(clients).where(eq(clients.id, clientId));
  if (!c || c.deletedAt) throw businessRule('The selected client does not exist');
  return c;
}

async function assertRecord(tx: Tx, recordId: string | null, clientId: string) {
  if (!recordId) return;
  const [r] = await tx
    .select({ clientId: accountingRecords.clientId })
    .from(accountingRecords)
    .where(eq(accountingRecords.id, recordId));
  if (!r) throw businessRule('The linked ledger entry does not exist');
  if (r.clientId !== clientId) throw businessRule('The ledger entry belongs to a different client');
}

/** The ledger number kind each shipment document carries. */
const KIND: Record<IssueDatedType, NumberKind> = {
  'tax-invoices': 'INV',
  disbursements: 'DIS',
  'debit-notes': 'DN',
};
const LEDGER_FIELD = { INV: 'invNo', DIS: 'disNo', DN: 'dnNo' } as const;

/**
 * A shipment document's number, date and rates, from its Monthly Ledger entry: the number
 * given when its Chea payment was checked, the issue date (next working day after
 * clearance), that day's exchange rate and the entry's VAT percent. One live document of each
 * type per shipment.
 */
async function fromLedger(
  tx: Tx,
  type: IssueDatedType,
  recordId: string,
  exceptDocId: string | null,
): Promise<Row> {
  const cfg = CONFIG[type];
  const [r] = await queryRows<{
    declareNo: string;
    invDate: string;
    rate: string;
    vatRate: string;
    invNo: string | null;
    disNo: string | null;
    dnNo: string | null;
  }>(
    tx,
    sql`SELECT d.declare_no AS "declareNo", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate",
               a.exchange_rate::text AS rate, a.vat_rate::text AS "vatRate", a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo"
        FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        WHERE a.id = ${recordId}`,
  );
  if (!r) throw businessRule('The linked ledger entry does not exist');
  const number = r[LEDGER_FIELD[KIND[type]]];
  const label = BILLING_LABEL[type].toLowerCase();
  if (!number)
    throw businessRule(
      `${r.declareNo} has no ${label} number yet. It gets one when its Chea payment is marked Checked.`,
    );
  const [other] = await queryRows<{ number: string }>(
    tx,
    sql`SELECT ${sql.raw(cfg.numberSql!)} AS number FROM ${sql.raw(cfg.sqlTable)}
        WHERE accounting_record_id = ${recordId} AND status <> 'VOID'
          ${exceptDocId ? sql`AND id <> ${exceptDocId}` : sql``} LIMIT 1`,
  );
  if (other) throw conflict(`${r.declareNo} already has ${label} ${other.number}`);
  return {
    [cfg.numberCol!]: number,
    [cfg.dateCol]: r.invDate,
    ...(cfg.kind !== 'plain' ? { exchangeRate: r.rate } : {}),
    ...(hasVat(cfg) ? { vatRate: r.vatRate } : {}),
  };
}

/**
 * A record summary's INV / DIS / DN: never typed, always its Monthly Ledger row's (given when
 * the accountant checks the Chea payment, and following any later correction there). An
 * unlinked summary has none.
 */
async function ledgerNumbers(
  tx: Tx | typeof db,
  recordId: string | null,
): Promise<{ invNo: string | null; disNo: string | null; dnNo: string | null }> {
  const [r] = recordId
    ? await queryRows<{ invNo: string | null; disNo: string | null; dnNo: string | null }>(
        tx,
        sql`SELECT inv_no AS "invNo", dis_no AS "disNo", dn_no AS "dnNo" FROM accounting_records WHERE id = ${recordId}`,
      )
    : [];
  return { invNo: r?.invNo ?? null, disNo: r?.disNo ?? null, dnNo: r?.dnNo ?? null };
}

/**
 * A record summary not linked to a ledger row (started from the shipping plan) takes its
 * declaration's row once there is one, so its INV / DIS / DN numbers follow the ledger.
 */
async function linkSummary(tx: Tx, type: BillingDocType, input: Input): Promise<Input> {
  const declareNo = String(input.declareNo ?? '').trim();
  if (type !== 'record-summaries' || input.accountingRecordId || !declareNo) return input;
  const [r] = await queryRows<{ id: string }>(
    tx,
    sql`SELECT a.id FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        WHERE a.client_id = ${input.clientId} AND upper(d.declare_no) = upper(${declareNo}) LIMIT 1`,
  );
  return r ? { ...input, accountingRecordId: r.id } : input;
}

function headerValues(type: BillingDocType, input: Input) {
  const { lines: _l, ...rest } = input;
  const numberCol = CONFIG[type].numberCol;
  // An empty number means "allocate one"; a typed number is stored upper-case.
  const values = Object.fromEntries(
    Object.entries(rest)
      .filter(([k, v]) => !(k === numberCol && !v))
      .map(([k, v]) => [k, k === numberCol && typeof v === 'string' ? v.toUpperCase() : v]),
  ) as Row;
  // An air shipment has no CBM: a record summary by air always shows "NON".
  if (type === 'record-summaries' && values.transportMode === 'AIR') values.cbm = 'NON';
  return values;
}

async function writeLines(
  tx: Tx,
  type: BillingDocType,
  docId: string,
  input: Input,
  lineTotals: Row[],
  vatRate?: string,
) {
  const cfg = CONFIG[type];
  await tx.insert(cfg.lines).values(
    input.lines.map((l, i) => ({
      [cfg.fk]: docId,
      lineNo: i + 1,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      // The processing fee's "VAT 10%" Mark follows the document's percent.
      mark: cfg.vatOnFee && vatRate ? vatMark(l, vatRate) : l.mark,
      ...lineTotals[i],
    })) as never,
  );
}

export async function createDoc(type: BillingDocType, typed: Input, req: Request): Promise<string> {
  const cfg = CONFIG[type];
  try {
    return await db.transaction(async (tx) => {
      const input = await linkSummary(tx, type, typed);
      const client = await loadClient(tx, input.clientId);
      await assertRecord(tx, input.accountingRecordId ?? null, input.clientId);
      const values = headerValues(type, input);
      if (isIssueDated(type)) {
        // Never typed: a shipment's document takes its Monthly Ledger number and date.
        values[cfg.numberCol!] = undefined;
        if (input.accountingRecordId)
          Object.assign(values, await fromLedger(tx, type, input.accountingRecordId, null));
      }
      if (type === 'record-summaries')
        Object.assign(values, await ledgerNumbers(tx, input.accountingRecordId ?? null));
      const date = values[cfg.dateCol] as string;
      if (cfg.numberCol && !values[cfg.numberCol] && cfg.allocate)
        values[cfg.numberCol] = await cfg.allocate(tx, date, client.code);
      // The VAT percent in force on the document's date (a shipment's: its ledger entry's).
      if (hasVat(cfg)) values.vatRate ??= await vatRateOn(tx, date);
      const t = totals(
        cfg.kind,
        input.lines,
        (values.exchangeRate as string | undefined) ?? null,
        cfg.vatOnFee,
        values.vatRate as string | undefined,
      );
      const [row] = (await tx
        .insert(cfg.table)
        .values({ ...values, ...t.header, status: 'DRAFT', createdById: req.auth!.userId } as never)
        .returning()) as Row[];
      await writeLines(tx, type, row!.id as string, input, t.lines, values.vatRate as string);
      await audit(
        tx,
        {
          action: 'CREATE',
          entity: cfg.sqlTable,
          entityId: row!.id as string,
          after: { ...row, lines: input.lines },
        },
        req,
      );
      return row!.id as string;
    });
  } catch (err) {
    return friendlyUnique(err, type);
  }
}

async function lockDoc(tx: Tx, type: BillingDocType, id: string): Promise<Row> {
  const cfg = CONFIG[type];
  const [row] = (await tx
    .select()
    .from(cfg.table)
    .where(eq(col(cfg.table, 'id'), id))
    .for('update')) as Row[];
  if (!row) throw notFound(BILLING_LABEL[type]);
  return row;
}

const BILLING_LABEL: Record<BillingDocType, string> = {
  'tax-invoices': 'Tax invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit note',
  'credit-notes': 'Credit note',
  'record-summaries': 'Record summary',
};

/** Submitted credit notes and record summaries can be revised by their makers and resubmitted. */
export const isRevisable = (type: BillingDocType) =>
  type === 'credit-notes' || type === 'record-summaries';

/**
 * Save a document's changes. With `resubmit`, a submitted credit note or record summary is
 * revised in place ("Revise" → "Resubmit"): it stays submitted, keeps its number, client,
 * declaration and ledger entry, and goes back to accounting as Request Revise. The Monthly
 * Ledger keeps its last approved amounts until accounting approves the revision.
 */
export async function updateDoc(
  type: BillingDocType,
  id: string,
  typed: Input,
  req: Request,
  opts: { resubmit?: boolean } = {},
): Promise<void> {
  const cfg = CONFIG[type];
  try {
    await db.transaction(async (tx) => {
      const before = await lockDoc(tx, type, id);
      // An issued tax invoice, DIS or debit note stays editable: its lines and details can be
      // fixed, while its number, date, rate, client and ledger entry stay as issued (the number
      // and date change through a correction).
      const issued = before.status === 'ISSUED' && isIssueDated(type);
      const resubmit = !!opts.resubmit;
      if (resubmit && (before.status !== 'ISSUED' || !isRevisable(type)))
        throw conflict(`Only a submitted ${BILLING_LABEL[type].toLowerCase()} can be revised`);
      if (before.status !== 'DRAFT' && !issued && !resubmit)
        throw conflict(
          `${BILLING_LABEL[type]} is ${before.status === 'VOID' ? 'cancelled' : String(before.status).toLowerCase()} and can no longer be edited. Cancel it and create a new one.`,
        );
      const linkedInput = await linkSummary(tx, type, typed);
      const input =
        issued || resubmit
          ? {
              ...linkedInput,
              clientId: before.clientId as string,
              accountingRecordId: (before.accountingRecordId as string | null) ?? null,
              // A revision stays on its declaration (the ledger entry it belongs to).
              ...(resubmit ? { declareNo: before.declareNo as string | null } : {}),
            }
          : linkedInput;
      const client = await loadClient(tx, input.clientId);
      await assertRecord(tx, input.accountingRecordId ?? null, input.clientId);
      const values = headerValues(type, input);
      const linked = isIssueDated(type) && !!input.accountingRecordId;
      if (isIssueDated(type)) values[cfg.numberCol!] = undefined; // never typed
      if (type === 'record-summaries')
        Object.assign(values, await ledgerNumbers(tx, input.accountingRecordId ?? null));
      if (issued)
        Object.assign(values, {
          [cfg.numberCol!]: before[cfg.numberCol!],
          [cfg.dateCol]: before[cfg.dateCol],
          ...(cfg.kind !== 'plain' ? { exchangeRate: before.exchangeRate } : {}),
        });
      else if (linked)
        Object.assign(values, await fromLedger(tx, type, input.accountingRecordId!, id));
      else if (resubmit) {
        if (cfg.numberCol) values[cfg.numberCol] = before[cfg.numberCol]; // keeps its number
      } else {
        if (cfg.numberCol && !values[cfg.numberCol]) values[cfg.numberCol] = before[cfg.numberCol]; // keep the allocated number
        // A draft whose date moves into another month (debit note) or year (the others) takes
        // that period's next number, unless the user typed a number of their own.
        const newDate = values[cfg.dateCol] as string;
        if (
          cfg.numberCol &&
          cfg.allocate &&
          values[cfg.numberCol] === before[cfg.numberCol] &&
          numberPeriod(type, String(before[cfg.dateCol])) !== numberPeriod(type, newDate)
        )
          values[cfg.numberCol] = await cfg.allocate(tx, newDate, client.code);
      }
      // The document keeps its VAT percent while its date stays; a new date takes that date's.
      if (hasVat(cfg) && values.vatRate === undefined) {
        const date = String(values[cfg.dateCol]);
        values.vatRate =
          date === String(before[cfg.dateCol])
            ? (before.vatRate as string)
            : await vatRateOn(tx, date);
      }
      const t = totals(
        cfg.kind,
        input.lines,
        (values.exchangeRate as string | undefined) ?? null,
        cfg.vatOnFee,
        values.vatRate as string,
      );
      await tx
        .update(cfg.table)
        .set({ ...values, ...t.header } as never)
        .where(eq(col(cfg.table, 'id'), id));
      await tx.delete(cfg.lines).where(eq(col(cfg.lines, cfg.fk), id));
      await writeLines(tx, type, id, input, t.lines, values.vatRate as string);
      if (issued) await issuedToLedger(tx, cfg, await lockDoc(tx, type, id), req);
      // Back to accounting; the ledger keeps the last approved amounts until they approve it.
      if (resubmit)
        await tx
          .update(cfg.table)
          .set({
            reviewStatus: 'REVISION_REQUESTED',
            ...(type === 'record-summaries' ? { reviewNote: null } : {}),
          } as never)
          .where(eq(col(cfg.table, 'id'), id));
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: cfg.sqlTable,
          entityId: id,
          before,
          after: resubmit ? { ...input, reviewStatus: 'REVISION_REQUESTED' } : input,
        },
        req,
      );
    });
  } catch (err) {
    friendlyUnique(err, type);
  }
}

/**
 * Issue: the document becomes final. For tax invoices, disbursements and debit notes the
 * linked ledger row takes this document's number and total, and net profit is recalculated.
 */
export async function issueDoc(type: BillingDocType, id: string, req: Request): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    if (doc.status !== 'DRAFT')
      throw conflict(
        `Only drafts can be issued; this one is ${doc.status === 'VOID' ? 'cancelled' : String(doc.status).toLowerCase()}`,
      );
    await tx
      .update(cfg.table)
      // A credit note accounting sent back comes back to them as Unchecked.
      .set(
        (type === 'credit-notes'
          ? { status: 'ISSUED', reviewStatus: 'UNCHECKED' }
          : type === 'record-summaries'
            ? // Submitted to accounting (Expense to Clients) to check.
              { status: 'ISSUED', reviewStatus: 'UNCHECKED', reviewNote: null }
            : { status: 'ISSUED' }) as never,
      )
      .where(eq(col(cfg.table, 'id'), id));
    // A credit note reaches the Monthly Ledger when accounting checks it, not on submission.
    if (type !== 'credit-notes') await issuedToLedger(tx, cfg, doc, req);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: cfg.sqlTable,
        entityId: id,
        before: { status: doc.status },
        after: { status: 'ISSUED' },
      },
      req,
    );
  });
}

/** An issued document's number and total into its Monthly Ledger row (on issue, and on later edits). */
async function issuedToLedger(tx: Tx, cfg: Config, doc: Row, req: Request): Promise<void> {
  if (!cfg.ledger || !doc.accountingRecordId) return;
  const total = cfg.kind === 'tax' ? doc.subtotal : doc.total;
  // A submitted record summary decides the amounts; the document then only gives its number.
  const summary = await liveSummaryId(tx, doc.accountingRecordId as string);
  await tx
    .update(accountingRecords)
    .set({
      ...(cfg.ledger.numberCol
        ? { [cfg.ledger.numberCol]: cfg.numberCol ? doc[cfg.numberCol] : null }
        : {}),
      ...(summary ? {} : { [cfg.ledger.totalCol]: total }),
      updatedById: req.auth!.userId,
    } as never)
    .where(eq(accountingRecords.id, doc.accountingRecordId as string));
  await recompute(tx, doc.accountingRecordId as string);
}

/**
 * The Monthly Ledger row a credit note or record summary belongs to, found through its declare
 * no. When the declaration has no ledger row yet, one is created (amounts 0) so the clear fee
 * or the summary's charges have a home.
 */
async function ledgerRowByDeclareNo(
  tx: Tx,
  doc: Row,
  req: Request,
  what = 'credit note',
): Promise<string> {
  const declareNo = String(doc.declareNo ?? '').trim();
  if (!declareNo)
    throw businessRule(`Enter the declare no. so the ${what} can go into the Monthly Ledger`);
  const [d] = await queryRows<{ id: string; clientId: string; recordId: string | null }>(
    tx,
    sql`
    SELECT d.id, s.client_id AS "clientId", a.id AS "recordId"
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL
    LEFT JOIN accounting_records a ON a.declaration_id = d.id
    WHERE upper(d.declare_no) = upper(${declareNo})
    ORDER BY d.declare_date DESC LIMIT 1`,
  );
  if (!d) throw businessRule(`Declaration ${declareNo} was not found on any shipment`);
  if (d.clientId !== doc.clientId)
    throw businessRule(`Declaration ${declareNo} belongs to a different client`);
  return d.recordId ?? insertLedger(tx, ledgerInputSchema.parse({ declarationId: d.id }), req);
}

/** Undo what issuing wrote into the Monthly Ledger row (if that row still shows this document). */
/**
 * The shipment's checked record summary, which decides its INV, THC, REIM and DN. One being
 * revised (Request Revise) still counts: the ledger keeps its approved amounts meanwhile.
 */
async function liveSummaryId(tx: Tx, recordId: string): Promise<string | null> {
  const [r] = await tx
    .select({ id: recordSummaries.id })
    .from(recordSummaries)
    .where(
      and(
        eq(recordSummaries.accountingRecordId, recordId),
        eq(recordSummaries.status, 'ISSUED'),
        inArray(recordSummaries.reviewStatus, ['CHECKED', 'REVISION_REQUESTED']),
      ),
    )
    .limit(1);
  return r?.id ?? null;
}

/**
 * Checked in Expense to Clients: the record summary's lines fill the ledger row ("Accountant (Monthly)
 * data flow"): INV = the processing fee before VAT, DIS / REIM = the receipt lines, DN = the rest,
 * THC = the THC / HBL fee.
 */
async function summaryToLedger(
  tx: Tx,
  summaryId: string,
  recordId: string,
  req: Request,
): Promise<void> {
  const userId = req.auth!.userId;
  const lines = await tx
    .select({
      description: recordSummaryLines.description,
      mark: recordSummaryLines.mark,
      qty: recordSummaryLines.qty,
      unitPrice: recordSummaryLines.unitPrice,
    })
    .from(recordSummaryLines)
    .where(eq(recordSummaryLines.recordSummaryId, summaryId));
  const t = recordSummaryLedger(lines);
  await tx
    .update(accountingRecords)
    .set({
      invRevenue: toMoneyString(t.invRevenue),
      thc: toMoneyString(t.thc),
      disTotal: toMoneyString(t.disTotal),
      dnTotal: toMoneyString(t.dnTotal),
      updatedById: userId,
    })
    .where(eq(accountingRecords.id, recordId));
  await recompute(tx, recordId);
  // No processing fee means no tax invoice, so no INV number.
  await syncInvoiceNumber(tx, recordId, req);
}

/** A checked record summary unchecked, revised or cancelled: the amounts go back to the issued documents'. */
async function summaryOutOfLedger(tx: Tx, recordId: string): Promise<void> {
  if (await liveSummaryId(tx, recordId)) return;
  const issued = (table: string, total: string) =>
    sql.raw(
      `coalesce((SELECT sum(${total}) FROM ${table} WHERE accounting_record_id = accounting_records.id AND status = 'ISSUED'), 0)`,
    );
  await tx
    .update(accountingRecords)
    .set({
      invRevenue: sql`${issued('tax_invoices', 'subtotal')}`,
      disTotal: sql`${issued('disbursements', 'total')}`,
      dnTotal: sql`${issued('debit_notes', 'total')}`,
      thc: '0',
    })
    .where(eq(accountingRecords.id, recordId));
  await recompute(tx, recordId);
}

async function takeOutOfLedger(tx: Tx, cfg: Config, doc: Row): Promise<void> {
  if (!cfg.ledger || !doc.accountingRecordId) return;
  const [r] = await tx
    .select()
    .from(accountingRecords)
    .where(eq(accountingRecords.id, doc.accountingRecordId as string));
  const numberCol = cfg.ledger.numberCol;
  const stillOurs = numberCol
    ? !!cfg.numberCol && r?.[numberCol] === doc[cfg.numberCol]
    : Number(r?.[cfg.ledger.totalCol]) === Number(doc.total);
  if (!r || !stillOurs) return;
  // With a submitted record summary, the amount is the summary's: only the number goes.
  const keepTotal = !!(await liveSummaryId(tx, r.id));
  await tx
    .update(accountingRecords)
    .set({
      ...(numberCol ? { [numberCol]: null } : {}),
      ...(keepTotal ? {} : { [cfg.ledger.totalCol]: '0' }),
    } as never)
    .where(eq(accountingRecords.id, r.id));
  await recompute(tx, r.id);
}

/**
 * A credit note's Clear Fee out of its Monthly Ledger row. Under revision (Request Revise) the
 * row still holds the last approved fee, no longer the note's total, so it goes by status.
 */
async function creditNoteOutOfLedger(tx: Tx, doc: Row): Promise<void> {
  if (doc.reviewStatus !== 'REVISION_REQUESTED' || !doc.accountingRecordId)
    return takeOutOfLedger(tx, CONFIG['credit-notes'], doc);
  await tx
    .update(accountingRecords)
    .set({ clearFee: '0' })
    .where(eq(accountingRecords.id, doc.accountingRecordId as string));
  await recompute(tx, doc.accountingRecordId as string);
}

/**
 * Cancel (void): keeps the document and its number (never reused) and takes it back out of
 * the ledger; a shipment's entry then takes the next number for a replacement document.
 */
export async function voidDoc(
  type: BillingDocType,
  id: string,
  reason: string,
  req: Request,
): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    if (doc.status === 'VOID') throw conflict('Already cancelled');
    await tx
      .update(cfg.table)
      .set({ status: 'VOID' } as never)
      .where(eq(col(cfg.table, 'id'), id));
    if (doc.status === 'ISSUED')
      await (type === 'credit-notes'
        ? creditNoteOutOfLedger(tx, doc)
        : takeOutOfLedger(tx, cfg, doc));
    if (
      type === 'record-summaries' &&
      (doc.reviewStatus === 'CHECKED' || doc.reviewStatus === 'REVISION_REQUESTED') &&
      doc.accountingRecordId
    )
      await summaryOutOfLedger(tx, doc.accountingRecordId as string);
    // The cancelled document keeps its number, so the shipment takes the next one.
    if (isIssueDated(type) && doc.accountingRecordId) {
      const field = LEDGER_FIELD[KIND[type]];
      await tx
        .update(accountingRecords)
        .set({ [field]: null } as never)
        .where(
          and(
            eq(accountingRecords.id, doc.accountingRecordId as string),
            eq(accountingRecords[field], String(doc[cfg.numberCol!])),
          ),
        );
      await assignNumbers(tx, doc.accountingRecordId as string, req, [KIND[type]]);
      await resequence(tx, req);
    }
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: cfg.sqlTable,
        entityId: id,
        before: { status: doc.status },
        after: { status: 'VOID' },
        reason,
      },
      req,
    );
  });
}

/** The three documents dated from the clearance date and correctable once issued. */
const ISSUE_DATED = ['tax-invoices', 'disbursements', 'debit-notes'] as const;
export type IssueDatedType = (typeof ISSUE_DATED)[number];
export const isIssueDated = (type: BillingDocType): type is IssueDatedType =>
  (ISSUE_DATED as readonly string[]).includes(type);

/**
 * A declaration's clearance (declare) date changed. While none of its tax invoice, DIS and
 * debit note is issued, its Monthly Ledger entry moves to the new issue date (the next
 * working day) and that day's rate; a number whose period changes (a debit note's month, an
 * INV or DIS year) is given back and the period's next one taken. Drafts follow the entry.
 * Once one document is issued, the dates and numbers stay as they are.
 */
export async function applyClearanceDate(
  tx: Tx,
  declarationId: string,
  req: Request,
): Promise<void> {
  const [rec] = await queryRows<{
    id: string;
    declareDate: string;
    declareNo: string;
    invDate: string;
    code: string;
    invNo: string | null;
    disNo: string | null;
    dnNo: string | null;
  }>(
    tx,
    sql`SELECT a.id, to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", d.declare_no AS "declareNo",
               to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", c.code,
               a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo"
        FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        JOIN clients c ON c.id = a.client_id WHERE a.declaration_id = ${declarationId}`,
  );
  if (!rec) return;
  const [{ issued } = { issued: 0 }] = await queryRows<{ issued: number }>(
    tx,
    sql`SELECT ((SELECT count(*) FROM tax_invoices WHERE accounting_record_id = ${rec.id} AND status = 'ISSUED')
              + (SELECT count(*) FROM disbursements WHERE accounting_record_id = ${rec.id} AND status = 'ISSUED')
              + (SELECT count(*) FROM debit_notes WHERE accounting_record_id = ${rec.id} AND status = 'ISSUED'))::int AS issued`,
  );
  if (issued) return;
  const date = await issueDateFor(tx, rec.declareDate);
  if (date === rec.invDate) return;
  const reason = `Declaration date changed to ${rec.declareDate}`;
  const rate = await rateOn(tx, date);
  const vatRate = await vatRateOn(tx, date);
  await lockNumbering(tx);
  // Numbers whose period changes come off the entry, then the new period's are taken.
  const moved = ISSUE_DATED.map((type) => KIND[type]).filter((kind) => {
    const n = rec[LEDGER_FIELD[kind]];
    return !!n && periodOf(kind, rec.invDate, rec.code).key !== periodOf(kind, date, rec.code).key;
  });
  await tx
    .update(accountingRecords)
    .set({
      invDate: date,
      exchangeRate: rate,
      vatRate,
      ...Object.fromEntries(moved.map((k) => [LEDGER_FIELD[k], null])),
      updatedById: req.auth?.userId ?? null,
    })
    .where(eq(accountingRecords.id, rec.id));
  await recompute(tx, rec.id);
  const assigned = moved.length ? await assignNumbers(tx, rec.id, req, moved) : null;
  await audit(
    tx,
    {
      action: 'UPDATE',
      entity: 'accounting_record',
      entityId: rec.id,
      before: { invDate: rec.invDate, invNo: rec.invNo, disNo: rec.disNo, dnNo: rec.dnNo },
      after: {
        invDate: date,
        exchangeRate: rate,
        ...Object.fromEntries(
          (assigned?.numbers ?? []).map((n) => [LEDGER_FIELD[n.kind], n.number]),
        ),
      },
      reason,
    },
    req,
  );
  for (const type of ISSUE_DATED) {
    const cfg = CONFIG[type];
    const kind = KIND[type];
    const number = assigned?.numbers.find((n) => n.kind === kind)?.number;
    const drafts = (await tx
      .select()
      .from(cfg.table)
      .where(
        and(
          eq(col(cfg.table, 'accountingRecordId'), rec.id),
          eq(col(cfg.table, 'status'), 'DRAFT'),
        ),
      )) as Row[];
    for (const d of drafts) {
      const set: Row = {
        [cfg.dateCol]: date,
        ...(cfg.kind !== 'plain' ? { exchangeRate: rate } : {}),
        ...(hasVat(cfg) ? { vatRate } : {}),
        ...(number ? { [cfg.numberCol!]: number } : {}),
      };
      await tx
        .update(cfg.table)
        .set(set as never)
        .where(eq(col(cfg.table, 'id'), d.id as string));
      // Moved past a VAT change: the draft's amounts follow its new percent.
      if (hasVat(cfg) && Number(d.vatRate) !== Number(vatRate))
        await retotal(tx, type, d.id as string, rate, vatRate);
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: cfg.sqlTable,
          entityId: d.id as string,
          before: { date: d[cfg.dateCol], number: d[cfg.numberCol!] },
          after: set,
          reason,
        },
        req,
      );
    }
    // The old number is free once neither the entry nor a draft carries it.
    const old = rec[LEDGER_FIELD[kind]];
    if (number && old)
      await releaseNumber(
        tx,
        kind,
        old,
        rec.invDate,
        rec.code,
        rec.declareNo,
        req.auth?.userId ?? null,
      );
  }
  // The new date may put the shipment before or after others in its runs.
  await resequence(tx, req);
}

/** Recalculate a saved document's line and header totals at the given rates. */
async function retotal(
  tx: Tx,
  type: BillingDocType,
  id: string,
  rate: string | null,
  vatRate: string,
): Promise<void> {
  const cfg = CONFIG[type];
  const lines = (await tx
    .select()
    .from(cfg.lines)
    .where(eq(col(cfg.lines, cfg.fk), id))
    .orderBy(asc(col(cfg.lines, 'lineNo')))) as Row[];
  const t = totals(cfg.kind, lines as Input['lines'], rate, cfg.vatOnFee, vatRate);
  await tx
    .update(cfg.table)
    .set(t.header as never)
    .where(eq(col(cfg.table, 'id'), id));
  for (const [i, l] of lines.entries())
    await tx
      .update(cfg.lines)
      .set(t.lines[i] as never)
      .where(eq(col(cfg.lines, 'id'), l.id as string));
}

/**
 * An authorised correction of an issued tax invoice, DIS or debit note: its number and/or
 * issue date, with a reason kept in the audit history. The Monthly Ledger entry follows a new
 * number when it still shows the old one. Numbers stay unique (per year for DIS).
 */
export async function correctIssuedDoc(
  type: IssueDatedType,
  id: string,
  input: { number?: string | undefined; date?: string | undefined; reason: string },
  req: Request,
): Promise<void> {
  const cfg = CONFIG[type];
  const numberCol = cfg.numberCol!;
  try {
    await db.transaction(async (tx) => {
      const doc = await lockDoc(tx, type, id);
      if (doc.status !== 'ISSUED')
        throw conflict(
          doc.status === 'DRAFT'
            ? 'This is a draft: change its number or date in the editor and save'
            : 'A cancelled document cannot be corrected',
        );
      const oldNumber = String(doc[numberCol]);
      const oldDate = String(doc[cfg.dateCol]);
      const number = input.number?.trim().toUpperCase() || oldNumber;
      const date = input.date || oldDate;
      if (number === oldNumber && date === oldDate)
        throw businessRule('Change the number or the date, or close without correcting');
      await tx
        .update(cfg.table)
        .set({ [numberCol]: number, [cfg.dateCol]: date } as never)
        .where(eq(col(cfg.table, 'id'), id));
      const ledgerCol = cfg.ledger?.numberCol;
      if (ledgerCol && doc.accountingRecordId && number !== oldNumber)
        await tx
          .update(accountingRecords)
          .set({ [ledgerCol]: number, updatedById: req.auth!.userId } as never)
          .where(
            and(
              eq(accountingRecords.id, doc.accountingRecordId as string),
              eq(accountingRecords[ledgerCol], oldNumber),
            ),
          );
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: cfg.sqlTable,
          entityId: id,
          before: { number: oldNumber, date: oldDate },
          after: { number, date, correction: true },
          reason: input.reason,
        },
        req,
      );
    });
  } catch (err) {
    friendlyUnique(err, type);
  }
}

export async function deleteDoc(type: BillingDocType, id: string, req: Request): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    // A discarded credit note or cancelled record summary is already out of the ledger and
    // carries no billing number, so it can go too; cancelled invoices keep theirs on record.
    const voidDeletable = doc.status === 'VOID' && !isIssueDated(type);
    if (doc.status !== 'DRAFT' && !voidDeletable)
      throw conflict('Only drafts can be deleted. Cancel an issued document instead.');
    await tx.delete(cfg.table).where(eq(col(cfg.table, 'id'), id));
    // A shipment's draft only borrowed its ledger number; a loose one gives its number back.
    if (isIssueDated(type) && !doc.accountingRecordId && doc[cfg.numberCol!]) {
      const [c] = await tx
        .select({ code: clients.code })
        .from(clients)
        .where(eq(clients.id, doc.clientId as string));
      await releaseNumber(
        tx,
        KIND[type],
        String(doc[cfg.numberCol!]),
        String(doc[cfg.dateCol]),
        c?.code ?? '',
        null,
        req.auth?.userId ?? null,
      );
    }
    await audit(tx, { action: 'DELETE', entity: cfg.sqlTable, entityId: id, before: doc }, req);
  });
}

export async function getDoc(type: BillingDocType, id: string): Promise<BillingDoc> {
  const cfg = CONFIG[type];
  const [doc] = (await db
    .select()
    .from(cfg.table)
    .where(eq(col(cfg.table, 'id'), id))) as Row[];
  if (!doc) throw notFound(BILLING_LABEL[type]);
  const [client] = await db
    .select({ code: clients.code, name: clients.name })
    .from(clients)
    .where(eq(clients.id, doc.clientId as string));
  const lines = (await db
    .select()
    .from(cfg.lines)
    .where(eq(col(cfg.lines, cfg.fk), id))
    .orderBy(asc(col(cfg.lines, 'lineNo')))) as Row[];
  const [rec] = doc.accountingRecordId
    ? await queryRows<{ declareNo: string; transportMode: string | null }>(
        db,
        sql`SELECT d.declare_no AS "declareNo", s.transport_mode AS "transportMode"
            FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
            LEFT JOIN shipments s ON s.id = d.shipment_id WHERE a.id = ${doc.accountingRecordId as string}`,
      )
    : [];
  const skip = new Set([
    'id',
    'clientId',
    'accountingRecordId',
    'status',
    'createdById',
    'createdAt',
    'updatedAt',
    'subtotal',
    'vat',
    'total',
    'subtotalKhr',
    'vatKhr',
    'totalKhr',
  ]);
  const header = Object.fromEntries(
    Object.entries(doc)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => [k, v === null || v === undefined ? null : String(v)]),
  );
  // The shipment's mode, for printing: by air the volume shows "NON" (a record summary has its own).
  if (!header.transportMode && rec?.transportMode) header.transportMode = rec.transportMode;
  // Live from the Monthly Ledger, so a number the accountant corrects there shows here too.
  if (type === 'record-summaries' && doc.accountingRecordId)
    Object.assign(header, await ledgerNumbers(db, doc.accountingRecordId as string));
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  return {
    id,
    type,
    number: cfg.numberCol ? ((doc[cfg.numberCol] as string | null) ?? null) : null,
    date: doc[cfg.dateCol] as string,
    status: doc.status as BillingDoc['status'],
    clientId: doc.clientId as string,
    clientCode: client!.code,
    clientName: client!.name,
    accountingRecordId: (doc.accountingRecordId as string | null) ?? null,
    declareNo: rec?.declareNo ?? (doc.declareNo as string | null) ?? null,
    header,
    lines: lines.map((l) => ({
      id: l.id as string,
      lineNo: l.lineNo as number,
      description: l.description as string,
      qty: l.qty as string,
      unit: (l.unit as string | null) ?? null,
      unitPrice: l.unitPrice as string,
      subtotal: l.subtotal as string,
      mark: (l.mark as string | null) ?? null,
      ...(cfg.kind === 'tax' ? { vat: l.vat as string, amount: l.amount as string } : {}),
    })),
    totals: {
      subtotal: s(doc.subtotal) ?? s(doc.total) ?? '0',
      vat: s(doc.vat) ?? '0.00',
      total: s(doc.total) ?? '0',
      ...(cfg.kind !== 'plain' ? { totalKhr: s(doc.totalKhr) } : {}),
      ...(cfg.kind === 'tax' ? { subtotalKhr: s(doc.subtotalKhr), vatKhr: s(doc.vatKhr) } : {}),
    },
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
  };
}

/**
 * A document as it would print from these values, without saving anything: the month pack's
 * sheet for a number typed in the Monthly Ledger (a document made outside the system), so the
 * pack still has every shipment's tax invoice, DIS and debit note. Totals use the same
 * formulas as a saved document.
 */
export function previewDoc(
  type: BillingDocType,
  values: Row & { lines: BillingLineInput[] },
  meta: {
    number: string;
    date: string;
    clientCode: string;
    clientName: string;
    declareNo: string | null;
    recordId: string;
  },
): BillingDoc {
  const cfg = CONFIG[type];
  const lines = values.lines.map((l) => ({
    ...l,
    qty: String(l.qty || '0'),
    unitPrice: String(l.unitPrice || '0'),
  }));
  const rate = values.exchangeRate == null ? null : String(values.exchangeRate);
  const vatRate = values.vatRate == null ? undefined : String(values.vatRate);
  const t = totals(cfg.kind, lines as Input['lines'], rate, cfg.vatOnFee, vatRate);
  const header: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(values))
    if (k !== 'lines' && !/Id$/.test(k))
      header[k] = v === null || v === undefined ? null : String(v);
  if (cfg.numberCol) header[cfg.numberCol] = meta.number;
  header[cfg.dateCol] = meta.date;
  const h = t.header as Record<string, string | undefined>;
  return {
    id: `ledger-${type}-${meta.recordId}`,
    type,
    number: meta.number,
    date: meta.date,
    status: 'ISSUED',
    clientId: String(values.clientId ?? ''),
    clientCode: meta.clientCode,
    clientName: meta.clientName,
    accountingRecordId: meta.recordId,
    declareNo: meta.declareNo,
    header,
    lines: lines.map((l, i) => ({
      id: String(i + 1),
      lineNo: i + 1,
      description: l.description,
      qty: l.qty,
      unit: l.unit ?? null,
      unitPrice: l.unitPrice,
      subtotal: t.lines[i]!.subtotal,
      ...(cfg.kind === 'tax'
        ? {
            vat: (t.lines[i] as { vat: string }).vat,
            amount: (t.lines[i] as { amount: string }).amount,
          }
        : {}),
      mark: l.mark || null,
    })),
    totals: {
      subtotal: h.subtotal ?? h.total ?? '0',
      vat: h.vat ?? '0.00',
      total: h.total ?? '0',
      ...(cfg.kind !== 'plain' ? { totalKhr: h.totalKhr } : {}),
      ...(cfg.kind === 'tax' ? { subtotalKhr: h.subtotalKhr, vatKhr: h.vatKhr } : {}),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listDocs(
  type: BillingDocType,
  p: {
    page: number;
    pageSize: number;
    q?: string | undefined;
    clientId?: string | undefined;
    /** Per-user client access; undefined = every client. */
    clientIds?: string[] | undefined;
    status?: string | undefined;
    month?: string | undefined;
    year?: number | undefined;
    monthOfYear?: number | undefined;
    /** Record summaries only (the other tables have no direction). */
    direction?: string | undefined;
    /** Record summaries only: accounting's check (UNCHECKED, REVISED, …). */
    review?: string | undefined;
  },
): Promise<Paginated<BillingDocListItem>> {
  const cfg = CONFIG[type];
  const t = sql.raw(cfg.sqlTable);
  const dateCol = sql.raw(`t.${cfg.dateSql}`);
  const numCol = cfg.numberSql ? sql.raw(`t.${cfg.numberSql}`) : sql`NULL`;
  const c = [sql`true`];
  if (p.clientId) c.push(sql`t.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`t.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.status) c.push(sql`t.status = ${p.status}`);
  if (p.month)
    c.push(
      sql`${dateCol} >= ${`${p.month}-01`}::date AND ${dateCol} < (${`${p.month}-01`}::date + interval '1 month')`,
    );
  if (p.year) c.push(sql`extract(year from ${dateCol}) = ${p.year}`);
  if (p.monthOfYear) c.push(sql`extract(month from ${dateCol}) = ${p.monthOfYear}`);
  if (p.direction && type === 'record-summaries') c.push(sql`t.direction = ${p.direction}`);
  if (p.review && type === 'record-summaries') c.push(sql`t.review_status = ${p.review}`);
  if (p.q) {
    const like = likePattern(p.q);
    c.push(
      sql`(${numCol} ILIKE ${like} OR ${sql.raw(`t.${cfg.billToSql}`)} ILIKE ${like} OR d.declare_no ILIKE ${like} OR cl.code ILIKE ${like})`,
    );
  }
  // Record Summary's list also shows the shipment and its INV / DIS / DN numbers.
  const extra =
    type === 'record-summaries'
      ? sql`, t.direction, t.transport_mode AS "transportMode",
           CASE WHEN a.id IS NULL THEN t.inv_no ELSE a.inv_no END AS "invNo",
           CASE WHEN a.id IS NULL THEN t.dis_no ELSE a.dis_no END AS "disNo",
           CASE WHEN a.id IS NULL THEN t.dn_no ELSE a.dn_no END AS "dnNo",
           t.quantity_text AS "quantityText", (SELECT p.short_name FROM ports p WHERE p.id = t.port_id) AS port,
           t.review_status AS "reviewStatus"`
      : sql``;
  const rows = await queryRows<BillingDocListItem & { total_count: string }>(
    db,
    sql`
    SELECT t.id, ${numCol} AS number, to_char(${dateCol}, 'YYYY-MM-DD') AS date, t.status, cl.code AS "clientCode", cl.name AS "clientName",
           ${sql.raw(`t.${cfg.billToSql}`)} AS "billTo", d.declare_no AS "declareNo", t.total::text AS total${extra}, count(*) OVER () AS total_count
    FROM ${t} t JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN accounting_records a ON a.id = t.accounting_record_id LEFT JOIN customs_declarations d ON d.id = a.declaration_id
    ${whereAll(c)} ORDER BY ${dateCol} DESC, t.created_at DESC ${paginate(p.page, p.pageSize)}`,
  );
  return toPaginated(rows, p.page, p.pageSize);
}

/* ---------- Deleting a shipment's issued invoice set ---------- */

export type ReleasedSet = ReleasedInvoiceSet;

/**
 * Deletes a shipment's tax invoice, DIS and debit note (drafts and issued; cancelled ones are
 * kept), takes their numbers and totals off its Monthly Ledger entry, and sends its Chea
 * payment back to Unchecked so it is "not invoiced" again. The numbers are released: the next
 * approved shipment takes them (one already waiting takes them now, earliest clearance
 * first); a number that was the highest of its run simply comes back as the next one.
 */
export async function releaseInvoiceSet(
  recordId: string,
  reason: string,
  req: Request,
): Promise<ReleasedSet> {
  return db.transaction(async (tx) => {
    await lockNumbering(tx);
    const [rec] = await queryRows<{
      declareNo: string;
      invDate: string;
      code: string;
      invNo: string | null;
      disNo: string | null;
      dnNo: string | null;
    }>(
      tx,
      sql`SELECT d.declare_no AS "declareNo", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", c.code,
                 a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo"
          FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
          JOIN clients c ON c.id = a.client_id
          WHERE a.id = ${recordId} FOR UPDATE OF a`,
    );
    if (!rec) throw notFound('Ledger entry');
    const numbers = new Map<NumberKind, Set<string>>();
    const add = (kind: NumberKind, n: string | null | undefined) => {
      if (n) numbers.set(kind, (numbers.get(kind) ?? new Set()).add(n.toUpperCase()));
    };
    add('INV', rec.invNo);
    add('DIS', rec.disNo);
    add('DN', rec.dnNo);
    const deleted: Row[] = [];
    for (const type of ISSUE_DATED) {
      const cfg = CONFIG[type];
      const docs = (await tx
        .delete(cfg.table)
        .where(
          and(
            eq(col(cfg.table, 'accountingRecordId'), recordId),
            sql`${col(cfg.table, 'status')} <> 'VOID'`,
          ),
        )
        .returning()) as Row[];
      for (const d of docs) {
        add(KIND[type], d[cfg.numberCol!] as string | null);
        deleted.push({ type, id: d.id, number: d[cfg.numberCol!], status: d.status });
      }
    }
    if (!numbers.size && !deleted.length)
      throw conflict(`${rec.declareNo} has no invoice numbers or documents to delete`);
    await tx
      .update(accountingRecords)
      .set({
        invNo: null,
        disNo: null,
        dnNo: null,
        invRevenue: '0',
        disTotal: '0',
        dnTotal: '0',
        updatedById: req.auth?.userId ?? null,
      })
      .where(eq(accountingRecords.id, recordId));
    await recompute(tx, recordId);
    // Not invoiced again: it waits for accounting to check its Chea payment once more.
    await tx
      .update(creditNotes)
      .set({
        reviewStatus: 'UNCHECKED',
        reviewedBy: req.auth?.userId ?? null,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(creditNotes.accountingRecordId, recordId),
          eq(creditNotes.status, 'ISSUED'),
          eq(creditNotes.reviewStatus, 'CHECKED'),
        ),
      );
    const released: ReleasedSet['released'] = [];
    for (const [kind, set] of numbers)
      for (const number of [...set].sort())
        released.push({
          kind,
          number,
          kept: await releaseNumber(
            tx,
            kind,
            number,
            rec.invDate,
            rec.code,
            rec.declareNo,
            req.auth?.userId ?? null,
          ),
        });
    const reassigned = await numberEligible(tx, req);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'accounting_record',
        entityId: recordId,
        before: { invNo: rec.invNo, disNo: rec.disNo, dnNo: rec.dnNo, documents: deleted },
        after: {
          invNo: null,
          disNo: null,
          dnNo: null,
          invoiceDeleted: true,
          released,
          reassignedTo: reassigned.flatMap((r) =>
            r.numbers
              .filter((n) => n.reused)
              .map((n) => ({ number: n.number, declareNo: r.declareNo })),
          ),
        },
        reason: `Invoice deleted for ${rec.declareNo}: ${reason}`,
      },
      req,
    );
    return { declareNo: rec.declareNo, released, reassigned };
  });
}

/* ---------- Accounting's check of submitted credit notes ---------- */

/**
 * Submitted (issued) credit notes for Accounting → Credit Noted, with the shipment's
 * direction and mode, plus Checked / Unchecked / Revised counts for the same filters.
 */
export async function listCreditNoteReview(p: {
  page: number;
  pageSize: number;
  q?: string | undefined;
  clientId?: string | undefined;
  clientIds?: string[] | undefined;
  direction?: string | undefined;
  month?: number | undefined;
  year?: number | undefined;
  review?: string | undefined;
  /** The broker's own list (sidebar → Credit Noted): drafts and void too, optionally one status. */
  allStatuses?: boolean;
  status?: string | undefined;
}): Promise<Paginated<CreditNoteReviewRow> & { counts: CreditNoteReviewCounts }> {
  const c = p.allStatuses
    ? [p.status ? sql`t.status = ${p.status}` : sql`true`]
    : // Submitted ones, plus those sent back to the broker that are still being revised.
      [sql`(t.status = 'ISSUED' OR (t.status = 'DRAFT' AND t.review_status = 'REVISED'))`];
  if (p.clientId) c.push(sql`t.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`t.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.direction) c.push(sql`x.direction = ${p.direction}`);
  if (p.year) c.push(sql`extract(year FROM t.cn_date) = ${p.year}`);
  if (p.month) c.push(sql`extract(month FROM t.cn_date) = ${p.month}`);
  if (p.q) {
    const like = likePattern(p.q.replace(/\s+/g, ''));
    c.push(sql`(replace(t.declare_no, ' ', '') ILIKE ${like} OR t.cn_no ILIKE ${like})`);
  }
  const from = sql`
    FROM credit_notes t JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN ports po ON po.id = t.port_id
    LEFT JOIN accounting_records a ON a.id = t.accounting_record_id
    LEFT JOIN LATERAL (
      SELECT s.direction, s.transport_mode
      FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
      WHERE d.id = a.declaration_id
         OR (a.declaration_id IS NULL AND lower(d.declare_no) = lower(t.declare_no))
      ORDER BY d.created_at DESC LIMIT 1
    ) x ON true`;
  const [counts] = await queryRows<CreditNoteReviewCounts>(
    db,
    sql`SELECT count(*)::int AS total,
          (count(*) FILTER (WHERE t.review_status = 'CHECKED'))::int AS checked,
          (count(*) FILTER (WHERE t.review_status = 'UNCHECKED'))::int AS unchecked,
          (count(*) FILTER (WHERE t.review_status = 'REVIEWED'))::int AS reviewed,
          (count(*) FILTER (WHERE t.review_status = 'REVISED'))::int AS revised,
          (count(*) FILTER (WHERE t.review_status = 'REVISION_REQUESTED'))::int AS "revisionRequested"
        ${from} ${whereAll(c)}`,
  );
  if (p.review) c.push(sql`t.review_status = ${p.review}`);
  const rows = await queryRows<CreditNoteReviewRow & { total_count: string }>(
    db,
    sql`SELECT t.id, t.cn_no AS number, to_char(t.cn_date, 'YYYY-MM-DD') AS date,
          cl.id AS "clientId", cl.code AS "clientCode", cl.name AS "clientName",
          x.direction, x.transport_mode AS "transportMode", t.declare_no AS "declareNo",
          t.quantity_text AS "quantityText", po.short_name AS port, t.total::text AS total,
          t.status, t.review_status AS "reviewStatus", count(*) OVER () AS total_count
        ${from} ${whereAll(c)}
        ORDER BY t.cn_date DESC, t.created_at DESC ${paginate(p.page, p.pageSize)}`,
  );
  return { ...toPaginated(rows, p.page, p.pageSize), counts: counts! };
}

/**
 * Accounting's check of a submitted credit note.
 * - REVIEWED: set when accounting opens an Unchecked note; nothing else changes.
 * - CHECKED (shown as "Approved"): the declaration goes into the Monthly Ledger (its clear fee is this note's
 *   total) and gets its INV / DIS / DN numbers; the broker gets a "Checked" message.
 * - REVISED: the note goes back to the broker as an editable draft, its Clear Fee comes out of
 *   the Monthly Ledger until it is submitted again, and the broker gets the message saying
 *   what to change.
 */
export async function setCreditNoteReview(
  id: string,
  reviewStatus: CreditNoteReviewStatus,
  message: string | undefined,
  req: Request,
): Promise<AssignedNumbers[]> {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(tx, 'credit-notes', id);
    if (doc.status !== 'ISSUED')
      throw businessRule(
        doc.status === 'DRAFT' && doc.reviewStatus === 'REVISED'
          ? 'This credit note is with the broker for revision; it comes back when they submit it again'
          : 'Only a credit note submitted to the Monthly Ledger can be checked',
      );
    // Opened by accounting: only a note nobody has looked at yet, and the broker isn't told.
    if (reviewStatus === 'REVIEWED') {
      if (doc.reviewStatus !== 'UNCHECKED') return [];
      await tx
        .update(creditNotes)
        .set({ reviewStatus, reviewedBy: req.auth?.userId ?? null, reviewedAt: new Date() })
        .where(eq(creditNotes.id, id));
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: 'credit_note',
          entityId: id,
          before: { reviewStatus: doc.reviewStatus },
          after: { reviewStatus },
        },
        req,
      );
      return [];
    }
    if (reviewStatus === 'REVISED') {
      await tx.update(creditNotes).set({ status: 'DRAFT' }).where(eq(creditNotes.id, id));
      await creditNoteOutOfLedger(tx, doc);
    }
    // Approved: the declaration goes into the Monthly Ledger with this clear fee.
    if (reviewStatus === 'CHECKED') {
      const recordId =
        (doc.accountingRecordId as string | null) ?? (await ledgerRowByDeclareNo(tx, doc, req));
      await tx
        .update(creditNotes)
        .set({ accountingRecordId: recordId })
        .where(eq(creditNotes.id, id));
      await tx
        .update(accountingRecords)
        .set({ clearFee: String(doc.total), updatedById: req.auth?.userId ?? null })
        .where(eq(accountingRecords.id, recordId));
      await recompute(tx, recordId);
    }
    await tx
      .update(creditNotes)
      .set({ reviewStatus, reviewedBy: req.auth?.userId ?? null, reviewedAt: new Date() })
      .where(eq(creditNotes.id, id));
    // …and every approved shipment still waiting gets its INV / DIS / DN numbers.
    const numbered = reviewStatus === 'CHECKED' ? await numberEligible(tx, req) : [];
    // Revised: the broker hears about it in their Credit Noted inbox. An approval needs no
    // action from them, so it is not sent.
    if (reviewStatus === 'REVISED')
      await tx.execute(sql`
        INSERT INTO credit_note_messages (credit_note_id, recipient_id, sender_id, kind, body)
        SELECT ${id}::uuid, u.id, ${req.auth?.userId ?? null}::uuid, ${reviewStatus}::credit_note_review, ${message ?? ''}
        FROM ${creditNoteRecipients(id, doc.createdById as string | null)} u
        WHERE u.id IS DISTINCT FROM ${req.auth?.userId ?? null}::uuid`);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'credit_note',
        entityId: id,
        before: { status: doc.status, reviewStatus: doc.reviewStatus },
        after: {
          status: reviewStatus === 'REVISED' ? 'DRAFT' : doc.status,
          reviewStatus,
          message,
        },
      },
      req,
    );
    return numbered;
  });
}

/**
 * Who hears about a credit note: every active customs broker who can see its client, plus
 * whoever created it (an accountant or admin may have drafted it for the broker).
 */
function creditNoteRecipients(creditNoteId: string, createdById: string | null) {
  return sql`(
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    JOIN credit_notes t ON t.id = ${creditNoteId}::uuid
    WHERE r.code = 'CUSTOMS_BROKER' AND u.is_active AND u.deleted_at IS NULL
      AND (u.client_ids IS NULL OR t.client_id = ANY(u.client_ids))
    UNION
    SELECT id FROM users WHERE id = ${createdById}::uuid AND deleted_at IS NULL
  )`;
}

/* ---------- Accounting's check of submitted record summaries ---------- */

/**
 * Accounting → Expense to Clients: Operations' submitted record summaries (and those sent back
 * for revision), with Checked / Unchecked / Revised counts for the same filters.
 */
export async function listRecordSummaryReview(p: {
  page: number;
  pageSize: number;
  q?: string | undefined;
  clientId?: string | undefined;
  clientIds?: string[] | undefined;
  direction?: string | undefined;
  month?: number | undefined;
  year?: number | undefined;
  review?: string | undefined;
}): Promise<Paginated<RecordSummaryReviewRow> & { counts: CreditNoteReviewCounts }> {
  const c = [sql`(t.status = 'ISSUED' OR (t.status = 'DRAFT' AND t.review_status = 'REVISED'))`];
  if (p.clientId) c.push(sql`t.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`t.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.direction) c.push(sql`t.direction = ${p.direction}`);
  if (p.year) c.push(sql`extract(year FROM t.summary_date) = ${p.year}`);
  if (p.month) c.push(sql`extract(month FROM t.summary_date) = ${p.month}`);
  if (p.q)
    c.push(sql`replace(t.declare_no, ' ', '') ILIKE ${likePattern(p.q.replace(/\s+/g, ''))}`);
  const from = sql`
    FROM record_summaries t JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN ports po ON po.id = t.port_id
    LEFT JOIN accounting_records a ON a.id = t.accounting_record_id`;
  const [counts] = await queryRows<CreditNoteReviewCounts>(
    db,
    sql`SELECT count(*)::int AS total,
          (count(*) FILTER (WHERE t.review_status = 'CHECKED'))::int AS checked,
          (count(*) FILTER (WHERE t.review_status = 'UNCHECKED'))::int AS unchecked,
          (count(*) FILTER (WHERE t.review_status = 'REVIEWED'))::int AS reviewed,
          (count(*) FILTER (WHERE t.review_status = 'REVISED'))::int AS revised,
          (count(*) FILTER (WHERE t.review_status = 'REVISION_REQUESTED'))::int AS "revisionRequested"
        ${from} ${whereAll(c)}`,
  );
  if (p.review) c.push(sql`t.review_status = ${p.review}`);
  const rows = await queryRows<RecordSummaryReviewRow & { total_count: string }>(
    db,
    sql`SELECT t.id, to_char(t.summary_date, 'YYYY-MM-DD') AS date,
          cl.id AS "clientId", cl.code AS "clientCode", cl.name AS "clientName",
          t.direction, t.transport_mode AS "transportMode", t.declare_no AS "declareNo",
          coalesce(a.inv_no, t.inv_no) AS "invNo", t.quantity_text AS "quantityText",
          po.short_name AS port, t.total::text AS total,
          t.status, t.review_status AS "reviewStatus", count(*) OVER () AS total_count
        ${from} ${whereAll(c)}
        ORDER BY t.summary_date DESC, t.created_at DESC ${paginate(p.page, p.pageSize)}`,
  );
  return { ...toPaginated(rows, p.page, p.pageSize), counts: counts! };
}

/**
 * Accounting's check of a submitted record summary.
 * - REVIEWED: set when accounting opens an Unchecked summary; nothing else changes.
 * - CHECKED (shown as "Approved"): its lines fill the shipment's Monthly Ledger row (INV, THC, REIM, DN).
 * - REVISED: back to Operations as an editable draft with the note saying what to change; its
 *   amounts leave the ledger until it is submitted and checked again.
 * - UNCHECKED: back to waiting; its amounts leave the ledger.
 */
export async function setRecordSummaryReview(
  id: string,
  reviewStatus: CreditNoteReviewStatus,
  message: string | undefined,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, 'record-summaries', id);
    if (doc.status !== 'ISSUED')
      throw businessRule(
        doc.status === 'DRAFT' && doc.reviewStatus === 'REVISED'
          ? 'This record summary is with Operations for revision; it comes back when they submit it again'
          : 'Only a submitted record summary can be checked',
      );
    // Opened by accounting: only a summary nobody has looked at yet; nothing else changes.
    if (reviewStatus === 'REVIEWED' && doc.reviewStatus !== 'UNCHECKED') return;
    let recordId = doc.accountingRecordId as string | null;
    // Started from the shipping plan before the shipment was in the Monthly Ledger: approving
    // it puts the declaration there (as a checked credit note does), and the summary joins it.
    if (reviewStatus === 'CHECKED' && !recordId) {
      recordId = await ledgerRowByDeclareNo(tx, doc, req, 'record summary');
      await tx
        .update(recordSummaries)
        .set({ accountingRecordId: recordId })
        .where(eq(recordSummaries.id, id));
    }
    await tx
      .update(recordSummaries)
      .set({
        reviewStatus,
        reviewedBy: req.auth?.userId ?? null,
        reviewedAt: new Date(),
        ...(reviewStatus === 'REVISED' ? { status: 'DRAFT', reviewNote: message ?? null } : {}),
      })
      .where(eq(recordSummaries.id, id));
    if (recordId) {
      if (reviewStatus === 'CHECKED') await summaryToLedger(tx, id, recordId, req);
      else if (doc.reviewStatus === 'CHECKED' || doc.reviewStatus === 'REVISION_REQUESTED')
        await summaryOutOfLedger(tx, recordId);
    }
    // Revised: Operations hear about it in their Record Summary inbox. An approval needs no
    // action from them, so it is not sent.
    if (reviewStatus === 'REVISED')
      await tx.execute(sql`
        INSERT INTO record_summary_messages (record_summary_id, recipient_id, sender_id, kind, body)
        SELECT ${id}::uuid, u.id, ${req.auth?.userId ?? null}::uuid, ${reviewStatus}::credit_note_review, ${message ?? ''}
        FROM ${recordSummaryRecipients(id, doc.createdById as string | null)} u
        WHERE u.id IS DISTINCT FROM ${req.auth?.userId ?? null}::uuid`);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'record_summaries',
        entityId: id,
        before: { status: doc.status, reviewStatus: doc.reviewStatus },
        after: {
          status: reviewStatus === 'REVISED' ? 'DRAFT' : doc.status,
          reviewStatus,
          message,
        },
      },
      req,
    );
  });
}

/**
 * Who hears about a record summary: every active Operations user who can see its client, plus
 * whoever created it.
 */
function recordSummaryRecipients(recordSummaryId: string, createdById: string | null) {
  return sql`(
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    JOIN record_summaries t ON t.id = ${recordSummaryId}::uuid
    WHERE r.code = 'OPERATOR' AND u.is_active AND u.deleted_at IS NULL
      AND (u.client_ids IS NULL OR t.client_id = ANY(u.client_ids))
    UNION
    SELECT id FROM users WHERE id = ${createdById}::uuid AND deleted_at IS NULL
  )`;
}

/* ---------- The broker's inbox ---------- */

const MESSAGE_COLUMNS = sql`m.id, m.credit_note_id AS "creditNoteId", t.cn_no AS number,
  t.declare_no AS "declareNo", cl.code AS "clientCode", cl.name AS "clientName", m.kind, m.body,
  u.full_name AS "senderName", m.created_at AS "createdAt", m.read_at AS "readAt",
  to_char(t.cn_date, 'YYYY-MM-DD') AS date, t.status, x.direction, x.transport_mode AS "transportMode",
  t.quantity_text AS "quantityText", po.short_name AS port, t.total::text AS total`;
const MESSAGE_FROM = sql`FROM credit_note_messages m
  JOIN credit_notes t ON t.id = m.credit_note_id JOIN clients cl ON cl.id = t.client_id
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN ports po ON po.id = t.port_id
  LEFT JOIN accounting_records a ON a.id = t.accounting_record_id
  LEFT JOIN LATERAL (
    SELECT s.direction, s.transport_mode
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
    WHERE d.id = a.declaration_id
       OR (a.declaration_id IS NULL AND lower(d.declare_no) = lower(t.declare_no))
    ORDER BY d.created_at DESC LIMIT 1
  ) x ON true`;

// Only "Revised" messages: Approved ones sent before approvals stopped being sent are left out.

export async function creditNoteInbox(
  userId: string,
): Promise<{ data: CreditNoteMessage[]; unread: number }> {
  const data = await queryRows<CreditNoteMessage>(
    db,
    sql`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
        WHERE m.recipient_id = ${userId} AND m.kind = 'REVISED'
        ORDER BY m.created_at DESC LIMIT 50`,
  );
  const [r] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM credit_note_messages
        WHERE recipient_id = ${userId} AND read_at IS NULL AND kind = 'REVISED'`,
  );
  return { data, unread: r?.n ?? 0 };
}

/** Marks my messages read: one, or all when no id is given. */
export async function markCreditNoteMessagesRead(userId: string, id?: string): Promise<void> {
  await db.execute(
    sql`UPDATE credit_note_messages SET read_at = now()
        WHERE recipient_id = ${userId} AND read_at IS NULL ${id ? sql`AND id = ${id}` : sql``}`,
  );
}

/** Accounting's messages about one credit note, newest first (the editor's banner). */
export async function creditNoteMessagesFor(id: string): Promise<CreditNoteMessage[]> {
  return queryRows<CreditNoteMessage>(
    db,
    sql`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
        WHERE m.credit_note_id = ${id} ORDER BY m.created_at DESC LIMIT 20`,
  );
}

/* ---------- Operations' Record Summary inbox ---------- */

// Only "Revised" messages: Approved ones sent before approvals stopped being sent are left out.

export async function recordSummaryInbox(
  userId: string,
): Promise<{ data: RecordSummaryMessage[]; unread: number }> {
  const data = await queryRows<RecordSummaryMessage>(
    db,
    sql`SELECT m.id, m.record_summary_id AS "recordSummaryId", t.inv_no AS "invNo",
          t.declare_no AS "declareNo", cl.name AS "clientName", m.kind, m.body,
          u.full_name AS "senderName", m.created_at AS "createdAt", m.read_at AS "readAt",
          to_char(t.summary_date, 'YYYY-MM-DD') AS date, t.status, t.direction,
          t.transport_mode AS "transportMode", t.quantity_text AS "quantityText",
          po.short_name AS port, t.total::text AS total
        FROM record_summary_messages m
        JOIN record_summaries t ON t.id = m.record_summary_id
        JOIN clients cl ON cl.id = t.client_id
        LEFT JOIN users u ON u.id = m.sender_id
        LEFT JOIN ports po ON po.id = t.port_id
        WHERE m.recipient_id = ${userId} AND m.kind = 'REVISED'
        ORDER BY m.created_at DESC LIMIT 50`,
  );
  const [r] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM record_summary_messages
        WHERE recipient_id = ${userId} AND read_at IS NULL AND kind = 'REVISED'`,
  );
  return { data, unread: r?.n ?? 0 };
}

/** Marks my Record Summary messages read: one, or all when no id is given. */
export async function markRecordSummaryMessagesRead(userId: string, id?: string): Promise<void> {
  await db.execute(
    sql`UPDATE record_summary_messages SET read_at = now()
        WHERE recipient_id = ${userId} AND read_at IS NULL ${id ? sql`AND id = ${id}` : sql``}`,
  );
}
