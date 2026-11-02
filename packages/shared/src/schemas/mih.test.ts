import { describe, expect, it } from 'vitest';
import {
  mihChecks,
  mihMarketOf,
  mihMaterialKey,
  mihMonthDataSchema,
  mihTotals,
  productKeyOf,
  type MihMonthDataInput,
} from './mih';

const month = (d: MihMonthDataInput) => mihMonthDataSchema.parse(d);
const pants = (qty: number, value: number, product = 'PANTS') => ({
  kind: 'LADIES',
  product,
  unit: 'PCS',
  markets: { US: { qty, value } },
});

describe('MIH year-to-date', () => {
  it('adds months up by product, whatever order or wording their rows have', () => {
    const jan = month({
      products: [
        { kind: 'LADIES', product: 'PAJAMAS', markets: { CA: { qty: 10, value: 20 } } },
        pants(100, 200),
      ],
    });
    // February lists PANT first, spelt without the S.
    const feb = month({
      products: [
        pants(50, 101, 'PANT'),
        { kind: 'LADIES', product: 'PAJAMA', markets: { US: { qty: 5, value: 9 } } },
      ],
    });
    const t = mihTotals([jan, feb]);
    expect(t.get(productKeyOf({ kind: 'LADIES', product: 'PANTS' }, 'EXPORT'))).toEqual({
      qty: 150,
      value: 301,
    });
    expect(t.get(productKeyOf({ kind: 'LADIES', product: 'PAJAMAS' }, 'EXPORT'))).toEqual({
      qty: 15,
      value: 29,
    });
    expect(t.get(productKeyOf({ kind: 'LADIES', product: 'PAJAMAS' }, 'CA'))).toEqual({
      qty: 10,
      value: 20,
    });
  });

  it('reads the sheet’s material and market names the same way each month', () => {
    expect(mihMaterialKey('II. RAW MATERIAL')).toBe('RAW MATERIAL');
    expect(mihMaterialKey('I. MACHINERIES &. EQUIPMENTS')).toBe('MACHINERIES & EQUIPMENTS');
    expect(['US', 'CA', 'CN', 'DE', 'GB', null].map(mihMarketOf)).toEqual([
      'US',
      'CA',
      'CN',
      'EU',
      'OTHER',
      'OTHER',
    ]);
  });
});

describe('MIH checks', () => {
  const year = [
    {
      period: '2026-01',
      data: month({
        products: [pants(1000, 2000)],
        energy: [{ name: 'EDC', unit: 'KW', qty: 11368 }],
      }),
    },
    {
      period: '2026-02',
      data: month({
        products: [pants(1000, 2100)],
        energy: [{ name: 'EDC', unit: 'KW', qty: 11368 }],
      }),
    },
  ];

  it('flags a price far from the usual, copied meter readings and value typed as quantity', () => {
    const mar = month({
      employees: 170,
      products: [
        pants(2080, 155240),
        { kind: 'LADIES', product: 'NIGHT GOWN', markets: { US: { qty: 2080, value: 155240 } } },
      ],
      materials: [
        { name: 'RAW MATERIAL', unit: 'MTR', origins: { CN: { qty: 81187.7, value: 81187.7 } } },
      ],
      energy: [{ name: 'EDC', unit: 'KW', qty: 11368 }],
    });
    const checks = mihChecks('2026-03', mar, [...year, { period: '2026-03', data: mar }], {
      period: '2026-03',
      staffCount: 176,
      female: 0,
      gross: '0.00',
    });
    expect(checks).toEqual([
      expect.stringContaining('LADIES PANTS: $74.63 a piece'),
      // Only one month of night gowns: compared with every garment of the year.
      expect.stringContaining('LADIES NIGHT GOWN: $74.63 a piece'),
      expect.stringContaining('RAW MATERIAL: the value ($81,187.70) is exactly the quantity'),
      expect.stringContaining('Electricity EDC: 11,368 KW, the same as Feb 2026'),
      expect.stringContaining('176 staff (here 170)'),
    ]);
  });

  it('says which earlier months the year-to-date leaves out', () => {
    const checks = mihChecks('2026-05', month({}), year, null);
    expect(checks).toEqual([expect.stringContaining('leaves out Mar 2026, Apr 2026')]);
  });
});
