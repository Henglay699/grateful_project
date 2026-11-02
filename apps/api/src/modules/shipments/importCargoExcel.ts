import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  CUT_STOCK_CATEGORY_LABEL,
  type CutStockCategory,
  type ImportCargoExcelParseResult,
} from '@gs/shared';
import { db } from '../../db/client';
import { clients, cutStockItems } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { parseDateCell } from './excel';

type Field =
  | 'invoiceNo'
  | 'invoiceDate'
  | 'description'
  | 'pcs'
  | 'unit'
  | 'netWeightKg'
  | 'grossWeightKg'
  | 'fobUnitPrice';

/** The template's columns, in order, with the other header spellings the parser accepts. */
const COLUMNS: { field: Field; header: string; width: number; note: string; match: string[] }[] = [
  {
    field: 'invoiceNo',
    header: 'INV',
    width: 14,
    note: 'Invoice no. Empty: the same invoice as the row above.',
    match: ['invoice no', 'inv no', 'invoice', 'invoice number'],
  },
  {
    field: 'invoiceDate',
    header: 'DATE',
    width: 12,
    note: 'Invoice date, e.g. 2026-09-21. Read on the invoice’s first row.',
    match: ['inv date', 'invoice date'],
  },
  {
    field: 'description',
    header: 'ITEM',
    width: 36,
    note: 'Item name exactly as on the client’s CDC master list (see the CDC Master List sheet).',
    match: ['item name', 'description'],
  },
  {
    field: 'pcs',
    header: 'QUANTITY',
    width: 12,
    note: 'Item quantity, in the CDC unit. It is taken off the item’s balance when saved.',
    match: ['qty', 'pcs'],
  },
  {
    field: 'unit',
    header: 'CDC UNIT',
    width: 9,
    note: 'Must be the unit on the CDC master list (SET, MTR, KGS…).',
    match: ['unit'],
  },
  {
    field: 'netWeightKg',
    header: 'NW.KGS',
    width: 11,
    note: '',
    match: ['nw kgs', 'n.w kgs', 'nw', 'n.w', 'nw (kg)', 'net weight'],
  },
  {
    field: 'grossWeightKg',
    header: 'GW.KGS',
    width: 11,
    note: '',
    match: ['gw kgs', 'g.w kgs', 'gw', 'g.w', 'gw (kg)', 'gross weight'],
  },
  {
    field: 'fobUnitPrice',
    header: 'UNIT PRICE',
    width: 11,
    note: 'USD per CDC unit. Empty: the master list price.',
    match: ['price', 'unit price (usd)'],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const LOOKUP = new Map(
  COLUMNS.flatMap((c) => [c.header, ...c.match].map((m) => [norm(m), c.field] as const)),
);
/** Item names compare without case, spaces or punctuation ("Light box" = "LIGHT BOX"). */
const nameKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** "II. Raw Material" → "II. RAW MATERIAL", as the import schedule writes it. */
const materialOf = (c: CutStockCategory) => CUT_STOCK_CATEGORY_LABEL[c].toUpperCase();

async function masterList(clientId: string) {
  const [client] = await db
    .select({ code: clients.code, name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)));
  if (!client) throw notFound('Client');
  const items = await db
    .select({
      declareRef: cutStockItems.declareRef,
      name: cutStockItems.name,
      category: cutStockItems.category,
      unit: cutStockItems.unit,
      unitPrice: cutStockItems.unitPrice,
    })
    .from(cutStockItems)
    .where(and(eq(cutStockItems.clientId, clientId), isNull(cutStockItems.deletedAt)))
    .orderBy(asc(cutStockItems.category), asc(cutStockItems.lineNo));
  return { client, items };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v)
    return String((v as ExcelJS.CellFormulaValue).result ?? '').trim();
  return (cell.text ?? String(v)).trim();
}

function cellRaw(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as ExcelJS.CellFormulaValue).result;
  return v;
}

/** The blank import template, with the client's CDC master list as an ITEM dropdown and a reference sheet. */
export async function buildImportCargoTemplate(
  clientId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { client, items } = await masterList(clientId);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grateful Solutions Logistics Command Center';
  const ws = wb.addWorksheet('Import Invoices', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.field, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;
  COLUMNS.forEach((c, i) => {
    if (c.note) head.getCell(i + 1).note = c.note;
  });

  const ref = wb.addWorksheet('CDC Master List', { views: [{ state: 'frozen', ySplit: 1 }] });
  ref.columns = [
    { header: 'ITEM', key: 'name', width: 40 },
    { header: 'CDC UNIT', key: 'unit', width: 9 },
    { header: 'CDC NO', key: 'cdcNo', width: 10 },
    { header: 'MATERIAL', key: 'material', width: 26 },
    { header: 'UNIT PRICE', key: 'price', width: 11 },
  ];
  ref.getRow(1).font = { bold: true };
  for (const it of items)
    ref.addRow({
      name: it.name,
      unit: it.unit,
      cdcNo: it.declareRef,
      material: materialOf(it.category),
      price: Number(it.unitPrice),
    });

  // ITEM picks from the master list; a typed name that is not on it is flagged by Excel too.
  const itemCol = COLUMNS.findIndex((c) => c.field === 'description') + 1;
  if (items.length)
    for (let r = 2; r <= 500; r++)
      ws.getCell(r, itemCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'CDC Master List'!$A$2:$A$${items.length + 1}`],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: 'ITEM',
        error: `This item is not on ${client.code}'s CDC master list.`,
      };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `${client.code} Import Invoice Template.xlsx` };
}

/**
 * Reads an import workbook (INV, DATE, ITEM, QUANTITY, CDC UNIT, NW.KGS, GW.KGS, UNIT PRICE)
 * into invoices. Blank INV cells continue the invoice above. Each ITEM must be on the client's
 * CDC master list with the same CDC UNIT; its CDC no. and material come from there. When any
 * row does not match, nothing is returned and `errors` lists every such row.
 */
export async function parseImportCargoWorkbook(
  buffer: Buffer,
  fileName: string,
  clientId: string,
): Promise<ImportCargoExcelParseResult> {
  const { client, items } = await masterList(clientId);
  const byName = new Map(items.map((i) => [nameKey(i.name), i]));
  const wb = new ExcelJS.Workbook();
  const ws = /\.csv$/i.test(fileName)
    ? await wb.csv.read(Readable.from(buffer))
    : (await wb.xlsx.load(buffer as unknown as ArrayBuffer), wb.worksheets[0]);
  const warnings: ImportCargoExcelParseResult['warnings'] = [];
  const errors: ImportCargoExcelParseResult['errors'] = [];
  const empty = (message: string) => ({
    invoices: [],
    warnings: [],
    errors: [{ row: null, message }],
    rowsRead: 0,
  });
  if (!ws) return empty('The workbook has no sheets.');

  // The header row is within the first 10 rows.
  let headerRow = 0;
  let columns = new Map<Field, number>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const found = new Map<Field, number>();
    ws.getRow(r).eachCell((cell, col) => {
      const f = LOOKUP.get(norm(cellText(cell)));
      if (f && !found.has(f)) found.set(f, col);
    });
    if (found.size >= 3) {
      headerRow = r;
      columns = found;
      break;
    }
  }
  if (!headerRow)
    return empty(
      `No header row found. Use the import template columns: ${COLUMNS.map((c) => c.header).join(', ')}.`,
    );
  const missing = COLUMNS.filter((c) => !columns.has(c.field)).map((c) => c.header);
  if (missing.length)
    return empty(
      `The sheet is missing ${missing.join(', ')}. Use the import template columns: ${COLUMNS.map((c) => c.header).join(', ')}.`,
    );

  const invoices = new Map<string, ImportCargoExcelParseResult['invoices'][number]>();
  let currentNo = '';
  let rowsRead = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cell = (f: Field) => {
      const col = columns.get(f);
      return col ? row.getCell(col) : null;
    };
    const text = (f: Field) => {
      const c = cell(f);
      return c ? cellText(c) : '';
    };
    const num = (f: Field, decimals: number, label: string): string | null => {
      const c = cell(f);
      if (!c || !cellText(c)) return null;
      const raw = cellRaw(c);
      const n = typeof raw === 'number' ? raw : Number(cellText(c).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        warnings.push({
          row: r,
          message: `${label} "${cellText(c)}" is not a valid number; used 0.`,
        });
        return '0';
      }
      return String(Number(n.toFixed(decimals)));
    };
    const lineFields: Field[] = ['description', 'pcs', 'netWeightKg', 'grossWeightKg'];
    if (!lineFields.some((f) => text(f)) && !text('invoiceNo')) continue; // blank row
    rowsRead++;

    const invNo = text('invoiceNo').toUpperCase();
    if (invNo) currentNo = invNo;
    else if (!currentNo) {
      errors.push({ row: r, message: 'INV is empty and there is no invoice above it.' });
      continue;
    }
    let inv = invoices.get(currentNo);
    if (!inv) {
      const dc = cell('invoiceDate');
      const invoiceDate = dc ? parseDateCell(cellRaw(dc)) : null;
      if (dc && cellText(dc) && !invoiceDate)
        warnings.push({
          row: r,
          message: `Invoice date "${cellText(dc)}" not recognised; use YYYY-MM-DD.`,
        });
      inv = { invoiceNo: currentNo, invoiceDate, lines: [] };
      invoices.set(currentNo, inv);
    }
    if (!lineFields.some((f) => text(f))) continue; // an invoice row without an item

    const name = text('description');
    const item = name ? byName.get(nameKey(name)) : undefined;
    const unit = text('unit').toUpperCase();
    if (!name) errors.push({ row: r, message: 'ITEM is empty.' });
    else if (!item)
      errors.push({ row: r, message: `"${name}" is not on ${client.code}'s CDC master list.` });
    else if (unit !== item.unit.toUpperCase())
      errors.push({
        row: r,
        message: unit
          ? `"${item.name}" is counted in ${item.unit} on the CDC master list, not ${unit}.`
          : `CDC UNIT is empty; "${item.name}" is counted in ${item.unit}.`,
      });
    const pcs = num('pcs', 3, 'QUANTITY');
    if (!pcs || Number(pcs) === 0) errors.push({ row: r, message: 'QUANTITY is empty or 0.' });
    if (!item) continue;
    inv.lines.push({
      cdcNo: item.declareRef,
      description: item.name,
      material: materialOf(item.category),
      unit: item.unit,
      pcs: pcs ?? '0',
      netWeightKg: num('netWeightKg', 3, 'NW.KGS') ?? '0',
      grossWeightKg: num('grossWeightKg', 3, 'GW.KGS') ?? '0',
      fobUnitPrice: num('fobUnitPrice', 4, 'UNIT PRICE') ?? String(Number(item.unitPrice)),
    });
  }
  // Nothing is filled in while any row does not match: fix the sheet and upload it again.
  if (errors.length) return { invoices: [], warnings, errors, rowsRead };
  for (const inv of invoices.values())
    if (!inv.lines.length)
      warnings.push({ row: null, message: `Invoice ${inv.invoiceNo} has no items.` });
  if (!rowsRead) errors.push({ row: null, message: 'The sheet has a header but no data rows.' });
  return {
    invoices: [...invoices.values()].filter((i) => i.lines.length),
    warnings,
    errors,
    rowsRead,
  };
}
