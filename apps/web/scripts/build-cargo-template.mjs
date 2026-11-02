// Generates public/templates/cargo-import-template.xlsx: the workbook users fill in and load
// with "Upload Excel Template" in the shipment form's Cargo section. The headers must stay
// in step with the HEADERS aliases in apps/api/src/modules/shipments/excel.ts.
// The header row is locked; the data rows below it are open for typing.
// Run after changing a column: `node scripts/build-cargo-template.mjs`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

// Lets an admin unprotect the sheet in Excel (Review > Unprotect Sheet) to change the layout.
const PASSWORD = 'gs-cargo';
const DATA_ROWS = 1000;

const COLUMNS = [
  { header: 'INVOICE NO', width: 16, kind: 'text', note: 'Required on the first line of each invoice. Leave blank on the following lines of the same invoice.' },
  { header: 'INV DATE', width: 13, kind: 'date', note: 'Invoice date, e.g. 2026-10-14. Only needed on the first line of each invoice.' },
  { header: 'PO#', width: 14, kind: 'text', note: 'Purchase order number.' },
  { header: 'STYLE', width: 14, kind: 'text', note: 'Style number.' },
  { header: 'HTS CODE', width: 14, kind: 'text', note: 'One HTS code per invoice.' },
  { header: 'DESCRIPTION', width: 36, kind: 'text', note: 'Goods description, e.g. Mens woven shorts 100 nylon.' },
  { header: 'PCS', width: 10, kind: 'number', format: '#,##0', note: 'Pieces.' },
  { header: 'CTNS', width: 10, kind: 'number', format: '#,##0', note: 'Cartons.' },
  { header: 'N.W KGS', width: 12, kind: 'number', format: '#,##0.00', note: 'Net weight in kg.' },
  { header: 'G.W KGS', width: 12, kind: 'number', format: '#,##0.00', note: 'Gross weight in kg.' },
  { header: 'CBM', width: 10, kind: 'number', format: '#,##0.000', note: 'Volume in cubic metres.' },
  { header: 'FOB PRICE', width: 12, kind: 'number', format: '#,##0.0000', note: 'FOB unit price in USD.' },
];

const BRAND = 'FF0891B2';
const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

const wb = new ExcelJS.Workbook();
wb.creator = 'GS Command Center';
wb.created = new Date();

// The importer reads the first sheet, so the data sheet must come first.
const ws = wb.addWorksheet('Cargo', { views: [{ state: 'frozen', ySplit: 1 }] });
ws.columns = COLUMNS.map((c) => ({ key: c.header, width: c.width }));

const head = ws.getRow(1);
head.height = 22;
COLUMNS.forEach((c, i) => {
  const cell = head.getCell(i + 1);
  cell.value = c.header;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  cell.border = border;
  cell.note = c.note;
  cell.protection = { locked: true };
});

for (let r = 2; r <= DATA_ROWS + 1; r++) {
  const row = ws.getRow(r);
  COLUMNS.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.protection = { locked: false };
    cell.border = border;
    if (c.kind === 'text') cell.numFmt = '@'; // keep leading zeros in codes
    if (c.kind === 'date') {
      cell.numFmt = 'yyyy-mm-dd';
      cell.dataValidation = {
        type: 'date',
        operator: 'greaterThan',
        formulae: [new Date(Date.UTC(2000, 0, 1))],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Invoice date',
        error: 'Enter a date, for example 2026-10-14.',
      };
    }
    if (c.kind === 'number') {
      cell.numFmt = c.format;
      cell.alignment = { horizontal: 'right' };
      cell.dataValidation = {
        type: 'decimal',
        operator: 'greaterThanOrEqual',
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: c.header,
        error: 'Enter a number of 0 or more.',
      };
    }
  });
}

const allow = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  formatCells: true,
  formatColumns: true,
  formatRows: true,
  insertRows: true,
  deleteRows: true,
  sort: true,
  autoFilter: true,
};
await ws.protect(PASSWORD, allow);

// Second sheet: how to fill it in, with an example the importer never reads.
const help = wb.addWorksheet('How to fill');
help.columns = [{ width: 4 }, ...COLUMNS.map((c) => ({ width: c.width }))];
const lines = [
  'How to fill the Cargo sheet',
  '',
  '1. Type one line item per row on the Cargo sheet, starting in row 2. Do not change the header row.',
  '2. Put INVOICE NO and INV DATE on the first line of each invoice. Leave both blank on the lines below it that belong to the same invoice.',
  '3. Use one HTS code per invoice.',
  '4. Numbers only in PCS, CTNS, N.W KGS, G.W KGS, CBM and FOB PRICE. FOB PRICE is the unit price in USD.',
  '5. Save the file and use "Upload Excel Template" in the Cargo, Pricing & FOB section of the shipping plan.',
  '',
  'Example: invoice GS-001 with two lines, then invoice GS-002 with one line.',
];
lines.forEach((t, i) => {
  const cell = help.getCell(i + 1, 2);
  cell.value = t;
  if (i === 0) cell.font = { bold: true, size: 14 };
});
const exHeader = lines.length + 2;
const example = [
  ['GS-001', new Date(Date.UTC(2026, 9, 14)), 'PO1001', 'ST-501', '6204.63', 'Mens woven shorts 100 nylon', 1200, 60, 540, 610, 4.2, 3.85],
  ['', '', 'PO1001', 'ST-502', '6204.63', 'Mens woven shorts 100 nylon', 800, 40, 360, 405, 2.8, 3.85],
  ['GS-002', new Date(Date.UTC(2026, 9, 15)), 'PO1002', 'ST-610', '6110.30', 'Ladies knit pullover', 500, 25, 210, 240, 1.9, 6.5],
];
COLUMNS.forEach((c, i) => {
  const cell = help.getCell(exHeader, i + 2);
  cell.value = c.header;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF94A3B8' } };
  cell.alignment = { horizontal: 'center' };
  cell.border = border;
});
example.forEach((vals, r) => {
  vals.forEach((v, i) => {
    const cell = help.getCell(exHeader + 1 + r, i + 2);
    cell.value = v;
    cell.border = border;
    if (COLUMNS[i].kind === 'date') cell.numFmt = 'yyyy-mm-dd';
    if (COLUMNS[i].format) cell.numFmt = COLUMNS[i].format;
  });
});
await help.protect(PASSWORD, { selectLockedCells: true, selectUnlockedCells: true });

wb.views = [{ activeTab: 0 }];
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/templates/cargo-import-template.xlsx');
await wb.xlsx.writeFile(out);
console.log('Wrote', out);
