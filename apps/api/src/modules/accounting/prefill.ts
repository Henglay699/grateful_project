import { sql } from 'drizzle-orm';
import {
  recordSummaryItems,
  chargeLineUnit,
  containerUnit,
  recordSummaryLedgerGroup,
  shipmentChargeUnit,
  type BillingDocType,
  type BillingLineInput,
  type BillingPackType,
} from '@gs/shared';
import { db } from '../../db/client';
import { badRequest, notFound } from '../../lib/errors';
import { issueDateFor } from '../../lib/issueDate';
import { queryRows } from '../../lib/listing';
import { rateOn, vatRateOn } from './ledger';

interface Ctx {
  /** Null for a declaration not in the Monthly Ledger yet (record summaries only). */
  recordId: string | null;
  clientId: string;
  /** Null without a ledger row. */
  invDate: string | null;
  declareDate: string;
  exchangeRate: string;
  /** The ledger row's VAT percent (10 without a row). */
  vatRate: string;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  /** The ledger's typed number when no document has it yet (the new document takes it). */
  freeInvNo: string | null;
  freeDisNo: string | null;
  freeDnNo: string | null;
  clearFee: string;
  thc: string;
  otherPay: string;
  invRevenue: string;
  disTotal: string;
  dnTotal: string;
  declareNo: string;
  direction: 'IMPORT' | 'EXPORT';
  transportMode: string;
  loadType: string;
  forwarderId: string | null;
  portId: string | null;
  portName: string | null;
  originName: string | null;
  destinationName: string | null;
  clientName: string;
  legalName: string | null;
  legalNameKm: string | null;
  address: string | null;
  vattin: string | null;
  shipper: string | null;
  consignee: string | null;
  hbl: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  containers: string | null;
  containerSize: string | null;
  cbm: string;
  gw: string;
  ctns: string;
}

const n = (v: string | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v));

/**
 * A ready-to-edit draft for a document type, built from a ledger row and its shipment. A record
 * summary can also start from a declaration not in the Monthly Ledger yet (`declarationId`).
 */
export async function prefill(
  type: BillingDocType,
  recordId: string | null,
  declarationId: string | null = null,
): Promise<Record<string, unknown>> {
  if (type === 'credit-notes') {
    const [r] = await queryRows<{ declarationId: string }>(
      db,
      sql`SELECT declaration_id AS "declarationId" FROM accounting_records WHERE id = ${recordId}`,
    );
    if (!r) throw notFound('Ledger entry');
    return creditNotePrefill(r.declarationId);
  }
  if (!recordId && type !== 'record-summaries')
    throw badRequest('Start this document from a ledger entry');
  const [c] = await queryRows<Ctx>(
    db,
    sql`
    SELECT a.id AS "recordId", c.id AS "clientId", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate",
           to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", a.exchange_rate::text AS "exchangeRate",
           coalesce(a.vat_rate, 10)::text AS "vatRate", a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo",
           CASE WHEN NOT EXISTS (SELECT 1 FROM tax_invoices t WHERE upper(t.invoice_no) = upper(a.inv_no)) THEN a.inv_no END AS "freeInvNo",
           CASE WHEN NOT EXISTS (SELECT 1 FROM disbursements t WHERE upper(t.dis_no) = upper(a.dis_no) AND extract(year FROM t.dis_date) = extract(year FROM a.inv_date)) THEN a.dis_no END AS "freeDisNo",
           CASE WHEN NOT EXISTS (SELECT 1 FROM debit_notes t WHERE upper(t.dn_no) = upper(a.dn_no)) THEN a.dn_no END AS "freeDnNo",
           a.clear_fee::text AS "clearFee", a.thc::text AS thc,
           a.other_pay::text AS "otherPay", a.inv_revenue::text AS "invRevenue", a.dis_total::text AS "disTotal", a.dn_total::text AS "dnTotal",
           d.declare_no AS "declareNo", s.direction, s.transport_mode AS "transportMode", s.load_type AS "loadType", s.forwarder_id AS "forwarderId",
           coalesce(d.port_id, s.clearance_port_id) AS "portId", p.short_name AS "portName", oc.name AS "originName", dc.name AS "destinationName",
           c.name AS "clientName", c.legal_name AS "legalName", c.legal_name_km AS "legalNameKm", c.address, c.vattin,
           s.shipper_name AS shipper, cn.name AS consignee, s.hbl_no AS hbl, s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
           (SELECT string_agg(container_no, ', ' ORDER BY sort_order) FROM containers WHERE shipment_id = s.id) AS containers,
           (SELECT size::text FROM containers WHERE shipment_id = s.id ORDER BY sort_order LIMIT 1) AS "containerSize",
           coalesce((SELECT sum(l.cbm) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS cbm,
           coalesce((SELECT sum(l.gross_weight_kg) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS gw,
           coalesce((SELECT sum(l.ctns) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS ctns
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
    LEFT JOIN accounting_records a ON a.declaration_id = d.id JOIN clients c ON c.id = coalesce(a.client_id, s.client_id)
    LEFT JOIN ports p ON p.id = coalesce(d.port_id, s.clearance_port_id) LEFT JOIN consignees cn ON cn.id = s.consignee_id
    LEFT JOIN countries oc ON oc.iso2 = s.origin_country_iso2 LEFT JOIN countries dc ON dc.iso2 = s.destination_country_iso2
    WHERE ${
      recordId ? sql`a.id = ${recordId}` : sql`d.id = ${declarationId} AND s.deleted_at IS NULL`
    }`,
  );
  if (!c) throw notFound(recordId ? 'Ledger entry' : 'Declaration');

  const isImport = c.direction === 'IMPORT';
  const ship = {
    // POL / POD print in capitals (UNITED STATES, SHV PORT).
    pol: (isImport ? c.originName : c.portName)?.toUpperCase() ?? null,
    pod: (isImport ? c.portName : c.destinationName)?.toUpperCase() ?? null,
    containerNo: c.containers,
    volumeCbm: n(c.cbm),
    // Not a document field: lets a preview print "NON" as the volume by air.
    transportMode: c.transportMode,
    grossWeightKg: n(c.gw),
    shipper: c.shipper,
    consignee: c.consignee,
    hbl: c.hbl ?? 'NON',
    containerSize: c.containerSize,
    pkgs: Number(c.ctns) ? n(c.ctns) : c.quantity ? n(c.quantity) : null,
    pkgsUnit: Number(c.ctns) ? 'CTNS' : c.quantity ? c.quantityUnit : null,
  };
  const customer = {
    customerNameEn: (c.legalName ?? c.clientName).toUpperCase(),
    customerNameKm: c.legalNameKm,
    customerAddress: c.address,
    customerVattin: c.vattin,
  };
  const base = { accountingRecordId: c.recordId, clientId: c.clientId };
  const line = (description: string, price: string, unit = 'SHIP') => ({
    description,
    qty: '1',
    unit,
    unitPrice: n(price) || '0',
    mark: '',
  });
  const fee = isImport
    ? 'កំរៃសេវាបំពេញបែបបទនាំចូល / IMPORT PROCESSING FEE'
    : 'កំរៃសេវាបំពេញបែបបទនាំចេញ / EXPORT PROCESSING FEE';

  switch (type) {
    case 'tax-invoices':
      return {
        ...base,
        ...customer,
        ...ship,
        invoiceNo: c.freeInvNo,
        invoiceDate: c.invDate,
        exchangeRate: c.exchangeRate,
        vatRate: c.vatRate,
        lines: [line(fee, c.invRevenue)],
      };
    case 'disbursements':
      return {
        ...base,
        ...customer,
        ...ship,
        disNo: c.freeDisNo,
        disDate: c.invDate,
        exchangeRate: c.exchangeRate,
        reference: c.declareNo,
        lines: (await summaryLines('disbursements', recordId)) ?? [
          line('CUSTOMS PROCESSING FEE (as per receipt)', c.disTotal),
        ],
      };
    case 'debit-notes':
      return {
        ...base,
        ...ship,
        dnNo: c.freeDnNo,
        dnDate: c.invDate,
        billTo: customer.customerNameEn,
        address: c.address,
        reference: c.declareNo,
        lines: (await summaryLines('debit-notes', recordId)) ?? [
          line('CLEARANCE, TRUCKING & HANDLING CHARGES', c.dnTotal),
        ],
      };
    case 'record-summaries': {
      // Not in the ledger yet: the issue date it will get (next working day after clearance).
      const summaryDate = c.invDate ?? (await issueDateFor(db, c.declareDate));
      const vatRate = await vatRateOn(db, summaryDate);
      return {
        ...base,
        direction: c.direction,
        transportMode: c.transportMode,
        loadType: c.loadType,
        invNo: c.invNo,
        disNo: c.disNo,
        dnNo: c.dnNo,
        forwarderId: c.forwarderId,
        portId: c.portId,
        declareNo: c.declareNo,
        summaryDate,
        vatRate,
        quantityText: ship.pkgs && `${ship.pkgs} ${ship.pkgsUnit ?? ''}`.trim(),
        blNo: c.hbl,
        containerNo: c.containers,
        containerSize: c.containerSize,
        grossWeightKg: n(c.gw),
        cbm: c.transportMode === 'AIR' ? 'NON' : n(c.cbm),
        // The standard import / export breakdown; the processing fee starts at the ledger's
        // service fee (VAT at the summary date's percent goes on top), the rest are priced
        // per shipment.
        lines: recordSummaryItems(c.direction, vatRate).map(([description, mark], i) => ({
          description,
          qty: '1',
          unit: chargeLineUnit(description, shipmentChargeUnit(c)),
          unitPrice: (i === 0 && n(c.invRevenue)) || '0',
          mark,
        })),
      };
    }
  }
}

/**
 * A shipment's Disbursement or Debit Note lines from its checked record summary: the priced
 * receipt lines (DIS) or the other charges (DN), as on the summary. Null without one.
 */
export async function summaryLines(
  type: 'disbursements' | 'debit-notes',
  recordId: string | null,
): Promise<BillingLineInput[] | null> {
  if (!recordId) return null;
  const rows = await queryRows<BillingLineInput & { description: string; mark: string }>(
    db,
    sql`SELECT l.description, l.qty::text AS qty, coalesce(l.unit, '') AS unit,
               l.unit_price::text AS "unitPrice", coalesce(l.mark, '') AS mark
        FROM record_summary_lines l JOIN record_summaries t ON t.id = l.record_summary_id
        WHERE t.accounting_record_id = ${recordId} AND t.status = 'ISSUED'
          AND t.review_status = 'CHECKED'
        ORDER BY l.line_no`,
  );
  const want = type === 'disbursements' ? 'DIS' : 'DN';
  const lines = rows
    .filter(
      (l) => Number(l.unitPrice) > 0 && recordSummaryLedgerGroup(l.description, l.mark) === want,
    )
    .map((l) => ({ ...l, qty: n(String(l.qty)), unitPrice: n(String(l.unitPrice)) }));
  return lines.length ? lines : null;
}

/**
 * A draft Credit Noted (the customs broker's payment voucher) for a declaration. It bills
 * Grateful Solutions; the shipper is the client's factory. Works with or without a Monthly
 * Ledger row (submitting it creates one when missing).
 */
export async function creditNotePrefill(declarationId: string): Promise<Record<string, unknown>> {
  const [c] = await queryRows<{
    recordId: string | null;
    clientId: string;
    declareNo: string;
    declareDate: string;
    direction: 'IMPORT' | 'EXPORT';
    transportMode: string;
    loadType: string;
    portId: string | null;
    shipper: string;
    hbl: string | null;
    quantity: string | null;
    quantityUnit: string | null;
    containers: string | null;
    containerSize: string | null;
    containerCount: number;
    cbm: string;
    gw: string;
    company: { nameEn?: string; addressEn?: string } | null;
  }>(
    db,
    sql`
    SELECT a.id AS "recordId", s.client_id AS "clientId", d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
           s.direction, s.transport_mode AS "transportMode", s.load_type AS "loadType",
           coalesce(d.port_id, s.clearance_port_id) AS "portId", upper(coalesce(c.legal_name, c.name)) AS shipper,
           s.hbl_no AS hbl, s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
           (SELECT string_agg(container_no, ', ' ORDER BY sort_order) FROM containers WHERE shipment_id = s.id) AS containers,
           (SELECT size::text FROM containers WHERE shipment_id = s.id ORDER BY sort_order LIMIT 1) AS "containerSize",
           (SELECT count(*)::int FROM containers WHERE shipment_id = s.id) AS "containerCount",
           coalesce((SELECT sum(l.cbm) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS cbm,
           coalesce((SELECT sum(l.gross_weight_kg) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS gw,
           (SELECT value FROM settings WHERE key = 'company') AS company
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL JOIN clients c ON c.id = s.client_id
    LEFT JOIN accounting_records a ON a.declaration_id = d.id
    WHERE d.id = ${declarationId}`,
  );
  if (!c) throw notFound('Declaration');
  const size = c.containerSize ?? '';
  // "MRKU8974303 (1X20'GP)" as on the broker's voucher; the editor reads the unit back from it.
  const containerNo = c.containers
    ? `${c.containers}${size ? ` (${c.containerCount}X${containerUnit(size)})` : ''}`
    : null;
  const unit = shipmentChargeUnit(c);
  const line = (description: string) => ({
    description,
    qty: '1',
    unit: chargeLineUnit(description, unit),
    unitPrice: '',
    mark: '',
  });
  return {
    accountingRecordId: c.recordId ?? '',
    clientId: c.clientId,
    cnDate: c.declareDate,
    vatRate: await vatRateOn(db, c.declareDate),
    billTo: (c.company?.nameEn ?? 'GRATEFUL SOLUTIONS (CAMBODIA) CO.,LTD').toUpperCase(),
    address: c.company?.addressEn ?? null,
    shipper: c.shipper,
    portId: c.portId,
    containerNo,
    refType: 'HOUSE_BILL',
    refNo: c.hbl,
    quantityText: c.quantity ? `${n(c.quantity)} ${c.quantityUnit ?? ''}`.trim() : null,
    grossWeightKg: n(c.gw),
    cbm: n(c.cbm),
    declareNo: c.declareNo,
    // The broker's usual charges; prices are filled in per shipment.
    lines: [
      line(c.direction === 'IMPORT' ? 'IMPORT-CLEARANCE' : 'EXPORT-CLEARANCE'),
      line('TRUCKING'),
      line('CUSTOMS ACC'),
      line('CUSTOM PROCESSING FEE'),
      line('LOLO'),
    ],
  };
}

/**
 * A draft for a document that belongs to no shipment (e.g. a monthly service-fee debit
 * note): the client's billing details, the date, and no lines yet.
 */
export async function clientPrefill(
  type: BillingDocType,
  clientId: string,
  date: string,
): Promise<Record<string, unknown>> {
  const [c] = await queryRows<{
    name: string;
    legalName: string | null;
    legalNameKm: string | null;
    address: string | null;
    vattin: string | null;
  }>(
    db,
    sql`SELECT name, legal_name AS "legalName", legal_name_km AS "legalNameKm", address, vattin
        FROM clients WHERE id = ${clientId} AND deleted_at IS NULL`,
  );
  if (!c) throw notFound('Client');
  const billTo = (c.legalName ?? c.name).toUpperCase();
  const customer = {
    customerNameEn: billTo,
    customerNameKm: c.legalNameKm,
    customerAddress: c.address,
    customerVattin: c.vattin,
  };
  switch (type) {
    case 'tax-invoices':
      return {
        clientId,
        ...customer,
        invoiceDate: date,
        exchangeRate: await rateOn(db, date),
        vatRate: await vatRateOn(db, date),
        lines: [],
      };
    case 'disbursements':
      return {
        clientId,
        ...customer,
        disDate: date,
        exchangeRate: await rateOn(db, date),
        lines: [],
      };
    case 'debit-notes':
      return { clientId, billTo, address: c.address, dnDate: date, lines: [] };
    default:
      throw badRequest('Start this document from a ledger entry');
  }
}

const LINES_SQL: Record<
  BillingPackType,
  { doc: string; lines: string; fk: string; date: string; no: string }
> = {
  'tax-invoices': {
    doc: 'tax_invoices',
    lines: 'tax_invoice_lines',
    fk: 'tax_invoice_id',
    date: 'invoice_date',
    no: 'invoice_no',
  },
  disbursements: {
    doc: 'disbursements',
    lines: 'disbursement_lines',
    fk: 'disbursement_id',
    date: 'dis_date',
    no: 'dis_no',
  },
  'debit-notes': {
    doc: 'debit_notes',
    lines: 'debit_note_lines',
    fk: 'debit_note_id',
    date: 'dn_date',
    no: 'dn_no',
  },
};

/**
 * The line items of the client's last issued shipment document of a type, to start a new
 * one from: same direction (import/export) as the ledger entry, the same container size
 * first, then the most recent. Null when the client has none yet.
 */
export async function previousLines(
  type: BillingPackType,
  clientId: string,
  recordId: string | null,
): Promise<{ number: string | null; lines: BillingLineInput[] } | null> {
  const t = LINES_SQL[type];
  const firstSize = (shipment: string) =>
    sql.raw(
      `(SELECT size FROM containers WHERE shipment_id = ${shipment} ORDER BY sort_order LIMIT 1)`,
    );
  const [src] = await queryRows<{ id: string; number: string | null }>(
    db,
    sql`
    WITH target AS (
      SELECT s.direction, ${firstSize('s.id')} AS size
      FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
      JOIN shipments s ON s.id = d.shipment_id
      WHERE a.id = ${recordId}::uuid
    )
    SELECT t.id, t.${sql.raw(t.no)} AS number
    FROM ${sql.raw(t.doc)} t
    JOIN accounting_records a ON a.id = t.accounting_record_id
    JOIN customs_declarations d ON d.id = a.declaration_id JOIN shipments s ON s.id = d.shipment_id
    LEFT JOIN target ON true
    WHERE t.client_id = ${clientId} AND t.status = 'ISSUED'
      -- Import and export lines differ (IMPORT vs EXPORT PROCESSING FEE, THC vs HBL fee…).
      AND (target.direction IS NULL OR s.direction = target.direction)
    ORDER BY (${firstSize('s.id')} = target.size) DESC NULLS LAST,
             t.${sql.raw(t.date)} DESC, t.created_at DESC
    LIMIT 1`,
  );
  if (!src) return null;
  const lines = await queryRows<BillingLineInput>(
    db,
    sql`SELECT description, qty::text AS qty, coalesce(unit, '') AS unit, unit_price::text AS "unitPrice", coalesce(mark, '') AS mark
        FROM ${sql.raw(t.lines)} WHERE ${sql.raw(t.fk)} = ${src.id} ORDER BY line_no`,
  );
  return lines.length
    ? {
        number: src.number,
        lines: lines.map((l) => ({
          ...l,
          qty: n(String(l.qty)),
          unitPrice: n(String(l.unitPrice)),
        })),
      }
    : null;
}
