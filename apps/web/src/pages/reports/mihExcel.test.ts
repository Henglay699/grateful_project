// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readMihWorkbook } from './mihExcel';

interface Sheet {
  name: string;
  /** [kind, product, export qty, export value, sheet's year-to-date qty, value]. */
  products: [string, string, number, number, number, number][];
  /** [kind, product, USA qty, USA value, CANADA qty, CANADA value]. */
  markets: [string, string, number, number, number, number][];
  fabric: [qty: number, value: number];
  kw: number;
}

/** A month laid out like the factory's MIH sheet (only the cells the reader looks at). */
function addSheet(wb: ExcelJS.Workbook, s: Sheet) {
  const ws = wb.addWorksheet(s.name);
  const put = (r: number, c: number, v: ExcelJS.CellValue) => (ws.getCell(r, c).value = v);
  put(6, 10, 'ឆ្នាំ 2026');
  put(10, 1, 'Name of Factory: JR APPAREL CO., LTD  Factory Address:  #LOM ROAD');
  put(13, 1, 'ចំនួនពលកម្មសរុបៈ​​    ');
  put(13, 3, 168);
  put(13, 6, 111);
  put(13, 10, 45784.38);
  put(15, 1, 'ទុនសរុបមិនគិតដីធ្លី Total Asset(Land exclude)');
  put(15, 4, 1000000);
  put(15, 10, 900000);
  put(19, 4, 'ក្នុងស្រុក Domestic');
  let r = 20;
  for (const [kind, product, qty, value, ytdQty, ytdValue] of s.products) {
    put(r, 1, kind);
    put(r, 2, product);
    put(r, 3, 'PCS');
    put(r, 9, qty);
    // As the sheet has it: a formula with its last result.
    put(r, 11, { formula: `ROUND(I${r}*2,2)`, result: value });
    put(r, 13, ytdQty);
    put(r, 15, ytdValue);
    r++;
  }
  put(r, 1, 'Total');
  put(30, 5, 'USA');
  r = 32;
  for (const [kind, product, uq, uv, cq, cv] of s.markets) {
    put(r, 2, { formula: 'A20', result: kind });
    put(r, 3, product);
    put(r, 5, uq);
    put(r, 6, uv);
    put(r, 7, cq);
    put(r, 8, cv);
    r++;
  }
  put(r, 2, 'សរុប');
  put(40, 5, 'ចិន');
  put(42, 2, 'II. RAW MATERIAL');
  put(42, 4, 'MTR');
  put(42, 5, s.fabric[0]);
  put(42, 6, s.fabric[1]);
  put(43, 2, 'សរុប');
  put(50, 2, '      បរិមាណការប្រើប្រាស់ថាមពល  ប្រចាំខែ');
  put(53, 1, 1);
  put(53, 2, 'EDC');
  put(53, 5, 'KW');
  put(53, 9, s.kw);
  put(53, 10, { formula: '0.137*I53', result: s.kw * 0.137 });
  put(54, 2, 'សរុប');
  put(56, 2, '   បរិមាណការប្រើប្រាស់ទឹក​   ប្រចាំខែ');
  put(59, 2, 'PPWSA');
  put(59, 5, 'M3');
  put(59, 9, 83);
  put(59, 10, 45.65);
  put(60, 2, 'សរុប');
  put(62, 2, 'ប្រភេទសំណល់');
  put(63, 2, 'សំណល់រឹង');
  put(64, 2, 'សរុប');
  put(70, 11, 'ថ្ងៃទី 15 ខែ មករា ឆ្នាំ2026');
  put(72, 11, 'Director');
  put(80, 11, 'NI, CUNLAN');
  put(80, 14, 'THNIN');
}

describe('reading the MIH workbook', () => {
  const wb = new ExcelJS.Workbook();
  // February first: months come back in order whatever the sheet order.
  addSheet(wb, {
    name: '2-FEB',
    products: [
      ['LADIES', 'PANTS', 500, 1000, 1500, 3000],
      // The sheet's year-to-date points at the wrong row: 9,999.
      ['LADIES', 'PAJAMAS', 100, 150, 9999, 150],
    ],
    markets: [
      ['LADIES', 'PANTS', 400, 800, 100, 200],
      ['LADIES', 'PAJAMAS', 100, 149.8, 0, 0],
    ],
    fabric: [81187.7, 81187.7],
    kw: 11368,
  });
  addSheet(wb, {
    name: '1-JAN',
    products: [['LADIES', 'PANTS', 1000, 2000, 1000, 2000]],
    // Page 2 counts something else: the split can't be trusted.
    markets: [['LADIES', 'PANTS', 0, 0, 217, 2000]],
    fabric: [96774.8, 160385.04],
    kw: 11368,
  });
  wb.addWorksheet('Notes');
  const book = readMihWorkbook(wb);

  it('reads each month’s own figures, in month order', () => {
    expect(book.company).toBe('JR APPAREL CO., LTD');
    expect(book.months.map((m) => [m.sheet, m.period])).toEqual([
      ['1-JAN', '2026-01'],
      ['2-FEB', '2026-02'],
    ]);
    const feb = book.months[1]!.data;
    expect(feb).toMatchObject({
      employees: 168,
      female: 111,
      salary: 45784.38,
      totalAsset: 1000000,
      fixedAsset: 900000,
      reportDate: 'ថ្ងៃទី 15 ខែ មករា ឆ្នាំ2026',
      directorName: 'NI, CUNLAN',
      reporterName: 'THNIN',
    });
    expect(feb.products[0]!.markets).toMatchObject({
      US: { qty: 400, value: 800 },
      CA: { qty: 100, value: 200 },
    });
    expect(feb.materials).toMatchObject([
      { name: 'II. RAW MATERIAL', unit: 'MTR', origins: { CN: { qty: 81187.7, value: 81187.7 } } },
    ]);
    expect(feb.energy).toEqual([
      { name: 'EDC', unit: 'KW', qty: 11368, unitPrice: 0.137, value: 1557.42 },
    ]);
    expect(feb.water).toMatchObject([{ name: 'PPWSA', unit: 'M3', qty: 83, value: 45.65 }]);
    expect(feb.waste).toEqual([{ name: 'សំណល់រឹង', unit: '', qty: 0 }]);
  });

  it('keeps page 1’s totals when page 2’s markets don’t add up, and says so', () => {
    const [jan, feb] = book.months;
    expect(jan!.data.products[0]!.markets.CA).toEqual({ qty: 1000, value: 2000 });
    expect(jan!.issues).toEqual([
      expect.stringContaining('page 1 says 1000 pcs, page 2 (markets) 217 pcs'),
    ]);
    // Same pieces, 20 cents apart: the split stands, the 20 cents go on the biggest market.
    expect(feb!.data.products[1]!.markets.US).toEqual({ qty: 100, value: 150 });
    expect(feb!.issues).toContain(
      'LADIES PAJAMAS: page 2 adds up to $149.8, page 1 says $150. The missing $0.20 was put on US.',
    );
  });

  it('notes where the sheet’s own year-to-date doesn’t match the months added up', () => {
    expect(book.months[1]!.issues).toEqual(
      expect.arrayContaining([
        "The sheet's year-to-date for LADIES PAJAMAS was 9,999 PCS / $150; the months add up to 100 PCS / $150.",
      ]),
    );
    expect(book.months[1]!.issues.some((i) => i.includes('LADIES PANTS'))).toBe(false);
  });
});
