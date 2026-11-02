import {
  productionProfileSchema,
  type ProductionMachine,
  type ProductionProfile,
  type ProductionReportData,
} from '@gs/shared';
import { CATEGORIES, type PayrollReport } from './payroll';

/*
 * Reports → Payroll → Capacity report: everything the monthly report to the Ministry of
 * Commerce shows, worked out from the imported payroll (points 4–5), the month's export invoices
 * (points 10–11) and the saved setup (the rest). Shared by the screen, the print page and Excel.
 */

export const KH_MONTHS = [
  'មករា',
  'កុម្ភៈ',
  'មីនា',
  'មេសា',
  'ឧសភា',
  'មិថុនា',
  'កក្កដា',
  'សីហា',
  'កញ្ញា',
  'តុលា',
  'វិច្ឆិកា',
  'ធ្នូ',
];

/** 2026 → "២០២៦". */
export const khmerDigits = (v: string | number) =>
  String(v).replace(/\d/g, (d) => '០១២៣៤៥៦៧៨៩'[Number(d)]!);

/** "2026-08" → "ខែ សីហា ឆ្នាំ ២០២៦". */
export function khmerMonth(month: string): string {
  const [y, m] = month.split('-');
  return `ខែ ${KH_MONTHS[Number(m) - 1] ?? ''} ឆ្នាំ ${khmerDigits(y ?? '')}`;
}

/** The sheet's machines (point 9), counts left for the factory to fill in. */
export const DEFAULT_MACHINES: ProductionMachine[] = [
  { labelKh: 'តុកាត់', labelEn: 'Cutting Table', unitKh: 'តុ', total: 0, working: 0 },
  { labelKh: 'ម៉ាស៊ីនកាត់', labelEn: 'Cutting Machine', unitKh: 'គ្រឿង', total: 0, working: 0 },
  { labelKh: 'ម៉ាស៊ីនដេរ', labelEn: 'Sewing Machine', unitKh: 'គ្រឿង', total: 0, working: 0 },
  { labelKh: 'ម៉ាស៊ីនផុង', labelEn: 'Over-lock Machine', unitKh: 'គ្រឿង', total: 0, working: 0 },
  { labelKh: 'ម៉ាស៊ីនផ្សេងៗ', labelEn: 'Other Machine', unitKh: 'គ្រឿង', total: 0, working: 0 },
];

/** A first-time setup: the sheet's hours and wording, the factory's name from the payroll. */
export function defaultProfile(companyName: string): ProductionProfile {
  return productionProfileSchema.parse({
    companyName,
    regularTime: '7:00AM-11:00AM, ថ្ងៃ 12:00PM-4:00PM',
    overtimeTime: '4:00PM-6:00PM',
    machines: DEFAULT_MACHINES,
  });
}

export interface CapacityLine {
  key: string;
  kind: string;
  product: string;
  material: string;
  /** Export pcs of the month. */
  pcs: number;
  /** Counted as overtime production: typed for the month, else the OT share. */
  otPcs: number;
  otTyped: boolean;
  regularPerHour: number;
  overtimePerHour: number;
}

/** One row of point 10 (and, with weights, point 11). */
export interface CapacityRow {
  key: string;
  kind: string;
  product: string;
  material: string;
  overtime: boolean;
  /** Hours a day (8 regular, 2 overtime). */
  hoursPerDay: number;
  perHour: number;
  perDay: number;
  perMonth: number;
  /** Point 11: kg per unit and per dozen, and the month's weight. */
  unitWeight: number;
  dozenWeight: number;
  totalWeight: number;
}

export interface StaffRow {
  labelKh: string;
  male: number;
  female: number;
  total: number;
}

export interface CapacityModel {
  month: string;
  titleKh: string;
  profile: ProductionProfile;
  /** Point 4: the four categories, then the workers (sewing + production). */
  staff: StaffRow[];
  /** Point 5: gross salary of the same rows. */
  salaries: { labelKh: string; amount: number }[];
  materials: string;
  materialOrigins: string;
  destinations: string;
  machines: ProductionMachine[];
  machinesTotal: number;
  machinesWorking: number;
  lines: CapacityLine[];
  rows: CapacityRow[];
  exportTotal: number;
  capacityTotal: number;
  weightTotal: number;
}

const WORKERS = 'កម្មករសរុប';

export function buildCapacityModel(
  payroll: PayrollReport,
  data: Pick<
    ProductionReportData,
    'month' | 'lines' | 'destinations' | 'importMaterials' | 'importOrigins'
  >,
  profile: ProductionProfile,
): CapacityModel {
  const p = profile;
  const cat = (key: string) => payroll.byCategory.find((g) => g.key === key);
  const staff: StaffRow[] = CATEGORIES.map((c) => {
    const g = cat(c.key);
    return { labelKh: c.labelKh, male: g?.male ?? 0, female: g?.female ?? 0, total: g?.total ?? 0 };
  });
  const workers = staff.slice(2);
  staff.push({
    labelKh: WORKERS,
    male: workers.reduce((t, r) => t + r.male, 0),
    female: workers.reduce((t, r) => t + r.female, 0),
    total: workers.reduce((t, r) => t + r.total, 0),
  });
  const salaries = CATEGORIES.map((c) => ({ labelKh: c.labelKh, amount: cat(c.key)?.gross ?? 0 }));
  salaries.push({
    labelKh: WORKERS,
    amount: (cat('sewing')?.gross ?? 0) + (cat('production')?.gross ?? 0),
  });

  const typed = p.otPcs[data.month] ?? {};
  const lines: CapacityLine[] = data.lines.map((l) => {
    const otTyped = typed[l.key] !== undefined;
    const otPcs = Math.min(
      l.pcs,
      otTyped ? typed[l.key]! : Math.round((l.pcs * p.otSharePct) / 100),
    );
    return {
      key: l.key,
      kind: l.kind,
      product: l.product,
      material: l.material,
      pcs: l.pcs,
      otPcs,
      otTyped,
      regularPerHour: Math.round((l.pcs - otPcs) / p.regularHours),
      overtimePerHour: p.overtimeHours ? Math.round(otPcs / p.overtimeHours) : 0,
    };
  });

  // As on the sheet: every line's regular hours first, then the overtime rows.
  const row = (l: CapacityLine, overtime: boolean): CapacityRow => {
    const perHour = overtime ? l.overtimePerHour : l.regularPerHour;
    const perMonth = perHour * (overtime ? p.overtimeHours : p.regularHours);
    const unitWeight = p.unitWeights[l.product] ?? 0;
    return {
      key: l.key,
      kind: l.kind,
      product: l.product,
      material: l.material,
      overtime,
      hoursPerDay: overtime ? p.overtimeHoursPerDay : p.regularHoursPerDay,
      perHour,
      perDay: perHour * (overtime ? p.overtimeHoursPerDay : p.regularHoursPerDay),
      perMonth,
      unitWeight,
      dozenWeight: round(unitWeight * 12, 3),
      totalWeight: round(perMonth * unitWeight, 2),
    };
  };
  const rows = [
    ...lines.filter((l) => l.regularPerHour > 0).map((l) => row(l, false)),
    ...lines.filter((l) => l.overtimePerHour > 0).map((l) => row(l, true)),
  ];

  const machines = p.machines;
  return {
    month: data.month,
    titleKh: `ការវាយតម្លៃសមត្ថភាពផលិត បទដ្ឋានផលិត និងបំរែបំរួលសង្វាក់ផលិតកម្មប្រចាំ${khmerMonth(data.month)}`,
    profile: p,
    staff,
    salaries,
    // "KNITTED" → "KNITTED FABRIC", as the sheet words it.
    materials:
      p.materials ||
      [...new Set(data.importMaterials.map((m) => (/FABRIC$/.test(m) ? m : `${m} FABRIC`)))].join(
        ', ',
      ),
    materialOrigins: p.materialOrigins || data.importOrigins.join(', '),
    destinations: p.destinations || data.destinations.join(', '),
    machines,
    machinesTotal: machines.reduce((t, m) => t + m.total, 0),
    machinesWorking: machines.reduce((t, m) => t + m.working, 0),
    lines,
    rows,
    exportTotal: lines.reduce((t, l) => t + l.pcs, 0),
    capacityTotal: rows.reduce((t, r) => t + r.perMonth, 0),
    weightTotal: round(
      rows.reduce((t, r) => t + r.totalWeight, 0),
      2,
    ),
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** "8" → "8:00", as the sheet shows the hours. */
export const hoursLabel = (h: number) =>
  `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
