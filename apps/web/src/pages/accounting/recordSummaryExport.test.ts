import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { BillingDoc } from '@gs/shared';

const saved: { blob?: Blob; name?: string } = {};
vi.mock('../../lib/files', () => ({
  saveBlob: (blob: Blob, name: string) => Object.assign(saved, { blob, name }),
}));
// No logo in the test: the export goes on without it.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false })),
);
const { exportRecordSummaryExcel, recordSummaryFileName } = await import('./recordSummaryExport');
const { transportLabel } = await import('../print/PrintDocPage');

const doc = {
  id: 'x',
  type: 'record-summaries',
  number: null,
  date: '2026-08-21',
  clientCode: 'JR',
  clientName: 'JR Apparel Co., Ltd.',
  header: {
    direction: 'IMPORT',
    transportMode: 'SEA',
    loadType: 'FCL',
    invNo: 'GS26-212',
    disNo: 'DIS232',
    dnNo: 'JR2608001',
    declareNo: 'I 122050',
    quantityText: '4 PKGS',
    blNo: '274995778',
    containerNo: 'MRKU8974303',
    containerSize: '20GP',
    grossWeightKg: '2420',
    cbm: '12',
  },
  lines: [
    {
      id: '1',
      lineNo: 1,
      description: 'THC FEE',
      qty: '1',
      unit: '20GP',
      unitPrice: '355',
      subtotal: '355.00',
      mark: 'Receipt',
    },
    {
      id: '2',
      lineNo: 2,
      description: 'LOLO AT PORT',
      qty: '1',
      unit: '20GP',
      unitPrice: '62.7',
      subtotal: '62.70',
      mark: 'Receipt',
    },
  ],
  totals: { subtotal: '417.70', vat: '0', total: '417.70' },
} as unknown as BillingDoc;

const company = {
  nameKm: 'ក្រុមហ៊ុន ហ្គ្រេតហ្វ៊ូល សឹលូសិន (ខេមបូឌា) ឯ.ក',
  nameEn: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.',
  vattin: 'K008-902404873',
};

describe('Record Summary', () => {
  it('words the shipment like the ledger sheets', () => {
    expect(transportLabel('SEA', 'FCL')).toBe('BY SEA: CY / CY');
    expect(transportLabel('SEA', 'LCL')).toBe('BY SEA: LCL');
    expect(transportLabel('AIR', 'NONE')).toBe('BY AIR');
    expect(transportLabel('ROAD', 'LCL')).toBe('BY TRUCK: LCL');
    expect(transportLabel('ROAD', 'FCL')).toBe('BY TRUCK: CY / CY');
  });

  it('exports the sheet as on screen: letterhead, header box, gray table with formulas', async () => {
    expect(recordSummaryFileName(doc)).toBe('RecordSummary_I_122050');
    await exportRecordSummaryExcel(doc, company, 'Sihanoukville Port', 'Maersk');
    expect(saved.name).toBe('RecordSummary_I_122050.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await new Promise<ArrayBuffer>((resolve) => {
        const fr = new FileReader(); // jsdom's Blob has no arrayBuffer()
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.readAsArrayBuffer(saved.blob!);
      }),
    );
    const ws = wb.getWorksheet('Record Summary')!;

    expect(ws.getCell('A1').value).toBe(company.nameKm);
    expect(ws.getCell('A1').font).toMatchObject({ name: 'Khmer OS Muol Light' });
    expect(ws.getCell('A2').value).toBe(company.nameEn);
    expect(ws.getCell('A3').value).toBe('លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : K008-902404873');
    expect(ws.getCell('A5').value).toBe('RECORD SUMMARY');

    // Header box: left pairs in A / C, right pairs in D / G; the shipment's bar in red.
    const shipment = ws.getCell('C7').value as ExcelJS.CellRichTextValue;
    expect(shipment.richText.map((t) => t.text).join('')).toBe('IMPORT | BY SEA: CY / CY');
    expect(shipment.richText[1]!.font?.color).toEqual({ argb: 'FFA11D1D' });
    expect(ws.getCell('D7').value).toBe('INVOICE NO:');
    expect(ws.getCell('G7').value).toBe('GS26-212');
    expect(ws.getCell('C8').value).toBe('JR APPAREL CO., LTD.');
    expect(ws.getCell('C9').value).toBe('SIHANOUKVILLE PORT');
    expect(ws.getCell('G10').value).toBe("MRKU8974303 (20' GP)");
    expect(ws.getCell('G11').value).toBe('2,420 KGS');
    expect(ws.getCell('C13').value).toBe('21-Aug-2026');
    expect(ws.getCell('G13').value).toBe('MAERSK');

    // Table: gray header, lines with live formulas, TOTAL summing them.
    expect([1, 2, 4, 5, 6, 7, 8].map((c) => ws.getCell(15, c).value)).toEqual([
      'NO',
      'DESCRIPTION',
      "Q'TY",
      'UNIT',
      'PRICE',
      'SUBTOTAL',
      'MARK',
    ]);
    expect(ws.getCell('A15').fill).toMatchObject({ fgColor: { argb: 'FFBDBDBD' } });
    expect(ws.getCell('B16').value).toBe('THC FEE');
    expect(ws.getCell('G16').value).toMatchObject({ formula: 'ROUND(D16*F16,2)', result: 355 });
    expect(ws.getCell('H17').value).toBe('Receipt');
    expect(ws.getCell('A18').value).toBe('TOTAL:');
    expect(ws.getCell('G18').value).toMatchObject({ formula: 'SUM(G16:G17)', result: 417.7 });
  });
});
