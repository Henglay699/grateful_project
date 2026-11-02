import { describe, expect, it } from 'vitest';
import type { CustomsReportData } from '@gs/shared';
import { buildCustomsModel, goodsName, khmerDate, khmerPeriod, lastDay } from './importExport';

const data = (over: Partial<CustomsReportData> = {}): CustomsReportData => ({
  clientId: 'c',
  direction: 'EXPORT',
  from: '2026-08',
  to: '2026-09',
  companyName: 'JR APPAREL CO., LTD',
  vattin: 'L001-902501613',
  lines: [
    {
      declareNo: 'E 245477',
      declareDate: '2026-08-14',
      shipmentId: 's',
      reference: 'SHP-1',
      invoiceNo: 'JRA1',
      description: 'LADIES PANT KNITTED 95% POLYESTER 5% SPANDEX',
      unit: null,
      qty: 1312,
      netWeightKg: 658,
      grossWeightKg: 713,
      value: 3673.6,
    },
    {
      declareNo: 'E 291340',
      declareDate: '2026-09-25',
      shipmentId: 's2',
      reference: 'SHP-2',
      invoiceNo: 'JRA2',
      description: 'LADIES 2PC PAJAMAS',
      unit: null,
      qty: 0,
      netWeightKg: 0.1,
      grossWeightKg: 0.2,
      value: 0,
    },
  ],
  undeclared: [],
  ...over,
});

describe('import & export report', () => {
  it('writes the period and the signing day in Khmer, as the sheet does', () => {
    expect(khmerPeriod('2026-01', '2026-09')).toBe(
      'ខែ មករា ឆ្នាំ 2026 រហូតដល់ ខែ កញ្ញា ឆ្នាំ 2026',
    );
    expect(khmerPeriod('2026-09', '2026-09')).toBe('ខែ កញ្ញា ឆ្នាំ 2026');
    expect(khmerDate('2026-09-30')).toBe('ថ្ងៃទី ៣០ ខែ កញ្ញា ឆ្នាំ ២០២៦');
    expect(lastDay('2026-02')).toBe('2026-02-28');
  });

  it('names export goods without their fibre content; imports as invoiced', () => {
    expect(goodsName('LADIES PANT KNITTED 95% POLYESTER 5% SPANDEX', 'EXPORT')).toBe(
      'LADIES PANT KNITTED',
    );
    expect(goodsName('ladies  2pc pajamas', 'EXPORT')).toBe('LADIES 2PC PAJAMAS');
    expect(goodsName('KNITTED FABRIC 100% COTTON', 'IMPORT')).toBe('KNITTED FABRIC 100% COTTON');
  });

  it('numbers the rows, works out unit values and adds up the totals', () => {
    const m = buildCustomsModel(data(), {
      date: '2026-09-30',
      title: 'ប្រធានក្រុមហ៊ុន',
      name: 'X',
    });
    expect(m.titleKh).toBe('តារាងរបាយការណ៏នាំចេញតាមប្រតិវេទន៏គយ');
    expect(m.subtitleKh).toBe(
      'ក្រុមហ៊ុន JR APPAREL CO., LTD មាន អ.ត.ប លេខ L001-902501613 សំរាប់ ខែ សីហា ឆ្នាំ 2026 រហូតដល់ ខែ កញ្ញា ឆ្នាំ 2026',
    );
    expect(m.rows.map((r) => [r.no, r.goods, r.unitValue])).toEqual([
      [1, 'LADIES PANT KNITTED', 2.8],
      [2, 'LADIES 2PC PAJAMAS', 0],
    ]);
    expect(m.totals).toEqual({
      qty: 1312,
      netWeightKg: 658.1,
      grossWeightKg: 713.2,
      value: 3673.6,
    });
    expect(m.totalLabel).toBe('TOTAL 2026 :');
    expect(m.sheetName).toBe('EXP-8-9');
    expect(m.fileName).toBe('JR_APPAREL_CO_LTD_EXP_Report_2026-08_to_2026-09');
  });
});
