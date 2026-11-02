import type { Borders } from 'exceljs';
import { CO_STATUS_LABEL, type CoRow } from '@gs/shared';
import { saveBlob } from '../../lib/files';

/*
 * CO Plans → Excel: the list on the CO RECORD sheet's grid (columns A–M, green heading row,
 * Calibri, dd-mmm-yy dates), with a total row under it.
 */

const THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;
const BOX: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const DATE = '[$-409]dd\\-mmm\\-yy;@';
const HEADS = [
  'MONTH',
  'FORM',
  'MODE',
  'COUNTRY',
  'CO NO',
  'DATE CO',
  'INV NO',
  'DATE INV',
  'PCS',
  'CNTS',
  'AMOUNT',
  'ATD DATE',
  'STATUS',
];
const WIDTHS = [11.3, 9, 9.1, 13.7, 19.6, 13.9, 13.9, 14.6, 13.4, 11.9, 13.1, 13.1, 16];

/** "2026-07-14" → a date Excel shows as 14-Jul-26. */
const day = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function exportCoExcel(rows: CoRow[], from: string, to: string) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CO RECORD', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToHeight: 0 },
  });
  ws.columns = WIDTHS.map((width) => ({ width }));

  const head = ws.getRow(1);
  HEADS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  });

  rows.forEach((r, i) => {
    ws.getRow(i + 2).values = [
      `${r.month.slice(5, 7)}-${r.month.slice(0, 4)}`,
      r.form ?? '',
      r.mode,
      r.country ?? '',
      r.coNo ?? '',
      day(r.coDate),
      r.invoiceNo,
      day(r.invoiceDate),
      r.pcs,
      r.ctns,
      r.amount,
      day(r.atd),
      CO_STATUS_LABEL[r.status].toUpperCase(),
    ];
  });

  const last = rows.length + 1;
  const total = ws.getRow(last + 1);
  total.getCell(1).value = 'TOTAL';
  ws.mergeCells(last + 1, 1, last + 1, 8);
  for (const col of [9, 10, 11]) {
    const letter = String.fromCharCode(64 + col);
    total.getCell(col).value = { formula: `SUM(${letter}2:${letter}${last})` };
  }
  total.font = { name: 'Calibri', size: 11, bold: true };

  for (let r = 1; r <= last + 1; r++)
    for (let c = 1; c <= HEADS.length; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BOX;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (r > 1 && [6, 8, 12].includes(c)) cell.numFmt = DATE;
      if (r > 1 && (c === 9 || c === 10)) cell.numFmt = '#,##0';
      if (r > 1 && c === 11) cell.numFmt = '#,##0.00';
    }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `CO RECORD ${from === to ? from : `${from} to ${to}`}.xlsx`,
  );
}
