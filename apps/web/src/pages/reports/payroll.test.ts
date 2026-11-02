import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { categoryOf, payrollSheets, readPayroll } from './payroll';

const KH = ['ល.រ', 'លេខកាត', 'ឈ្មោះ', '', 'ថ្ងៃខែ\nកំណើត', 'លេខអត្តស\nញ្ញាណប័ណ្ណ', 'ភេទ'];
// prettier-ignore
const ZH = ['程序', '工號', '姓名（英文）', '姓名（柬文）', '出生日期', '身份证', '性別', '到職日期', '底薪',
  '上班\n天數', '上 班', '正常加班時數', '平常加\n班薪資', '节假日\n工時', '节假日\n薪資', '全勤獎',
  '交通\n補貼', '職務\n津貼', '技術\n津貼', '午餐伙\n食費', '加班18:00伙食次数', '加班20:00伙食次数',
  '加班伙\n食費', '合同津貼(3個月一次)5%', '年假\n天数', '年假\n金额', '應付薪資', '扣除（25日半薪）',
  '退休金2%', '工资税', '薪資尾款 (Salary Balance)', '簽名'];

/** One staff row: basic, OT pay, attendance, lunch, gross, advance, pension, tax, net. */
function staff(
  no: number,
  card: string,
  en: string,
  kh: string,
  g: string,
  [basic, ot, att, lunch, gross, adv, pen, tax, net]: (number | null)[],
) {
  // prettier-ignore
  return [no, card, en, kh, new Date('1990-01-01'), 'ID', g, new Date('2026-07-03'), 210, 26,
    basic, 10, ot, 0, 0, att, 0, 0, 0, lunch, 0, 0, 0, 0, 0, 0, gross, adv, pen, tax, net, ''];
}

/** The salary sheet as the accountant receives it; `pad` shifts it right a column. */
function sheet(wb: ExcelJS.Workbook, name: string, pad = 0) {
  const ws = wb.addWorksheet(name);
  const add = (cells: unknown[]) => ws.addRow([...Array(pad).fill(null), ...cells]);
  add(['JR APPAREL CO.,LTD  2026年07月薪资明细表']);
  add(['ផ្នែក ： Chinese']);
  add(KH);
  add(ZH);
  add(
    staff(
      1,
      'OFF0010',
      'NI CUNLAN',
      'NI CUNLAN',
      'F',
      [1745, 0, 0, 155, 1900, 0, 5.95, 146.25, 1747.8],
    ),
  );
  add(
    staff(
      2,
      'OFF0014',
      'LONG SREYPOV',
      'ឡុង ស្រីពៅ',
      'F',
      [450, 129.81, 15, 50, 820.03, 0, 5.95, 0, 814.08],
    ),
  );
  add(
    staff(
      3,
      'SW1009',
      'YUN DY',
      'យន់ ឌី',
      'M',
      [210, 130.24, 15, 10, 439.32, 105, 5.95, 0, 328.37],
    ),
  );
  add(staff(4, 'QC0024', 'SOK NA', 'សុខ ណា', 'F', [210, 20, 0, 10, 250, 100, null, 0, 150]));
  add(staff(5, 'SW1010', 'KEO VY', 'កែវ វី', 'X', [100, 0, 0, 5, 105, 0, 0, 0, 99]));
  add([]);
  add([null, null, null, null, 'F', 3]); // a totals block under the table
  return ws;
}

describe('categoryOf', () => {
  it('follows the sheet formula', () => {
    expect(categoryOf('OFF0010', 'NI CUNLAN', 'NI CUNLAN')).toBe('foreign');
    expect(categoryOf('OFF0014', 'LONG SREYPOV', 'ឡុង ស្រីពៅ')).toBe('khmer');
    expect(categoryOf('SW-0028', 'A', 'ក')).toBe('sewing');
    expect(categoryOf('WH0007', 'A', 'ក')).toBe('production');
  });
});

describe('readPayroll', () => {
  it.each([0, 1])('reads the sheet (shifted %i columns) and sums like the formulas', (pad) => {
    const wb = new ExcelJS.Workbook();
    const r = readPayroll(sheet(wb, 'Payroll', pad));
    expect(r.company).toBe('JR APPAREL CO.,LTD');
    expect(r.period).toBe('2026-07');
    expect(r.sections).toEqual(['Chinese']);
    expect(r.staff.map((s) => s.card)).toEqual([
      'OFF0010',
      'OFF0014',
      'SW1009',
      'QC0024',
      'SW1010',
    ]);
    expect(r.totals).toMatchObject({
      count: 5,
      female: 3,
      male: 1,
      unknownGender: 1,
      newJoiners: 5,
    });
    expect(r.totals.gross).toBeCloseTo(3514.35);
    const cat = Object.fromEntries(
      r.byCategory.map((c) => [
        c.key,
        [c.female, c.male, c.total, Math.round(c.gross * 100) / 100],
      ]),
    );
    expect(cat).toEqual({
      foreign: [1, 0, 1, 1900],
      khmer: [1, 0, 1, 820.03],
      sewing: [0, 1, 2, 544.32],
      production: [1, 0, 1, 250],
    });
    expect(r.byDepartment.map((d) => [d.key, d.label, d.total])).toEqual([
      ['OFF', 'Office', 2],
      ['SW', 'Sewing', 2],
      ['QC', 'Quality Control', 1],
    ]);
    // Gross holds more than the itemised columns: the rest shows as "Other".
    const other = r.components.find((c) => c.key === 'other')!;
    expect(other.amount).toBeCloseTo(3514.35 - (2715 + 280.05 + 30 + 230));
    expect(r.bands.map((b) => b.total)).toEqual([1, 1, 0, 1, 1, 1]);
    expect(r.issues.map((i) => [i.card, i.message])).toEqual([
      ['QC0024', 'Blank pension 2% (counted as 0).'],
      ['SW1010', 'Gender is “X”, not F or M.'],
      ['SW1010', 'Net pay 99.00 ≠ gross − advance − pension − tax (105.00).'],
    ]);
  });

  it('lists only payroll sheets, and says why a sheet cannot be read', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notes').addRow(['nothing here']);
    sheet(wb, 'Original Data');
    expect(payrollSheets(wb)).toEqual(['Original Data']);
    expect(() => readPayroll(wb.getWorksheet('Notes')!)).toThrow(/no staff header row/);
  });
});

describe('payrollFromSaved', () => {
  it('reopens a saved month with the same figures as the import', async () => {
    const { payrollFromSaved, payrollToSave } = await import('./payroll');
    const r = readPayroll(sheet(new ExcelJS.Workbook(), 'Payroll'));
    const sent = payrollToSave(r, { fileName: 'p.xlsx', clientId: null, period: '2026-07' });
    const saved = {
      ...sent,
      id: 'x',
      clientId: null,
      sheetName: sent.sheetName ?? '',
      fileName: 'p.xlsx',
      sections: sent.sections ?? [],
      issues: sent.issues ?? [],
      staff: sent.staff.map(({ pay, ...s }) => ({ ...s, pay: { basic: pay.basic! } })),
      staffCount: 5,
      female: 3,
      male: 1,
      gross: '0',
      net: '0',
      savedByName: null,
      savedAt: '',
    };
    const back = payrollFromSaved(saved as never);
    expect(back.totals).toEqual(r.totals);
    expect(back.byCategory).toEqual(r.byCategory);
    expect(back.issues).toEqual(r.issues);
    // Earnings left out of a saved row read as 0.
    expect(back.staff[0]!.pay.lunch).toBe(0);
  });
});
