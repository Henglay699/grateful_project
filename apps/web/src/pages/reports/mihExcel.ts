import type { CellValue, Workbook, Worksheet } from 'exceljs';
import {
  MIH_MARKETS,
  MIH_ORIGINS,
  materialKeyOf,
  mihFigures,
  mihMonthDataSchema,
  productKeyOf,
  utilityKeyOf,
  type MihMarket,
  type MihMonthData,
  type MihQV,
} from '@gs/shared';

/*
 * Reports → MIH → Import Excel: reads the factory's own workbook (one sheet per month, "1-JAN" …
 * "9-SEP") into saved months. Only each month's own figures are taken; the sheet's "from the
 * beginning of the year" columns are compared with the months added up, and every difference is
 * noted on the month, since those formulas pointed at the wrong rows of the sheet before.
 */

export interface MihSheetMonth {
  sheet: string;
  period: string;
  data: MihMonthData;
  issues: string[];
}

export interface MihWorkbook {
  company: string;
  months: MihSheetMonth[];
}

const MON = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');

/** Runs of spaces, including the zero-width ones (U+200B) the sheet pads Khmer text with. */
const PADDING = new RegExp(String.raw`[\s${String.fromCharCode(0x200b)}]+`, 'g');

/** A cell's value as typed or as last worked out by Excel. */
function raw(v: CellValue): unknown {
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('formula' in v || 'sharedFormula' in v) return null;
  }
  return v;
}
const txt = (ws: Worksheet, r: number, c: number) => {
  const v = raw(ws.getCell(r, c).value);
  return v == null ? '' : String(v).replace(PADDING, ' ').trim();
};
const num = (ws: Worksheet, r: number, c: number) => {
  const v = raw(ws.getCell(r, c).value);
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const qv = (ws: Worksheet, r: number, c: number): MihQV => ({
  qty: num(ws, r, c),
  value: num(ws, r, c + 1),
});

/** The first row (from `from`) where `test` holds for the text of column `col`. */
function findRow(ws: Worksheet, col: number, test: (t: string) => boolean, from = 1, to = 260) {
  for (let r = from; r <= Math.min(to, ws.rowCount); r++) if (test(txt(ws, r, col))) return r;
  return 0;
}
/** Rows from `from` up to (not including) the "សរុប"/"Total" row in column `col`. */
function rowsUntilTotal(ws: Worksheet, from: number, col: number) {
  const rows: number[] = [];
  for (let r = from; r <= from + 60; r++) {
    const t = txt(ws, r, col);
    if (t === 'សរុប' || /^total$/i.test(t)) break;
    rows.push(r);
  }
  return rows;
}

/** "1-JAN" + "ឆ្នាំ 2026" → "2026-01"; null for a sheet that isn't a month. */
function periodOf(ws: Worksheet): string | null {
  const m = /^\s*(\d{1,2})\s*-\s*([A-Z]{3})/i.exec(ws.name);
  const idx = m ? MON.indexOf(m[2]!.toUpperCase()) : -1;
  if (idx < 0) return null;
  const head = [6, 7].flatMap((r) => Array.from({ length: 12 }, (_, c) => txt(ws, r, c + 1)));
  const year = head.join(' ').match(/20\d\d/)?.[0];
  return year ? `${year}-${String(idx + 1).padStart(2, '0')}` : null;
}

interface Filed {
  products: Map<string, MihQV>;
  materials: Map<string, MihQV>;
  utilities: Map<string, MihQV>;
}

/** One month's sheet. Null when it doesn't look like the MIH report. */
export function readMihSheet(
  ws: Worksheet,
): (MihSheetMonth & { company: string; filed: Filed }) | null {
  const period = periodOf(ws);
  const domesticRow = findRow(ws, 4, (t) => /Domestic/i.test(t));
  if (!period || !domesticRow) return null;
  const issues: string[] = [];
  const filed: Filed = { products: new Map(), materials: new Map(), utilities: new Map() };

  const nameRow = findRow(ws, 1, (t) => /Name of Factory/i.test(t), 1, 20);
  const company =
    /Name of Factory:\s*(.+?)\s*(Factory Address|$)/i.exec(txt(ws, nameRow, 1))?.[1]?.trim() ?? '';
  const staffRow = findRow(ws, 1, (t) => t.startsWith('ចំនួនពលកម្មសរុប'), 1, 30);
  const assetRow = findRow(ws, 1, (t) => /Total Asset/i.test(t), 1, 30);

  // Page 1: products (A kind, B product, C unit; H/J domestic, I/K export; L–O the year so far).
  type Line = { kind: string; product: string; unit: string; domestic: MihQV; exportQV: MihQV };
  const lines: Line[] = [];
  for (const r of rowsUntilTotal(ws, domesticRow + 1, 1)) {
    const product = txt(ws, r, 2);
    if (!product) continue;
    const line: Line = {
      kind: txt(ws, r, 1),
      product,
      unit: txt(ws, r, 3),
      domestic: { qty: num(ws, r, 8), value: num(ws, r, 10) },
      exportQV: { qty: num(ws, r, 9), value: num(ws, r, 11) },
    };
    lines.push(line);
    filed.products.set(productKeyOf(line, 'EXPORT'), {
      qty: num(ws, r, 13),
      value: num(ws, r, 15),
    });
  }

  // Page 2: the same products by market (E–N in pairs).
  const marketHead = findRow(ws, 5, (t) => t === 'USA', domesticRow);
  const split = new Map<string, Record<MihMarket, MihQV>>();
  if (marketHead)
    for (const r of rowsUntilTotal(ws, marketHead + 2, 2)) {
      const key = `${txt(ws, r, 2)}|${txt(ws, r, 3)}`.toUpperCase();
      split.set(
        key,
        Object.fromEntries(MIH_MARKETS.map((m, i) => [m, qv(ws, r, 5 + i * 2)])) as Record<
          MihMarket,
          MihQV
        >,
      );
    }

  const products = lines.map((l) => {
    const label = `${l.kind} ${l.product}`.trim();
    const markets = split.get(`${l.kind}|${l.product}`.toUpperCase());
    const sum = (f: (x: MihQV) => number) =>
      markets ? MIH_MARKETS.reduce((t, m) => t + f(markets[m]), 0) : 0;
    const round = (n: number) => Math.round(n * 100) / 100;
    const out = Object.fromEntries(MIH_MARKETS.map((m) => [m, { qty: 0, value: 0 }])) as Record<
      MihMarket,
      MihQV
    >;
    const ex = l.exportQV;
    if (ex.qty === 0 && ex.value === 0) {
      if (sum((x) => x.qty) || sum((x) => x.value))
        issues.push(
          `${label}: nothing on page 1 but ${sum((x) => x.qty)} pcs / $${round(sum((x) => x.value))} on page 2 (markets). Page 1 kept.`,
        );
      return { kind: l.kind, product: l.product, unit: l.unit, domestic: l.domestic, markets: out };
    }
    // Page 1 is what the report adds up; page 2 only says which market it went to.
    const biggest = markets
      ? [...MIH_MARKETS].sort(
          (a, b) => markets[b].value - markets[a].value || markets[b].qty - markets[a].qty,
        )[0]!
      : 'US';
    if (markets && Math.abs(sum((x) => x.qty) - ex.qty) < 0.005) {
      for (const m of MIH_MARKETS) out[m] = { ...markets[m] };
      const gap = round(ex.value - sum((x) => x.value));
      if (gap !== 0) {
        out[biggest].value = round(out[biggest].value + gap);
        issues.push(
          `${label}: page 2 adds up to $${round(sum((x) => x.value))}, page 1 says $${ex.value}. The ${gap > 0 ? 'missing' : 'extra'} $${Math.abs(gap).toFixed(2)} was put on ${biggest}.`,
        );
      }
    } else {
      out[biggest] = { ...ex };
      issues.push(
        markets
          ? `${label}: page 1 says ${ex.qty} pcs, page 2 (markets) ${round(sum((x) => x.qty))} pcs. Page 1's ${ex.qty} pcs / $${ex.value} kept, all under ${biggest}. Check the split.`
          : `${label}: not on page 2 (markets); put under US.`,
      );
    }
    return { kind: l.kind, product: l.product, unit: l.unit, domestic: l.domestic, markets: out };
  });

  // Raw materials by origin (E–N in pairs, China first).
  const originHead = findRow(ws, 5, (t) => t === 'ចិន', marketHead || domesticRow);
  const materials = originHead
    ? rowsUntilTotal(ws, originHead + 2, 2)
        .filter((r) => txt(ws, r, 2))
        .map((r) => {
          const m = {
            name: txt(ws, r, 2),
            unit: txt(ws, r, 4),
            origins: Object.fromEntries(MIH_ORIGINS.map((o, i) => [o, qv(ws, r, 5 + i * 2)])),
          };
          filed.materials.set(materialKeyOf(m, 'TOTAL'), qv(ws, r, 15));
          return m;
        })
    : [];

  // Electricity and water: B name, E unit, I/J the month, K/M the year so far.
  const utility = (section: 'e' | 'w', title: RegExp) => {
    const head = findRow(ws, 2, (t) => title.test(t), originHead || domesticRow);
    if (!head) return [];
    return rowsUntilTotal(ws, head + 3, 2)
      .filter((r) => txt(ws, r, 2))
      .map((r) => {
        const qty = num(ws, r, 9);
        const value = num(ws, r, 10);
        const name = txt(ws, r, 2);
        filed.utilities.set(utilityKeyOf(section, name), {
          qty: num(ws, r, 11),
          value: num(ws, r, 13),
        });
        return {
          name,
          unit: txt(ws, r, 5),
          qty,
          value,
          unitPrice: qty ? Math.round((value / qty) * 10000) / 10000 : 0,
        };
      });
  };

  // Waste: B name, D unit, G the month.
  const wasteHead = findRow(ws, 2, (t) => t === 'ប្រភេទសំណល់', domesticRow);
  const waste = wasteHead
    ? rowsUntilTotal(ws, wasteHead + 1, 2)
        .filter((r) => txt(ws, r, 2))
        .map((r) => ({ name: txt(ws, r, 2), unit: txt(ws, r, 4), qty: num(ws, r, 7) }))
    : [];

  // Signatures: the date line, then the director and reporter names under "Director".
  const dateRow = findRow(ws, 11, (t) => t.startsWith('ថ្ងៃទី'), domesticRow);
  const directorRow = findRow(ws, 11, (t) => /^Director$/i.test(t), domesticRow);
  const namesRow = directorRow ? findRow(ws, 11, (t) => !!t, directorRow + 1, directorRow + 12) : 0;

  const data = mihMonthDataSchema.parse({
    companyName: company,
    employees: num(ws, staffRow, 3),
    female: num(ws, staffRow, 6),
    salary: num(ws, staffRow, 10),
    totalAsset: assetRow ? num(ws, assetRow, 4) : 0,
    fixedAsset: assetRow ? num(ws, assetRow, 10) : 0,
    products,
    materials,
    energy: utility('e', /ថាមពល/),
    water: utility('w', /ប្រើប្រាស់ទឹក/),
    waste,
    reportDate: dateRow ? txt(ws, dateRow, 11) : '',
    directorName: namesRow ? txt(ws, namesRow, 11) : '',
    reporterName: namesRow ? txt(ws, namesRow, 14) : '',
  });
  return { sheet: ws.name, period, company, data, issues, filed };
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const amount = (qty: number, unit: string, value: number) =>
  `${fmt(qty)}${unit ? ` ${unit}` : ''} / $${fmt(value)}`;

/**
 * Every month sheet of the workbook, in month order. Each month's own year-to-date columns are
 * checked against the months before it added up (so only when the earlier months are there).
 */
export function readMihWorkbook(wb: Workbook): MihWorkbook {
  const read = wb.worksheets
    .map(readMihSheet)
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => a.period.localeCompare(b.period));
  // A month appearing twice: the later sheet wins.
  const byPeriod = new Map(read.map((m) => [m.period, m]));
  const months = [...byPeriod.values()];

  const running = new Map<string, MihQV>();
  for (const m of months) {
    for (const [k, v] of mihFigures(m.data)) {
      const t = running.get(k) ?? { qty: 0, value: 0 };
      running.set(k, { qty: t.qty + v.qty, value: t.value + v.value });
    }
    const complete = Array.from(
      { length: Number(m.period.slice(5)) - 1 },
      (_, i) => `${m.period.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`,
    ).every((p) => byPeriod.has(p));
    if (!complete) continue;
    const compare = (label: string, filed: MihQV, key: string, unit: string) => {
      const sum = running.get(key) ?? { qty: 0, value: 0 };
      // Left blank on the sheet: nothing was filed to compare.
      if (filed.qty === 0 && filed.value === 0) return;
      if (Math.abs(sum.qty - filed.qty) > 0.5 || Math.abs(sum.value - filed.value) > 0.5)
        m.issues.push(
          `The sheet's year-to-date for ${label} was ${amount(filed.qty, unit, filed.value)}; the months add up to ${amount(sum.qty, unit, sum.value)}.`,
        );
    };
    for (const p of m.data.products) {
      const filed = m.filed.products.get(productKeyOf(p, 'EXPORT'));
      if (filed)
        compare(`${p.kind} ${p.product}`.trim(), filed, productKeyOf(p, 'EXPORT'), p.unit || 'pcs');
    }
    for (const x of m.data.materials) {
      const filed = m.filed.materials.get(materialKeyOf(x, 'TOTAL'));
      if (filed) compare(x.name, filed, materialKeyOf(x, 'TOTAL'), x.unit);
    }
    for (const [section, rows] of [
      ['e', m.data.energy],
      ['w', m.data.water],
    ] as const)
      for (const u of rows) {
        const key = utilityKeyOf(section, u.name);
        const filed = m.filed.utilities.get(key);
        if (filed) compare(u.name, filed, key, u.unit);
      }
  }
  return {
    company: months.find((m) => m.company)?.company ?? '',
    months: months.map(({ sheet, period, data, issues }) => ({ sheet, period, data, issues })),
  };
}
