import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { queryRows } from '../../lib/listing';
import { badRequest, notFound } from '../../lib/errors';
import { addColumnBreaks } from './invoicePackingList';
import {
  KH_SOLAR_MONTHS,
  khmerLunarParts,
  khmerLunarText,
  khmerNumber,
  khmerSolarText,
} from '../../lib/khmerDate';

/**
 * Import "INV + PL" workbook, laid out like JR's own file (e.g. SHANGHAI YONGYUE IMP 635
 * ROLLS.xlsx): an INVOICE sheet per cargo invoice with the commercial invoice in A–G and the
 * packing list beside it in H–L, plus the customs cover letter ("Cover") and the transfer of
 * rights to the broker ("AUTHOR") for clients whose signatories are on file below.
 */

interface Head {
  shipperName: string | null;
  /** From the client's Suppliers (Client Details), matched on the shipper name. */
  supplierAddress: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  hblNo: string | null;
  etd: string | null;
  portCode: string | null;
  portName: string | null;
  originName: string | null;
  clientCode: string;
  clientName: string;
  legalName: string | null;
  clientAddress: string | null;
  vattin: string | null;
  contactName: string | null;
  contactPhone: string | null;
  cdcNo: string | null;
  cdcIssueDate: string | null;
  containers: { containerNo: string; size: string | null; linerSeal: string | null }[];
}
interface Line {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string | null;
  description: string | null;
  invoiceDescription: string | null;
  pcs: string;
  ctns: string;
  nw: string;
  gw: string;
  price: string;
  amount: string;
  /** From the client's CDC master list (cut stock), matched on the item name. */
  cdcRef: string | null;
  cdcUnit: string | null;
  cdcPrice: string | null;
}

/**
 * Standing details for the two letters, which the system doesn't hold yet: the client's
 * signatory and its customs letter, and the broker's representatives. Copied from JR's own
 * import file; a client without an entry gets the INVOICE sheets only.
 */
interface LetterProfile {
  /** Owner of the goods who signs both letters. */
  signatory: { name: string; passportNo: string; titleKm: string; title: string };
  companyPhone: string;
  /** The customs letter that extended the CDC master list, and the department's note on it. */
  extensionLetterNo: string;
  customsNoteDate: string;
}
const LETTER_PROFILES: Record<string, LetterProfile> = {
  JR: {
    signatory: {
      name: 'LIN LEE BI JEN',
      passportNo: '353387543',
      titleKm: 'ជ.នាយកក្រុមហ៊ុន JR APPAREL',
      title: 'GENERAL MANAGER',
    },
    companyPhone: '077 777 469',
    extensionLetterNo: '1343/26',
    customsNoteDate: '2026-05-22',
  },
};
type Broker = typeof DEFAULT_BROKER;
/** The broker the rights are transferred to (us), as in the AUTHOR letter. Fallback when
 * Settings → Customs broker has no active entry. */
const DEFAULT_BROKER = {
  company: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.',
  vattin: 'K008-902404873',
  grantee: { name: 'យឹម ជៀវសៀ', idNo: '021114299', phone: '098\u200b\u200b 484 414' },
  agent: { name: 'សៀ សុខជា', idNo: '020466170 (02)', phone: '086 347 078' },
  cardNo: 'CB CARD #1132',
  cardExpiry: '2028-03-31',
};
/** Clearance ports in Khmer for the letters; others fall back to the English name. */
const PORT_KM: Record<string, string> = {
  SHV11: 'កំពង់ផែក្រុងព្រះសីហនុ',
  PNH04: 'កំពង់ផែស្វយ័តភ្នំពេញ',
  PNH01: 'អាកាសយានដ្ឋានអន្តរជាតិតេជោ',
  SVR11: 'ច្រកអន្តរជាតិបាវិត',
};

const FONT = 'Times New Roman';
const KH = 'Khmer MEF1';
const KH_BOLD = 'Khmer MEF2';
const MUOL = 'Khmer OS Muol Light';
const BOKOR = 'Kh Bokor';
/** Column widths of the original INVOICE sheet (A–L). */
const WIDTHS = [9.29, 42, 7.71, 13.43, 8.57, 15, 15.57, 9.86, 10.71, 49.14, 25.29, 27];
const FMT = {
  acc: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  price: '#,##0.00',
  date: 'dd\\-mmm\\-yyyy',
  shortDate: '[$-409]dd\\-mmm\\-yy;@',
  items: '\\ ##\\ "មុខ"',
  kgs: '\\ #,##0.00\\ "Kgs"',
};
/** First and last item rows of the original; more lines push everything below down. */
const ITEMS_FROM = 19;
const ITEMS_TO = 24;

async function load(shipmentId: string): Promise<{ head: Head; lines: Line[] }> {
  const [head] = await queryRows<Head>(
    db,
    sql`
    SELECT s.shipper_name AS "shipperName",
           (SELECT sp.address FROM suppliers sp WHERE sp.client_id = s.client_id
              AND lower(sp.name) = lower(trim(s.shipper_name))) AS "supplierAddress",
           s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
           s.hbl_no AS "hblNo", to_char(s.etd, 'YYYY-MM-DD') AS etd,
           p.code AS "portCode", p.name AS "portName", co.name AS "originName",
           c.code AS "clientCode", c.name AS "clientName", c.legal_name AS "legalName",
           c.address AS "clientAddress", c.vattin, c.contact_name AS "contactName", c.contact_phone AS "contactPhone",
           c.cdc_no AS "cdcNo", to_char(c.cdc_issue_date, 'YYYY-MM-DD') AS "cdcIssueDate",
           coalesce((SELECT json_agg(json_build_object('containerNo', k.container_no, 'size', k.size,
                                                       'linerSeal', k.liner_seal) ORDER BY k.sort_order)
                     FROM containers k WHERE k.shipment_id = s.id), '[]') AS containers
    FROM shipments s JOIN clients c ON c.id = s.client_id
    LEFT JOIN ports p ON p.id = s.clearance_port_id
    LEFT JOIN countries co ON co.iso2 = s.origin_country_iso2
    WHERE s.id = ${shipmentId} AND s.deleted_at IS NULL`,
  );
  if (!head) throw notFound('Shipment');
  const lines = await queryRows<Line>(
    db,
    sql`
    SELECT ci.id AS "invoiceId", ci.invoice_no AS "invoiceNo", to_char(ci.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
           l.description, ci.description AS "invoiceDescription",
           l.pcs::text AS pcs, l.ctns::text AS ctns, l.net_weight_kg::text AS nw, l.gross_weight_kg::text AS gw,
           l.fob_unit_price::text AS price, l.fob_amount::text AS amount,
           m.declare_ref AS "cdcRef", m.unit AS "cdcUnit", m.unit_price::text AS "cdcPrice"
    FROM cargo_invoices ci JOIN cargo_invoice_lines l ON l.invoice_id = ci.id
    JOIN shipments s ON s.id = ci.shipment_id
    LEFT JOIN LATERAL (
      SELECT i.declare_ref, i.unit, i.unit_price FROM cut_stock_items i
      WHERE i.client_id = s.client_id
        AND upper(trim(i.name)) = upper(trim(coalesce(nullif(l.description, ''), ci.description)))
      ORDER BY i.line_no LIMIT 1
    ) m ON true
    WHERE ci.shipment_id = ${shipmentId}
    ORDER BY ci.sort_order, ci.invoice_no, l.line_no`,
  );
  return { head, lines };
}

const xlDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const n = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? 0 : Number(v);
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
/** "2026-05-21" → "21-05-2026", as the letters write dates. */
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '');
/** "ROLLS" → "Rolls". */
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
/** Today in Phnom Penh, the date the letters are signed. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

/** Address in two lines, split at the comma nearest the middle (or a space, failing that). */
function twoLines(address: string | null): [string, string] {
  const lines = (address ?? '')
    .toUpperCase()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length > 1) return [lines[0]!, lines.slice(1).join(', ')];
  const one = lines[0] ?? '';
  const mid = one.length / 2;
  const cuts = [...one.matchAll(/,/g)].map((m) => m.index);
  const at = (cuts.length ? cuts : [...one.matchAll(/ /g)].map((m) => m.index)).sort(
    (a, b) => Math.abs(a - mid) - Math.abs(b - mid),
  )[0];
  if (at === undefined || one.length < 36) return [one, ''];
  return [one.slice(0, at).trim(), one.slice(at + 1).trim()];
}

/** "+855 85 441 621" → "085441621" */
const localPhone = (p: string | null) =>
  (p ?? '')
    .replace(/[^\d+]/g, '')
    .replace(/^\+855/, '0')
    .replace(/^\+/, '');

/** "Sihanoukville Port" → "SIHANOUKVILLE" (the place after CIF). */
const cifPlace = (name: string | null) =>
  (name ?? '').replace(/(?<!dry)\s+port$/i, '').toUpperCase();

/** "SHANGHAI YONGYUE IMP.&EXP. TRADING CO., LTD." → "SHANGHAI YONGYUE" */
function shortSupplier(name: string | null): string {
  const upper = (name ?? '').toUpperCase().trim();
  const cut = /\b(IMP|EXP|IMPORT|EXPORT|TRADING|INDUSTRIAL|CO|COMPANY|LTD|LIMITED|CORP|INC)\b/.exec(
    upper,
  );
  const short = (cut ? upper.slice(0, cut.index) : upper).replace(/[^A-Z0-9 ]+/g, ' ').trim();
  return short.replace(/\s+/g, ' ') || 'SUPPLIER';
}

type Put = (
  addr: string,
  value: ExcelJS.CellValue,
  o?: {
    font?: Partial<ExcelJS.Font>;
    h?: ExcelJS.Alignment['horizontal'];
    v?: ExcelJS.Alignment['vertical'];
    wrap?: boolean;
    fmt?: string;
  },
) => void;
function writer(ws: ExcelJS.Worksheet, base: Partial<ExcelJS.Font>): Put {
  return (addr, value, o = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { ...base, ...o.font };
    if (o.h || o.v || o.wrap) c.alignment = { horizontal: o.h, vertical: o.v, wrapText: o.wrap };
    if (o.fmt) c.numFmt = o.fmt;
  };
}
/** A formula with its value, so the sheet reads right before Excel recalculates. */
const f = (formula: string, result: ExcelJS.CellValue): ExcelJS.CellValue =>
  ({ formula, result }) as ExcelJS.CellFormulaValue;

interface InvoiceSheet {
  name: string;
  invoiceNo: string;
  invoiceDate: string | null;
  /** Row offset of the totals and footer against the original (0 when the lines fit). */
  shift: number;
  items: number;
  pkgs: number;
  gw: number;
  amount: number;
}

/**
 * The client's letter details from the database (Clients → signatory, phone and CDC extension),
 * falling back to the built-in profile for clients set up before those fields existed.
 */
async function letterProfile(clientCode: string): Promise<LetterProfile | null> {
  const [row] = await queryRows<{
    name: string | null;
    passportNo: string | null;
    title: string | null;
    titleKm: string | null;
    companyPhone: string | null;
    extensionLetterNo: string | null;
    customsNoteDate: string | null;
  }>(
    db,
    sql`SELECT sg.name, sg.passport_no AS "passportNo", sg.title, sg.title_km AS "titleKm",
               c.company_phone AS "companyPhone", c.cdc_extension_letter_no AS "extensionLetterNo",
               to_char(c.cdc_customs_note_date, 'YYYY-MM-DD') AS "customsNoteDate"
        FROM clients c
        LEFT JOIN LATERAL (SELECT * FROM client_signatories s WHERE s.client_id = c.id
                           ORDER BY s.is_default DESC, s.created_at LIMIT 1) sg ON true
        WHERE upper(c.code) = upper(${clientCode}) AND c.deleted_at IS NULL`,
  );
  const fallback = LETTER_PROFILES[clientCode.toUpperCase()];
  if (!row?.name) return fallback ?? null;
  return {
    signatory: {
      name: row.name,
      passportNo: row.passportNo ?? fallback?.signatory.passportNo ?? '',
      titleKm: row.titleKm ?? fallback?.signatory.titleKm ?? '',
      title: row.title ?? fallback?.signatory.title ?? '',
    },
    companyPhone: row.companyPhone ?? fallback?.companyPhone ?? '',
    extensionLetterNo: row.extensionLetterNo ?? fallback?.extensionLetterNo ?? '',
    customsNoteDate: row.customsNoteDate ?? fallback?.customsNoteDate ?? '',
  };
}

/** The default active broker from Settings → Customs broker. */
async function loadBroker(): Promise<Broker> {
  const [b] = await queryRows<{
    company: string;
    vattin: string | null;
    granteeName: string;
    granteeIdNo: string | null;
    granteePhone: string | null;
    agentName: string;
    agentIdNo: string | null;
    agentPhone: string | null;
    cardNo: string | null;
    cardExpiry: string | null;
  }>(
    db,
    sql`SELECT company, company_vattin AS vattin, grantee_name AS "granteeName", grantee_id_no AS "granteeIdNo",
               grantee_phone AS "granteePhone", agent_name AS "agentName", agent_id_no AS "agentIdNo",
               agent_phone AS "agentPhone", card_no AS "cardNo", to_char(card_expiry, 'YYYY-MM-DD') AS "cardExpiry"
        FROM broker_agents WHERE is_active ORDER BY is_default DESC, created_at LIMIT 1`,
  );
  if (!b) return DEFAULT_BROKER;
  return {
    company: b.company,
    vattin: b.vattin ?? '',
    grantee: { name: b.granteeName, idNo: b.granteeIdNo ?? '', phone: b.granteePhone ?? '' },
    agent: { name: b.agentName, idNo: b.agentIdNo ?? '', phone: b.agentPhone ?? '' },
    cardNo: b.cardNo ?? '',
    cardExpiry: b.cardExpiry ?? DEFAULT_BROKER.cardExpiry,
  };
}

/** Workbook + a file name like "SHANGHAI YONGYUE IMP 635 ROLLS.xlsx". */
export async function buildImportInvoicePackingList(
  shipmentId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { head, lines } = await load(shipmentId);
  if (!lines.length)
    throw badRequest('Add the cargo invoices and their lines first (Item, Costing & Forwarding).');

  const invoices = new Map<string, Line[]>();
  for (const l of lines) invoices.set(l.invoiceId, [...(invoices.get(l.invoiceId) ?? []), l]);
  const unit = (head.quantityUnit ?? 'ROLLS').trim().toUpperCase();
  const letterDate = today();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  const single = invoices.size === 1;
  const sheets = [...invoices.values()].map((inv) =>
    addInvoiceSheet(wb, head, inv, {
      name: single ? 'INVOICE' : `INVOICE ${inv[0]!.invoiceNo}`.slice(0, 31),
      unit,
      letterDate,
    }),
  );
  const profile = await letterProfile(head.clientCode);
  if (profile) {
    addCoverSheet(wb, head, profile, sheets, unit, letterDate);
    addAuthorSheet(wb, head, profile, sheets, letterDate, await loadBroker());
  }

  // The PACKING LIST (H–L) prints on its own page, after the INVOICE (A–G).
  const buffer = await addColumnBreaks(Buffer.from(await wb.xlsx.writeBuffer()), sheets.length, 7);
  const pkgs = round(
    sheets.reduce((s, x) => s + x.pkgs, 0),
    3,
  );
  const total = pkgs || n(head.quantity);
  const fileName = `${shortSupplier(head.shipperName)} IMP ${total} ${unit}.xlsx`.replace(
    /[\\/:*?"<>|]+/g,
    ' ',
  );
  return { buffer, fileName };
}

function addInvoiceSheet(
  wb: ExcelJS.Workbook,
  h: Head,
  inv: Line[],
  o: { name: string; unit: string; letterDate: string },
): InvoiceSheet {
  const first = inv[0]!;
  const ws = wb.addWorksheet(o.name, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      scale: 79,
      horizontalCentered: true,
      margins: { left: 0.2, right: 0.19, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  ws.properties.defaultRowHeight = 12.75;
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const put = writer(ws, { name: FONT, size: 10 });
  const sz = (size: number, more: Partial<ExcelJS.Font> = {}) => ({ font: { size, ...more } });

  const last = Math.max(ITEMS_TO, ITEMS_FROM + inv.length - 1);
  const t = last + 1; // totals row (25 in the original)
  const d = t - 25;
  const heights: Record<number, number> = {
    1: 30,
    2: 35.25,
    3: 17.25,
    4: 17.25,
    14: 16.5,
    [30 + d]: 15,
    [40 + d]: 14.45,
    [41 + d]: 25.5,
    [42 + d]: 23.25,
    [43 + d]: 15,
    [44 + d]: 16.5,
    [45 + d]: 25.15,
  };
  for (const r of [5, 6, 7, 8, 9, 13, 15]) heights[r] = 15.75;
  for (let r = ITEMS_FROM; r <= last; r++) heights[r] = r - ITEMS_FROM < 3 ? 15.75 : 15;
  for (let r = t; r <= t + 2; r++) heights[r] = 15;
  for (const [r, ht] of Object.entries(heights)) ws.getRow(Number(r)).height = ht;

  /** Packing-list cell that repeats an invoice cell, as the original does with formulas. */
  const mirror = (addr: string, src: string, value: ExcelJS.CellValue, opts: Parameters<Put>[2]) =>
    put(addr, value === '' || value === null ? '' : f(src, value), opts);

  // ---- Supplier letterhead (rows 1–3) and titles (row 6) ----
  for (const r of [1, 2, 3, 6]) {
    ws.mergeCells(`A${r}:G${r}`);
    ws.mergeCells(`H${r}:L${r}`);
  }
  const supplier = (h.shipperName ?? '').toUpperCase();
  put('A1', supplier, { ...sz(16, { bold: true }), h: 'center' });
  mirror('H1', 'A1', supplier, { ...sz(16, { bold: true }), h: 'center' });
  // The supplier's address (Client Details → Suppliers): its first line in row 2, the rest in
  // row 3; blank when none is saved.
  const [supplierLine = '', ...supplierRest] = (h.supplierAddress ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const [r, text] of [
    [2, supplierLine],
    [3, supplierRest.join(', ')],
  ] as const) {
    put(`A${r}`, text.toUpperCase(), { ...sz(9), h: 'center', v: 'middle', wrap: true });
    mirror(`H${r}`, `A${r}`, text.toUpperCase(), {
      ...sz(9),
      h: 'center',
      v: 'middle',
      wrap: true,
    });
  }
  // The rule under the letterhead: top of row 4 on the invoice, bottom of row 3 on the list.
  for (const l of 'ABCDEFG') ws.getCell(`${l}4`).border = { top: { style: 'medium' } };
  for (const l of 'HIJKL') ws.getCell(`${l}3`).border = { bottom: { style: 'medium' } };
  put('A6', 'INVOICE', { ...sz(12), h: 'center' });
  put('H6', 'PACKING LIST', { ...sz(12), h: 'center' });

  // ---- Invoice no / date (row 7), consignee (rows 10–14) ----
  put('A7', 'NO: ', { h: 'right' });
  put('B7', first.invoiceNo, { h: 'left' });
  put('F7', 'Date:', { h: 'right', fmt: '#,##0.00' });
  put('G7', xlDate(first.invoiceDate), { h: 'left', fmt: FMT.date });
  mirror('H7', 'A7', 'NO: ', { h: 'right' });
  mirror('I7', 'B7', first.invoiceNo, { h: 'left', v: 'middle' });
  mirror('K7', 'F7', 'Date:', { h: 'right', fmt: '#,##0.00' });
  mirror('L7', 'G7', xlDate(first.invoiceDate), { h: 'left', fmt: FMT.date });

  const company = h.legalName ?? h.clientName;
  const [addr1, addr2] = twoLines(h.clientAddress);
  const phone = localPhone(h.contactPhone);
  const attn = h.contactName
    ? `ATTN: ${h.contactName.toUpperCase()}${phone ? ` TEL ${phone}` : ''}`
    : '';
  const vat = h.vattin ? `VAT# ${h.vattin}` : '';
  put('A10', 'Consignee:');
  put('B10', company);
  put('B11', addr1, { h: 'left' });
  put('B12', addr2);
  put('B13', attn, sz(12));
  put('B14', vat, sz(11));
  put('E14', 'COUNTRY OF ORIGIN:  ', { h: 'left' });
  put('G14', (h.originName ?? '').toUpperCase());
  mirror('H10', 'A10', 'Consignee:', {});
  mirror('I10', 'B10', company, {});
  mirror('I11', 'B11', addr1, { h: 'left' });
  mirror('I12', 'B12', addr2, {});
  mirror('I13', 'B13', attn, {});
  mirror('I14', 'B14', vat, { ...sz(12), h: 'left', v: 'middle' });

  // ---- Goods table ----
  const unitLabel = titleCase(o.unit);
  ws.mergeCells('D16:E16');
  put('A16', 'No', { h: 'center' });
  put('B16', 'Description of Goods');
  put('D16', 'Quantity', { h: 'center' });
  put('F16', 'Unit Price(USD)', { h: 'center' });
  put('G16', 'Amount(USD)', { h: 'center' });
  put('H16', 'No', { h: 'center' });
  put('I16', `No. of ${unitLabel}`, { h: 'center', v: 'middle' });
  put('J16', 'Description of Goods', { h: 'center' });
  put('K16', 'Net Weight (KGS)', { h: 'center' });
  put('L16', 'Gross Weight (KGS)', { h: 'center' });
  put('F17', `CIF ${cifPlace(h.portName)}`.trim(), {
    font: { underline: true },
    h: 'center',
    fmt: '#,##0.000',
  });

  const thin: Partial<ExcelJS.Border> = { style: 'thin' };
  const border = (addr: string, sides: string, bottom: ExcelJS.BorderStyle = 'thin') => {
    const c = ws.getCell(addr);
    c.border = {
      ...c.border,
      ...(sides.includes('T') ? { top: thin } : {}),
      ...(sides.includes('B') ? { bottom: { style: bottom } } : {}),
      ...(sides.includes('L') ? { left: thin } : {}),
      ...(sides.includes('R') ? { right: thin } : {}),
    };
  };
  const row16 = { A: 'TBL', B: 'TBL', C: 'TBR', D: 'TBLR', E: 'TBR', F: 'TBLR', G: 'TBLR' };
  const pl16 = { H: 'TBLR', I: 'TBLR', J: 'TB', K: 'TBLR', L: 'TBLR' };
  for (const [l, s] of Object.entries({ ...row16, ...pl16 })) border(`${l}16`, s);
  // Column rules of the goods box, from row 17 down to the last item row.
  const RULES = { A: 'L', D: 'L', F: 'LR', G: 'LR', H: 'LR', I: 'LR', J: 'L', K: 'LR', L: 'LR' };
  for (let r = 17; r <= last; r++)
    for (const [l, s] of Object.entries(RULES)) border(`${l}${r}`, r === 17 ? `T${s}` : s);
  for (const [l, s] of Object.entries({ A: 'B', B: 'B', C: 'B', D: 'B', E: 'BR', F: 'B' }))
    border(`${l}${last}`, s);
  for (const l of 'HIL') border(`${l}${last}`, 'B');

  const sum = (k: 'pcs' | 'ctns' | 'nw' | 'gw') =>
    round(
      inv.reduce((s, l) => s + n(l[k]), 0),
      3,
    );
  let amount = 0;
  inv.forEach((l, i) => {
    const r = ITEMS_FROM + i;
    const name = (l.description || l.invoiceDescription || '').trim().toUpperCase();
    const price = n(l.price) || n(l.cdcPrice);
    const lineAmount = round(price * n(l.pcs), 2);
    amount += lineAmount;
    const item = sz(12);
    put(`A${r}`, i + 1, { ...item, h: 'center' });
    put(`B${r}`, name, { ...item, h: 'left' });
    put(`C${r}`, l.cdcRef ?? '', { ...item, h: 'left' });
    put(`D${r}`, n(l.pcs), { ...item, fmt: FMT.acc });
    put(`E${r}`, l.cdcUnit ?? '', { ...item, h: 'center', v: 'middle' });
    put(`F${r}`, price, { ...item, h: 'center', fmt: FMT.price });
    put(`G${r}`, f(`ROUND(F${r}*D${r},2)`, lineAmount), { ...item, h: 'right', fmt: FMT.acc });
    put(`H${r}`, f(`A${r}`, i + 1), { ...item, h: 'center', v: 'middle', fmt: '#,##0' });
    put(`I${r}`, n(l.ctns), { ...item, h: 'center', v: 'middle' });
    put(`J${r}`, f(`B${r}`, name), item);
    put(`K${r}`, n(l.nw), { ...item, h: 'right', fmt: FMT.acc });
    put(`L${r}`, n(l.gw), { ...item, h: 'right', fmt: FMT.acc });
  });
  amount = round(amount, 2);

  // ---- Totals (row 25 of the original): thin box, double underline ----
  const pkgs = sum('ctns');
  const gw = sum('gw');
  const tot = sz(12);
  put(`G${t}`, f(`SUM(G${ITEMS_FROM}:G${last})`, amount), { ...tot, h: 'right', fmt: FMT.acc });
  put(`I${t}`, f(`SUM(I17:I${last})`, pkgs), { ...tot, h: 'center', v: 'middle' });
  put(`J${t}`, unitLabel, { ...tot, h: 'left' });
  put(`K${t}`, f(`SUM(K17:K${last})`, sum('nw')), { ...tot, h: 'right', fmt: FMT.acc });
  put(`L${t}`, f(`SUM(L17:L${last})`, gw), { ...tot, h: 'right', fmt: FMT.acc });
  for (const l of 'GHIKL') border(`${l}${t}`, 'TBLR', 'double');
  border(`J${t}`, 'TB', 'double');

  // ---- Containers, signature ----
  const ctnr = h.containers.map((k) =>
    [k.containerNo, k.linerSeal, k.size?.replace(/^(\d+)/, "$1'")].filter(Boolean).join(' / '),
  );
  if (ctnr.length) put(`A${30 + d}`, 'CTNR:', { h: 'right', v: 'middle' });
  ctnr.forEach((c, i) => put(`B${30 + d + i}`, c, { ...sz(11), v: 'middle' }));
  put(`D${36 + d}`, f('A1', supplier));
  put(`K${36 + d}`, f(`D${36 + d}`, supplier), { fmt: '#,##0.00' });
  const line = '________________________________________________';
  put(`D${39 + d}`, line);
  put(`K${39 + d}`, f(`D${39 + d}`, line), { fmt: '#,##0.00' });

  // ---- Notes for the letters, below the print area (rows 41–45 of the original) ----
  const kh = (size: number) => ({ font: { name: BOKOR, size } });
  put(`A${41 + d}`, f(`COUNT(A${ITEMS_FROM}:A${last})`, inv.length), {
    ...kh(12),
    h: 'center',
    v: 'middle',
    fmt: FMT.items,
  });
  put(`B${41 + d}`, khmerLunarText(o.letterDate), kh(11));
  put(`B${42 + d}`, khmerSolarText(o.letterDate), kh(11));
  put(`D${42 + d}`, h.cdcNo ?? '', sz(12));
  ws.mergeCells(`E${43 + d}:F${43 + d}`);
  put(`A${43 + d}`, 'B/L', { font: { name: 'Tahoma', size: 12 } });
  put(`B${43 + d}`, h.hblNo ?? '', { font: { name: 'Tahoma', size: 12 }, h: 'left' });
  const arial = { font: { name: 'Arial', size: 12 } };
  put(`A${44 + d}`, 'Date', arial);
  put(`B${44 + d}`, xlDate(h.etd), { ...arial, h: 'left', fmt: FMT.date });
  put(`D${44 + d}`, 'PKGS :', arial);
  put(`E${44 + d}`, f(`I${t}&J${t}`, `${pkgs}${unitLabel}`), arial);
  put(`B${45 + d}`, portKm(h), { ...kh(11), v: 'middle' });

  ws.pageSetup.printArea = `A1:L${40 + d}`;
  return {
    name: o.name,
    invoiceNo: first.invoiceNo,
    invoiceDate: first.invoiceDate,
    shift: d,
    items: inv.length,
    pkgs,
    gw,
    amount,
  };
}

/** "កំពង់ផែក្រុងព្រះសីហនុ (បញ្ចេញទំនិញនៅមាត់ច្រក កំពង់ផែក្រុងព្រះសីហនុ)" */
function portKm(h: Head): string {
  const name = (h.portCode && PORT_KM[h.portCode]) || h.portName || '';
  return name ? `${name} (បញ្ចេញទំនិញនៅមាត់ច្រក\u200b ${name})` : '';
}

/** Letter to the Director General of Customs asking to import the materials (sheet "Cover"). */
function addCoverSheet(
  wb: ExcelJS.Workbook,
  h: Head,
  p: LetterProfile,
  sheets: InvoiceSheet[],
  unit: string,
  letterDate: string,
) {
  const ws = wb.addWorksheet('Cover', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      scale: 85,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  ws.properties.defaultRowHeight = 28.5;
  // A grid of narrow columns (A–AU), as in the original.
  const widths: Record<string, number> = {
    A: 2.57, B: 5.57, C: 2, D: 3, O: 3, R: 3.57, T: 2.14, U: 3, V: 2.14, Y: 2.43, AB: 3,
    AC: 2.29, AD: 2.57, AE: 1.71, AF: 2.71, AG: 2, AH: 2.57, AJ: 2.29, AR: 1.71, AT: 4.29,
  }; // prettier-ignore
  for (let c = 1; c <= 47; c++) {
    const col = ws.getColumn(c);
    col.width = widths[col.letter] ?? 2.14;
  }
  const heights: Record<number, number> = { 1: 35.25, 2: 33.75, 3: 24.75, 4: 16.5, 8: 20.25 };
  Object.assign(heights, { 18: 29.25, 19: 23.25, 20: 17.25, 21: 15.75 });
  // Every row set explicitly: Excel ignores a sheet's default row height on its own.
  for (let r = 1; r <= 29; r++) ws.getRow(r).height = heights[r] ?? 28.5;
  for (const m of ['AF1:AT1', 'AF2:AT2', 'AF3:AT3', 'A9:AT9', 'A10:AT10', 'A11:AT11'])
    ws.mergeCells(m);
  for (const m of ['S12:U12', 'AD12:AJ12', 'AO12:AT12', 'O16:AA16', 'AE16:AQ16', 'O17:AA17'])
    ws.mergeCells(m);
  for (const m of ['AE17:AQ17', 'AF22:AT22', 'AF23:AT23', 'AF24:AT24', 'AF29:AT29'])
    ws.mergeCells(m);

  const put = writer(ws, { name: KH, size: 11 });
  const muol = (size: number) => ({ font: { name: MUOL, size } });
  const centre = { h: 'center' as const, v: 'middle' as const };
  // Totals come from the INVOICE sheet by formula when there is one invoice, as in the original.
  const one = sheets.length === 1 ? sheets[0]! : null;
  const ref = (cell: (s: InvoiceSheet) => string, value: ExcelJS.CellValue) =>
    one ? f(`INVOICE!${cell(one)}`, value) : value;
  const first = sheets[0]!;
  const notes = (row: number) => `${row + first.shift}`;
  const ref0 = (col: string, row: number, value: ExcelJS.CellValue) =>
    f(`'${first.name}'!${col}${notes(row)}`, value);

  put('AF1', 'ព្រះរាជាណាចក្រកម្ពុ\u200bជា', { ...muol(12), ...centre });
  put('AF2', 'ជាតិ\u200b\u200b សាសនា ព្រះមហាក្សត្រ', { ...muol(12), ...centre });
  put('AF3', 'eeõff', { font: { name: 'Wingdings 2', size: 14 }, ...centre });

  const company = h.legalName ?? h.clientName;
  const [addr1, addr2] = twoLines(h.clientAddress);
  put('A2', 'ក្រុមហ៊ុន', muol(10));
  put('E2', ':', { font: { name: FONT, size: 12 } });
  put('F2', company, { font: { name: FONT, size: 12, bold: true } });
  put('A3', 'អាស័យដ្ឋាន', muol(10));
  put('E3', ':', { font: { name: 'Calibri', size: 11 } });
  put('F3', addr1, { font: { name: FONT, size: 11 } });
  put('F4', addr2, { font: { name: FONT, size: 11 } });
  put('F5', h.vattin ? `VAT: ${h.vattin}` : '', { font: { name: FONT, size: 11 } });
  // The original starts these at AB5 / AD6; centred over W–AU, a long date (Thursday, 15 roach…)
  // still fits on the page.
  ws.mergeCells('W5:AU5');
  ws.mergeCells('W6:AU6');
  put('W5', ref0('B', 41, khmerLunarText(letterDate)), { h: 'center' });
  put('W6', ref0('B', 42, khmerSolarText(letterDate)), { h: 'center', v: 'middle' });

  put('A9', 'សូមគោរពជូន', { ...muol(12), ...centre });
  put('A10', 'ឯកឧត្តម\u200b\u200b\u200b\u200bរដ្ឋមន្រ្តីប្រតិភូអមនាយករដ្ឋមន្រ្តី', {
    ...muol(12),
    ...centre,
  });
  put('A11', 'អគ្គនាយក\u200bនៃអគ្គនាយកដ្ឋានគយ និងរដ្ឋាករកម្ពុជា', { ...muol(12), ...centre });

  const items = sheets.reduce((s, x) => s + x.items, 0);
  const pkgs = round(
    sheets.reduce((s, x) => s + x.pkgs, 0),
    3,
  );
  const gw = round(
    sheets.reduce((s, x) => s + x.gw, 0),
    3,
  );
  const amount = round(
    sheets.reduce((s, x) => s + x.amount, 0),
    2,
  );
  const colon = { font: { name: 'Calibri', size: 11, bold: true } };
  put('A12', 'កម្មវត្ថុ', muol(11));
  put('C12', ':', colon);
  put('D12', 'សំណើសុំលិខិតអនុញ្ញាតតិនាំចូលនូវវត្ថុធាតុដើម');
  put(
    'S12',
    ref((s) => `A${41 + s.shift}`, items),
    { h: 'center', fmt: FMT.items },
  );
  put('V12', 'ចំនួន');
  put(
    'Y12',
    ref((s) => `E${44 + s.shift}`, `${pkgs}${titleCase(unit)}`),
  );
  put('AC12', '=');
  put(
    'AD12',
    ref((s) => `L${25 + s.shift}`, gw),
    { h: 'center', fmt: FMT.kgs },
  );
  put('AK12', 'តំលៃUSD');
  put(
    'AO12',
    ref((s) => `G${25 + s.shift}`, amount),
    { h: 'center', fmt: '#,##0.00' },
  );
  put('D13', 'ដោយពន្ឋនិងអាករជាបន្ទុករបស់រដ្ឋតាមមាត់ច្រក');
  put('T13', ref0('B', 45, portKm(h)));

  put('A14', 'យោង', muol(11));
  put('C14', ':', colon);
  put(
    'D14',
    `-លិខិតលេខ ${p.extensionLetterNo} គ.វ.ក ចុះថ្ងៃទី ${dmy(h.cdcIssueDate)} ` +
      `ពន្យារសុពលភាពលើលិខិតលេខ ${h.cdcNo ?? ''} គ.វ.ក។`,
  );
  put('D15', `-ចំណារលោកប្រធាននាយកដ្ឋានរបបគយ ចុះថ្ងៃទី ${dmy(p.customsNoteDate)} `);
  put('D16', '-Invoice/Packing List ');
  put('M16', 'No.');
  put('O16', one ? f('INVOICE!B7', one.invoiceNo) : sheets.map((s) => s.invoiceNo).join(', '), {
    h: 'center',
  });
  put('AB16', 'ចុះថ្ងៃទី');
  put(
    'AE16',
    ref(() => 'G7', xlDate(first.invoiceDate)),
    { h: 'left', fmt: FMT.date },
  );
  put('D17', '-Bill of Loading');
  put('M17', 'No.');
  put('O17', ref0('B', 43, h.hblNo ?? ''), { h: 'center' });
  put('AB17', 'ចុះថ្ងៃទី');
  put('AE17', ref0('B', 44, xlDate(h.etd)), { h: 'left', fmt: FMT.date });
  put(
    'D18',
    'តបតាមន័យកម្មវត្ថុ និង យោងខាងលើ សូមឯកឧត្តមរដ្ឋមន្រ្តីប្រតិភូ មេត្តាពិនិត្យ និង ' +
      'ដោះស្រាយនូវសំណើខាងលើដោយក្តីអនុគ្រោះ ។',
  );

  put('AF22', p.signatory.titleKm, { ...muol(12), h: 'center' });
  put('AF23', '   (ហត្ថលេខា និង ឈ្មោះ )', { font: { size: 10 }, h: 'center' });
  put('AF24', p.signatory.title, { font: { name: FONT, size: 10 }, h: 'center' });
  put('AF29', p.signatory.name, { font: { name: FONT, size: 11 }, h: 'center' });
  ws.pageSetup.printArea = 'A1:AU29';
}

/** Transfer of rights from the owner of the goods to the customs broker (sheet "AUTHOR "). */
function addAuthorSheet(
  wb: ExcelJS.Workbook,
  h: Head,
  p: LetterProfile,
  sheets: InvoiceSheet[],
  letterDate: string,
  BROKER: Broker,
) {
  // The original's sheet name has a trailing space.
  const ws = wb.addWorksheet('AUTHOR ', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      scale: 67,
      margins: { left: 1.2, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  ws.properties.defaultRowHeight = 15;
  for (let c = 1; c <= 29; c++) ws.getColumn(c).width = 3.71;
  Object.entries({ Q: 2.71, S: 4.71, V: 11.71, Y: 11.86 }).forEach(
    ([l, w]) => (ws.getColumn(l).width = w),
  );
  const heights: Record<number, number> = { 1: 39.75, 2: 39.75, 3: 15, 4: 35.25, 5: 15 };
  Object.assign(heights, { 8: 34.5, 34: 15.6 });
  for (let r = 1; r <= 35; r++)
    ws.getRow(r).height = heights[r] ?? ([22, 25, 27, 28, 29, 30, 31].includes(r) ? 15.75 : 30);
  for (const m of ['A1:AC1', 'A2:AC2', 'A4:AC4', 'M18:U18', 'M19:U19', 'M20:U20', 'X12:AA12'])
    ws.mergeCells(m);

  const put = writer(ws, { name: KH, size: 12 });
  const bold = { font: { name: KH_BOLD, size: 12 } };
  const centre = { h: 'center' as const, v: 'middle' as const };
  const title = { font: { name: KH_BOLD, size: 16 }, ...centre };
  // Rich text with Wingdings check boxes: þ ticked, ¨ empty.
  const wd = (t: string): ExcelJS.RichText => ({ text: t, font: { name: 'Wingdings', size: 12 } });
  const km = (t: string, more: Partial<ExcelJS.Font> = {}): ExcelJS.RichText => ({
    text: t,
    font: { name: KH, size: 12, ...more },
  });
  const rich = (...parts: (string | ExcelJS.RichText)[]): ExcelJS.CellValue => ({
    richText: parts.map((x) => (typeof x === 'string' ? km(x) : x)),
  });

  put('A1', 'ព្រះរាជាណាចក្រកម្ពុ\u200bជា', title);
  put('A2', 'ជាតិ  សាសនា  ព្រះមហាក្សត្រ', title);
  put('A4', 'លិខិតផ្ទេរសិទ្ធិ ', { font: { name: KH_BOLD, size: 14 }, ...centre });
  put(
    'E6',
    rich('សម្រាប់ម្ចាស់ទំនិញជូននីតិបុគ្គលជើងសាគយ ', wd('þ'), '    រូបវន្តបុគ្គលជើងសាគយ  ', wd('¨')),
  );
  put(
    'C7',
    `ខ្ញុំបាទ/នាងខ្ញុំ....${p.signatory.name}..... អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ      ${p.signatory.passportNo} `,
  );
  put(
    'A8',
    rich(
      'ជាប្រធានក្រុមហ៊ុន ',
      wd('þ'),
      ' សមាជិកក្រុមប្រឹក្សាភិបាល ',
      wd('¨ '),
      'ផ្សេងទៀត  ',
      wd('¨'),
      km('................................', { size: 13.2 }),
      ' នៃក្រុមហ៊ុន/សហគ្រាស/អង្គភាព',
    ),
  );
  put('A9', h.legalName ?? h.clientName, { font: { name: FONT, size: 12, bold: true } });
  put(
    'H9',
    `អត្តសញ្ញាណកម្មសារពើពន្ធ (VAT)លេខ\u200b ${h.vattin ?? ''}\u200b ទូរស័ព្ទលេខ ${p.companyPhone}`,
  );
  put('A10', rich('និងជាម្ចាស់ទំនិញ ', km('សូមផ្ទេរសិទ្ធិជូន', { name: KH_BOLD }), '\u200b\u200b'));
  put('J10', rich('លោក\u200b ', wd('þ'), '   /\u200b លោកស្រី ', wd('¨')));
  put('Q10', BROKER.grantee.name, bold);
  put(
    'A11',
    `អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ           ${BROKER.grantee.idNo}          ទូរស័ព្ទលេខ     ${BROKER.grantee.phone}`,
  );
  put('A12', `ជាប្រធាន/អនុប្រធានក្រុមហ៊ុន/សហគ្រាស            ${BROKER.company} `);
  put(
    'A13',
    rich(
      `មានអត្តសញ្ញាណកម្មសារពើពន្ធ\u200b (VAT)លេខ ${BROKER.vattin} និងមានរូបវន្តបុគ្គលជើងសាគយតំណាងលោក `,
      km(BROKER.agent.name, { name: KH_BOLD, bold: true }),
    ),
  );
  put(
    'A14',
    `អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ          ${BROKER.agent.idNo}       ទូរស័ព្ទលេខ        ${BROKER.agent.phone}`,
  );
  const [ey, em, ed] = BROKER.cardExpiry.split('-').map(Number) as [number, number, number];
  put(
    'A15',
    `ប័ណ្ណសម្គាល់ជើងសាគយលេខ         ${BROKER.cardNo}   ផុតសុពលភាពថ្ងៃទី   ${khmerNumber(ed)}     ` +
      `ខែ   ${KH_SOLAR_MONTHS[em - 1]}  ឆ្នាំ   ${khmerNumber(ey)}`,
  );
  put(
    'A16',
    rich(
      km('ដើម្បីបំពេញបែបបទបញ្ចេញទំនិញពីគយ ', { bold: true }),
      'សម្រាប់មួយប្រតិបត្តិការនៅ ',
      km('នាយកដ្ឋានរបបគយ ', { name: KH_BOLD, bold: true }),
    ),
    { font: { bold: true } },
  );
  put(
    'B17',
    rich('តាមឯកសារភ្ជាប់ដូចខាងក្រោម', { text: '៖', font: { name: 'Khmer OS Siemreap', size: 12 } }),
  );

  const one = sheets.length === 1 ? sheets[0]! : null;
  const first = sheets[0]!;
  const invNo = one ? f('INVOICE!B7', one.invoiceNo) : sheets.map((s) => s.invoiceNo).join(', ');
  const invDate = xlDate(first.invoiceDate);
  put('C18', '1-វិក្កយប័ត្រ(Invoice)លេខ');
  put('M18', invNo, { h: 'center' });
  put('V18', 'ចុះថ្ងៃទីខែឆ្នាំ');
  put('Y18', one ? f('INVOICE!G7', invDate) : invDate, { h: 'left', fmt: FMT.shortDate });
  put('C19', '2-បញ្ជីវេចខ្ចប់(Packing List)លេខ');
  put('M19', one ? f('+M18', one.invoiceNo) : invNo, { h: 'center' });
  put('V19', 'ចុះថ្ងៃទីខែឆ្នាំ');
  put('Y19', f('Y18', invDate), { h: 'left', fmt: FMT.shortDate });
  const blRow = 43 + first.shift;
  put('C20', '3-អញ្ញាតប័ណ្ណ(B/L, AWB, TWB)លេខ');
  put('M20', f(`'${first.name}'!B${blRow}`, h.hblNo ?? ''), { h: 'center' });
  put('V20', 'ចុះថ្ងៃទីខែឆ្នាំ');
  put('Y20', f(`'${first.name}'!B${blRow + 1}`, xlDate(h.etd)), { h: 'left', fmt: FMT.shortDate });
  put('C21', '4-ឯកសារគាំទ្រផ្សេងទៀត');

  const lunar = khmerLunarParts(letterDate);
  const [y, m, d] = letterDate.split('-').map(Number) as [number, number, number];
  put(
    'Q23',
    `ថ្ងៃ ${lunar.weekday} ${lunar.day} ខែ ${lunar.month} ឆ្នាំ ${lunar.animal} ${lunar.era} ព.ស ${lunar.be}`,
  );
  put(
    'Q24',
    `រាជធានីភ្នំពេញ ថ្ងៃទី ${khmerNumber(d)} ខែ ${KH_SOLAR_MONTHS[m - 1]}\u200b គ.ស ${khmerNumber(y)}`,
  );
  put('C26', 'ហត្ថលេខា និងត្រាអ្នកទទួលសិទ្ធ', bold);
  put('U26', 'ហត្ថលេខានិងត្រាអ្នកផ្ទេរសិទ្ធិ', bold);
  put('M32', 'ស្នាមមេដៃស្ដាំជើងសារគយ', bold);
  put('D33', 'ឈ្មោះ', bold);
  put('F33', BROKER.grantee.name, bold);
  put('V33', 'ឈ្មោះ', bold);
  put('W33', p.signatory.name, bold);
  put('O35', `ឈ្មោះ ${BROKER.agent.name}`, bold);
  ws.pageSetup.printArea = 'A1:AA35';
}
