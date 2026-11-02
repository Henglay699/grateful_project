import type { Request } from 'express';
import { sql } from 'drizzle-orm';
import {
  CLOSED_STAGE,
  DOCUMENT_CATEGORY_LABEL,
  EXPIRY_WARNING_DAYS,
  LOW_MARGIN_RATIO,
  OWNER_LABEL,
  OWNER_PERMISSION,
  ROLE_OWNERS,
  VARIANCE_TOLERANCE,
  currentStageKey,
  daysUntil,
  hasPermission,
  stageIndex,
  stageLabel,
  stagesFor,
  type AlertItem,
  type CustomsPermitRow,
  type Direction,
  type DocumentCategory,
  type Permission,
  type RequirementKey,
  type RequirementStatus,
  type ShipmentWorkflow,
  type StageDef,
  type StageHistoryEntry,
  type VendorInvoiceRow,
  type WorkQueueItem,
  type WorkflowIssue,
  type WorkflowMargin,
} from '@gs/shared';
import { db, type DbOrTx } from '../../db/client';
import { queryRows } from '../../lib/listing';
import { audit } from '../../lib/audit';
import { businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { allowedClients, assertClientVisible, clientCondition } from '../../lib/clientScope';

/** Today's date in Phnom Penh (UTC+7), YYYY-MM-DD. */
export function todayPP(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

const n = (v: string | number | null | undefined): number => (v == null ? 0 : Number(v) || 0);
const fmt = (v: number, d = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
const dmy = (d: string) => {
  const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${d.slice(8, 10)}-${m[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
};
const pctDiff = (actual: number, expected: number) =>
  expected === 0 ? (actual === 0 ? 0 : 1) : (actual - expected) / expected;

/* ---------------------------------------------------------------------------------------- */
/* Facts: everything the stage checks and cross-checks look at, in a few queries.           */
/* ---------------------------------------------------------------------------------------- */

export interface Facts {
  id: string;
  reference: string;
  clientId: string;
  clientName: string;
  direction: Direction;
  stage: string;
  stageChangedAt: string | null;
  hblNo: string | null;
  bookingNo: string | null;
  eta: string | null;
  etd: string | null;
  atd: string | null;
  doDate: string | null;
  arriveFty: string | null;
  coForm: string | null;
  coNumber: string | null;
  coStatus: string | null;
  bookedQty: string | null;
  bookedGrossWeightKg: string | null;
  bookedCbm: string | null;
  measuredCbm: string | null;
  measuredGrossWeightKg: string | null;
  cdcNo: string | null;
  cdcValidUntil: string | null;
  lines: number;
  invoices: number;
  pcs: number;
  cbm: number;
  grossWeightKg: number;
  docs: Map<DocumentCategory, number>;
  duplicateDocs: { title: string; otherTitle: string }[];
  permits: CustomsPermitRow[];
  vendorInvoices: VendorInvoiceRow[];
  declared: number;
  firstDeclareDate: string | null;
  ledger: { count: number; revenue: number; cost: number; netProfit: number };
  coInvoices: number;
  coApproved: number;
  brokerCardExpiry: string | null;
}

type Head = Omit<
  Facts,
  | 'docs'
  | 'duplicateDocs'
  | 'permits'
  | 'vendorInvoices'
  | 'ledger'
  | 'stage'
  | 'lines'
  | 'invoices'
  | 'pcs'
  | 'cbm'
  | 'grossWeightKg'
  | 'declared'
  | 'firstDeclareDate'
  | 'coInvoices'
  | 'coApproved'
  | 'brokerCardExpiry'
> & {
  workflowStage: string | null;
};

const PERMIT_SELECT = sql`
  SELECT p.id, p.shipment_id AS "shipmentId", p.permit_no AS "permitNo",
         to_char(p.issue_date, 'YYYY-MM-DD') AS "issueDate", to_char(p.valid_from, 'YYYY-MM-DD') AS "validFrom",
         to_char(p.valid_until, 'YYYY-MM-DD') AS "validUntil", p.office, p.remark, p.document_id AS "documentId"
  FROM customs_permits p`;

const VENDOR_SELECT = sql`
  SELECT v.id, v.shipment_id AS "shipmentId", v.vendor_name AS "vendorName", v.invoice_no AS "invoiceNo",
         to_char(v.invoice_date, 'YYYY-MM-DD') AS "invoiceDate", v.description, v.amount::text, v.vat::text,
         (v.amount + v.vat)::text AS total, v.billed_cbm::text AS "billedCbm",
         v.billed_gross_weight_kg::text AS "billedGrossWeightKg", to_char(v.due_date, 'YYYY-MM-DD') AS "dueDate",
         to_char(v.paid_on, 'YYYY-MM-DD') AS "paidOn", v.payment_ref AS "paymentRef", v.document_id AS "documentId"
  FROM vendor_invoices v`;

export async function listPermits(
  exec: DbOrTx,
  shipmentId: string,
  today = todayPP(),
): Promise<CustomsPermitRow[]> {
  const rows = await queryRows<Omit<CustomsPermitRow, 'daysLeft'>>(
    exec,
    sql`${PERMIT_SELECT} WHERE p.shipment_id = ${shipmentId} AND p.deleted_at IS NULL
        ORDER BY p.valid_until DESC NULLS LAST, p.created_at DESC`,
  );
  return rows.map((r) => ({ ...r, daysLeft: daysUntil(r.validUntil, today) }));
}

export async function listVendorInvoices(
  exec: DbOrTx,
  shipmentId: string,
): Promise<VendorInvoiceRow[]> {
  return queryRows<VendorInvoiceRow>(
    exec,
    sql`${VENDOR_SELECT} WHERE v.shipment_id = ${shipmentId} AND v.deleted_at IS NULL
        ORDER BY v.invoice_date NULLS LAST, v.created_at`,
  );
}

export async function loadFacts(exec: DbOrTx, shipmentId: string): Promise<Facts> {
  const [head] = await queryRows<Head>(
    exec,
    sql`
    SELECT s.id, s.reference, s.client_id AS "clientId", c.name AS "clientName", s.direction,
           s.workflow_stage AS "workflowStage", ${sql.raw(`to_char(s.stage_changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)} AS "stageChangedAt",
           s.hbl_no AS "hblNo", s.booking_no AS "bookingNo",
           to_char(s.eta, 'YYYY-MM-DD') AS eta, to_char(s.etd, 'YYYY-MM-DD') AS etd, to_char(s.atd, 'YYYY-MM-DD') AS atd,
           to_char(s.do_date, 'YYYY-MM-DD') AS "doDate", to_char(s.arrive_fty, 'YYYY-MM-DD') AS "arriveFty",
           s.co_form AS "coForm", s.co_number AS "coNumber", s.co_status AS "coStatus",
           s.booked_qty::text AS "bookedQty", s.booked_gross_weight_kg::text AS "bookedGrossWeightKg",
           s.booked_cbm::text AS "bookedCbm", s.measured_cbm::text AS "measuredCbm",
           s.measured_gross_weight_kg::text AS "measuredGrossWeightKg",
           c.cdc_no AS "cdcNo", to_char(c.cdc_valid_until, 'YYYY-MM-DD') AS "cdcValidUntil"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    WHERE s.id = ${shipmentId} AND s.deleted_at IS NULL`,
  );
  if (!head) throw notFound('Shipment');

  const [agg] = await queryRows<{
    lines: number;
    invoices: number;
    pcs: string;
    cbm: string;
    gw: string;
    declared: number;
    firstDeclare: string | null;
    coInvoices: number;
    coApproved: number;
    ledgerCount: number;
    revenue: string;
    cost: string;
    profit: string;
    brokerCard: string | null;
  }>(
    exec,
    sql`
    SELECT
      (SELECT count(*) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = ${shipmentId})::int AS lines,
      (SELECT count(*) FROM cargo_invoices WHERE shipment_id = ${shipmentId})::int AS invoices,
      (SELECT coalesce(sum(l.pcs), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = ${shipmentId})::text AS pcs,
      (SELECT coalesce(sum(l.cbm), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = ${shipmentId})::text AS cbm,
      (SELECT coalesce(sum(l.gross_weight_kg), 0) FROM cargo_invoice_lines l JOIN cargo_invoices i ON i.id = l.invoice_id WHERE i.shipment_id = ${shipmentId})::text AS gw,
      (SELECT count(*) FROM customs_declarations WHERE shipment_id = ${shipmentId} AND declare_no IS NOT NULL)::int AS declared,
      (SELECT to_char(min(declare_date), 'YYYY-MM-DD') FROM customs_declarations WHERE shipment_id = ${shipmentId}) AS "firstDeclare",
      (SELECT count(*) FROM cargo_invoices WHERE shipment_id = ${shipmentId})::int AS "coInvoices",
      (SELECT count(*) FROM co_records r JOIN cargo_invoices i ON i.id = r.invoice_id
        WHERE i.shipment_id = ${shipmentId} AND r.status = 'APPROVE')::int AS "coApproved",
      (SELECT count(*) FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${shipmentId})::int AS "ledgerCount",
      (SELECT coalesce(sum(a.inv_revenue + a.dis_total + a.dn_total), 0) FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${shipmentId})::text AS revenue,
      (SELECT coalesce(sum(a.clear_fee + a.thc + a.commission + a.other_pay), 0) FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${shipmentId})::text AS cost,
      (SELECT coalesce(sum(a.net_profit), 0) FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${shipmentId})::text AS profit,
      (SELECT to_char(card_expiry, 'YYYY-MM-DD') FROM broker_agents WHERE is_active ORDER BY is_default DESC, created_at LIMIT 1) AS "brokerCard"`,
  );
  const a = agg!;

  const docRows = await queryRows<{ category: DocumentCategory; n: number }>(
    exec,
    sql`SELECT category, count(*)::int AS n FROM documents
        WHERE shipment_id = ${shipmentId} AND deleted_at IS NULL GROUP BY category`,
  );
  const duplicateDocs = await queryRows<{ title: string; otherTitle: string }>(
    exec,
    sql`SELECT d1.title, d2.title AS "otherTitle" FROM documents d1
        JOIN documents d2 ON d2.sha256 = d1.sha256 AND d2.id > d1.id AND d2.shipment_id = d1.shipment_id AND d2.deleted_at IS NULL
        WHERE d1.shipment_id = ${shipmentId} AND d1.deleted_at IS NULL`,
  );

  const { workflowStage, ...rest } = head;
  return {
    ...rest,
    stage: currentStageKey(head.direction, workflowStage),
    lines: a.lines,
    invoices: a.invoices,
    pcs: n(a.pcs),
    cbm: n(a.cbm),
    grossWeightKg: n(a.gw),
    docs: new Map(docRows.map((r) => [r.category, r.n])),
    duplicateDocs,
    permits: await listPermits(exec, shipmentId),
    vendorInvoices: await listVendorInvoices(exec, shipmentId),
    declared: a.declared,
    firstDeclareDate: a.firstDeclare,
    ledger: {
      count: a.ledgerCount,
      revenue: n(a.revenue),
      cost: n(a.cost),
      netProfit: n(a.profit),
    },
    coInvoices: a.coInvoices,
    coApproved: a.coApproved,
    brokerCardExpiry: a.brokerCard,
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Cross-checks                                                                              */
/* ---------------------------------------------------------------------------------------- */

/** The permit that counts: the latest-expiring one. */
function bestPermit(f: Facts): CustomsPermitRow | undefined {
  return f.permits[0];
}

export function crossChecks(f: Facts, today = todayPP()): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const closed = f.stage === CLOSED_STAGE;
  const add = (i: WorkflowIssue) => issues.push(i);

  // Same file attached twice (e.g. "HBL from China" and "HBL for permit" are one scan).
  for (const d of f.duplicateDocs)
    add({
      code: 'DUPLICATE_DOCUMENT',
      severity: 'WARNING',
      message: `"${d.otherTitle}" is the same file as "${d.title}".`,
      fix: 'Documents',
    });

  if (f.direction === 'IMPORT') {
    // QIP master list validity: the duty exemption depends on it.
    if (f.cdcNo && f.cdcValidUntil && !closed) {
      const left = daysUntil(f.cdcValidUntil, today)!;
      const at = f.eta ?? today;
      if (f.cdcValidUntil < at)
        add({
          code: 'CDC_EXPIRED',
          severity: 'ERROR',
          message: `CDC master list ${f.cdcNo} is valid until ${dmy(f.cdcValidUntil)}, before the cargo arrives${f.eta ? ` (${dmy(f.eta)})` : ''}.`,
          fix: 'Client → CDC licence',
        });
      else if (left <= EXPIRY_WARNING_DAYS)
        add({
          code: 'CDC_EXPIRING',
          severity: 'WARNING',
          message: `CDC master list ${f.cdcNo} expires in ${left} day${left === 1 ? '' : 's'} (${dmy(f.cdcValidUntil)}).`,
          fix: 'Client → CDC licence',
        });
    }
    const permit = bestPermit(f);
    if (permit?.validUntil && !closed) {
      const left = daysUntil(permit.validUntil, today)!;
      if (f.declared === 0 && left < 0)
        add({
          code: 'PERMIT_EXPIRED',
          severity: 'ERROR',
          message: `Permit ${permit.permitNo} expired on ${dmy(permit.validUntil)} and the cargo is not cleared.`,
          fix: 'Customs permit',
        });
      else if (f.declared === 0 && left <= 7)
        add({
          code: 'PERMIT_EXPIRING',
          severity: 'WARNING',
          message: `Permit ${permit.permitNo} expires in ${left} day${left === 1 ? '' : 's'}; clear the cargo before ${dmy(permit.validUntil)}.`,
          fix: 'Customs permit',
        });
      if (f.eta && f.eta > permit.validUntil)
        add({
          code: 'PERMIT_BEFORE_ETA',
          severity: 'ERROR',
          message: `The cargo arrives ${dmy(f.eta)}, after permit ${permit.permitNo} expires (${dmy(permit.validUntil)}).`,
          fix: 'Customs permit',
        });
    }
    if (f.brokerCardExpiry && !closed) {
      const left = daysUntil(f.brokerCardExpiry, today)!;
      if (left < 0)
        add({
          code: 'BROKER_CARD_EXPIRED',
          severity: 'ERROR',
          message: `The customs agent's card expired on ${dmy(f.brokerCardExpiry)}; letters would be refused.`,
          fix: 'Settings → Customs broker',
        });
      else if (left <= EXPIRY_WARNING_DAYS)
        add({
          code: 'BROKER_CARD_EXPIRING',
          severity: 'WARNING',
          message: `The customs agent's card expires in ${left} days (${dmy(f.brokerCardExpiry)}).`,
          fix: 'Settings → Customs broker',
        });
    }
  }

  if (f.direction === 'EXPORT' && f.lines > 0) {
    // Booking vs final packing list.
    if (f.bookedQty != null && n(f.bookedQty) !== f.pcs) {
      const diff = f.pcs - n(f.bookedQty);
      add({
        code: 'QTY_VS_BOOKING',
        severity: 'WARNING',
        message: `Shipping ${fmt(f.pcs, 0)} pcs against ${fmt(n(f.bookedQty), 0)} booked (${diff > 0 ? '+' : ''}${fmt(diff, 0)}, ${diff > 0 ? '+' : ''}${fmt(pctDiff(f.pcs, n(f.bookedQty)) * 100, 1)}%).`,
        fix: 'Workflow → Booked & measured',
      });
    }
    if (
      f.bookedGrossWeightKg != null &&
      Math.abs(pctDiff(f.grossWeightKg, n(f.bookedGrossWeightKg))) > VARIANCE_TOLERANCE
    )
      add({
        code: 'GW_VS_BOOKING',
        severity: 'WARNING',
        message: `Final gross weight ${fmt(f.grossWeightKg)} kg differs from the booking (${fmt(n(f.bookedGrossWeightKg))} kg) by ${fmt(pctDiff(f.grossWeightKg, n(f.bookedGrossWeightKg)) * 100, 1)}%. Tell the forwarder.`,
        fix: 'Workflow → Booked & measured',
      });
    if (f.bookedCbm != null && Math.abs(pctDiff(f.cbm, n(f.bookedCbm))) > VARIANCE_TOLERANCE)
      add({
        code: 'CBM_VS_BOOKING',
        severity: 'WARNING',
        message: `Final ${fmt(f.cbm, 3)} CBM differs from the booking (${fmt(n(f.bookedCbm), 3)} CBM) by ${fmt(pctDiff(f.cbm, n(f.bookedCbm)) * 100, 1)}%.`,
        fix: 'Workflow → Booked & measured',
      });
    // What the CFS measured vs what was declared.
    if (f.measuredCbm != null && Math.abs(pctDiff(n(f.measuredCbm), f.cbm)) > VARIANCE_TOLERANCE)
      add({
        code: 'CBM_MEASURED',
        severity: 'WARNING',
        message: `The warehouse measured ${fmt(n(f.measuredCbm), 3)} CBM; ${fmt(f.cbm, 3)} CBM was declared (${fmt(pctDiff(n(f.measuredCbm), f.cbm) * 100, 1)}%). CBM charges follow the measured figure.`,
        fix: 'Workflow → Booked & measured',
      });
    if (
      f.measuredGrossWeightKg != null &&
      Math.abs(pctDiff(n(f.measuredGrossWeightKg), f.grossWeightKg)) > VARIANCE_TOLERANCE
    )
      add({
        code: 'GW_MEASURED',
        severity: 'WARNING',
        message: `The warehouse weighed ${fmt(n(f.measuredGrossWeightKg))} kg; ${fmt(f.grossWeightKg)} kg was declared.`,
        fix: 'Workflow → Booked & measured',
      });
    // Ship date on the invoice / CO must be the on-board date.
    if (f.atd && f.etd && f.atd !== f.etd)
      add({
        code: 'SHIP_DATE',
        severity: f.coForm ? 'WARNING' : 'INFO',
        message: `On-board date (ATD ${dmy(f.atd)}) differs from the ETD (${dmy(f.etd)}). INV + PL now prints the on-board date; re-export it${f.coForm ? ' and make sure the CO shows the same shipping date' : ''}.`,
        fix: 'Origin, Destination & Vessel',
      });
  }

  // Billed CBM above what was declared / measured.
  const reference = f.measuredCbm != null ? n(f.measuredCbm) : f.cbm;
  for (const v of f.vendorInvoices) {
    if (
      v.billedCbm != null &&
      reference > 0 &&
      pctDiff(n(v.billedCbm), reference) > VARIANCE_TOLERANCE
    )
      add({
        code: 'BILLED_CBM',
        severity: 'WARNING',
        message: `${v.vendorName} ${v.invoiceNo} charges ${fmt(n(v.billedCbm), 3)} CBM; ${fmt(reference, 3)} CBM was ${f.measuredCbm != null ? 'measured' : 'declared'}.`,
        fix: 'Vendor invoices',
      });
    if (
      v.billedGrossWeightKg != null &&
      f.grossWeightKg > 0 &&
      Math.abs(pctDiff(n(v.billedGrossWeightKg), f.grossWeightKg)) > VARIANCE_TOLERANCE
    )
      add({
        code: 'BILLED_GW',
        severity: 'INFO',
        message: `${v.vendorName} ${v.invoiceNo} shows ${fmt(n(v.billedGrossWeightKg))} kg; ${fmt(f.grossWeightKg)} kg was declared.`,
        fix: 'Vendor invoices',
      });
  }
  return issues;
}

/* ---------------------------------------------------------------------------------------- */
/* Stage requirements                                                                        */
/* ---------------------------------------------------------------------------------------- */

const CHECK_LABEL: Record<RequirementKey, string> = {
  HAS_CARGO_LINES: 'Cargo invoice lines entered',
  HAS_HBL_NO: 'HBL number recorded',
  HAS_BOOKING_NO: 'Booking / SO number recorded',
  HAS_BOOKED_FIGURES: 'Booked quantity recorded',
  HAS_ETA: 'ETA recorded',
  HAS_DO_DATE: 'DO date recorded',
  HAS_ARRIVE_FTY: 'Arrival at factory recorded',
  HAS_ATD: 'On-board date (ATD) recorded',
  HAS_MEASURED: 'Measured CBM recorded',
  VALID_PERMIT: 'Valid customs permit',
  DECLARED: 'Declaration number recorded',
  VENDOR_INVOICES: 'Vendor invoices entered',
  VENDOR_INVOICES_PAID: 'Vendor invoices paid',
  LEDGER_ENTRY: 'Ledger entry recorded',
  CO_DONE: 'CO approved',
  NO_BLOCKING_ISSUES: 'No blocking cross-check errors',
};

function check(key: RequirementKey, f: Facts, issues: WorkflowIssue[], today: string) {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  switch (key) {
    case 'HAS_CARGO_LINES':
      return {
        met: f.lines > 0,
        detail: f.lines ? `${f.lines} line${f.lines > 1 ? 's' : ''}` : undefined,
      };
    case 'HAS_HBL_NO':
      return { met: !!f.hblNo, detail: f.hblNo ?? undefined };
    case 'HAS_BOOKING_NO':
      return { met: !!f.bookingNo, detail: f.bookingNo ?? undefined };
    case 'HAS_BOOKED_FIGURES':
      return { met: f.bookedQty != null };
    case 'HAS_ETA':
      return { met: !!f.eta, detail: f.eta ? dmy(f.eta) : undefined };
    case 'HAS_DO_DATE':
      return { met: !!f.doDate, detail: f.doDate ? dmy(f.doDate) : undefined };
    case 'HAS_ARRIVE_FTY':
      return { met: !!f.arriveFty, detail: f.arriveFty ? dmy(f.arriveFty) : undefined };
    case 'HAS_ATD':
      return { met: !!f.atd, detail: f.atd ? dmy(f.atd) : undefined };
    case 'HAS_MEASURED':
      return { met: f.measuredCbm != null };
    case 'VALID_PERMIT': {
      const p = bestPermit(f);
      if (!p) return { met: false, detail: 'No permit recorded' };
      // Once cleared, the permit had to be valid on the declaration date; before, today.
      const on = f.declared > 0 && f.firstDeclareDate ? f.firstDeclareDate : today;
      const ok = !p.validUntil || p.validUntil >= on;
      return {
        met: ok,
        detail: p.validUntil
          ? `${p.permitNo}, valid until ${dmy(p.validUntil)}`
          : `${p.permitNo} (no expiry recorded)`,
      };
    }
    case 'DECLARED':
      return { met: f.declared > 0 };
    case 'VENDOR_INVOICES':
      return {
        met: f.vendorInvoices.length > 0,
        detail: f.vendorInvoices.length ? `${f.vendorInvoices.length} entered` : undefined,
      };
    case 'VENDOR_INVOICES_PAID': {
      const unpaid = f.vendorInvoices.filter((v) => !v.paidOn).length;
      return {
        met: f.vendorInvoices.length > 0 && unpaid === 0,
        detail: unpaid ? `${unpaid} unpaid` : undefined,
      };
    }
    case 'LEDGER_ENTRY':
      return { met: f.ledger.count > 0 };
    case 'CO_DONE':
      if (!f.coForm) return { met: true, detail: 'No CO form on this shipment' };
      return {
        met: (f.coInvoices > 0 && f.coApproved >= f.coInvoices) || !!f.coNumber,
        detail: `${f.coApproved} of ${f.coInvoices} invoice${f.coInvoices === 1 ? '' : 's'} approved`,
      };
    case 'NO_BLOCKING_ISSUES':
      return {
        met: errors.length === 0,
        detail: errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : undefined,
      };
  }
}

export function requirementsFor(
  stage: StageDef | undefined,
  f: Facts,
  issues: WorkflowIssue[],
  today = todayPP(),
): RequirementStatus[] {
  if (!stage) return [];
  return [
    ...stage.docs.map((category) => {
      const count = f.docs.get(category) ?? 0;
      return {
        key: `DOC:${category}`,
        label: `${DOCUMENT_CATEGORY_LABEL[category]} uploaded`,
        met: count > 0,
        detail: count > 1 ? `${count} files` : undefined,
        kind: 'DOCUMENT' as const,
        category,
      };
    }),
    ...stage.checks.map((key) => ({
      key,
      label: CHECK_LABEL[key],
      kind: 'CHECK' as const,
      ...check(key, f, issues, today),
    })),
  ];
}

export function marginOf(f: Facts): WorkflowMargin | null {
  if (!f.ledger.count) return null;
  const ratio = f.ledger.revenue > 0 ? f.ledger.netProfit / f.ledger.revenue : null;
  return {
    revenue: f.ledger.revenue,
    cost: f.ledger.cost,
    netProfit: f.ledger.netProfit,
    ratio,
    low: f.ledger.netProfit < 0 || (ratio !== null && ratio < LOW_MARGIN_RATIO),
  };
}

/* ---------------------------------------------------------------------------------------- */
/* The workflow view and the moves                                                           */
/* ---------------------------------------------------------------------------------------- */

interface Viewer {
  permissions: Permission[];
}

function evaluate(f: Facts, viewer: Viewer, today = todayPP()) {
  const stages = stagesFor(f.direction);
  const idx = stageIndex(f.direction, f.stage);
  const stage = stages[idx];
  const issues = crossChecks(f, today);
  const requirements = requirementsFor(stage, f, issues, today);
  const unmet = requirements.filter((r) => !r.met);
  const margin = marginOf(f);
  const needsCeoApproval = stage?.key === 'CLOSING' && !!margin?.low;
  const has = (p: Permission) => hasPermission(viewer.permissions, p);
  const ownerOk = !!stage && has(OWNER_PERMISSION[stage.owner]);
  const financeOk = !needsCeoApproval || has('finance:approve');
  const canApprove = has('workflow:approve');

  let blockedReason: string | null = null;
  if (!stage) blockedReason = 'The job is closed';
  else if (!ownerOk)
    blockedReason = `Waiting for ${OWNER_LABEL[stage.owner]}${stage.approval ? ' approval' : ''}`;
  else if (!financeOk) blockedReason = 'Low margin: the CEO must approve closing this job';
  else if (unmet.length) blockedReason = `Still needed: ${unmet.map((r) => r.label).join(' · ')}`;

  return {
    stages,
    idx,
    stage,
    issues,
    requirements,
    unmet,
    margin,
    needsCeoApproval,
    can: {
      advance: !!stage && ownerOk && financeOk && unmet.length === 0,
      override: !!stage && canApprove && financeOk && unmet.length > 0,
      sendBack: idx > 0 && (ownerOk || canApprove),
      financeApprove: needsCeoApproval && has('finance:approve'),
    },
    blockedReason,
  };
}

async function history(exec: DbOrTx, shipmentId: string): Promise<StageHistoryEntry[]> {
  return queryRows<StageHistoryEntry>(
    exec,
    sql`SELECT h.id, h.from_stage AS "fromStage", h.to_stage AS "toStage", h.action, h.note,
               h.override_reason AS "overrideReason", u.full_name AS "userName",
               ${sql.raw(`to_char(h.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)} AS "createdAt"
        FROM shipment_stage_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.shipment_id = ${shipmentId} ORDER BY h.created_at DESC LIMIT 100`,
  );
}

export async function getWorkflow(req: Request, shipmentId: string): Promise<ShipmentWorkflow> {
  const f = await loadFacts(db, shipmentId);
  assertClientVisible(req, f.clientId, 'Shipment');
  const viewer = { permissions: req.auth!.permissions };
  const e = evaluate(f, viewer);
  const seeMoney = hasPermission(viewer.permissions, 'accounting:read');
  const total = f.vendorInvoices.reduce((s, v) => s + n(v.total), 0);
  return {
    shipmentId: f.id,
    reference: f.reference,
    direction: f.direction,
    stage: f.stage,
    stageIndex: e.idx,
    stageChangedAt: f.stageChangedAt,
    stages: e.stages.map((s, index) => ({ ...s, index })),
    requirements: e.requirements,
    issues: e.issues,
    can: e.can,
    blockedReason: e.blockedReason,
    needsCeoApproval: e.needsCeoApproval,
    margin: seeMoney || hasPermission(viewer.permissions, 'finance:approve') ? e.margin : null,
    permits: f.permits,
    vendorInvoices: {
      count: f.vendorInvoices.length,
      unpaid: f.vendorInvoices.filter((v) => !v.paidOn).length,
      total: seeMoney ? total.toFixed(2) : '',
      rows: seeMoney ? f.vendorInvoices : null,
    },
    history: await history(db, shipmentId),
    measured: { cbm: f.measuredCbm, grossWeightKg: f.measuredGrossWeightKg },
    booked: { qty: f.bookedQty, grossWeightKg: f.bookedGrossWeightKg, cbm: f.bookedCbm },
  };
}

async function lockShipment(tx: DbOrTx, shipmentId: string) {
  await tx.execute(sql`SELECT id FROM shipments WHERE id = ${shipmentId} FOR UPDATE`);
}

export async function advance(
  req: Request,
  shipmentId: string,
  input: { from: string; note: string | null; overrideReason: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockShipment(tx, shipmentId);
    const f = await loadFacts(tx, shipmentId);
    assertClientVisible(req, f.clientId, 'Shipment');
    if (f.stage !== input.from)
      throw conflict(
        `This shipment has moved to "${stageLabel(f.direction, f.stage)}" since you opened it. Refresh to see the latest.`,
      );
    const e = evaluate(f, { permissions: req.auth!.permissions });
    if (!e.stage) throw businessRule('The job is already closed');
    const overriding = !e.can.advance;
    if (overriding) {
      if (!e.can.override) throw forbidden(e.blockedReason ?? 'You cannot complete this stage');
      if (!input.overrideReason)
        throw businessRule('Give a reason to move on while requirements are unmet', {
          unmet: e.unmet.map((r) => r.label),
        });
    }
    const next = e.stages[e.idx + 1]?.key ?? CLOSED_STAGE;
    await tx.execute(
      sql`UPDATE shipments SET workflow_stage = ${next}, stage_changed_at = now(), updated_at = now(), updated_by_id = ${req.auth!.userId}
          WHERE id = ${shipmentId}`,
    );
    const action = overriding ? 'OVERRIDE' : e.stage.approval ? 'APPROVE' : 'ADVANCE';
    const note =
      e.needsCeoApproval && input.note
        ? `${input.note} (low margin approved)`
        : e.needsCeoApproval
          ? 'Low margin approved'
          : input.note;
    await tx.execute(
      sql`INSERT INTO shipment_stage_history (shipment_id, from_stage, to_stage, action, note, override_reason, user_id)
          VALUES (${shipmentId}, ${f.stage}, ${next}, ${action}, ${note}, ${overriding ? input.overrideReason : null}, ${req.auth!.userId})`,
    );
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'shipment_workflow',
        entityId: shipmentId,
        before: { stage: f.stage },
        after: { stage: next, action },
        reason: overriding ? input.overrideReason : input.note,
      },
      req,
    );
  });
}

export async function sendBack(
  req: Request,
  shipmentId: string,
  input: { from: string; to: string; note: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockShipment(tx, shipmentId);
    const f = await loadFacts(tx, shipmentId);
    assertClientVisible(req, f.clientId, 'Shipment');
    if (f.stage !== input.from)
      throw conflict(
        `This shipment has moved to "${stageLabel(f.direction, f.stage)}" since you opened it. Refresh to see the latest.`,
      );
    const e = evaluate(f, { permissions: req.auth!.permissions });
    if (!e.can.sendBack) throw forbidden('You cannot send this shipment back');
    const to = stageIndex(f.direction, input.to);
    if (to < 0 || to >= e.idx) throw businessRule('Pick an earlier stage to send it back to');
    await tx.execute(
      sql`UPDATE shipments SET workflow_stage = ${input.to}, stage_changed_at = now(), updated_at = now(), updated_by_id = ${req.auth!.userId}
          WHERE id = ${shipmentId}`,
    );
    await tx.execute(
      sql`INSERT INTO shipment_stage_history (shipment_id, from_stage, to_stage, action, note, user_id)
          VALUES (${shipmentId}, ${f.stage}, ${input.to}, 'RETURN', ${input.note}, ${req.auth!.userId})`,
    );
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'shipment_workflow',
        entityId: shipmentId,
        before: { stage: f.stage },
        after: { stage: input.to, action: 'RETURN' },
        reason: input.note,
      },
      req,
    );
  });
}

/* ---------------------------------------------------------------------------------------- */
/* My Work                                                                                   */
/* ---------------------------------------------------------------------------------------- */

interface QueueRow {
  shipmentId: string;
  reference: string;
  clientName: string;
  clientCode: string;
  direction: Direction;
  workflowStage: string | null;
  stageChangedAt: string | null;
  eta: string | null;
  etd: string | null;
  invoiceNos: string[];
}

export async function workQueue(
  req: Request,
  scope: 'mine' | 'all',
): Promise<{ items: WorkQueueItem[]; counts: Record<string, number> }> {
  const conds = [sql`s.deleted_at IS NULL`, sql`coalesce(s.workflow_stage, '') <> ${CLOSED_STAGE}`];
  const scoped = clientCondition(sql`s.client_id`, allowedClients(req) ?? undefined);
  if (scoped) conds.push(scoped);
  const rows = await queryRows<QueueRow>(
    db,
    sql`
    SELECT s.id AS "shipmentId", s.reference, c.name AS "clientName", c.code AS "clientCode", s.direction,
           s.workflow_stage AS "workflowStage", to_char(s.stage_changed_at, 'YYYY-MM-DD') AS "stageChangedAt",
           to_char(s.eta, 'YYYY-MM-DD') AS eta, to_char(s.etd, 'YYYY-MM-DD') AS etd,
           coalesce((SELECT array_agg(invoice_no ORDER BY sort_order) FROM cargo_invoices WHERE shipment_id = s.id), '{}') AS "invoiceNos"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY coalesce(s.eta, s.etd) NULLS LAST, s.reference`,
  );
  const today = todayPP();
  const owners = new Set(ROLE_OWNERS[req.auth!.role] ?? []);
  // Someone without a role mapping (e.g. per-user extras) works the stages they can complete.
  if (!owners.size)
    for (const [owner, perm] of Object.entries(OWNER_PERMISSION))
      if (
        req.auth!.role !== 'CEO' &&
        req.auth!.role !== 'VIEWER' &&
        hasPermission(req.auth!.permissions, perm)
      )
        owners.add(owner as WorkQueueItem['owner']);
  // The CEO's queue: closings held for a low margin.
  const ceo = owners.size === 0 && hasPermission(req.auth!.permissions, 'finance:approve');
  const lowMargin = new Set<string>();
  if (ceo) {
    const low = await queryRows<{ id: string }>(
      db,
      sql`SELECT d.shipment_id AS id FROM customs_declarations d
          JOIN accounting_records a ON a.declaration_id = d.id
          JOIN shipments s ON s.id = d.shipment_id AND s.workflow_stage = 'CLOSING'
          GROUP BY d.shipment_id
          HAVING sum(a.net_profit) < 0
              OR sum(a.net_profit) < ${LOW_MARGIN_RATIO} * nullif(sum(a.inv_revenue + a.dis_total + a.dn_total), 0)`,
    );
    for (const r of low) lowMargin.add(r.id);
  }
  const counts: Record<string, number> = {};
  const items: WorkQueueItem[] = [];
  for (const r of rows) {
    const stageKey = currentStageKey(r.direction, r.workflowStage);
    const stage = stagesFor(r.direction).find((s) => s.key === stageKey)!;
    counts[stage.owner] = (counts[stage.owner] ?? 0) + 1;
    if (scope === 'mine' && !owners.has(stage.owner) && !lowMargin.has(r.shipmentId)) continue;
    items.push({
      shipmentId: r.shipmentId,
      reference: r.reference,
      clientName: r.clientName,
      clientCode: r.clientCode,
      direction: r.direction,
      stage: stageKey,
      stageLabel: stage.label,
      owner: stage.owner,
      invoiceNos: r.invoiceNos,
      eta: r.eta,
      etd: r.etd,
      daysInStage: r.stageChangedAt ? -daysUntil(r.stageChangedAt, today)! : null,
    });
  }
  return { items, counts };
}

/* ---------------------------------------------------------------------------------------- */
/* Alerts                                                                                    */
/* ---------------------------------------------------------------------------------------- */

const SEVERITY_ORDER = { ERROR: 0, WARNING: 1, INFO: 2 } as const;

export async function alerts(req: Request): Promise<AlertItem[]> {
  const today = todayPP();
  const has = (p: Permission) => hasPermission(req.auth!.permissions, p);
  const ids = allowedClients(req) ?? undefined;
  const scoped = (col: string) => clientCondition(sql.raw(col), ids) ?? sql`true`;
  const out: AlertItem[] = [];
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const workflowLink = (id: string) => `/plans/${id}?tab=workflow`;

  if (has('shipments:read')) {
    // Permits about to lapse on shipments not yet cleared.
    const permits = await queryRows<{
      id: string;
      shipmentId: string;
      reference: string;
      permitNo: string;
      validUntil: string;
    }>(
      db,
      sql`SELECT p.id, s.id AS "shipmentId", s.reference, p.permit_no AS "permitNo", to_char(p.valid_until, 'YYYY-MM-DD') AS "validUntil"
          FROM customs_permits p JOIN shipments s ON s.id = p.shipment_id
          WHERE p.deleted_at IS NULL AND s.deleted_at IS NULL AND p.valid_until <= ${today}::date + 7
            AND coalesce(s.workflow_stage, '') <> ${CLOSED_STAGE}
            AND NOT EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id AND d.declare_no IS NOT NULL)
            AND ${scoped('s.client_id')}`,
    );
    for (const p of permits) {
      const left = daysUntil(p.validUntil, today)!;
      out.push({
        id: `permit:${p.id}`,
        kind: left < 0 ? 'PERMIT_EXPIRED' : 'PERMIT_EXPIRING',
        severity: left < 0 ? 'ERROR' : 'WARNING',
        title: left < 0 ? `Permit expired — ${p.reference}` : `Permit expiring — ${p.reference}`,
        detail:
          left < 0
            ? `${p.permitNo} expired ${dmy(p.validUntil)}; cargo not cleared.`
            : `${p.permitNo} expires in ${plural(left, 'day')} (${dmy(p.validUntil)}).`,
        link: workflowLink(p.shipmentId),
        date: p.validUntil,
      });
    }
    // Imports arriving in the next three days that haven't reached the factory.
    const eta = await queryRows<{ id: string; reference: string; clientName: string; eta: string }>(
      db,
      sql`SELECT s.id, s.reference, c.name AS "clientName", to_char(s.eta, 'YYYY-MM-DD') AS eta
          FROM shipments s JOIN clients c ON c.id = s.client_id
          WHERE s.deleted_at IS NULL AND s.direction = 'IMPORT' AND s.arrive_fty IS NULL
            AND s.eta BETWEEN ${today}::date AND ${today}::date + 3 AND ${scoped('s.client_id')}
          ORDER BY s.eta LIMIT 20`,
    );
    for (const s of eta)
      out.push({
        id: `eta:${s.id}`,
        kind: 'ETA_SOON',
        severity: 'INFO',
        title: `Arriving ${s.eta === today ? 'today' : dmy(s.eta)} — ${s.reference}`,
        detail: `${s.clientName}: have the permit, DO and local charges ready.`,
        link: workflowLink(s.id),
        date: s.eta,
      });
  }

  if (has('clients:read') || has('customs:read')) {
    const cdc = await queryRows<{ id: string; name: string; cdcNo: string; validUntil: string }>(
      db,
      sql`SELECT c.id, c.name, c.cdc_no AS "cdcNo", to_char(c.cdc_valid_until, 'YYYY-MM-DD') AS "validUntil"
          FROM clients c WHERE c.deleted_at IS NULL AND c.status <> 'INACTIVE' AND c.cdc_valid_until IS NOT NULL
            AND c.cdc_valid_until <= ${today}::date + ${EXPIRY_WARNING_DAYS}::int AND ${scoped('c.id')}`,
    );
    for (const c of cdc) {
      const left = daysUntil(c.validUntil, today)!;
      out.push({
        id: `cdc:${c.id}`,
        kind: 'CDC_EXPIRING',
        severity: left < 0 ? 'ERROR' : 'WARNING',
        title: `CDC master list ${left < 0 ? 'expired' : 'expiring'} — ${c.name}`,
        detail: `${c.cdcNo ?? 'Master list'} ${left < 0 ? 'expired' : 'valid until'} ${dmy(c.validUntil)}. Ask the client for the extension letter.`,
        link: `/clients/${c.id}`,
        date: c.validUntil,
      });
    }
    const auth = await queryRows<{
      id: string;
      clientId: string;
      name: string;
      kind: string;
      reference: string | null;
      validUntil: string;
    }>(
      db,
      sql`SELECT a.id, c.id AS "clientId", c.name, a.kind, a.reference, to_char(a.valid_until, 'YYYY-MM-DD') AS "validUntil"
          FROM client_authorizations a JOIN clients c ON c.id = a.client_id
          WHERE a.deleted_at IS NULL AND c.deleted_at IS NULL AND a.valid_until IS NOT NULL
            AND a.valid_until <= ${today}::date + ${EXPIRY_WARNING_DAYS}::int AND ${scoped('c.id')}`,
    );
    for (const a of auth) {
      const left = daysUntil(a.validUntil, today)!;
      out.push({
        id: `auth:${a.id}`,
        kind: 'AUTHORIZATION_EXPIRING',
        severity: left < 0 ? 'ERROR' : 'WARNING',
        title: `${a.kind === 'BROKER_ID' ? 'Broker ID' : a.kind === 'PATENT_VAT' ? 'Patent & VAT' : 'Authorization'} ${left < 0 ? 'expired' : 'expiring'} — ${a.name}`,
        detail: `${a.reference ?? 'Document'} ${left < 0 ? 'expired' : 'valid until'} ${dmy(a.validUntil)}.`,
        link: `/clients/${a.clientId}`,
        date: a.validUntil,
      });
    }
  }

  if (has('customs:read')) {
    const cards = await queryRows<{
      id: string;
      agentName: string;
      cardNo: string | null;
      cardExpiry: string;
    }>(
      db,
      sql`SELECT id, agent_name AS "agentName", card_no AS "cardNo", to_char(card_expiry, 'YYYY-MM-DD') AS "cardExpiry"
          FROM broker_agents WHERE is_active AND card_expiry IS NOT NULL AND card_expiry <= ${today}::date + 60`,
    );
    for (const c of cards) {
      const left = daysUntil(c.cardExpiry, today)!;
      out.push({
        id: `card:${c.id}`,
        kind: 'BROKER_CARD_EXPIRING',
        severity: left < 0 ? 'ERROR' : 'WARNING',
        title: `Customs agent card ${left < 0 ? 'expired' : 'expiring'}`,
        detail: `${c.agentName} ${c.cardNo ?? ''} ${left < 0 ? 'expired' : 'valid until'} ${dmy(c.cardExpiry)}.`,
        link: '/settings/broker',
        date: c.cardExpiry,
      });
    }
  }

  // Approvals waiting for this person.
  if (has('workflow:approve')) {
    const waiting = await queryRows<{
      id: string;
      reference: string;
      clientName: string;
      stage: string;
      direction: Direction;
      revenue: string;
      profit: string;
      ledger: number;
    }>(
      db,
      sql`SELECT s.id, s.reference, c.name AS "clientName", s.workflow_stage AS stage, s.direction,
                 coalesce(sum(a.inv_revenue + a.dis_total + a.dn_total), 0)::text AS revenue,
                 coalesce(sum(a.net_profit), 0)::text AS profit, count(a.id)::int AS ledger
          FROM shipments s JOIN clients c ON c.id = s.client_id
          LEFT JOIN customs_declarations d ON d.shipment_id = s.id
          LEFT JOIN accounting_records a ON a.declaration_id = d.id
          WHERE s.deleted_at IS NULL AND s.workflow_stage IN ('REVIEW', 'CLOSING') AND ${scoped('s.client_id')}
          GROUP BY s.id, c.name ORDER BY s.stage_changed_at NULLS FIRST LIMIT 50`,
    );
    for (const w of waiting) {
      const revenue = n(w.revenue);
      const profit = n(w.profit);
      const low =
        w.ledger > 0 && (profit < 0 || (revenue > 0 && profit / revenue < LOW_MARGIN_RATIO));
      // The CEO only needs to see closings that are waiting for them.
      if (req.auth!.role === 'CEO' && !(w.stage === 'CLOSING' && low)) continue;
      out.push({
        id: `approval:${w.id}`,
        kind: 'APPROVAL_WAITING',
        severity: low ? 'WARNING' : 'INFO',
        title: `${w.stage === 'REVIEW' ? 'Review package' : low ? 'Low-margin closing' : 'Close job'} — ${w.reference}`,
        detail: low
          ? `${w.clientName}: net profit $${fmt(profit)} on $${fmt(revenue)} revenue. Needs CEO approval.`
          : `${w.clientName}: waiting for your approval.`,
        link: workflowLink(w.id),
        date: null,
      });
    }
  }

  if (has('accounting:read')) {
    const due = await queryRows<{
      id: string;
      shipmentId: string;
      reference: string;
      vendorName: string;
      invoiceNo: string;
      total: string;
      dueDate: string;
    }>(
      db,
      sql`SELECT v.id, s.id AS "shipmentId", s.reference, v.vendor_name AS "vendorName", v.invoice_no AS "invoiceNo",
                 (v.amount + v.vat)::text AS total, to_char(v.due_date, 'YYYY-MM-DD') AS "dueDate"
          FROM vendor_invoices v JOIN shipments s ON s.id = v.shipment_id
          WHERE v.deleted_at IS NULL AND v.paid_on IS NULL AND v.due_date IS NOT NULL
            AND v.due_date <= ${today}::date + 3 AND ${scoped('s.client_id')}
          ORDER BY v.due_date LIMIT 30`,
    );
    for (const v of due) {
      const left = daysUntil(v.dueDate, today)!;
      out.push({
        id: `vendor:${v.id}`,
        kind: 'VENDOR_INVOICE_DUE',
        severity: left < 0 ? 'ERROR' : 'WARNING',
        title: `${left < 0 ? 'Overdue' : 'Due'}: ${v.vendorName} ${v.invoiceNo}`,
        detail: `$${fmt(n(v.total))} for ${v.reference}, due ${dmy(v.dueDate)}.`,
        link: workflowLink(v.shipmentId),
        date: v.dueDate,
      });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
  );
}
