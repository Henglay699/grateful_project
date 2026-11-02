import { describe, expect, it } from 'vitest';
import type { ProductionExportLine } from '@gs/shared';
import { buildCapacityModel, defaultProfile, khmerMonth } from './capacity';
import type { PayrollReport } from './payroll';

const group = (key: string, female: number, male: number, gross: number) => ({
  key,
  label: key,
  female,
  male,
  total: female + male,
  gross,
  net: 0,
});
// August 2026 on the JR-08 sheet.
const payroll = {
  byCategory: [
    group('foreign', 2, 1, 4900),
    group('khmer', 1, 2, 2750.39),
    group('sewing', 86, 37, 33498.3),
    group('production', 27, 18, 19861.65),
  ],
} as unknown as PayrollReport;

const line = (key: string, pcs: number): ProductionExportLine => {
  const [kind = '', product = '', material = ''] = key.split('|');
  return { key, kind, product, material, pcs, invoiceLines: 1, shipments: ['SHP-1'] };
};
const data = {
  month: '2026-08',
  lines: [line('LADIES|PANT|KNITTED', 41078), line('LADIES|PAJAMAS|KNITTED', 13404)],
  destinations: ['UNITED STATES'],
  importMaterials: ['KNITTED', 'WOVEN FABRIC'],
  importOrigins: ['CHINA', 'TAIWAN'],
};

describe('buildCapacityModel', () => {
  it('fills points 4 and 5 from the payroll, workers = sewing + production', () => {
    const m = buildCapacityModel(payroll, data, defaultProfile('JR APPAREL CO.,LTD'));
    expect(m.staff.map((r) => [r.male, r.female, r.total])).toEqual([
      [1, 2, 3],
      [2, 1, 3],
      [37, 86, 123],
      [18, 27, 45],
      [55, 113, 168],
    ]);
    expect(m.salaries.at(-1)!.amount).toBeCloseTo(53359.95);
    expect(m.titleKh).toContain('ខែ សីហា ឆ្នាំ ២០២៦');
    expect(m.materials).toBe('KNITTED FABRIC, WOVEN FABRIC');
    expect(m.materialOrigins).toBe('CHINA, TAIWAN');
  });

  it('reproduces the August sheet when its OT pcs are typed in', () => {
    const profile = defaultProfile('JR');
    profile.otPcs = { '2026-08': { 'LADIES|PANT|KNITTED': 894, 'LADIES|PAJAMAS|KNITTED': 358 } };
    profile.unitWeights = { PANT: 0.55, PAJAMAS: 0.31 };
    const m = buildCapacityModel(payroll, data, profile);
    expect(m.rows.map((r) => [r.product, r.hoursPerDay, r.perHour, r.perDay, r.perMonth])).toEqual([
      ['PANT', 8, 193, 1544, 40144],
      ['PAJAMAS', 8, 63, 504, 13104],
      ['PANT', 2, 30, 60, 900],
      ['PAJAMAS', 2, 12, 24, 360],
    ]);
    expect(m.exportTotal).toBe(54482);
    expect(m.capacityTotal).toBe(54508);
    expect(m.rows[0]).toMatchObject({ dozenWeight: 6.6, totalWeight: 22079.2 });
  });

  it('splits by the OT share otherwise, dropping rows under one piece an hour', () => {
    const m = buildCapacityModel(
      payroll,
      { ...data, lines: [line('LADIES|PANT|KNITTED', 41086), line('LADIES|SKIRT|WOVEN', 175)] },
      defaultProfile('JR'),
    );
    expect(m.lines.map((l) => [l.otPcs, l.regularPerHour, l.overtimePerHour])).toEqual([
      [1027, 193, 34],
      [4, 1, 0],
    ]);
    expect(m.rows.map((r) => `${r.product} ${r.overtime ? 'OT' : 'reg'}`)).toEqual([
      'PANT reg',
      'SKIRT reg',
      'PANT OT',
    ]);
  });

  it('names months in Khmer', () => {
    expect(khmerMonth('2026-01')).toBe('ខែ មករា ឆ្នាំ ២០២៦');
  });
});

describe('addCapacitySheet', () => {
  it('lays the report out on the sheet grid and writes a valid workbook', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { addCapacitySheet } = await import('./capacityExport');
    const profile = defaultProfile('JR APPAREL CO.,LTD');
    profile.otPcs = { '2026-08': { 'LADIES|PANT|KNITTED': 894, 'LADIES|PAJAMAS|KNITTED': 358 } };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('2026-08');
    addCapacitySheet(ws, buildCapacityModel(payroll, data, profile));
    const texts: string[] = [];
    // Merged ranges repeat their value in every cell: count each range once.
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (c.master.address === c.address) texts.push(String(c.value));
      }),
    );
    expect(texts).toContain('JR APPAREL CO.,LTD');
    expect(texts).toContain('១០)ការវាយតម្លៃសមត្ថភាពផលិតកម្ម (Production Capacity)');
    expect(texts.filter((t) => t === '40144')).toHaveLength(2); // points 10 and 11
    expect(ws.getCell('A1').font).toMatchObject({ name: 'Khmer OS Muol Light' });
    await expect(wb.xlsx.writeBuffer()).resolves.toBeTruthy();
  });
});
