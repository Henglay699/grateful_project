import type { Borders, Font } from 'exceljs';
import { saveBlob } from '../../lib/files';
import type { CustomsModel } from './importExport';

/*
 * Reports → Import & Export → Excel: the report on the factory's own grid (columns A–I of its
 * "JR-IMP" / "JR-EXP" sheets), fonts and number formats kept, so it can still be touched up in
 * Excel before it is sent. Unit and totals are formulas, as there.
 */

const MUOL = 'Khmer OS Muol Light';
const KH = 'Khmer OS Battambang';
const THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;
const BOX: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const ACC = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const WIDTHS = [5.7, 14.5, 14, 30, 10, 14, 13.3, 13, 14];
const arial = (extra: Partial<Font> = {}): Partial<Font> => ({ name: 'Arial', size: 10, ...extra });

export async function exportCustomsExcel(m: CustomsModel) {
  const { default: ExcelJS } = await import('exceljs');
  const imp = m.direction === 'IMPORT';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(m.sheetName, {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '3:4',
      margins: { left: 0.4, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });
  ws.columns = WIDTHS.map((width) => ({ width }));

  const centred = (range: string, value: string, font: Partial<Font>) => {
    ws.mergeCells(range);
    const c = ws.getCell(range.split(':')[0]!);
    c.value = value;
    c.font = font;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    return c;
  };

  ws.getRow(1).height = 33;
  centred('A1:I1', m.titleKh, { name: MUOL, size: 12 });
  ws.getRow(2).height = 23;
  centred('A2:I2', m.subtitleKh, { name: KH, size: 11 });

  const heads: [string, string][] = [
    ['ល.រ', 'No.'],
    ['លេខប្រតិវេតន៍គយ', 'Customs Declaration No.'],
    ['កាលបរិច្ឆេទ', 'Customs Declaration Date'],
    ['មុខទំនិញ', 'Description of Goods'],
    ['ឯកតា', 'Unit'],
    [m.qtyHeadKh, 'Quantity'],
    ['ទម្ងន់សុទ្ធ', 'Net Weight\n (Kgs.)'],
    ['ទម្ងន់សរុប', 'Gross Weight\n (Kgs.)'],
    ['តម្លៃគិតពន្ធគយ', 'Customs Value\n (USD)'],
  ];
  ws.getRow(3).height = 21;
  ws.getRow(4).height = 36;
  heads.forEach(([kh, en], i) => {
    const top = ws.getCell(3, i + 1);
    top.value = kh;
    top.font = { name: 'Khmer OS Siemreap', size: 9 };
    const bottom = ws.getCell(4, i + 1);
    bottom.value = en;
    bottom.font = { name: 'Times New Roman', size: 9 };
    for (const c of [top, bottom]) {
      c.border = BOX;
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  });

  const first = 5;
  const qtyFmt = imp ? ACC : '#,##0';
  m.rows.forEach((x, i) => {
    const r = first + i;
    const [y, mo, d] = x.declareDate.split('-').map(Number) as [number, number, number];
    const values: [unknown, string | undefined][] = [
      [x.no, undefined],
      [x.declareNo, undefined],
      [new Date(Date.UTC(y, mo - 1, d)), 'dd-mmm-yy'],
      [x.goods, undefined],
      [{ formula: `IF(F${r}=0,0,I${r}/F${r})`, result: x.unitValue }, imp ? ACC : '0.000'],
      [x.qty, qtyFmt],
      [x.netWeightKg, ACC],
      [x.grossWeightKg, ACC],
      [x.value, ACC],
    ];
    values.forEach(([v, fmt], j) => {
      const c = ws.getCell(r, j + 1);
      c.value = v as never;
      c.font = arial();
      c.border = BOX;
      c.alignment = { horizontal: j >= 4 ? 'right' : 'center', vertical: 'middle' };
      if (fmt) c.numFmt = fmt;
    });
  });

  const last = first + m.rows.length - 1;
  const tr = Math.max(last, first - 1) + 1;
  ws.getRow(tr).height = 20;
  ws.mergeCells(`A${tr}:E${tr}`);
  const bold: Partial<Font> = { name: 'Times New Roman', size: 11, bold: true };
  const label = ws.getCell(`A${tr}`);
  label.value = m.totalLabel;
  label.font = bold;
  label.alignment = { horizontal: 'right', vertical: 'middle' };
  const totals: [string, number, string][] = [
    ['F', m.totals.qty, qtyFmt],
    ['G', m.totals.netWeightKg, ACC],
    ['H', m.totals.grossWeightKg, ACC],
    ['I', m.totals.value, ACC],
  ];
  for (const [col, result, fmt] of totals) {
    const c = ws.getCell(`${col}${tr}`);
    c.value = m.rows.length ? { formula: `SUM(${col}${first}:${col}${last})`, result } : 0;
    c.font = bold;
    c.numFmt = fmt;
    c.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  for (let col = 1; col <= 9; col++) ws.getCell(tr, col).border = BOX;

  const khmer = { name: KH, size: 12 };
  centred(`F${tr + 2}:I${tr + 2}`, m.signDateKh, khmer);
  centred(`F${tr + 3}:I${tr + 3}`, m.signer.title, khmer);
  centred(`F${tr + 10}:I${tr + 10}`, m.signer.name, arial({ bold: true }));

  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${m.fileName}.xlsx`,
  );
}
