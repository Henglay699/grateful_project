import { describe, expect, it } from 'vitest';
import type { CoBreakdownInput, CoDetail } from '@gs/shared';
import { computeBreakdown, defaultBreakdown, startingBreakdown } from './breakdown';

/** JRA26056 as in BREAKDOWN.xlsx: 5,600 pcs, 2,921.10 kg net, target FOB 2.95. */
const sheet: CoBreakdownInput = {
  htsCode: 'JRA26056',
  date: '2026-10-08',
  kinds: '',
  poNo: '',
  styleNo: '',
  fabricName: 'KNITTED FABRIC',
  fabricOrigin: 'Taiwan',
  accessoriesOrigin: 'China',
  targetFob: 2.95,
  importShare: 0.51,
  transportCost: 0.09,
  base: { fabric: 1.15, accessories: 0.54, local: 0.49, overhead: 0.47, profit: 0.5 },
  accountant: 'KENDY',
  manager: 'KONG YEKSEAM',
};

const detail = (over: Partial<CoDetail> = {}) =>
  ({
    invoiceNo: 'JRA26059',
    htsCode: '6104.69',
    invoiceDate: '2026-10-29',
    pcs: 5600,
    amount: 16912,
    breakdown: null,
    template: null,
    ...over,
  }) as CoDetail;

describe('computeBreakdown', () => {
  it('works the sheet out as the workbook does', () => {
    const b = computeBreakdown(sheet, 5600, 2921.1);
    expect(b.kgPerPcs).toBeCloseTo(0.521625, 6);
    expect(b.fabricUnitCost).toBe(1.47);
    expect(b.fabric).toBeCloseTo(0.7668, 4);
    expect(b.accessories).toBeCloseTo(0.6918, 4);
    expect(b.local).toBe(0.47);
    expect(b.overhead).toBe(0.45);
    expect(b.profit).toBeCloseTo(0.4814, 4);
    expect(b.subTotal).toBeCloseTo(2.86, 9);
    expect(b.fob).toBeCloseTo(2.95, 9);
    expect(b.localContent).toBeCloseTo(0.49, 9);
    expect(b.importContent).toBeCloseTo(0.51, 9);
    expect(b.tenth).toBeCloseTo(0.047, 9);
  });

  it('survives an invoice without pieces', () => {
    const b = computeBreakdown(sheet, 0, 0);
    expect(b.kgPerPcs).toBe(0);
    expect(Number.isFinite(b.fabricUnitCost)).toBe(true);
    expect(b.fob).toBeCloseTo(2.95, 9);
  });
});

describe('startingBreakdown', () => {
  it('starts from the invoice’s average FOB', () => {
    expect(defaultBreakdown(detail()).targetFob).toBe(3.02);
  });

  it('carries the client’s last breakdown over, with this invoice’s HTS code, date and FOB', () => {
    const b = startingBreakdown(detail({ template: sheet }));
    expect(b.accountant).toBe('KENDY');
    expect(b.htsCode).toBe('6104.69');
    expect(b.date).toBe('2026-10-29');
    expect(b.targetFob).toBe(3.02);
  });

  it('keeps a saved breakdown as saved', () => {
    expect(startingBreakdown(detail({ breakdown: sheet, template: null }))).toBe(sheet);
  });
});
