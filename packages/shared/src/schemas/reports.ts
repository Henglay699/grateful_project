import { z } from 'zod';

/*
 * Reports → Payroll → Capacity report: the monthly report to the Ministry of Commerce on
 * production capacity ("ការវាយតម្លៃសមត្ថភាពផលិត…"). Staff counts and salaries come from the
 * imported payroll; point 10 comes from the client's export invoices of the month.
 */

export const productionReportQuerySchema = z.object({
  clientId: z.string().uuid(),
  /** "2026-08": export invoices dated in this month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
});

/** One product line of the month's exports, e.g. LADIES / PANT / KNITTED. */
export interface ProductionExportLine {
  /** "LADIES|PANT|KNITTED": identifies the line for OT overrides and unit weights. */
  key: string;
  kind: string;
  product: string;
  material: string;
  pcs: number;
  /** Invoice lines and shipments it was summed from. */
  invoiceLines: number;
  shipments: string[];
}

export interface ProductionReportData {
  clientId: string;
  month: string;
  lines: ProductionExportLine[];
  /** Destination countries of the month's exports (point 8). */
  destinations: string[];
  /** Point 7: fabric kinds and origin countries of the month's imports. */
  importMaterials: string[];
  importOrigins: string[];
  /** Saved setup for this client, or null before the first save. */
  profile: ProductionProfile | null;
}

const text = (max: number) => z.string().trim().max(max).default('');
const count = z.coerce.number().int().min(0).max(100000).default(0);

export const productionMachineSchema = z.object({
  labelKh: text(80),
  labelEn: text(80),
  unitKh: text(20),
  total: count,
  working: count,
});
export type ProductionMachine = z.output<typeof productionMachineSchema>;

/** What stays the same month to month (kept per client), plus each month's OT pcs. */
export const productionProfileSchema = z.object({
  companyName: text(160),
  address1: text(200),
  address2: text(200),
  phone: text(120),
  registration: text(120),
  registrationDate: text(20),
  regularHours: z.coerce.number().min(1).max(744).default(208),
  overtimeHours: z.coerce.number().min(0).max(744).default(30),
  regularHoursPerDay: z.coerce.number().min(1).max(24).default(8),
  overtimeHoursPerDay: z.coerce.number().min(0).max(24).default(2),
  regularTime: text(120),
  overtimeTime: text(120),
  /** Blank = the month's imports (materials, origin countries) or exports (destinations). */
  materials: text(200),
  materialOrigins: text(200),
  destinations: text(200),
  categories: text(200),
  machines: z.array(productionMachineSchema).max(20).default([]),
  /** % of each line's pcs counted as overtime production. */
  otSharePct: z.coerce.number().min(0).max(100).default(2.5),
  /** kg per unit, by product (PANT, PAJAMAS…). */
  unitWeights: z.record(z.string().max(60), z.coerce.number().min(0).max(1000)).default({}),
  /** Per month ("2026-08"), OT pcs typed for a line (by line key), replacing the share. */
  otPcs: z
    .record(
      z.string().regex(/^\d{4}-\d{2}$/),
      z.record(z.string().max(200), z.coerce.number().int().min(0)),
    )
    .default({}),
  conclusion: text(2000),
  informantName: text(80),
  informantTitle: text(80),
  officerName: text(80),
  approverName: text(80),
});
export type ProductionProfile = z.output<typeof productionProfileSchema>;
export type ProductionProfileInput = z.input<typeof productionProfileSchema>;

const KINDS: Record<string, string> = {
  LADIES: 'LADIES',
  LADY: 'LADIES',
  "LADIES'": 'LADIES',
  WOMEN: 'WOMEN',
  WOMENS: 'WOMEN',
  "WOMEN'S": 'WOMEN',
  MEN: 'MEN',
  MENS: 'MEN',
  "MEN'S": 'MEN',
  GIRLS: 'GIRLS',
  BOYS: 'BOYS',
  KIDS: 'KIDS',
  CHILDREN: 'KIDS',
  BABY: 'BABY',
  UNISEX: 'UNISEX',
};
const MATERIALS: Record<string, string> = {
  KNITTED: 'KNITTED',
  KNIT: 'KNITTED',
  KINTTED: 'KNITTED',
  KNITTING: 'KNITTED',
  WOVEN: 'WOVEN',
};
/** Plurals and misspellings seen on invoices → the report's word. */
const PRODUCTS: Record<string, string> = {
  PANTS: 'PANT',
  TROUSERS: 'PANT',
  TROUSER: 'PANT',
  PAJAMA: 'PAJAMAS',
  PYJAMAS: 'PAJAMAS',
  PYJAMA: 'PAJAMAS',
  SHORTS: 'SHORT',
  SHIRTS: 'SHIRT',
  SKIRTS: 'SKIRT',
  SKORTS: 'SKORT',
  DRESSES: 'DRESS',
  JACKETS: 'JACKET',
  JECKET: 'JACKET',
  TANKS: 'TANK',
  SWEATERS: 'SWEATER',
  GOWNS: 'GOWN',
  VESTS: 'VEST',
};

/**
 * An export invoice line's description → its report line. "LADIES 2PC PAJAMAS KNITTED 96% POLY
 * 4% SPANDEX" → LADIES / PAJAMAS / KNITTED. The fabric content (from the first "%") is dropped,
 * so are piece counts (2PC) and size letters; the HTS chapter gives the material when the
 * description doesn't (61 knitted, 62 woven).
 */
export function productionLineOf(
  description: string | null | undefined,
  htsCode?: string | null,
): Pick<ProductionExportLine, 'key' | 'kind' | 'product' | 'material'> {
  const head = (description ?? '')
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/\s(?=\S*\d+(\.\d+)?\s*%)/)[0]!;
  const words = head.split(/[\s,/]+/).filter(Boolean);
  let kind = '';
  let material = '';
  const rest: string[] = [];
  for (const w of words) {
    if (!kind && !rest.length && KINDS[w]) kind = KINDS[w]!;
    else if (MATERIALS[w]) material ||= MATERIALS[w]!;
    else if (/^\d+\s*PCS?$/.test(w) || /^\d+%?$/.test(w) || w.length === 1 || w === 'SET') continue;
    else rest.push(PRODUCTS[w] ?? w);
  }
  if (!material) {
    const chapter = (htsCode ?? '').replace(/\D/g, '').slice(0, 2);
    material = chapter === '61' ? 'KNITTED' : chapter === '62' ? 'WOVEN' : '';
  }
  const product = rest.join(' ') || 'OTHER';
  return { key: `${kind}|${product}|${material}`, kind, product, material };
}

/* ---------- Reports → Payroll: saved months ---------- */

export const PAYROLL_CATEGORIES = ['foreign', 'khmer', 'sewing', 'production'] as const;
export type PayrollCategory = (typeof PAYROLL_CATEGORIES)[number];
export type PayrollGender = 'F' | 'M' | '?';

const amount = z.number().finite().min(-10_000_000).max(10_000_000);
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** One staff row of an imported payroll sheet, as the Payroll page reads it. */
export const payrollStaffSchema = z.object({
  row: z.number().int().min(1),
  no: z.string().max(20),
  card: z.string().trim().min(1).max(40),
  nameEn: z.string().max(160),
  nameKh: z.string().max(160),
  gender: z.enum(['F', 'M', '?']),
  birthDate: isoDay,
  joinDate: isoDay,
  section: z.string().max(80),
  department: z.string().max(20),
  category: z.enum(PAYROLL_CATEGORIES),
  baseSalary: amount,
  daysWorked: amount,
  otHours: amount,
  holidayHours: amount,
  /** Earnings columns by key (basic, overtime, attendance…). */
  pay: z.record(z.string().max(30), amount),
  gross: amount,
  advance: amount,
  pension: amount,
  tax: amount,
  net: amount,
});
export type PayrollStaffRow = z.output<typeof payrollStaffSchema>;

export const payrollIssueSchema = z.object({
  row: z.number().int().min(0),
  card: z.string().max(40),
  message: z.string().max(300),
});

/** Payroll → Save month: everything needed to reopen the month as it was imported. */
export const payrollMonthInputSchema = z.object({
  period,
  company: z.string().trim().min(1, 'The payroll has no company name').max(160),
  /** The client the company was matched to, if any (restricted users see only their clients). */
  clientId: z.string().uuid().nullish(),
  sheetName: z.string().trim().max(100).default(''),
  fileName: z.string().trim().max(200).default(''),
  sections: z.array(z.string().max(80)).max(50).default([]),
  staff: z.array(payrollStaffSchema).min(1, 'The payroll has no staff rows').max(3000),
  issues: z.array(payrollIssueSchema).max(3000).default([]),
  /** Saving a month that is already saved replaces it only when this is true. */
  replace: z.boolean().default(false),
});
export type PayrollMonthInput = z.input<typeof payrollMonthInputSchema>;

/** A row of the saved months list. */
export interface PayrollMonthRow {
  id: string;
  period: string;
  company: string;
  clientId: string | null;
  sheetName: string;
  fileName: string;
  staffCount: number;
  female: number;
  male: number;
  gross: string;
  net: string;
  savedByName: string | null;
  savedAt: string;
}

export interface PayrollMonthDetail extends PayrollMonthRow {
  sections: string[];
  staff: PayrollStaffRow[];
  issues: z.output<typeof payrollIssueSchema>[];
}

/* ---------- Import & Export: the customs-declaration reports ---------- */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/**
 * Reports → Import & Export: a factory's import (or export) invoice lines whose customs
 * declaration is dated from the first day of `from` to the last day of `to`.
 */
export const customsReportQuerySchema = z
  .object({
    clientId: z.string().uuid(),
    direction: z.enum(['IMPORT', 'EXPORT']),
    from: monthSchema,
    to: monthSchema,
  })
  .refine((q) => q.from <= q.to, { message: 'From must not be after To', path: ['to'] });

/** One row of the report: one commercial invoice line under its customs declaration. */
export interface CustomsReportLine {
  declareNo: string;
  declareDate: string;
  shipmentId: string;
  reference: string;
  invoiceNo: string;
  description: string;
  unit: string | null;
  qty: number;
  netWeightKg: number;
  grossWeightKg: number;
  /** The line's FOB amount: the customs value. */
  value: number;
}

export interface CustomsReportData {
  clientId: string;
  direction: 'IMPORT' | 'EXPORT';
  from: string;
  to: string;
  companyName: string;
  /** VAT TIN ("អ.ត.ប"), e.g. L001-902501613. */
  vattin: string;
  lines: CustomsReportLine[];
  /** Shipments of the period with invoices but no I/E declaration yet: left off the report. */
  undeclared: { shipmentId: string; reference: string; date: string | null; lines: number }[];
}
