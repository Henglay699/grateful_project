import type { Font, Worksheet } from 'exceljs';
import { saveBlob } from '../../lib/files';
import { CATEGORIES, DEPARTMENTS, periodLabel, type PayrollReport } from './payroll';

/*
 * Reports → Payroll → Export Excel: the analysis as a workbook. "Summary" holds the tables the
 * page shows (category × gender like the sheet's COUNTIF block, departments, pay make-up,
 * bands); "Staff" is every row with its worked-out category and department.
 */

const MONEY = '#,##0.00;-#,##0.00;"-"';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF5' } } as const;
const bold: Partial<Font> = { bold: true };

export function payrollFileName(r: PayrollReport): string {
  return `Payroll_Report_${r.period ?? r.sheetName.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
}

export async function exportPayrollExcel(r: PayrollReport) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  addSummary(wb.addWorksheet('Summary', { views: [{ showGridLines: false }] }), r);
  addStaff(wb.addWorksheet('Staff', { views: [{ state: 'frozen', ySplit: 1 }] }), r);
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${payrollFileName(r)}.xlsx`,
  );
}

/** A titled table; `money` lists the 0-based columns shown as amounts. */
function table(ws: Worksheet, title: string, head: string[], rows: unknown[][], money: number[]) {
  ws.addRow([]);
  ws.addRow([title]).font = { bold: true, size: 12 };
  const h = ws.addRow(head);
  h.font = bold;
  h.eachCell((c) => (c.fill = HEAD_FILL));
  rows.forEach((cells, i) => {
    const row = ws.addRow(cells);
    for (const m of money) row.getCell(m + 1).numFmt = MONEY;
    if (i === rows.length - 1 && cells[0] === 'Total') row.font = bold;
  });
}

function addSummary(ws: Worksheet, r: PayrollReport) {
  ws.columns = [{ width: 34 }, ...Array.from({ length: 6 }, () => ({ width: 15 }))];
  ws.addRow([`${r.company || 'Payroll'} — ${periodLabel(r.period) || r.sheetName}`]).font = {
    bold: true,
    size: 14,
  };
  ws.addRow([`From sheet “${r.sheetName}” · ${r.totals.count} staff`]);

  const t = r.totals;
  table(
    ws,
    'Totals',
    ['', 'Amount'],
    [
      ['Total staff', t.count],
      ['Female', t.female],
      ['Male', t.male],
      ['Gross salary', t.gross],
      ['Half-month advance', t.advance],
      ['Pension 2%', t.pension],
      ['Salary tax', t.tax],
      ['Net pay (salary balance)', t.net],
    ],
    [],
  );
  // The last five (gross down to net) are amounts; the head counts stay whole numbers.
  for (let i = 0; i < 5; i++) ws.getRow(ws.rowCount - i).getCell(2).numFmt = MONEY;

  const groupRows = (
    gs: PayrollReport['byCategory'],
    label: (g: (typeof gs)[number]) => string,
  ) => [
    ...gs.map((g) => [label(g), g.female, g.male, g.total, g.gross, g.net]),
    [
      'Total',
      t.female,
      t.male,
      t.count,
      gs.reduce((s, g) => s + g.gross, 0),
      gs.reduce((s, g) => s + g.net, 0),
    ],
  ];
  const head = ['F', 'M', 'Total', 'Gross salary', 'Net pay'];
  table(
    ws,
    'Staff by category',
    ['Category', ...head],
    groupRows(r.byCategory, (g) => `${g.labelKh} (${g.label})`),
    [4, 5],
  );
  table(
    ws,
    'Staff by department (card no. prefix)',
    ['Department', ...head],
    groupRows(r.byDepartment, (g) => (g.label === g.key ? g.key : `${g.key} — ${g.label}`)),
    [4, 5],
  );
  table(
    ws,
    'Gross salary make-up',
    ['Item', 'Amount'],
    [...r.components.map((c) => [c.label, c.amount]), ['Total', t.gross]],
    [1],
  );
  table(
    ws,
    'Staff by gross pay',
    ['Gross pay', 'F', 'M', 'Total'],
    r.bands.map((b) => [b.label, b.female, b.male, b.total]),
    [],
  );
  if (r.issues.length)
    table(
      ws,
      'Checks',
      ['Card no.', 'Row', 'Problem'],
      r.issues.map((i) => [i.card, i.row, i.message]),
      [],
    );
}

function addStaff(ws: Worksheet, r: PayrollReport) {
  const category = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.labelKh]));
  // prettier-ignore
  const cols: [string, number, (s: PayrollReport['staff'][number]) => unknown, boolean?][] = [
    ['No.', 6, (s) => s.no],
    ['Card no.', 11, (s) => s.card],
    ['Name', 24, (s) => s.nameEn],
    ['Khmer name', 20, (s) => s.nameKh],
    ['Gender', 8, (s) => s.gender],
    ['Category', 18, (s) => category[s.category]],
    ['Department', 16, (s) => DEPARTMENTS[s.department] ?? s.department],
    ['Joined', 12, (s) => s.joinDate],
    ['Base salary', 12, (s) => s.baseSalary, true],
    ['Days worked', 11, (s) => s.daysWorked],
    ['OT hours', 10, (s) => s.otHours],
    ['Gross salary', 13, (s) => s.gross, true],
    ['Advance', 11, (s) => s.advance, true],
    ['Pension 2%', 11, (s) => s.pension, true],
    ['Salary tax', 11, (s) => s.tax, true],
    ['Net pay', 13, (s) => s.net, true],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = bold;
  ws.getRow(1).eachCell((c) => (c.fill = HEAD_FILL));
  for (const s of r.staff) ws.addRow(cols.map(([, , get]) => get(s)));
  cols.forEach(([, , , isMoney], i) => {
    if (isMoney) ws.getColumn(i + 1).numFmt = MONEY;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}
