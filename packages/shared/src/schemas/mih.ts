import { z } from 'zod';
import { productionLineOf } from './reports';

/*
 * Reports → MIH: the monthly report to the Ministry of Industry, Science, Technology &
 * Innovation ("របាយការណ៍ជូនក្រសួងឧស្សាហកម្ម…"). One saved month per factory. Each month keeps only
 * its own figures; "from the beginning of the year" is always added up from the saved months by
 * product (never carried from the row above, which is how the Excel copies went wrong).
 */

/** The sheet's sales markets (page 2) and raw-material origins (page 2, lower table). */
export const MIH_MARKETS = ['US', 'CA', 'CN', 'EU', 'OTHER'] as const;
export const MIH_ORIGINS = ['CN', 'TW', 'HK', 'VN', 'OTHER'] as const;
export type MihMarket = (typeof MIH_MARKETS)[number];
export type MihOrigin = (typeof MIH_ORIGINS)[number];

export const MIH_MARKET_LABELS: Record<MihMarket, string> = {
  US: 'USA',
  CA: 'CANADA',
  CN: 'CHINA',
  EU: 'EU GROUP',
  OTHER: 'Other',
};
export const MIH_ORIGIN_LABELS: Record<MihOrigin, string> = {
  CN: 'China',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  VN: 'Vietnam',
  OTHER: 'Other',
};

/** EU members (ISO 2) — the sheet's "EU GROUP" column. The UK is "Other". */
const EU = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '),
);
export const mihMarketOf = (iso2: string | null | undefined): MihMarket => {
  const c = (iso2 ?? '').toUpperCase();
  return c === 'US' || c === 'CA' || c === 'CN' ? c : EU.has(c) ? 'EU' : 'OTHER';
};
export const mihOriginOf = (iso2: string | null | undefined): MihOrigin => {
  const c = (iso2 ?? '').toUpperCase();
  return (MIH_ORIGINS as readonly string[]).includes(c) ? (c as MihOrigin) : 'OTHER';
};

const text = (max: number) => z.string().trim().max(max).default('');
const num = z.coerce.number().finite().min(0).max(1e12).default(0);
const people = z.coerce.number().int().min(0).max(100000).default(0);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

const qv = z.object({ qty: num, value: num }).default({});
export type MihQV = z.output<typeof qv>;

const markets = z.object(
  Object.fromEntries(MIH_MARKETS.map((m) => [m, qv])) as Record<MihMarket, typeof qv>,
);
const origins = z.object(
  Object.fromEntries(MIH_ORIGINS.map((o) => [o, qv])) as Record<MihOrigin, typeof qv>,
);

/** A product line (page 1) with its sales by market (page 2). Export = the markets added up. */
export const mihProductSchema = z.object({
  kind: text(40),
  product: text(80),
  unit: text(20),
  domestic: qv,
  markets: markets.default({}),
});
export type MihProduct = z.output<typeof mihProductSchema>;

/** A raw-material group (machinery, raw material, accessory) by origin country. */
export const mihMaterialSchema = z.object({
  name: text(120),
  unit: text(20),
  origins: origins.default({}),
});
export type MihMaterial = z.output<typeof mihMaterialSchema>;

/** An electricity or water supply (page 3): the month's use and what it cost. */
export const mihUtilitySchema = z.object({
  name: text(80),
  unit: text(20),
  qty: num,
  unitPrice: num,
  value: num,
});
export type MihUtility = z.output<typeof mihUtilitySchema>;

export const mihWasteSchema = z.object({ name: text(80), unit: text(20), qty: num });
export type MihWaste = z.output<typeof mihWasteSchema>;

/** Everything one month's report shows. */
export const mihMonthDataSchema = z.object({
  companyName: text(160),
  employees: people,
  female: people,
  salary: num,
  totalAsset: num,
  fixedAsset: num,
  products: z.array(mihProductSchema).max(60).default([]),
  materials: z.array(mihMaterialSchema).max(30).default([]),
  energy: z.array(mihUtilitySchema).max(10).default([]),
  water: z.array(mihUtilitySchema).max(10).default([]),
  waste: z.array(mihWasteSchema).max(10).default([]),
  /** "ថ្ងៃទី 15 ខែ កញ្ញា ឆ្នាំ2026", as signed. */
  reportDate: text(80),
  directorName: text(80),
  reporterName: text(80),
  notes: text(2000),
});
export type MihMonthData = z.output<typeof mihMonthDataSchema>;
export type MihMonthDataInput = z.input<typeof mihMonthDataSchema>;

export const mihMonthInputSchema = z.object({
  period,
  clientId: z.string().uuid(),
  data: mihMonthDataSchema,
  /** Where it came from: typed in the app, or read from the Excel copy. */
  source: z.enum(['app', 'excel']).default('app'),
  fileName: text(200),
  /** Notes from reading the Excel copy (e.g. its own year-to-date that didn't add up). */
  issues: z.array(z.string().max(400)).max(200).default([]),
  /** Saving a month that is already saved replaces it only when this is true. */
  replace: z.boolean().default(false),
});
export type MihMonthInput = z.input<typeof mihMonthInputSchema>;

export const mihYearQuerySchema = z.object({
  clientId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2100),
});
export const mihDraftQuerySchema = z.object({ clientId: z.string().uuid(), month: period });

/** A row of the saved months list. */
export interface MihMonthRow {
  id: string;
  period: string;
  clientId: string;
  clientName: string;
  employees: number;
  female: number;
  salary: string;
  exportQty: string;
  exportValue: string;
  source: 'app' | 'excel';
  fileName: string;
  savedByName: string | null;
  savedAt: string;
}

export interface MihMonth extends MihMonthRow {
  data: MihMonthData;
  issues: string[];
}

/** The payroll saved for a month (Reports → Payroll), to compare head counts and salary. */
export interface MihPayrollSummary {
  period: string;
  staffCount: number;
  female: number;
  gross: string;
}

/** A client's year: its saved months (in order) and the payroll months saved for it. */
export interface MihYear {
  clientId: string;
  year: number;
  months: MihMonth[];
  payroll: MihPayrollSummary[];
}

/** A new month filled in from what the app already has. */
export interface MihDraft {
  clientId: string;
  month: string;
  data: MihMonthData;
  sources: {
    payrollPeriod: string | null;
    exportLines: number;
    exportShipments: string[];
    importLines: number;
    importShipments: string[];
    /** The earlier saved month the factory details, prices and row names were taken from. */
    carriedFrom: string | null;
  };
}

/* ---------- Adding months up ---------- */

/** "LADIES" + "PANTS" → "LADIES|PANT", so PANT and PANTS count as one line across months. */
export function mihProductKey(p: Pick<MihProduct, 'kind' | 'product'>): string {
  const l = productionLineOf(`${p.kind} ${p.product}`);
  return `${l.kind}|${l.product}`;
}

/** "II. RAW MATERIAL" → "RAW MATERIAL"; "I. MACHINERIES &. EQUIPMENTS" → "MACHINERIES & EQUIPMENTS". */
export function mihMaterialKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/^\s*[IVX]+\.\s*/, '')
    .replace(/&\./g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const nameKey = (name: string) => name.toUpperCase().replace(/\s+/g, ' ').trim();

export const sumQV = (list: MihQV[]): MihQV => ({
  qty: list.reduce((t, x) => t + x.qty, 0),
  value: list.reduce((t, x) => t + x.value, 0),
});
export const productExport = (p: MihProduct): MihQV => sumQV(MIH_MARKETS.map((m) => p.markets[m]));
export const materialTotal = (m: MihMaterial): MihQV => sumQV(MIH_ORIGINS.map((o) => m.origins[o]));

/**
 * Every figure of a month, flat by key ("p|LADIES|PANT|US", "m|RAW MATERIAL|CN", "e|EDC",
 * "w|PPWSA", "x|SOLID"…), so months can be added up whatever order their rows are in.
 */
export function mihFigures(d: MihMonthData): Map<string, MihQV> {
  const out = new Map<string, MihQV>();
  const add = (key: string, v: MihQV) => {
    const t = out.get(key) ?? { qty: 0, value: 0 };
    out.set(key, { qty: t.qty + v.qty, value: t.value + v.value });
  };
  for (const p of d.products) {
    const k = `p|${mihProductKey(p)}`;
    add(`${k}|DOMESTIC`, p.domestic);
    for (const m of MIH_MARKETS) add(`${k}|${m}`, p.markets[m]);
    add(`${k}|EXPORT`, productExport(p));
  }
  for (const m of d.materials) {
    const k = `m|${mihMaterialKey(m.name)}`;
    for (const o of MIH_ORIGINS) add(`${k}|${o}`, m.origins[o]);
    add(`${k}|TOTAL`, materialTotal(m));
  }
  for (const e of d.energy) add(`e|${nameKey(e.name)}`, e);
  for (const w of d.water) add(`w|${nameKey(w.name)}`, w);
  for (const w of d.waste) add(`x|${nameKey(w.name)}`, { qty: w.qty, value: 0 });
  return out;
}

/** The months added up, figure by figure. */
export function mihTotals(months: MihMonthData[]): Map<string, MihQV> {
  const out = new Map<string, MihQV>();
  for (const d of months)
    for (const [k, v] of mihFigures(d)) {
      const t = out.get(k) ?? { qty: 0, value: 0 };
      out.set(k, { qty: t.qty + v.qty, value: t.value + v.value });
    }
  return out;
}

export const productKeyOf = (
  p: Pick<MihProduct, 'kind' | 'product'>,
  col: MihMarket | 'DOMESTIC' | 'EXPORT',
) => `p|${mihProductKey(p)}|${col}`;
export const materialKeyOf = (m: Pick<MihMaterial, 'name'>, col: MihOrigin | 'TOTAL') =>
  `m|${mihMaterialKey(m.name)}|${col}`;
export const utilityKeyOf = (section: 'e' | 'w' | 'x', name: string) =>
  `${section}|${nameKey(name)}`;

/** The month's export, all products. */
export const mihExportTotal = (d: MihMonthData): MihQV =>
  sumQV(d.products.map((p) => productExport(p)));

/* ---------- Checks ---------- */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2
    : 0;
};
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const monthName = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const fmt = (n: number, dp = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * What to look at before sending the month: a price per piece far from the product's other
 * months, values typed the same as quantities, meter readings copied from last month, staff
 * figures that differ from the saved payroll, and earlier months missing from the year-to-date.
 */
export function mihChecks(
  period: string,
  d: MihMonthData,
  year: { period: string; data: MihMonthData }[],
  payroll: MihPayrollSummary | null,
): string[] {
  const out: string[] = [];
  const others = year.filter((m) => m.period !== period);

  // Prices per piece of the other months, by product. With fewer than two to go by, the
  // product is compared with every line of the year instead (one wrong month can't vouch).
  const priced = others.flatMap((m) =>
    m.data.products
      .map((q) => ({ key: mihProductKey(q), ex: productExport(q) }))
      .filter((x) => x.ex.qty > 0 && x.ex.value > 0)
      .map((x) => ({ key: x.key, price: x.ex.value / x.ex.qty })),
  );
  for (const p of d.products) {
    const ex = productExport(p);
    if (ex.qty <= 0 || ex.value <= 0) continue;
    const own = priced.filter((x) => x.key === mihProductKey(p)).map((x) => x.price);
    const usual = median(own.length >= 2 ? own : priced.map((x) => x.price));
    const price = ex.value / ex.qty;
    if (usual > 0 && (price > usual * 3 || price < usual / 3))
      out.push(
        `${p.kind} ${p.product}: $${fmt(price, 2)} a piece (${fmt(ex.qty)} pcs for $${fmt(ex.value, 2)}), against about $${fmt(usual, 2)} ${own.length >= 2 ? 'in its other months' : 'for the year’s garments'}. Check the value.`,
      );
  }

  for (const m of d.materials) {
    const t = materialTotal(m);
    if (t.qty >= 1000 && Math.abs(t.qty - t.value) < 0.005)
      out.push(
        `${mihMaterialKey(m.name)}: the value ($${fmt(t.value, 2)}) is exactly the quantity. Was the amount typed in both columns?`,
      );
  }

  const prev = others.filter((m) => m.period < period).at(-1);
  if (prev && prev.period.slice(0, 4) === period.slice(0, 4)) {
    for (const [section, label] of [
      ['energy', 'Electricity'],
      ['water', 'Water'],
    ] as const)
      for (const u of d[section]) {
        const before = prev.data[section].find((x) => nameKey(x.name) === nameKey(u.name));
        if (u.qty > 0 && before && before.qty === u.qty)
          out.push(
            `${label} ${u.name}: ${fmt(u.qty)} ${u.unit}, the same as ${monthName(prev.period)}. Check this month's bill.`,
          );
      }
  }

  if (payroll) {
    const diffs: string[] = [];
    if (payroll.staffCount !== d.employees)
      diffs.push(`${payroll.staffCount} staff (here ${d.employees})`);
    if (payroll.female !== d.female) diffs.push(`${payroll.female} women (here ${d.female})`);
    if (Math.abs(Number(payroll.gross) - d.salary) >= 0.01)
      diffs.push(`$${fmt(Number(payroll.gross), 2)} salary (here $${fmt(d.salary, 2)})`);
    if (diffs.length)
      out.push(`The payroll saved for ${monthName(period)} has ${diffs.join(', ')}.`);
  }

  const m = Number(period.slice(5, 7));
  const have = new Set(year.map((x) => x.period));
  const missing = Array.from(
    { length: m - 1 },
    (_, i) => `${period.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
  ).filter((p) => !have.has(p));
  if (missing.length)
    out.push(
      `The year-to-date leaves out ${missing.map(monthName).join(', ')}: ${missing.length === 1 ? 'that month isn’t' : 'those months aren’t'} saved.`,
    );
  return out;
}
