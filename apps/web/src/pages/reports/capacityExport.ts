import type { Borders, Font, Worksheet } from 'exceljs';
import { saveBlob } from '../../lib/files';
import { hoursLabel, type CapacityModel } from './capacity';

/*
 * Reports → Payroll → Capacity report → Export Excel: the report on the factory's own grid
 * (columns A–Y, as on the JR-08 sheet), fonts and wording kept, so it can still be touched up
 * in Excel before it is sent.
 */

const MUOL = 'Khmer OS Muol Light';
const BODY = 'Khmer OS Siemreap';
const THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;
const BOX: Partial<Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };
/** JR-08's column widths, A to Y. */
// prettier-ignore
const WIDTHS = [3.6, 5.9, 4.1, 9, 6.1, 4.1, 9, 5.3, 5.1, 3.7, 4.3, 7, 5.7, 4.1, 8.3, 3.3, 4.4, 1.6, 3.6, 2.1, 3.7, 1.7, 5.3, 2.1, 12.1];
const body = (extra: Partial<Font> = {}): Partial<Font> => ({ name: BODY, size: 11, ...extra });

export const capacityFileName = (m: CapacityModel) =>
  `Capacity_Report_${m.month}_${(m.profile.companyName || 'Factory').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')}`;

export async function exportCapacityExcel(m: CapacityModel) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  addCapacitySheet(
    wb.addWorksheet(m.month, {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.5, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      },
    }),
    m,
  );
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${capacityFileName(m)}.xlsx`,
  );
}

export function addCapacitySheet(ws: Worksheet, m: CapacityModel) {
  const p = m.profile;
  ws.columns = WIDTHS.map((width) => ({ width }));
  let r = 0;
  /** Next row; `height` as on the sheet. */
  const next = (height = 22) => {
    r += 1;
    ws.getRow(r).height = height;
    return r;
  };
  const put = (row: number, col: string, value: string | number, font = body(), fmt?: string) => {
    const c = ws.getCell(`${col}${row}`);
    c.value = value;
    c.font = font;
    if (fmt) c.numFmt = fmt;
    return c;
  };
  const centred = (row: number, from: string, to: string, value: string, font: Partial<Font>) => {
    ws.mergeCells(`${from}${row}:${to}${row}`);
    put(row, from, value, font).alignment = { horizontal: 'center', vertical: 'middle' };
  };

  centred(next(29), 'A', 'Y', 'ព្រះរាជាណាចក្រកម្ពុជា', { name: MUOL, size: 14 });
  centred(next(29), 'A', 'Y', 'ជាតិ សាសនា ព្រះមហាក្សត្រ', { name: MUOL, size: 14 });
  for (const t of ['ក្រសួងពាណិជ្ជកម្ម', 'អគ្គនាយកដ្ឋានសេវាពាណិជ្ជកម្ម', 'នាយកដ្ឋាននាំចេញ-នាំចូល'])
    centred(next(23), 'A', 'H', t, { name: MUOL, size: 11 });
  centred(next(27), 'A', 'Y', 'របាយការណ៍', { name: MUOL, size: 12 });
  centred(next(27), 'A', 'Y', 'ស្តីពី', { name: MUOL, size: 12 });
  centred(next(23), 'A', 'Y', m.titleKh, body());

  put(next(), 'A', '១) ឈ្មោះរោងចក្រ');
  put(r, 'F', p.companyName, { name: 'Arial', size: 11, bold: true });
  put(next(), 'B', 'មានទីតាំងនៅ');
  put(r, 'F', p.address1, { name: 'Arial', size: 11 });
  if (p.address2) put(next(), 'F', p.address2, { name: 'Arial', size: 11 });
  put(next(), 'A', '២) លេខទូរស័ព្ទ');
  put(r, 'E', p.phone);
  put(next(), 'A', '៣) លេខ និងកាលបរិច្ឆេទចុះបញ្ជី :');
  put(r, 'H', p.registration, { name: 'Arial', size: 11 });
  if (p.registrationDate) {
    put(r, 'O', 'Date:', { name: 'Arial', size: 11 });
    put(r, 'P', p.registrationDate, { name: 'Arial', size: 11 });
  }

  put(next(), 'A', '៤) សមត្ថភាពការងារ');
  put(r, 'F', '：');
  for (const s of m.staff) {
    put(next(21), 'B', `- ${s.labelKh}`);
    put(r, 'F', '：');
    put(r, 'H', 'ប្រុស');
    put(r, 'I', s.male).alignment = { horizontal: 'center' };
    put(r, 'K', 'នាក់');
    put(r, 'N', 'ស្រី');
    put(r, 'O', s.female).alignment = { horizontal: 'center' };
    put(r, 'Q', 'នាក់');
    put(r, 'T', 'សរុប');
    put(r, 'V', s.total).alignment = { horizontal: 'center' };
    put(r, 'X', 'នាក់');
  }

  put(next(), 'A', '៥)ប្រាក់បៀវត្ស');
  put(r, 'F', '：');
  for (const s of m.salaries) {
    put(next(), 'B', `- ${s.labelKh}`);
    put(r, 'F', '：');
    put(r, 'G', Math.round(s.amount * 100) / 100, body(), '#,##0.00');
    put(r, 'K', 'ដុល្លាអាមេរិក');
  }

  put(next(), 'A', '៦)ម៉ោងការងារ');
  put(r, 'F', '：');
  put(next(23), 'B', '+ ម៉ោងធ្វើការងារ');
  put(r, 'F', 'ព្រឹក');
  put(r, 'G', p.regularTime);
  put(r, 'O', 'ម៉ោងធ្វើការសរុបប្រចាំខែ');
  put(r, 'U', p.regularHours);
  put(next(23), 'B', '+ ម៉ោងបន្ថែម.');
  put(r, 'E', p.overtimeTime);
  put(r, 'I', 'ថែមម៉ោងសរុបប្រចាំខែ');
  put(r, 'N', p.overtimeHours);

  put(next(23), 'A', '៧) ប្រភេទវត្ថុធាតុដើមនាំចូលមាន');
  put(next(23), 'B', '+ ប្រភេទ');
  put(r, 'D', m.materials, { name: 'Arial', size: 11 });
  put(r, 'L', 'នាំមកពីប្រទេស:');
  put(r, 'P', m.materialOrigins, { name: 'Arial', size: 11 });
  put(next(23), 'A', '៨)ទិសដៅនាំចេញៈ');
  put(next(23), 'B', `+ ${m.destinations}`, { name: 'Arial', size: 11 });
  put(next(23), 'B', '+ Category.', { name: 'Arial', size: 11 });
  put(r, 'E', p.categories, { name: 'Arial', size: 11 });
  put(r, 'K', '.(សរសេរលេខ Cat ជាភាសារខ្មែរ)');

  put(next(23), 'A', '៩)មធ្យោបាយបំរើផលិតកម្មៈ');
  for (const x of m.machines) {
    put(next(23), 'B', `+ ${x.labelKh}`);
    put(r, 'G', x.labelEn ? `(${x.labelEn})` : '', { name: 'Arial', size: 11 });
    put(r, 'M', 'សរុប');
    put(r, 'N', x.total).alignment = { horizontal: 'center' };
    put(r, 'P', x.unitKh);
    put(r, 'S', 'ដំណើរការ');
    put(r, 'V', x.working).alignment = { horizontal: 'center' };
    put(r, 'X', 'គ្រឿង');
  }
  const bold = body({ bold: true });
  put(next(23), 'L', 'ចំនួនសរុប', bold);
  put(r, 'N', m.machinesTotal, bold).alignment = { horizontal: 'center' };
  put(r, 'P', 'គ្រឿង', bold);
  put(r, 'S', 'ដំណើរការ', bold);
  put(r, 'V', m.machinesWorking, bold).alignment = { horizontal: 'center' };
  put(r, 'X', 'គ្រឿង', bold);

  /** A bordered table with the sheet's merged column groups. */
  const GROUPS: [string, string][] = [
    ['A', 'B'],
    ['C', 'E'],
    ['F', 'I'],
    ['J', 'L'],
    ['M', 'O'],
    ['P', 'T'],
    ['U', 'Y'],
  ];
  const cell = (
    row: number,
    g: number,
    value: string | number,
    font: Partial<Font>,
    fmt?: string,
  ) => {
    const [from, to] = GROUPS[g]!;
    ws.mergeCells(`${from}${row}:${to}${row}`);
    const c = put(row, from, value, font, fmt);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let col = ws.getColumn(from).number; col <= ws.getColumn(to).number; col++)
      ws.getCell(row, col).border = BOX;
  };
  const head = (kh: string[], en: string[]) => {
    const a = next(21);
    const b = next(21);
    const span = (g: number, rows: [number, number], value: string, font: Partial<Font>) => {
      const [from, to] = GROUPS[g]!;
      ws.mergeCells(`${from}${rows[0]}:${to}${rows[1]}`);
      const c = put(rows[0], from, value, font);
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      for (let row = rows[0]; row <= rows[1]; row++)
        for (let col = ws.getColumn(from).number; col <= ws.getColumn(to).number; col++)
          ws.getCell(row, col).border = BOX;
    };
    // Kind of products spans the first two groups.
    ws.mergeCells(`A${a}:E${b}`);
    put(a, 'A', `${kh[0]}\n${en[0]}`, { name: BODY, size: 10 }).alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    for (let row = a; row <= b; row++)
      for (let col = 1; col <= 5; col++) ws.getCell(row, col).border = BOX;
    span(2, [a, b], `${kh[1]}\n${en[1]}`, { name: BODY, size: 10 });
    ws.mergeCells(`J${a}:O${a}`);
    put(a, 'J', `${kh[2]} ${en[2]}`, { name: BODY, size: 10 }).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    for (let col = 10; col <= 15; col++) ws.getCell(a, col).border = BOX;
    span(3, [b, b], `${kh[3]} ${en[3]}`, { name: BODY, size: 9 });
    span(4, [b, b], `${kh[4]} ${en[4]}`, { name: BODY, size: 9 });
    span(5, [a, b], `${kh[5]}\n${en[5]}`, { name: BODY, size: 10 });
    span(6, [a, b], `${kh[6]}\n${en[6]}`, { name: BODY, size: 10 });
  };
  const arial = (size = 10, bold = false): Partial<Font> => ({ name: 'Arial', size, bold });

  put(next(23), 'A', '១០)ការវាយតម្លៃសមត្ថភាពផលិតកម្ម (Production Capacity)');
  head(
    [
      'ប្រភេទផលិតផល',
      'ប្រភេទវត្ថុធាតុដើម',
      'សមត្ថភាពផលិត',
      'ម៉ោង',
      'ចំនួនផលិតផល',
      'សរុបប្រចាំថ្ងៃ',
      'សរុបប្រចាំខែ',
    ],
    [
      'Kind of Products',
      'Kind of Materials',
      'Production Capacity',
      'Hour',
      'Quantity',
      'Total Per Day PCS',
      'Total Per Month',
    ],
  );
  for (const x of m.rows) {
    const row = next(20);
    cell(row, 0, x.kind, arial());
    cell(row, 1, x.product, arial());
    cell(row, 2, x.material, arial());
    cell(row, 3, hoursLabel(x.hoursPerDay), arial(11));
    cell(row, 4, x.perHour, arial(12));
    cell(row, 5, x.perDay, arial(11), '#,##0.00');
    cell(row, 6, x.perMonth, arial(11), '#,##0 "PCS"');
  }

  next(10);
  put(next(23), 'A', '១១)ការវាយតម្លៃលើបទដ្ឋានផលិតកម្ម (Production Norm)');
  head(
    [
      'ប្រភេទផលិតផល',
      'ប្រភេទវត្ថុធាតុដើម',
      'បទដ្ឋានផលិត',
      'ទម្ងន់ក្នុងមួយឡូតិ៍',
      'ទម្ងន់មួយឯកត្តា',
      'ចំនួនសរុប',
      'ទម្ងន់សរុប',
    ],
    [
      'Kind of Products',
      'Kind of Materials',
      'Products Norm',
      'A Dozen Weight',
      'A Unit Weight',
      'Total Quantity',
      'Total Weight',
    ],
  );
  for (const x of m.rows) {
    const row = next(20);
    cell(row, 0, x.kind, arial());
    cell(row, 1, x.product, arial());
    cell(row, 2, x.material, arial());
    cell(row, 3, x.dozenWeight, arial(11), '0.00');
    cell(row, 4, x.unitWeight, arial(11), '0.00');
    cell(row, 5, x.perMonth, arial(11), '#,##0');
    cell(row, 6, x.totalWeight, arial(11), '#,##0.00');
  }

  put(next(23), 'A', '១២)សេចក្តីសន្និដ្ឋានៈ');
  const para = (text: string, height = 23) => {
    const row = next(height);
    ws.mergeCells(`B${row}:Y${row}`);
    put(row, 'B', text).alignment = { wrapText: true, vertical: 'top' };
  };
  if (p.conclusion) para(p.conclusion, Math.max(23, Math.ceil(p.conclusion.length / 90) * 20));
  else {
    para('.'.repeat(160));
    para(`${'.'.repeat(160)}។`);
  }
  para(
    `ការចុះពិនិត្យវាយតម្លៃលទ្ធភាពផលិត និងបទដ្ឋានផលិតខាងលើ ពិតជាបានចុះផ្ទាល់ដល់រោងចក្រ និងបានជួបជាមួយ ឈ្មោះ ${
      p.informantName || '..................'
    } ជា${p.informantTitle || '..........'} ជាអ្នកផ្តល់ពត៌មានចូលរួមសហការណ៍ និងឯកភាពតាមរបាយការណ៍វាយតម្លៃរបស់មន្រ្តី ។`,
    44,
  );
  para('អាស្រ័យដូចបានជម្រាបខាងលើសូម ឯកឧត្តម ប្រធានមេត្តាជ្រាបជាពត៌មាន និងមតិណែនាំតាមការគួរ។');

  const year = m.month.slice(0, 4);
  const sign = (from: string, to: string, lines: string[], name: string) => {
    const start = r;
    lines.forEach((t, i) => {
      const row = start + 1 + i;
      ws.getRow(row).height = 22;
      ws.mergeCells(`${from}${row}:${to}${row}`);
      put(row, from, t).alignment = { horizontal: 'center' };
    });
    const nameRow = start + lines.length + 4;
    ws.mergeCells(`${from}${nameRow}:${to}${nameRow}`);
    put(nameRow, from, name, arial(12, true)).alignment = { horizontal: 'center' };
    return nameRow;
  };
  const left = sign(
    'A',
    'G',
    [`ថ្ងៃទី...........ខែ....... ឆ្នាំ ${year}`, 'អ្នកផ្តល់ពត៌មានពីរោងចក្រ'],
    p.informantName,
  );
  const right = sign(
    'P',
    'Y',
    [`ថ្ងៃទី...........ខែ....... ឆ្នាំ ${year}`, 'មន្រ្តីសម្រង់ពត៌មាន'],
    p.officerName,
  );
  r = Math.max(left, right);
  const ok = next(23);
  ws.mergeCells(`A${ok}:Y${ok}`);
  put(ok, 'A', 'ឯកភាព', { name: MUOL, size: 11 }).alignment = { horizontal: 'center' };
  const date = next(22);
  ws.mergeCells(`A${date}:Y${date}`);
  put(date, 'A', `ថ្ងៃទី..........ខែ..... ឆ្នាំ ${year}`).alignment = { horizontal: 'center' };
  r += 3;
  const name = next(25);
  ws.mergeCells(`A${name}:Y${name}`);
  put(name, 'A', p.approverName, arial(12, true)).alignment = { horizontal: 'center' };

  ws.pageSetup.printArea = `A1:Y${r}`;
}
