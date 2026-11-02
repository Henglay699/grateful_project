import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { queryRows } from '../../lib/listing';
import { badRequest, notFound } from '../../lib/errors';

/**
 * Export paperwork that used to be filled by hand in Excel for every shipment:
 *  - BOOKING_FORM: the booking sent to the forwarder (JR EXPORT / 2-BOOKING TO FORWARDER)
 *  - WAREHOUSE_CHECKLIST: the CFS's document checklist for export clearance
 *  - CARGO_DO: the cargo delivery order the truck brings to the CFS
 * All three read the shipment, its client and consignee, and the cargo invoice lines.
 */
export const EXPORT_DOC_KINDS = ['BOOKING_FORM', 'WAREHOUSE_CHECKLIST', 'CARGO_DO'] as const;
export type ExportDocKind = (typeof EXPORT_DOC_KINDS)[number];

interface Head {
  reference: string;
  direction: 'IMPORT' | 'EXPORT';
  transportMode: string;
  loadType: string;
  bookingNo: string | null;
  etd: string | null;
  etdPort: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  clientLegalName: string | null;
  clientName: string;
  clientAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  consigneeName: string | null;
  consigneeAddress: string | null;
  countryName: string | null;
  forwarderName: string | null;
  portName: string | null;
  measuredCbm: string | null;
}

interface Line {
  invoiceNo: string;
  poNo: string | null;
  styleNo: string | null;
  description: string | null;
  invoiceDescription: string | null;
  pcs: string;
  ctns: string;
  cbm: string;
  nw: string;
  gw: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dm = (d: string | null) => (d ? `${d.slice(8, 10)}-${MONTHS[+d.slice(5, 7) - 1]}` : '');
const dmy = (d: string | null) => (d ? `${dm(d)}-${d.slice(0, 4)}` : '');
const num = (v: string | null | undefined) => (v ? Number(v) : 0);

async function load(id: string) {
  const [head] = await queryRows<Head>(
    db,
    sql`
    SELECT s.reference, s.direction, s.transport_mode AS "transportMode", s.load_type AS "loadType",
           s.booking_no AS "bookingNo", to_char(s.etd, 'YYYY-MM-DD') AS etd, s.etd_port AS "etdPort",
           s.vessel_name AS "vesselName", s.voyage_no AS "voyageNo",
           c.legal_name AS "clientLegalName", c.name AS "clientName", c.address AS "clientAddress",
           c.contact_name AS "contactName", c.contact_phone AS "contactPhone",
           cn.name AS "consigneeName", cn.address AS "consigneeAddress", co.name AS "countryName",
           f.name AS "forwarderName", p.name AS "portName", s.measured_cbm::text AS "measuredCbm"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    LEFT JOIN consignees cn ON cn.id = s.consignee_id
    LEFT JOIN countries co ON co.iso2 = s.destination_country_iso2
    LEFT JOIN forwarders f ON f.id = s.forwarder_id
    LEFT JOIN ports p ON p.id = s.clearance_port_id
    WHERE s.id = ${id} AND s.deleted_at IS NULL`,
  );
  if (!head) throw notFound('Shipment');
  const lines = await queryRows<Line>(
    db,
    sql`
    SELECT ci.invoice_no AS "invoiceNo", l.po_no AS "poNo", l.style_no AS "styleNo", l.description,
           ci.description AS "invoiceDescription", l.pcs::text AS pcs, l.ctns::text AS ctns, l.cbm::text AS cbm,
           l.net_weight_kg::text AS nw, l.gross_weight_kg::text AS gw
    FROM cargo_invoices ci JOIN cargo_invoice_lines l ON l.invoice_id = ci.id
    WHERE ci.shipment_id = ${id} ORDER BY ci.sort_order, ci.invoice_no, l.line_no`,
  );
  if (!lines.length)
    throw badRequest('Add the cargo invoices and their lines first (Item, Costing & Forwarding).');
  return { head, lines };
}

const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF7F7F7F' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE6F6FA' },
};

function sheet(wb: ExcelJS.Workbook, name: string, widths: number[]) {
  const ws = wb.addWorksheet(name, {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = widths.map((width) => ({ width }));
  ws.properties.defaultRowHeight = 18;
  return ws;
}

function title(ws: ExcelJS.Worksheet, row: number, text: string, cols: number, size = 16) {
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: 'Arial', bold: true, size };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(row).height = size + 10;
}

/** Label/value pairs, two per row. */
function pairs(ws: ExcelJS.Worksheet, start: number, items: [string, string][], cols: number) {
  const half = Math.floor(cols / 2);
  items.forEach(([label, value], i) => {
    const r = start + Math.floor(i / 2);
    const c0 = i % 2 === 0 ? 1 : half + 1;
    ws.getCell(r, c0).value = label;
    ws.getCell(r, c0).font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF555555' } };
    ws.mergeCells(r, c0 + 1, r, c0 + half - 1);
    const v = ws.getCell(r, c0 + 1);
    v.value = value;
    v.font = { name: 'Arial', size: 10 };
    v.alignment = { wrapText: true, vertical: 'top' };
  });
  return start + Math.ceil(items.length / 2);
}

function table(
  ws: ExcelJS.Worksheet,
  start: number,
  headers: string[],
  rows: (string | number | null)[][],
  totals: (string | number | null)[],
  numFmt: (string | undefined)[],
) {
  headers.forEach((h, i) => {
    const c = ws.getCell(start, i + 1);
    c.value = h;
    c.font = { name: 'Arial', bold: true, size: 9 };
    c.fill = HEAD_FILL;
    c.border = box;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(start).height = 30;
  rows.forEach((r, ri) => {
    r.forEach((v, i) => {
      const c = ws.getCell(start + 1 + ri, i + 1);
      c.value = v;
      c.font = { name: 'Arial', size: 10 };
      c.border = box;
      if (numFmt[i]) c.numFmt = numFmt[i]!;
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: numFmt[i] ? 'right' : 'left' };
    });
  });
  const tr = start + 1 + rows.length;
  totals.forEach((v, i) => {
    const c = ws.getCell(tr, i + 1);
    c.value = v;
    c.font = { name: 'Arial', bold: true, size: 10 };
    c.border = box;
    c.fill = HEAD_FILL;
    if (numFmt[i]) c.numFmt = numFmt[i]!;
    c.alignment = { horizontal: numFmt[i] ? 'right' : 'left' };
  });
  return tr + 1;
}

/** One row per invoice + PO + style, quantities summed. */
function grouped(lines: Line[]) {
  const map = new Map<string, Line & { n: number }>();
  for (const l of lines) {
    const k = `${l.invoiceNo}|${l.poNo ?? ''}|${l.styleNo ?? ''}`;
    const g = map.get(k);
    if (!g) map.set(k, { ...l, n: 1 });
    else {
      g.pcs = String(num(g.pcs) + num(l.pcs));
      g.ctns = String(num(g.ctns) + num(l.ctns));
      g.cbm = String(num(g.cbm) + num(l.cbm));
      g.nw = String(num(g.nw) + num(l.nw));
      g.gw = String(num(g.gw) + num(l.gw));
    }
  }
  return [...map.values()];
}

const sum = (lines: Line[], k: 'pcs' | 'ctns' | 'cbm' | 'nw' | 'gw') =>
  Math.round(lines.reduce((s, l) => s + num(l[k]), 0) * 1000) / 1000;

function shipper(h: Head) {
  return [h.clientLegalName ?? h.clientName, h.clientAddress, h.contactName && `ATTN: ${h.contactName} ${h.contactPhone ?? ''}`]
    .filter(Boolean)
    .join('\n');
}

function bookingForm(wb: ExcelJS.Workbook, h: Head, lines: Line[]) {
  const ws = sheet(wb, 'BOOKING FORM', [16, 16, 14, 34, 9, 10, 10, 11, 11]);
  title(ws, 1, `${(h.forwarderName ?? 'FORWARDER').toUpperCase()} — BOOKING FORM`, 9);
  let r = pairs(
    ws,
    3,
    [
      ['SHIPPER', shipper(h)],
      ['BOOKING / SO NO.', h.bookingNo ?? ''],
      ['CONSIGNEE', [h.consigneeName, h.consigneeAddress].filter(Boolean).join('\n')],
      ['DATE', dmy(new Date().toISOString().slice(0, 10))],
      ['NOTIFY PARTY', 'SAME AS CONSIGNEE'],
      ['EXPORT REF.', h.reference],
      ['ORIGIN', 'CAMBODIA'],
      ['MODE', `${h.transportMode} / ${h.loadType === 'FCL' ? 'CY' : 'CFS'}`],
      ['PORT OF LOADING', h.etdPort ?? h.portName ?? ''],
      ['FINAL DESTINATION', h.countryName ?? ''],
      ['ETD', dmy(h.etd)],
      ['VESSEL', [h.vesselName, h.voyageNo].filter(Boolean).join(' / ')],
    ],
    9,
  );
  for (let i = 3; i < r; i++) ws.getRow(i).height = 30;
  r += 1;
  ws.getCell(r, 1).value = 'PARTICULARS FURNISHED BY SHIPPER';
  ws.getCell(r, 1).font = { name: 'Arial', bold: true, size: 10 };
  const g = grouped(lines);
  table(
    ws,
    r + 1,
    ['INVOICE NO.', 'PO NO.', 'STYLE', 'DESCRIPTION', 'CTNS', 'QTY (PCS)', 'CBM', 'N.W. (KG)', 'G.W. (KG)'],
    g.map((l) => [
      l.invoiceNo,
      l.poNo,
      l.styleNo,
      l.description ?? l.invoiceDescription,
      num(l.ctns),
      num(l.pcs),
      num(l.cbm),
      num(l.nw),
      num(l.gw),
    ]),
    ['TOTAL', null, null, null, sum(lines, 'ctns'), sum(lines, 'pcs'), sum(lines, 'cbm'), sum(lines, 'nw'), sum(lines, 'gw')],
    [undefined, undefined, undefined, undefined, '#,##0', '#,##0', '#,##0.000', '#,##0.00', '#,##0.00'],
  );
}

function checklist(wb: ExcelJS.Workbook, h: Head, lines: Line[]) {
  const ws = sheet(wb, 'CHECKLIST', [6, 26, 20, 14, 20, 16]);
  title(ws, 1, 'DOCUMENT CHECKLIST FOR EXPORT CLEARANCE', 6);
  title(ws, 2, 'បញ្ជីត្រួតពិនិត្យឯកសារសម្រាប់ការនាំចេញ', 6, 12);
  let r = pairs(
    ws,
    4,
    [
      ['Shipper', h.clientLegalName ?? h.clientName],
      ['Consignee', h.consigneeName ?? ''],
      ['ETD', dmy(h.etd)],
      ['Booking / SO', h.bookingNo ?? ''],
    ],
    6,
  );
  const byInvoice = new Map<string, { pos: Set<string>; ctns: number }>();
  for (const l of lines) {
    const e = byInvoice.get(l.invoiceNo) ?? { pos: new Set<string>(), ctns: 0 };
    if (l.poNo) e.pos.add(l.poNo);
    e.ctns += num(l.ctns);
    byInvoice.set(l.invoiceNo, e);
  }
  r = table(
    ws,
    r + 1,
    ['No.', 'INVOICE & PACKING LIST No.', 'PO No.', 'Total Cartons', 'Final Destination', 'Declaration (Set)'],
    [...byInvoice.entries()].map(([inv, e], i) => [
      i + 1,
      inv,
      [...e.pos].join(', '),
      e.ctns,
      (h.countryName ?? '').toUpperCase(),
      1,
    ]),
    [null, 'TOTAL', null, sum(lines, 'ctns'), null, byInvoice.size],
    [undefined, undefined, undefined, '#,##0', undefined, '#,##0'],
  );
  r += 1;
  table(
    ws,
    r,
    ['', 'Attached documents', 'Original / set', '✓', '', ''],
    [
      [1, 'Invoice & Packing List', 'Sign & stamp 1 set', '', '', ''],
      [2, 'Authorization letter', 'Sign & stamp 2 sets', '', '', ''],
      [3, 'Authorization from owner to shipping staff', 'Sign & stamp 1 set', '', '', ''],
      [4, 'Patent & VAT', 'Stamp 1 set', '', '', ''],
      [5, 'CDC (Master List)', 'Copy 1 set', '', '', ''],
    ],
    [],
    [],
  );
}

function cargoDo(wb: ExcelJS.Workbook, h: Head, lines: Line[]) {
  const ws = sheet(wb, 'CARGO DELIVERY', [5, 18, 14, 16, 30, 9, 10, 12, 8, 8, 8]);
  title(ws, 1, 'CARGO DELIVERY ORDER (DO)', 11);
  let r = pairs(
    ws,
    3,
    [
      ['SHIPPER', shipper(h)],
      ['CONSIGNEE', [h.consigneeName, h.consigneeAddress].filter(Boolean).join('\n')],
      ['FINAL DESTINATION', (h.countryName ?? '').toUpperCase()],
      ['ETD', dmy(h.etd)],
      ['TRUCK / CONTAINER NO.', ''],
      ['DRIVER PHONE', ''],
      ['DELIVERY DATE', ''],
      ['TIME', ''],
    ],
    11,
  );
  for (let i = 3; i < 5; i++) ws.getRow(i).height = 44;
  r += 1;
  const g = grouped(lines);
  r = table(
    ws,
    r,
    ['No.', 'BR# / SO NUMBER', 'PO NUMBER', 'STYLE / COLOR', 'DESCRIPTION', 'CARTONS', 'CBM', 'GROSS WEIGHT', 'L', 'W', 'H'],
    g.map((l, i) => [
      i + 1,
      h.bookingNo,
      l.poNo,
      l.styleNo,
      l.description ?? l.invoiceDescription,
      num(l.ctns),
      num(l.cbm),
      num(l.gw),
      null,
      null,
      null,
    ]),
    [null, 'TOTAL', null, null, null, sum(lines, 'ctns'), sum(lines, 'cbm'), sum(lines, 'gw'), null, null, null],
    [undefined, undefined, undefined, undefined, undefined, '#,##0', '#,##0.000', '#,##0.00'],
  );
  r += 1;
  ws.mergeCells(r, 1, r, 11);
  ws.getCell(r, 1).value =
    'All drivers entering or delivering cargo to the CFS must wear full PPE (safety vest and safety shoes).';
  ws.getCell(r, 1).font = { name: 'Arial', italic: true, size: 9 };
  r += 3;
  ws.getCell(r, 2).value = 'Signature & stamp (Shipper)';
  ws.getCell(r, 8).value = 'Received by (CFS)';
  ws.getCell(r, 2).font = ws.getCell(r, 8).font = { name: 'Arial', bold: true, size: 10 };
}

export async function buildExportDoc(
  shipmentId: string,
  kind: ExportDocKind,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { head, lines } = await load(shipmentId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  if (kind === 'BOOKING_FORM') bookingForm(wb, head, lines);
  else if (kind === 'WAREHOUSE_CHECKLIST') checklist(wb, head, lines);
  else cargoDo(wb, head, lines);
  const name = { BOOKING_FORM: 'BOOKING FORM', WAREHOUSE_CHECKLIST: 'CHECKLIST', CARGO_DO: 'CARGO DELIVERY' }[kind];
  const client = (head.clientName ?? '').toUpperCase();
  const dest = (head.countryName ?? '').toUpperCase();
  const fileName = `${name} - ${client}${dest ? ` - ${dest}` : ''}${head.etd ? ` - ETD ${dm(head.etd)}` : ''}.xlsx`.replace(
    /[\\/:*?"<>|]+/g,
    ' ',
  );
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName };
}
