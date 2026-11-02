import type { CellValue, Workbook, Worksheet } from 'exceljs';
import type {
  PayrollCategory,
  PayrollGender,
  PayrollMonthDetail,
  PayrollMonthInput,
} from '@gs/shared';

/*
 * Reports → Payroll: reads the monthly salary sheet (JR APPAREL "薪资明细表", one row per staff
 * member under a Khmer and a Chinese header row) and works out what the accountant's formulas
 * did by hand: each person's category from the card no., head counts by gender, and salary
 * totals. The file is read in the browser; "Save month" keeps the rows on the server.
 */

export type { PayrollCategory };
export type Gender = PayrollGender;

/** The sheet's own Khmer labels (as its COUNTIF formulas use them), with English. */
export const CATEGORIES: { key: PayrollCategory; label: string; labelKh: string }[] = [
  { key: 'foreign', label: 'Foreign staff', labelKh: 'បុគ្គលិកបរទេស' },
  { key: 'khmer', label: 'Khmer staff', labelKh: 'បុគ្គលិកខ្មែរ' },
  { key: 'sewing', label: 'Sewing workers', labelKh: 'កម្មករដេរ' },
  { key: 'production', label: 'Production workers', labelKh: 'កម្មករផលិតកម្ម' },
];

/** Card no. prefixes seen on the sheet. Unknown prefixes show as the code itself. */
export const DEPARTMENTS: Record<string, string> = {
  OFF: 'Office',
  SW: 'Sewing',
  QC: 'Quality Control',
  CT: 'Cutting',
  PK: 'Packing',
  IR: 'Ironing',
  WH: 'Warehouse',
  MC: 'Mechanic',
  CL: 'Cleaning',
};

export interface PayrollStaff {
  /** Worksheet row, for pointing at problems. */
  row: number;
  no: string;
  card: string;
  nameEn: string;
  nameKh: string;
  gender: Gender;
  /** ISO dates (yyyy-mm-dd) or null. */
  birthDate: string | null;
  joinDate: string | null;
  section: string;
  department: string;
  category: PayrollCategory;
  baseSalary: number;
  daysWorked: number;
  otHours: number;
  holidayHours: number;
  pay: Record<PayComponent, number>;
  gross: number;
  advance: number;
  pension: number;
  tax: number;
  net: number;
}

/** Earnings columns that make up gross pay (應付薪資). */
export const PAY_COMPONENTS = [
  { key: 'basic', label: 'Basic pay (days worked)', zh: '上班' },
  { key: 'overtime', label: 'Overtime pay', zh: '平常加班薪資' },
  { key: 'holiday', label: 'Holiday overtime pay', zh: '节假日薪資' },
  { key: 'attendance', label: 'Attendance bonus', zh: '全勤獎' },
  { key: 'transport', label: 'Transport allowance', zh: '交通補貼' },
  { key: 'position', label: 'Position allowance', zh: '職務津貼' },
  { key: 'skill', label: 'Skill allowance', zh: '技術津貼' },
  { key: 'lunch', label: 'Lunch allowance', zh: '午餐伙食費' },
  { key: 'otMeal', label: 'Overtime meal allowance', zh: '加班伙食費' },
  { key: 'contract', label: 'Contract allowance 5%', zh: '合同津貼(3個月一次)5%' },
  { key: 'annualLeave', label: 'Annual leave pay', zh: '年假金额' },
] as const;
export type PayComponent = (typeof PAY_COMPONENTS)[number]['key'];

type Field =
  | 'no'
  | 'card'
  | 'nameEn'
  | 'nameKh'
  | 'birthDate'
  | 'gender'
  | 'joinDate'
  | 'baseSalary'
  | 'daysWorked'
  | 'otHours'
  | 'holidayHours'
  | 'gross'
  | 'advance'
  | 'pension'
  | 'tax'
  | 'net'
  | PayComponent;

/**
 * Chinese header → field, and the column's place counted from the card no. column (the
 * fallback when a header is missing or reworded). Headers are compared without spaces.
 */
const COLUMNS: [Field, string, number][] = [
  ['no', '程序', -1],
  ['card', '工號', 0],
  ['nameEn', '姓名（英文）', 1],
  ['nameKh', '姓名（柬文）', 2],
  ['birthDate', '出生日期', 3],
  ['gender', '性別', 5],
  ['joinDate', '到職日期', 6],
  ['baseSalary', '底薪', 7],
  ['daysWorked', '上班天數', 8],
  ['basic', '上班', 9],
  ['otHours', '正常加班時數', 10],
  ['overtime', '平常加班薪資', 11],
  ['holidayHours', '节假日工時', 12],
  ['holiday', '节假日薪資', 13],
  ['attendance', '全勤獎', 14],
  ['transport', '交通補貼', 15],
  ['position', '職務津貼', 16],
  ['skill', '技術津貼', 17],
  ['lunch', '午餐伙食費', 18],
  ['otMeal', '加班伙食費', 21],
  ['contract', '合同津貼(3個月一次)5%', 22],
  ['annualLeave', '年假金额', 24],
  ['gross', '應付薪資', 25],
  ['advance', '扣除（25日半薪）', 26],
  ['pension', '退休金2%', 27],
  ['tax', '工资税', 28],
  ['net', '薪資尾款(SalaryBalance)', 29],
];
const CARD_HEADERS = ['工號', 'លេខកាត'];
/** Money cells that should never be blank on a staff row. */
const REQUIRED_MONEY = ['gross', 'advance', 'pension', 'tax', 'net'] as const;

export interface PayrollIssue {
  row: number;
  card: string;
  message: string;
}

export interface PayrollGroup {
  key: string;
  label: string;
  labelKh?: string;
  female: number;
  male: number;
  total: number;
  gross: number;
  net: number;
}

export interface PayrollReport {
  sheetName: string;
  company: string;
  /** "2026-07" from the title ("…2026年07月薪资明细表"), or null. */
  period: string | null;
  sections: string[];
  staff: PayrollStaff[];
  totals: {
    count: number;
    female: number;
    male: number;
    unknownGender: number;
    gross: number;
    net: number;
    advance: number;
    pension: number;
    tax: number;
    otHours: number;
    /** Joined in the payroll month. */
    newJoiners: number;
  };
  byCategory: PayrollGroup[];
  byDepartment: PayrollGroup[];
  /** Earnings that add up to gross, then "Other" for whatever gross holds beyond the columns. */
  components: { key: string; label: string; amount: number }[];
  bands: { label: string; female: number; male: number; total: number }[];
  issues: PayrollIssue[];
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** A cell's plain value: formula results, rich text and hyperlinks unwrapped. */
function plain(v: CellValue): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result as CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return null;
}

const text = (v: CellValue) => {
  const p = plain(v);
  if (p === null) return '';
  if (p instanceof Date) return isoDate(p) ?? '';
  return String(p).trim();
};

/** Number in a cell; blank and text count as 0, `blank` reports whether it was empty. */
function money(v: CellValue): { n: number; blank: boolean } {
  const p = plain(v);
  if (p === null || p === '') return { n: 0, blank: true };
  const n = typeof p === 'number' ? p : Number(String(p).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? { n, blank: false } : { n: 0, blank: true };
}

function isoDate(d: Date): string | null {
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dateOf(v: CellValue): string | null {
  const p = plain(v);
  if (p instanceof Date) return isoDate(p);
  // A serial number when the column isn't formatted as a date.
  if (typeof p === 'number' && p > 1000)
    return isoDate(new Date(Date.UTC(1899, 11, 30) + p * 864e5));
  if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p)) return p.slice(0, 10);
  return null;
}

function genderOf(v: string): Gender {
  const g = v.trim().toUpperCase();
  if (g === 'F' || g === 'ស្រី' || g === '女') return 'F';
  if (g === 'M' || g === 'ប្រុស' || g === '男') return 'M';
  return '?';
}

/**
 * The sheet's formula: OFF cards are office staff (foreign when the Khmer name column just
 * repeats the English name), SW cards are sewing workers, everyone else is production.
 */
export function categoryOf(card: string, nameEn: string, nameKh: string): PayrollCategory {
  const c = card.toUpperCase();
  if (c.startsWith('OFF'))
    return nameEn.trim().toLowerCase() === nameKh.trim().toLowerCase() ? 'foreign' : 'khmer';
  return c.startsWith('SW') ? 'sewing' : 'production';
}

export const departmentOf = (card: string) => /^[A-Za-z]+/.exec(card)?.[0].toUpperCase() ?? '?';

/** "ផ្នែក ： Chinese" → "Chinese". */
function sectionOf(t: string): string | null {
  if (!t.startsWith('ផ្នែក')) return null;
  return t.replace(/^ផ្នែក\s*[：:]?\s*/, '').trim() || null;
}

interface Layout {
  headerRow: number;
  cols: Record<Field, number>;
}

/** Finds the header row (the one holding the card no. title) and each field's column. */
function findLayout(ws: Worksheet): Layout | null {
  const last = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    let cardCol = 0;
    row.eachCell((cell, col) => {
      if (!cardCol && CARD_HEADERS.includes(squash(text(cell.value)))) cardCol = col;
    });
    if (!cardCol) continue;
    // The Chinese titles sit on the next row when this is the Khmer one.
    const zhRow = squash(text(row.getCell(cardCol).value)) === '工號' ? r : r + 1;
    const byTitle = new Map<string, number>();
    ws.getRow(zhRow).eachCell((cell, col) => {
      const t = squash(text(cell.value));
      if (t && !byTitle.has(t)) byTitle.set(t, col);
    });
    const cols = {} as Record<Field, number>;
    for (const [field, title, offset] of COLUMNS)
      cols[field] = byTitle.get(squash(title)) ?? cardCol + offset;
    return { headerRow: Math.max(r, zhRow), cols };
  }
  return null;
}

/** Names of the sheets that look like a payroll sheet. */
export function payrollSheets(wb: Workbook): string[] {
  return wb.worksheets.filter((ws) => findLayout(ws)).map((ws) => ws.name);
}

export function readPayroll(ws: Worksheet): PayrollReport {
  const layout = findLayout(ws);
  if (!layout)
    throw new Error(
      `“${ws.name}” has no staff header row (looked for the 工號 / លេខកាត column in the first 20 rows).`,
    );
  const { cols, headerRow } = layout;

  let company = '';
  let period: string | null = null;
  let section = '';
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell((cell) => {
      const t = text(cell.value);
      const m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(t);
      if (m && !period) {
        period = `${m[1]}-${m[2]!.padStart(2, '0')}`;
        company = t.slice(0, m.index).trim();
      }
      section = sectionOf(t) ?? section;
    });
  }

  const staff: PayrollStaff[] = [];
  const issues: PayrollIssue[] = [];
  const sections = new Set<string>();
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const at = (f: Field) => row.getCell(cols[f]).value;
    const card = text(at('card'));
    if (!card) {
      // A new department block ("ផ្នែក ： …") between staff rows.
      row.eachCell((cell) => {
        section = sectionOf(text(cell.value)) ?? section;
      });
      continue;
    }
    if (CARD_HEADERS.includes(squash(card))) continue; // header repeated on a later page
    const nameEn = text(at('nameEn'));
    const nameKh = text(at('nameKh'));
    const num = (f: Field) => money(at(f)).n;
    const pay = Object.fromEntries(PAY_COMPONENTS.map((c) => [c.key, num(c.key)])) as Record<
      PayComponent,
      number
    >;
    const s: PayrollStaff = {
      row: r,
      no: text(at('no')),
      card,
      nameEn,
      nameKh,
      gender: genderOf(text(at('gender'))),
      birthDate: dateOf(at('birthDate')),
      joinDate: dateOf(at('joinDate')),
      section,
      department: departmentOf(card),
      category: categoryOf(card, nameEn, nameKh),
      baseSalary: num('baseSalary'),
      daysWorked: num('daysWorked'),
      otHours: num('otHours'),
      holidayHours: num('holidayHours'),
      pay,
      gross: num('gross'),
      advance: num('advance'),
      pension: num('pension'),
      tax: num('tax'),
      net: num('net'),
    };
    if (section) sections.add(section);
    staff.push(s);

    const flag = (message: string) => issues.push({ row: r, card, message });
    if (s.gender === '?') flag(`Gender is “${text(at('gender')) || 'blank'}”, not F or M.`);
    const blanks = REQUIRED_MONEY.filter((f) => money(at(f)).blank);
    if (blanks.length)
      flag(`Blank ${blanks.map((f) => MONEY_LABEL[f]).join(', ')} (counted as 0).`);
    const expectNet = s.gross - s.advance - s.pension - s.tax;
    if (Math.abs(expectNet - s.net) > 0.02)
      flag(
        `Net pay ${s.net.toFixed(2)} ≠ gross − advance − pension − tax (${expectNet.toFixed(2)}).`,
      );
  }

  const seen = new Map<string, PayrollStaff>();
  for (const s of staff) {
    const key = s.card.toUpperCase();
    const first = seen.get(key);
    if (first)
      issues.push({ row: s.row, card: s.card, message: `Card no. also on row ${first.row}.` });
    else seen.set(key, s);
  }
  issues.sort((a, b) => a.row - b.row);

  return {
    sheetName: ws.name,
    company,
    period,
    sections: [...sections],
    staff,
    issues,
    ...summarise(staff, period),
  };
}

/** A saved month, worked out again exactly as when its file was imported. */
export function payrollFromSaved(m: PayrollMonthDetail): PayrollReport {
  const zero = Object.fromEntries(PAY_COMPONENTS.map((c) => [c.key, 0])) as Record<
    PayComponent,
    number
  >;
  const staff: PayrollStaff[] = m.staff.map((s) => ({ ...s, pay: { ...zero, ...s.pay } }));
  return {
    sheetName: m.sheetName,
    company: m.company,
    period: m.period,
    sections: m.sections,
    staff,
    issues: m.issues,
    ...summarise(staff, m.period),
  };
}

/** What "Save month" sends: the rows as read, not the totals (the server adds those up). */
export function payrollToSave(
  r: PayrollReport,
  extra: { fileName: string; clientId: string | null; period: string; replace?: boolean },
): PayrollMonthInput {
  return {
    period: extra.period,
    company: r.company,
    clientId: extra.clientId,
    sheetName: r.sheetName,
    fileName: extra.fileName,
    sections: r.sections,
    staff: r.staff,
    issues: r.issues,
    replace: extra.replace ?? false,
  };
}

const MONEY_LABEL: Record<(typeof REQUIRED_MONEY)[number], string> = {
  gross: 'gross pay',
  advance: 'half-month advance',
  pension: 'pension 2%',
  tax: 'salary tax',
  net: 'net pay',
};

const sum = (xs: PayrollStaff[], f: (s: PayrollStaff) => number) =>
  xs.reduce((t, s) => t + f(s), 0);

function group(key: string, label: string, xs: PayrollStaff[], labelKh?: string): PayrollGroup {
  return {
    key,
    label,
    ...(labelKh ? { labelKh } : {}),
    female: xs.filter((s) => s.gender === 'F').length,
    male: xs.filter((s) => s.gender === 'M').length,
    total: xs.length,
    gross: sum(xs, (s) => s.gross),
    net: sum(xs, (s) => s.net),
  };
}

/** Gross pay bands, in dollars (lower bound inclusive). */
const BANDS: [string, number][] = [
  ['Under $200', 0],
  ['$200 – $299', 200],
  ['$300 – $399', 300],
  ['$400 – $499', 400],
  ['$500 – $999', 500],
  ['$1,000 and over', 1000],
];

function summarise(staff: PayrollStaff[], period: string | null) {
  const byCategory = CATEGORIES.map((c) =>
    group(
      c.key,
      c.label,
      staff.filter((s) => s.category === c.key),
      c.labelKh,
    ),
  );
  const depts = [...new Set(staff.map((s) => s.department))];
  const byDepartment = depts
    .map((d) =>
      group(
        d,
        DEPARTMENTS[d] ?? d,
        staff.filter((s) => s.department === d),
      ),
    )
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

  const gross = sum(staff, (s) => s.gross);
  const components: PayrollReport['components'] = PAY_COMPONENTS.map((c) => ({
    key: c.key,
    label: c.label,
    amount: sum(staff, (s) => s.pay[c.key]),
  })).filter((c) => Math.abs(c.amount) >= 0.005);
  const other = gross - components.reduce((t, c) => t + c.amount, 0);
  if (Math.abs(other) >= 0.005)
    components.push({ key: 'other', label: 'Other (in gross, not itemised)', amount: other });

  const bands = BANDS.map(([label, from], i) => {
    const to = BANDS[i + 1]?.[1] ?? Infinity;
    const xs = staff.filter((s) => s.gross >= from && s.gross < to);
    return {
      label,
      female: xs.filter((s) => s.gender === 'F').length,
      male: xs.filter((s) => s.gender === 'M').length,
      total: xs.length,
    };
  });

  return {
    totals: {
      count: staff.length,
      female: staff.filter((s) => s.gender === 'F').length,
      male: staff.filter((s) => s.gender === 'M').length,
      unknownGender: staff.filter((s) => s.gender === '?').length,
      gross,
      net: sum(staff, (s) => s.net),
      advance: sum(staff, (s) => s.advance),
      pension: sum(staff, (s) => s.pension),
      tax: sum(staff, (s) => s.tax),
      otHours: sum(staff, (s) => s.otHours + s.holidayHours),
      newJoiners: period ? staff.filter((s) => s.joinDate?.startsWith(period)).length : 0,
    },
    byCategory,
    byDepartment,
    components,
    bands,
  };
}

/** Opens an .xlsx file. */
export async function loadWorkbook(file: File): Promise<Workbook> {
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('Only .xlsx files can be read. Open the file in Excel and Save As .xlsx.');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  return wb;
}

/** "JR APPAREL CO.,LTD" → the client "JR APPAREL" (longest client name the title starts with). */
export function matchClient(
  company: string,
  clients: { id: string; name: string; legalName: string | null }[],
): string | undefined {
  const t = company.toUpperCase();
  return clients
    .filter((c) => [c.name, c.legalName].some((n) => n && t.startsWith(n.toUpperCase())))
    .sort((a, b) => b.name.length - a.name.length)[0]?.id;
}

/** "2026-07" → "July 2026". */
export function periodLabel(period: string | null): string {
  if (!period) return '';
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
