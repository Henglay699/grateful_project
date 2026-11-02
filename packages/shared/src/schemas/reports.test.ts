import { describe, expect, it } from 'vitest';
import { payrollMonthInputSchema, productionLineOf, productionProfileSchema } from './reports';

const line = (d: string, hts?: string) => {
  const { kind, product, material } = productionLineOf(d, hts);
  return `${kind} / ${product} / ${material}`;
};

describe('productionLineOf', () => {
  it.each([
    ['LADIES PANT KNITTED 68% RAYON 27% POLY 5% SPANDEX', 'LADIES / PANT / KNITTED'],
    ['LADIES 2PC PAJAMAS KNITTED 96% POLY 4% SPANDEX', 'LADIES / PAJAMAS / KNITTED'],
    ['LADIES 2PCS PAJAMAS WOVEN 92% POLYESTER 8% SPANDEX', 'LADIES / PAJAMAS / WOVEN'],
    ['LADIES WOVEN PANT 100% COTTON', 'LADIES / PANT / WOVEN'],
    ['LADIES WOVEN PANTS 76% RAYON 21% NYLON 3% SPANDEX', 'LADIES / PANT / WOVEN'],
    ['LADIES KINTTED PANT 59% COTTON 30% POLYESTER 11% SPANDEX', 'LADIES / PANT / KNITTED'],
    ['LADIES PANT KNIT 78% NYLON 22% SPANDEX', 'LADIES / PANT / KNITTED'],
    ['LADIES KNITTED PAJAMA 2PC 97% RAYON 3% SPANDEX', 'LADIES / PAJAMAS / KNITTED'],
    ['LADIES KNITTED PANTS S 52% NYLON 37% VISCOSE 11% SPANDEX', 'LADIES / PANT / KNITTED'],
    ['LADIES WOVEN NIGHT GOWN 100% COTTON', 'LADIES / NIGHT GOWN / WOVEN'],
    ['ladies skort knitted 95% polyester 5% spandex', 'LADIES / SKORT / KNITTED'],
  ])('%s', (d, want) => expect(line(d)).toBe(want));

  it('takes the material from the HTS chapter when the description has none', () => {
    expect(line('LADIES 2PC PAJAMAS 95% RAYON 5% SPANDEX', '6108.32')).toBe(
      'LADIES / PAJAMAS / KNITTED',
    );
    expect(line('MEN SHIRT 100% COTTON', '6205.20')).toBe('MEN / SHIRT / WOVEN');
    // The description wins over a wrong HTS code.
    expect(line('LADIES 2PC PAJAMAS KNIT 97% RAYON (HTS 6108.32)', '6204.69')).toBe(
      'LADIES / PAJAMAS / KNITTED',
    );
  });

  it('keys lines so spelling variants add up together', () => {
    expect(productionLineOf('LADIES PANTS KNITTED 95% POLY').key).toBe(
      productionLineOf('LADIES KNITTED PANT 95% POLY').key,
    );
    expect(productionLineOf('').key).toBe('|OTHER|');
  });
});

describe('productionProfileSchema', () => {
  it('fills the usual hours and OT share', () => {
    expect(productionProfileSchema.parse({})).toMatchObject({
      regularHours: 208,
      overtimeHours: 30,
      regularHoursPerDay: 8,
      overtimeHoursPerDay: 2,
      otSharePct: 2.5,
      machines: [],
    });
  });
});

describe('payrollMonthInputSchema', () => {
  const staff = {
    row: 7,
    no: '1',
    card: 'OFF0010',
    nameEn: 'NI CUNLAN',
    nameKh: 'NI CUNLAN',
    gender: 'F',
    birthDate: '1971-12-20',
    joinDate: null,
    section: 'Chinese',
    department: 'OFF',
    category: 'foreign',
    baseSalary: 1745,
    daysWorked: 26,
    otHours: 0,
    holidayHours: 0,
    pay: { basic: 1745, lunch: 155 },
    gross: 1900,
    advance: 0,
    pension: 5.95,
    tax: 146.25,
    net: 1747.8,
  };
  it('takes a month of staff rows and defaults replace to false', () => {
    const v = payrollMonthInputSchema.parse({ period: '2026-07', company: 'JR', staff: [staff] });
    expect(v).toMatchObject({ replace: false, sections: [], issues: [] });
  });
  it('refuses a bad month, no staff, or an unknown category', () => {
    const bad = (x: object) =>
      payrollMonthInputSchema.safeParse({ period: '2026-07', company: 'JR', staff: [staff], ...x })
        .success;
    expect(bad({ period: '2026-13' })).toBe(false);
    expect(bad({ staff: [] })).toBe(false);
    expect(bad({ staff: [{ ...staff, category: 'boss' }] })).toBe(false);
  });
});
