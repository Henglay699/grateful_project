import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { BillingDoc } from '@gs/shared';

const saved: { blob?: Blob; name?: string } = {};
vi.mock('../../lib/files', () => ({
  saveBlob: (blob: Blob, name: string) => Object.assign(saved, { blob, name }),
}));
const { creditNoteFileName, exportCreditNoteExcel, exportCreditNotePackExcel } =
  await import('./creditNoteExport');

const doc = {
  id: 'x',
  type: 'credit-notes',
  number: 'CN26-001',
  date: '2026-10-12',
  header: {
    billTo: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.',
    address:
      '#7E0, Beton Street, Group 7, Tuol Thngan Village, Tuol Sangke II Sangkat, Russey Keo District, Phnom Penh, Cambodia.',
    shipper: 'JR APPAREL',
    containerNo: "TCLU1700780 (1X20'GP)",
    declareNo: 'I 95116',
    refType: 'HOUSE_BILL',
    refNo: 'HIP26932472',
    grossWeightKg: '2380.67',
    cbm: '24.237',
  },
  lines: [
    {
      id: '1',
      lineNo: 1,
      description: 'CLEARANCE',
      qty: '1',
      unit: 'SHIP',
      unitPrice: '115',
      subtotal: '115.00',
      mark: 'A',
    },
    {
      id: '2',
      lineNo: 2,
      description: 'TRUCKING FEE',
      qty: '2',
      unit: 'TRUCK',
      unitPrice: '20.5',
      subtotal: '41.00',
      mark: '',
    },
  ],
  totals: { subtotal: '156.00', vat: '0', total: '156.00' },
} as unknown as BillingDoc;

describe('Credit Noted Excel export', () => {
  it('names the file after the house bill', () => {
    expect(creditNoteFileName(doc)).toBe('CreditNote_HIP26932472');
    expect(creditNoteFileName({ ...doc, header: {} } as BillingDoc)).toBe('CreditNote_CN26-001');
  });

  it('lays the sheet out like the printout, in Calibri, with live formulas', async () => {
    await exportCreditNoteExcel(doc, 'Sihanoukville');
    expect(saved.name).toBe('CreditNote_HIP26932472.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await new Promise<ArrayBuffer>((resolve) => {
        const fr = new FileReader(); // jsdom's Blob has no arrayBuffer()
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.readAsArrayBuffer(saved.blob!);
      }),
    );
    const ws = wb.getWorksheet('Credit Note')!;

    expect(ws.getCell('A1').value).toBe('CREDIT NOTED');
    expect(ws.getCell('B3').value).toBe('GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.');
    expect(ws.getCell('B6').value).toBe('SIHANOUKVILLE');
    // The address breaks after "Tuol Sangke II", like the sample sheet; the house bill
    // beside it is centred vertically.
    expect(ws.getCell('B4').value).toBe(
      '#7E0, Beton Street, Group 7, Tuol Thngan Village, Tuol Sangke II\n' +
        'Sangkat, Russey Keo District, Phnom Penh, Cambodia.',
    );
    expect(ws.getRow(4).height).toBe(30);
    expect(ws.getCell('E4').alignment).toMatchObject({ vertical: 'middle' });
    expect(ws.getCell('F4').alignment).toMatchObject({ vertical: 'middle' });
    expect(ws.getCell('E3').alignment).toMatchObject({ vertical: 'top' });
    expect(ws.getCell('E4').value).toBe('HOUSE BILL:');
    expect(ws.getCell('F5').value).toBe('12-Oct-2026');
    expect(ws.getCell('F7').value).toBe('2,380.67 KGS');

    // Table header, two lines with formulas, and the TOTAL row.
    const head = 10;
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => ws.getCell(head, c).value)).toEqual([
      'NO',
      'DESCRIPTION',
      "Q'TY",
      'UNIT',
      'PRICE',
      'SUBTOTAL',
      'MARK',
    ]);
    expect(ws.getCell(head + 1, 2).value).toBe('CLEARANCE');
    expect(ws.getCell(head + 2, 6).formula).toBe(`ROUND(C${head + 2}*E${head + 2},2)`);
    expect(ws.getCell(head + 3, 1).value).toBe('TOTAL:');
    expect(ws.getCell(head + 3, 6).formula).toBe(`SUM(F${head + 1}:F${head + 2})`);

    // Every used cell is Calibri, never Helvetica / Arial.
    const fonts = new Set<string>();
    ws.eachRow((row) => row.eachCell((cell) => fonts.add(String(cell.font?.name))));
    expect([...fonts]).toEqual(['Calibri']);
  });

  it('packs several credit notes into one workbook, one sheet each', async () => {
    const second = {
      ...doc,
      id: 'y',
      number: 'CN26-002',
      header: { ...doc.header, declareNo: 'E 41101' },
    } as BillingDoc;
    const noDeclare = {
      ...doc,
      id: 'z',
      number: 'CN26-003',
      header: { ...doc.header, declareNo: '', refNo: 'KHS2609038' },
    } as BillingDoc;
    await exportCreditNotePackExcel(
      [doc, second, noDeclare, doc].map((d) => ({ doc: d, portName: 'Sihanoukville' })),
      'CreditNoted_2026-09.xlsx',
    );
    expect(saved.name).toBe('CreditNoted_2026-09.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await new Promise<ArrayBuffer>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.readAsArrayBuffer(saved.blob!);
      }),
    );
    // Named after the note and its declare no. (house bill when there is none); a repeated
    // name gets a number, since Excel sheet names must be unique.
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'CN26-001 I 95116',
      'CN26-002 E 41101',
      'CN26-003 KHS2609038',
      'CN26-001 I 95116 2',
    ]);
    expect(wb.getWorksheet('CN26-002 E 41101')!.getCell('A1').value).toBe('CREDIT NOTED');
  });
});
