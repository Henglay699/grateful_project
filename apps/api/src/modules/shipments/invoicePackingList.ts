import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { queryRows } from '../../lib/listing';
import { badRequest, notFound } from '../../lib/errors';

/**
 * Export "INV + PL" workbook, laid out like JR's own file (e.g. INV+PL-TO LA-USA-1X40'HQ-CH-
 * JRA26057-ETD 27-SEP.xls): one sheet per cargo invoice, the commercial INVOICE in columns A–H
 * and the PACKING LIST beside it in I–R, with a page break between them so each prints on its
 * own page.
 */

interface Head {
  reference: string;
  direction: 'IMPORT' | 'EXPORT';
  transportMode: string;
  etd: string | null;
  /** On-board date: printed as "shipped on" once known, so it matches the B/L. */
  atd: string | null;
  portName: string | null;
  portCode: string | null;
  countryIso2: string | null;
  countryName: string | null;
  consigneeName: string | null;
  consigneeAddress: string | null;
  clientName: string;
  legalName: string | null;
  legalNameKm: string | null;
  clientAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  cdcNo: string | null;
  cdcIssueDate: string | null;
  containers: { containerNo: string; size: string | null }[];
}
interface Line {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string | null;
  invoiceDescription: string | null;
  poNo: string | null;
  styleNo: string | null;
  htsCode: string | null;
  description: string | null;
  pcs: string;
  ctns: string;
  nw: string;
  gw: string;
  cbm: string;
  price: string;
  amount: string;
}

const FONT = 'Times New Roman';
/** Column widths of the original, in Excel character units (A–R). */
const WIDTHS = [
  13, 17.875, 15.125, 14, 14, 10.375, 11.625, 17.875, 13, 17.875, 15.125, 14, 6.875, 14, 10.375,
  11.625, 11.125, 11,
];
const FMT = {
  pcs: '#,##0',
  price: '#,##0.000_);\\(#,##0.000\\)',
  amount: '#,##0.00_);(#,##0.00)',
  kg: '#,##0.00',
  invDate: '[$-409]dd\\-mmm\\-yy;@',
  longDate: '[$-409]d\\-mmm\\-yyyy;@',
  ctnsTotal: '#,##0\\ "CTNS"',
  kgsTotal: '#,###.00\\ "KGS"',
};
const SHORT_COUNTRY: Record<string, string> = { US: 'USA', GB: 'UK', AE: 'UAE' };
const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'LAND', RAIL: 'RAIL' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

async function load(shipmentId: string): Promise<{ head: Head; lines: Line[] }> {
  const [head] = await queryRows<Head>(
    db,
    sql`
    SELECT s.reference, s.direction, s.transport_mode AS "transportMode", to_char(s.etd, 'YYYY-MM-DD') AS etd,
           to_char(s.atd, 'YYYY-MM-DD') AS atd,
           p.name AS "portName", p.code AS "portCode",
           s.destination_country_iso2 AS "countryIso2", co.name AS "countryName",
           cn.name AS "consigneeName", cn.address AS "consigneeAddress",
           c.name AS "clientName", c.legal_name AS "legalName", c.legal_name_km AS "legalNameKm",
           c.address AS "clientAddress", c.contact_name AS "contactName", c.contact_phone AS "contactPhone",
           c.cdc_no AS "cdcNo", to_char(c.cdc_issue_date, 'YYYY-MM-DD') AS "cdcIssueDate",
           coalesce((SELECT json_agg(json_build_object('containerNo', k.container_no, 'size', k.size) ORDER BY k.sort_order)
                     FROM containers k WHERE k.shipment_id = s.id), '[]') AS containers
    FROM shipments s JOIN clients c ON c.id = s.client_id
    LEFT JOIN ports p ON p.id = s.clearance_port_id
    LEFT JOIN countries co ON co.iso2 = s.destination_country_iso2
    LEFT JOIN consignees cn ON cn.id = s.consignee_id
    WHERE s.id = ${shipmentId} AND s.deleted_at IS NULL`,
  );
  if (!head) throw notFound('Shipment');
  const lines = await queryRows<Line>(
    db,
    sql`
    SELECT ci.id AS "invoiceId", ci.invoice_no AS "invoiceNo", to_char(ci.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
           ci.description AS "invoiceDescription", l.po_no AS "poNo", l.style_no AS "styleNo", l.hts_code AS "htsCode",
           l.description, l.pcs::text AS pcs, l.ctns::text AS ctns, l.net_weight_kg::text AS nw,
           l.gross_weight_kg::text AS gw, l.cbm::text AS cbm, l.fob_unit_price::text AS price, l.fob_amount::text AS amount
    FROM cargo_invoices ci JOIN cargo_invoice_lines l ON l.invoice_id = ci.id
    WHERE ci.shipment_id = ${shipmentId}
    ORDER BY ci.sort_order, ci.invoice_no, l.line_no`,
  );
  return { head, lines };
}

/** "2026-09-27" → a Date at UTC midnight, so Excel shows the same calendar day. */
const xlDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const n = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? 0 : Number(v);

/** "FROM PHNOM PENH PORT KINGDOM OF CAMBODIA VIA VIETNAM TO USA" */
function route(h: Head): string {
  const port = (h.portName ?? 'PHNOM PENH PORT').toUpperCase();
  // River shipments from Phnom Penh Autonomous Port tranship in Vietnam (Cai Mep).
  const via = h.transportMode === 'SEA' && h.portCode === 'PNH04' ? ' VIA VIETNAM' : '';
  const to = h.countryIso2
    ? (SHORT_COUNTRY[h.countryIso2] ?? (h.countryName ?? h.countryIso2).toUpperCase())
    : '';
  return `FROM ${port} KINGDOM OF CAMBODIA${via}${to ? ` TO ${to}` : ''}`;
}

/** Workbook + a file name like "INV+PL-TO USA-1X40'HQ-JRA26057-ETD 27-SEP.xlsx". */
export async function buildInvoicePackingList(
  shipmentId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { head, lines } = await load(shipmentId);
  if (!lines.length)
    throw badRequest('Add the cargo invoices and their lines first (Cargo, Pricing & FOB).');

  const invoices = new Map<string, Line[]>();
  for (const l of lines) invoices.set(l.invoiceId, [...(invoices.get(l.invoiceId) ?? []), l]);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  const breaks: number[] = [];
  for (const invLines of invoices.values()) breaks.push(addSheet(wb, head, invLines));

  let buffer = Buffer.from(await wb.xlsx.writeBuffer());
  buffer = await addColumnBreaks(buffer, breaks.length);

  const sizes = new Map<string, number>();
  for (const c of head.containers) {
    const s = (c.size ?? '').replace(/^(\d+)/, "$1'");
    if (s) sizes.set(s, (sizes.get(s) ?? 0) + 1);
  }
  const ctnr = [...sizes].map(([s, k]) => `${k}X${s}`).join('+');
  const etd = head.etd
    ? `${head.etd.slice(8, 10)}-${MONTHS[Number(head.etd.slice(5, 7)) - 1]}`
    : '';
  const to = head.countryIso2
    ? (SHORT_COUNTRY[head.countryIso2] ?? (head.countryName ?? head.countryIso2).toUpperCase())
    : '';
  const parts = [
    'INV+PL',
    to && `TO ${to}`,
    ctnr,
    [...new Set(lines.map((l) => l.invoiceNo))].join(','),
    etd && `ETD ${etd}`,
  ].filter(Boolean);
  const fileName = `${parts.join('-').replace(/[\\/:*?"<>|]+/g, ' ')}.xlsx`;
  return { buffer, fileName };
}

/** Lays out one invoice on its own sheet; returns the last row used. */
function addSheet(wb: ExcelJS.Workbook, h: Head, inv: Line[]): number {
  const first = inv[0]!;
  const ws = wb.addWorksheet(first.invoiceNo.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      // A fixed scale (not "fit to page", which would ignore the page break after column H).
      scale: 78,
      margins: { left: 0.4, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });
  ws.properties.defaultRowHeight = 15;
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
    name: FONT,
    size: 12,
    ...o,
  });
  const put = (
    addr: string,
    value: ExcelJS.CellValue,
    o: {
      font?: Partial<ExcelJS.Font>;
      h?: ExcelJS.Alignment['horizontal'];
      v?: ExcelJS.Alignment['vertical'];
      wrap?: boolean;
      fmt?: string;
    } = {},
  ) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = font(o.font);
    c.alignment = { horizontal: o.h, vertical: o.v ?? 'middle', wrapText: o.wrap };
    if (o.fmt) c.numFmt = o.fmt;
  };
  // Every block is written twice: invoice from column A, packing list from column I (+8).
  // The packing list has one extra narrow column (M), so its G/H fields sit at P/Q (+9).
  const col = (letter: string, side: 0 | 1) =>
    String.fromCharCode(letter.charCodeAt(0) + (side ? (letter >= 'G' ? 9 : 8) : 0));
  const both = (fn: (side: 0 | 1, c: (letter: string) => string) => void) => {
    fn(0, (l) => col(l, 0));
    fn(1, (l) => col(l, 1));
  };

  // ---- Letterhead (rows 1–5) ----
  const heights: Record<number, number> = { 1: 39, 2: 20, 3: 20, 4: 20, 5: 33, 6: 20, 16: 24 };
  for (let row = 7; row <= 14; row++) heights[row] = 18;
  for (const [r, ht] of Object.entries(heights)) ws.getRow(Number(r)).height = ht;
  const company = h.legalName ?? h.clientName;
  both((side, c) => {
    for (let r = 1; r <= 5; r++) ws.mergeCells(`${c('A')}${r}:${side ? 'R' : 'H'}${r}`);
    put(`${c('A')}1`, h.legalNameKm ?? '', { font: { name: 'Khmer MEF2', size: 18 }, h: 'center' });
    put(`${c('A')}2`, company, { font: { size: 16, bold: true }, h: 'center' });
    put(`${c('A')}3`, (h.clientAddress ?? '').toUpperCase(), { h: 'center', wrap: true });
    put(`${c('A')}4`, h.contactPhone ? `TEL ${h.contactPhone}` : '', { h: 'center' });
    put(`${c('A')}5`, side ? 'PACKING LIST' : 'INVOICE', {
      font: { size: 20, bold: true, underline: true },
      h: 'center',
    });

    // ---- Invoice no / date / consignee (rows 6–14) ----
    put(`${c('G')}6`, 'Invoice No:', { h: 'right' });
    put(`${c('H')}6`, first.invoiceNo, { h: 'center' });
    put(`${c('A')}7`, 'Consignee:');
    put(`${c('B')}7`, (h.consigneeName ?? '').toUpperCase(), { h: 'left' });
    put(`${c('G')}7`, 'Date:', { h: 'right' });
    put(`${c('H')}7`, xlDate(first.invoiceDate), { h: 'center', fmt: FMT.invDate });
    const addr = (h.consigneeAddress ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const addrLines = addr.length > 3 ? [...addr.slice(0, 2), addr.slice(2).join(', ')] : addr;
    addrLines.forEach((t, i) => put(`${c('B')}${8 + i}`, t, { h: 'left' }));
    put(`${c('A')}12`, 'BY:');
    put(`${c('B')}12`, MODE[h.transportMode] ?? h.transportMode);
    put(`${c('B')}13`, route(h));
    put(`${c('A')}14`, 'SHIPPED ON :  ');
    put(`${c('B')}14`, xlDate(h.atd ?? h.etd), { h: 'center', fmt: FMT.longDate });
  });

  // ---- Goods table header (row 16) ----
  const thin: Partial<ExcelJS.Border> = { style: 'thin' };
  const border = (
    addr: string,
    sides: Partial<Record<'top' | 'bottom' | 'left' | 'right', boolean>>,
  ) => {
    const cell = ws.getCell(addr);
    cell.border = {
      ...cell.border,
      ...(sides.top ? { top: thin } : {}),
      ...(sides.bottom ? { bottom: thin } : {}),
      ...(sides.left ? { left: thin } : {}),
      ...(sides.right ? { right: thin } : {}),
    };
  };
  const head16 = { font: { size: 10 }, h: 'center' as const, wrap: true };
  ws.mergeCells('B16:E16');
  ws.mergeCells('J16:M16');
  put('A16', 'Marks & Numbers', { font: { size: 10 } });
  put('B16', 'Description of Goods', head16);
  put('F16', 'Quantity\nPCS', head16);
  put('G16', 'Unit Price', head16);
  put('H16', 'Amount\n(USD)', head16);
  put('I16', 'Marks & Numbers', { font: { size: 10 } });
  put('J16', 'Description of Goods', head16);
  put('N16', 'Quantity\nPCS', head16);
  put('O16', 'TOTAL \nCTN', head16);
  put('P16', 'TTL N.W\nKGS', head16);
  put('Q16', 'TTL GR.W\nKGS', head16);
  put('R16', 'CBM\nM3', head16);
  for (const l of 'ABCDEFGHIJKLMNOPQR') border(`${l}16`, { top: true, bottom: true });
  // Column separators of the goods box (left edges), plus the right edge of each half.
  const SEPARATORS = ['A', 'B', 'F', 'G', 'H', 'I', 'J', 'N', 'O', 'P', 'Q', 'R'];
  const RIGHT_EDGES = ['H', 'R'];
  const frame = (r: number) => {
    for (const l of SEPARATORS) border(`${l}${r}`, { left: true });
    for (const l of RIGHT_EDGES) border(`${l}${r}`, { right: true });
  };
  frame(16);

  // ---- Goods rows: marks, description groups, PO / style lines, HTS ----
  let r = 18;
  both((_s, c) => {
    put(`${c('A')}18`, 'AS PER', { font: { size: 10 }, h: 'center' });
    put(`${c('A')}19`, 'COMMERCIAL', { font: { size: 10 }, h: 'center' });
    put(`${c('A')}20`, 'INVOICE', { font: { size: 10 }, h: 'center' });
  });
  const groups: { description: string; lines: Line[] }[] = [];
  for (const l of inv) {
    const d = (l.description || l.invoiceDescription || '').trim();
    const last = groups[groups.length - 1];
    if (last && last.description === d) last.lines.push(l);
    else groups.push({ description: d, lines: [l] });
  }
  groups.forEach((g, gi) => {
    both((_s, c) =>
      put(`${c('B')}${r}`, g.description.toUpperCase(), { font: { bold: true }, h: 'left' }),
    );
    r++;
    if (gi === 0) {
      both((_s, c) => {
        put(`${c('B')}${r}`, 'P.O NO.:', { font: { bold: true }, h: 'center' });
        put(`${c('C')}${r}`, 'STYLE NO.:', { font: { bold: true }, h: 'center' });
      });
      r++;
    }
    for (const l of g.lines) {
      both((_s, c) => {
        put(`${c('B')}${r}`, l.poNo ?? '', { h: 'center', fmt: '@' });
        put(`${c('C')}${r}`, l.styleNo ?? '', { h: 'center', fmt: '@' });
      });
      put(`F${r}`, n(l.pcs), { h: 'center', fmt: FMT.pcs });
      put(`G${r}`, n(l.price), { h: 'center', fmt: FMT.price });
      put(`H${r}`, n(l.amount), { h: 'center', fmt: FMT.amount });
      put(`N${r}`, n(l.pcs), { h: 'center', fmt: FMT.pcs });
      put(`O${r}`, n(l.ctns), { h: 'center', fmt: FMT.pcs });
      put(`P${r}`, n(l.nw), { h: 'center', fmt: FMT.kg });
      put(`Q${r}`, n(l.gw), { h: 'center', fmt: FMT.kg });
      put(`R${r}`, n(l.cbm), { h: 'center', fmt: FMT.kg });
      r++;
    }
  });
  const hts = [...new Set(inv.map((l) => (l.htsCode ?? '').trim()).filter(Boolean))].join(', ');
  if (hts)
    both((_s, c) => {
      put(`${c('B')}${r}`, 'HTS CODE:', { font: { bold: true }, h: 'center' });
      put(`${c('C')}${r}`, hts, { font: { bold: true }, h: 'center' });
    });
  const lastContent = r;

  // ---- Totals (two rows, like rows 41–42 of the original) ----
  const t = Math.max(41, lastContent + 2);
  for (let row = 17; row < t; row++) frame(row);
  // Rounded so float noise (7.6259999…) never reaches the sheet; quantities carry 3 decimals.
  const sum = (k: keyof Line) =>
    Math.round(inv.reduce((s, l) => s + n(l[k] as string), 0) * 1000) / 1000;
  ws.mergeCells(`B${t}:E${t + 1}`);
  ws.mergeCells(`J${t}:M${t + 1}`);
  const bold = { font: { bold: true }, h: 'center' as const };
  put(`B${t}`, 'TOTAL', bold);
  put(`F${t}`, sum('pcs'), { ...bold, fmt: FMT.pcs });
  put(`H${t}`, Math.round(sum('amount') * 100) / 100, { ...bold, fmt: '#,##0.00' });
  put(`F${t + 1}`, 'PCS', bold);
  put(`H${t + 1}`, 'USD', bold);
  put(`J${t}`, 'TOTAL', bold);
  put(`N${t}`, sum('pcs'), { ...bold, fmt: FMT.pcs });
  put(`O${t}`, sum('ctns'), { ...bold, fmt: FMT.pcs });
  put(`P${t}`, sum('nw'), { ...bold, fmt: FMT.amount });
  put(`Q${t}`, sum('gw'), { ...bold, fmt: FMT.amount });
  put(`R${t}`, sum('cbm'), { ...bold, fmt: FMT.amount });
  ['PCS', 'CTNS', 'KGS', 'KGS', 'M3'].forEach((u, i) => put(`${'NOPQR'[i]}${t + 1}`, u, bold));
  for (const l of 'ABCDEFGHIJKLMNOPQR') {
    border(`${l}${t}`, { top: true });
    border(`${l}${t + 1}`, { bottom: true });
  }
  frame(t);
  frame(t + 1);

  // ---- CDC no, signature, totals summary ----
  const f = t + 4;
  both((side, c) => {
    put(`${c('A')}${f}`, '(CDC No) : ', { font: { bold: true } });
    put(`${c('B')}${f}`, h.cdcNo ?? '', { font: { bold: true } });
    put(`${c('A')}${f + 1}`, 'Issue date : ', { font: { bold: true } });
    put(`${c('B')}${f + 1}`, xlDate(h.cdcIssueDate), {
      font: { bold: true },
      h: 'left',
      fmt: FMT.longDate,
    });
    const sig = side ? 'P' : 'G';
    put(`${sig}${f}`, company, { h: 'center' });
    put(`${sig}${f + 1}`, 'SIGNATURE', { h: 'center' });
    put(`${sig}${f + 11}`, h.contactName ?? '');
  });
  put(`A${f + 3}`, 'TOTAL: CTNS:');
  put(`B${f + 3}`, sum('ctns'), { h: 'left', fmt: FMT.ctnsTotal });
  put(`A${f + 4}`, 'TOTAL: N.W :');
  put(`B${f + 4}`, sum('nw'), { h: 'left', fmt: FMT.kgsTotal });
  put(`A${f + 5}`, 'TOTAL:G.W:');
  put(`B${f + 5}`, sum('gw'), { h: 'left', fmt: FMT.kgsTotal });

  ws.pageSetup.printArea = `A1:R${f + 11}`;
  return f + 11;
}

/**
 * ExcelJS can't write column page breaks, so add one after column `afterCol` (8 = H) to the
 * first `sheets` sheets' XML: the INVOICE (A–H) and the PACKING LIST (I–R) then print on
 * separate pages, as in the original.
 */
export async function addColumnBreaks(xlsx: Buffer, sheets: number, afterCol = 8): Promise<Buffer> {
  const zip = await JSZip.loadAsync(xlsx);
  const BREAK = `<colBreaks count="1" manualBreakCount="1"><brk id="${afterCol}" max="1048575" man="1"/></colBreaks>`;
  for (let i = 1; i <= sheets; i++) {
    const path = `xl/worksheets/sheet${i}.xml`;
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    // colBreaks goes right after rowBreaks/headerFooter/pageSetup and before drawing etc.
    const anchor =
      /<(drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/.exec(
        xml,
      );
    if (!anchor) continue;
    zip.file(path, xml.slice(0, anchor.index) + BREAK + xml.slice(anchor.index));
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
