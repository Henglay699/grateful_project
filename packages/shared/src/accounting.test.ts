import { describe, expect, it } from 'vitest';
import {
  computeLedger,
  computeTaxDocument,
  computeTaxLine,
  nextBusinessDay,
  computeLinesTotal,
  chargeLineAmount,
  computeChargeLinesTotal,
  isVatChargedLine,
  chargeLineUnit,
  followShipmentUnit,
  shipmentChargeUnit,
  vatPercentOn,
  vatLabel,
  vatMark,
  recordSummaryItems,
} from './accounting';
import { computeCutStockBalance, wouldOverImport } from './cutstock';
import { toMoneyString, sumMoney, round2 } from './money';

describe('computeLedger (Chea payment / monthly ledger row)', () => {
  it('matches declaration I 122050 (JR Apparel, commission 0)', () => {
    const r = computeLedger({
      clearFee: 982.45,
      thc: 355,
      otherPay: 0,
      commission: 0,
      invRevenue: 185,
      disTotal: 21.25,
      dnTotal: 1334,
    });
    expect(r.vat).toBe(18.5);
    expect(r.totalInflow).toBe(1540.25);
    expect(r.totalOutflow).toBe(1337.45);
    expect(r.netProfit).toBe(202.8);
  });

  it('matches declaration I 95925 (Sportline, commission 50)', () => {
    const r = computeLedger({
      clearFee: '285.53',
      thc: '0.00',
      otherPay: '0',
      commission: '50.00',
      invRevenue: '150.00',
      disTotal: '190.53',
      dnTotal: '347.11',
    });
    expect(r.vat).toBe(15);
    expect(r.netProfit).toBe(352.11);
  });

  it('excludes VAT from net profit', () => {
    const a = computeLedger({
      clearFee: 0,
      thc: 0,
      otherPay: 0,
      commission: 0,
      invRevenue: 100,
      disTotal: 0,
      dnTotal: 0,
    });
    expect(a.netProfit).toBe(100);
    expect(a.vat).toBe(10);
  });

  it('can be negative (loss-making shipment)', () => {
    const r = computeLedger({
      clearFee: 500,
      thc: 355,
      otherPay: 12.5,
      commission: 50,
      invRevenue: 150,
      disTotal: 0,
      dnTotal: 300,
    });
    expect(r.netProfit).toBe(-467.5);
  });

  it('has no floating point drift', () => {
    const r = computeLedger({
      clearFee: 0.1,
      thc: 0.2,
      otherPay: 0,
      commission: 0,
      invRevenue: 0.3,
      disTotal: 0,
      dnTotal: 0,
    });
    expect(r.netProfit).toBe(0);
  });
});

describe('tax invoice', () => {
  it('computes VAT 10% per line and KHR at the stored rate', () => {
    const t = computeTaxDocument([{ qty: 1, unitPrice: 185 }], 4026);
    expect(t).toEqual({
      subtotal: 185,
      vat: 18.5,
      total: 203.5,
      subtotalKhr: 744810,
      vatKhr: 74481,
      totalKhr: 819291,
    });
  });

  it('rounds VAT half-up to cents', () => {
    expect(computeTaxLine({ qty: 1, unitPrice: 18.75 }).vat).toBe(1.88);
    expect(computeTaxLine({ qty: 3, unitPrice: '0.335' }).subtotal).toBe(1.01);
  });

  it('disbursement lines carry no VAT', () => {
    expect(computeTaxLine({ qty: 2, unitPrice: 95.265, vatable: false })).toEqual({
      subtotal: 190.53,
      vat: 0,
      amount: 190.53,
    });
  });

  it('sums debit note lines', () => {
    expect(
      computeLinesTotal([
        { qty: 1, unitPrice: 420 },
        { qty: 1, unitPrice: 35 },
        { qty: 1, unitPrice: 25 },
        { qty: 1, unitPrice: 20 },
        { qty: 1, unitPrice: 69 },
        { qty: 1, unitPrice: 40 },
        { qty: 1, unitPrice: 273 },
        { qty: 1, unitPrice: 45 },
        { qty: 1, unitPrice: 40 },
      ]),
    ).toBe(967);
  });
});

describe('nextBusinessDay', () => {
  it('Friday → Monday', () =>
    expect(nextBusinessDay('2026-08-21')).toEqual({ date: '2026-08-24', weekday: 'Monday' }));
  it('Wednesday → Thursday', () =>
    expect(nextBusinessDay('2026-07-01')).toEqual({ date: '2026-07-02', weekday: 'Thursday' }));
  it('Saturday → Monday', () => expect(nextBusinessDay('2026-08-22').date).toBe('2026-08-24'));
  it('Sunday → Monday', () => expect(nextBusinessDay('2026-08-23').date).toBe('2026-08-24'));
  it('crosses year end', () => expect(nextBusinessDay('2026-12-31').date).toBe('2027-01-01'));

  // Cambodian public holidays (2026: Sub-Decree No. 167).
  const hol = new Set([
    '2026-01-01',
    '2026-01-07',
    '2026-04-14',
    '2026-04-15',
    '2026-04-16',
    '2026-05-01',
    '2026-06-18',
    '2026-10-10',
    '2026-10-11',
    '2026-10-12',
    '2026-12-29',
    '2027-01-01',
  ]);
  it('skips a holiday on the next day (6 Jan → 8 Jan, as in the Excel list)', () =>
    expect(nextBusinessDay('2026-01-06', hol).date).toBe('2026-01-08'));
  it('17 Jun → 19 Jun past the Queen Mother’s birthday, as in the Excel list', () =>
    expect(nextBusinessDay('2026-06-17', hol).date).toBe('2026-06-19'));
  it('Friday with a holiday Monday → Tuesday', () => {
    const mondayOff = new Set(['2026-08-24']);
    expect(nextBusinessDay('2026-08-21', mondayOff)).toEqual({
      date: '2026-08-25',
      weekday: 'Tuesday',
    });
  });
  it('Saturday with a holiday Monday → Tuesday', () =>
    expect(nextBusinessDay('2026-08-22', new Set(['2026-08-24'])).date).toBe('2026-08-25'));
  it('a run of holidays: Khmer New Year 14–16 Apr 2026', () =>
    expect(nextBusinessDay('2026-04-13', hol).date).toBe('2026-04-17'));
  it('holidays then a weekend: Pchum Ben Sat 10 – Mon 12 Oct 2026', () =>
    expect(nextBusinessDay('2026-10-09', hol).date).toBe('2026-10-13'));
  it('into the next month: Thu 30 Apr 2026 → Mon 4 May (1 May off, then the weekend)', () =>
    expect(nextBusinessDay('2026-04-30', hol).date).toBe('2026-05-04'));
  it('Fri 31 Jul 2026 → Mon 3 Aug (always the next working day)', () =>
    expect(nextBusinessDay('2026-07-31', hol).date).toBe('2026-08-03'));
  it('year end: Thu 31 Dec 2026 → Mon 4 Jan 2027 (New Year’s Day, then the weekend)', () =>
    expect(nextBusinessDay('2026-12-31', hol).date).toBe('2027-01-04'));
  it('year end: Mon 28 Dec 2026 → Wed 30 Dec (Peace Day 29 Dec)', () =>
    expect(nextBusinessDay('2026-12-28', hol).date).toBe('2026-12-30'));
});

describe('cut stock', () => {
  it('matches spreadsheet row I-5 (60% → OK)', () => {
    expect(computeCutStockBalance(5, 2)).toEqual({ balance: 3, balancePct: 0.6, condition: 'OK' });
  });
  it('matches spreadsheet row I-10 (over-imported → CHECK)', () => {
    expect(computeCutStockBalance(40, 64)).toEqual({
      balance: -24,
      balancePct: -0.6,
      condition: 'CHECK',
    });
  });
  it('flags zero-quantity items as CHECK', () => {
    expect(computeCutStockBalance(0, 1).condition).toBe('CHECK');
  });
  it('detects over-import', () => {
    expect(wouldOverImport(10, 9, 1)).toBe(false);
    expect(wouldOverImport(10, 9, 1.001)).toBe(true);
  });
});

describe('money helpers', () => {
  it('formats NUMERIC strings', () => {
    expect(toMoneyString(1334)).toBe('1334.00');
    expect(toMoneyString(-0.5)).toBe('-0.50');
    expect(toMoneyString('2.345')).toBe('2.35');
  });
  it('sums exactly', () => expect(sumMoney([0.1, 0.2, '0.3'])).toBe(0.6));
  it('rounds half away from zero', () => expect(round2(-1.005)).toBe(-1.01));
});

describe('credit note / record summary lines (processing fee + 10% VAT)', () => {
  it('adds 10% to the import and export processing fee only', () => {
    expect(isVatChargedLine('IMPORT PROCESSING FEE')).toBe(true);
    expect(isVatChargedLine('export processing fee')).toBe(true);
    expect(isVatChargedLine('CUSTOMS PROCESSING FEE')).toBe(false);
    expect(chargeLineAmount({ description: 'IMPORT PROCESSING FEE', qty: 1, unitPrice: 200 })).toBe(
      220,
    );
    expect(
      chargeLineAmount({ description: 'EXPORT PROCESSING FEE', qty: 2, unitPrice: 33.33 }),
    ).toBe(73.33);
    expect(chargeLineAmount({ description: 'THC FEE', qty: 1, unitPrice: 200 })).toBe(200);
  });
  it('totals the lines with the fee VAT included', () => {
    expect(
      computeChargeLinesTotal([
        { description: 'IMPORT PROCESSING FEE', qty: 1, unitPrice: 200 },
        { description: 'DISBURSEMENT', qty: 1, unitPrice: 0 },
        { description: 'LOLO AT PORT', qty: 1, unitPrice: 45 },
      ]),
    ).toBe(265);
  });
});

describe('VAT percent from Settings → Invoice Management', () => {
  const rates = [
    { effectiveDate: '2027-01-01', percent: '12.00' },
    { effectiveDate: '2027-07-01', percent: '12.50' },
  ];
  it('takes the latest rate on or before the date, else the standard 10%', () => {
    expect(vatPercentOn([], '2026-11-01')).toBe(10);
    expect(vatPercentOn(rates, '2026-12-31')).toBe(10);
    expect(vatPercentOn(rates, '2027-01-01')).toBe(12);
    expect(vatPercentOn(rates, '2027-06-30')).toBe(12);
    expect(vatPercentOn(rates, '2027-08-15')).toBe(12.5);
  });
  it('computes every VAT at the given percent (10% by default)', () => {
    expect(computeTaxLine({ qty: 1, unitPrice: 185 }, 12).vat).toBe(22.2);
    expect(computeTaxDocument([{ qty: 1, unitPrice: 200 }], 4000, 12.5)).toMatchObject({
      vat: 25,
      total: 225,
      vatKhr: 100000,
    });
    const ledger = {
      clearFee: 0,
      thc: 0,
      otherPay: 0,
      commission: 0,
      invRevenue: 300,
      disTotal: 0,
      dnTotal: 0,
    };
    expect(computeLedger(ledger).vat).toBe(30);
    expect(computeLedger(ledger, 12).vat).toBe(36);
    expect(computeLedger(ledger, 12).netProfit).toBe(300);
    const fee = { description: 'IMPORT PROCESSING FEE', qty: 1, unitPrice: 200 };
    expect(chargeLineAmount(fee, 12)).toBe(224);
    expect(computeChargeLinesTotal([fee, { description: 'LOLO', qty: 1, unitPrice: 45 }], 12)).toBe(
      269,
    );
  });
  it('labels and marks follow the percent', () => {
    expect(vatLabel()).toBe('VAT 10%');
    expect(vatLabel('12.50')).toBe('VAT 12.5%');
    expect(vatMark({ description: 'EXPORT PROCESSING FEE', mark: 'VAT 10%' }, 12)).toBe('VAT 12%');
    expect(vatMark({ description: 'EXPORT PROCESSING FEE', mark: 'Paid' }, 12)).toBe('Paid');
    expect(vatMark({ description: 'THC FEE', mark: 'VAT 10%' }, 12)).toBe('VAT 10%');
    expect(recordSummaryItems('IMPORT', 12)[0]).toEqual(['IMPORT PROCESSING FEE', 'VAT 12%']);
  });
});

describe('charge line units (credit noted / record summary)', () => {
  it('bills by the container size, SHIP for air / LCL, SET for the per-set charges', () => {
    const fcl = shipmentChargeUnit({
      transportMode: 'SEA',
      loadType: 'FCL',
      containerSize: '40HQ',
    });
    expect(fcl).toBe("40'HQ");
    expect(
      shipmentChargeUnit({ transportMode: 'SEA', loadType: 'LCL', containerSize: '40HQ' }),
    ).toBe('SHIP');
    expect(
      shipmentChargeUnit({ transportMode: 'AIR', loadType: 'NONE', containerSize: null }),
    ).toBe('SHIP');
    expect(chargeLineUnit('TRUCKING FEE', fcl)).toBe("40'HQ");
    for (const d of ['PERMIT FEE', 'service taxation', 'MISSING INSURANCE', 'DOCUMENT FEE'])
      expect(chargeLineUnit(d, fcl)).toBe('SET');
  });
  it('re-units only lines whose unit follows the shipment', () => {
    expect(followShipmentUnit({ description: 'THC FEE', unit: '20GP' }, "40'HQ")).toBe("40'HQ");
    expect(followShipmentUnit({ description: 'THC FEE', unit: 'SET' }, 'SHIP')).toBe('SHIP');
    expect(followShipmentUnit({ description: 'PERMIT FEE', unit: "40'HQ" }, "40'HQ")).toBe('SET');
    expect(followShipmentUnit({ description: 'STORAGE', unit: 'DAY' }, "40'HQ")).toBe('DAY');
    expect(followShipmentUnit({ description: 'TRUCK', unit: 'TRUCK 5T' }, "40'HQ")).toBe(
      'TRUCK 5T',
    );
  });
});
