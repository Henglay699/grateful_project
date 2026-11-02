import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { BillingDoc, BillingPack } from '@gs/shared';

const saved: { blob?: Blob; name?: string } = {};
vi.mock('../../lib/files', () => ({
  saveBlob: (blob: Blob, name: string) => Object.assign(saved, { blob, name }),
}));
// No logo in the test: the export goes on without it.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false })),
);
const { exportInvoiceExcel, invoiceFileName } = await import('./invoiceExport');
const { buildPackWorkbook, packFileName } = await import('./packExport');

const company = {
  nameKm: 'ក្រុមហ៊ុន ហ្គ្រេតហ្វ៊ូល សឹលូសិន (ខេមបូឌា) ឯ.ក',
  nameEn: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.',
  vattin: 'K008-902404873',
  bankName: 'KB PRASAC BANK PLC',
  bankAccountName: 'GRATEFUL SOLUTIONS (CAMBODIA) CO.,LTD.',
  bankAccountNo: '033 754 230 001',
};

const header = {
  customerNameKm: 'ជេអរ',
  customerNameEn: 'JR APPAREL CO.,LTD',
  customerAddress: 'KAOH KNOR VILLAGE PREAEK ROKA COMMUNE KANDAL STUENG DISTRICT, KANDAL',
  customerVattin: 'L001-902501613',
  shipper: 'JR APPAREL CO., LTD.',
  consignee: 'CHAPTERONE SPORTSWEAR',
  hbl: 'COSU6464276980',
  pkgs: '1,150 CTNS',
  grossWeightKg: '16864.8',
  volumeCbm: '12',
  containerNo: 'CXDU2223299',
  pol: 'PNH PORT',
  pod: 'USA',
  exchangeRate: '4100',
  billTo: 'JR APPAREL CO.,LTD',
  address: 'KAOH KNOR VILLAGE PREAEK ROKA COMMUNE KANDAL STUENG DISTRICT, KANDAL',
};

const line = (lineNo: number, description: string, unitPrice: string, vat: string) => ({
  id: String(lineNo),
  lineNo,
  description,
  qty: '1',
  unit: '45H',
  unitPrice,
  subtotal: unitPrice,
  vat,
  amount: String(Number(unitPrice) + Number(vat)),
  mark: null,
});

const doc = (over: Partial<BillingDoc>) =>
  ({
    id: 'x',
    status: 'ISSUED',
    date: '2026-09-03',
    clientId: 'c',
    clientCode: 'JR',
    clientName: 'JR Apparel',
    accountingRecordId: 'r1',
    declareNo: 'E 264562',
    header,
    ...over,
  }) as BillingDoc;

const tax = doc({
  id: 't',
  type: 'tax-invoices',
  number: 'GS26-360',
  lines: [line(1, 'EXPORT PROCESSING FEE', '242', '24.2')],
  totals: {
    subtotal: '242',
    vat: '24.2',
    total: '266.2',
    subtotalKhr: '992200',
    vatKhr: '99220',
    totalKhr: '1091420',
  },
});
const dis = doc({
  id: 'd',
  type: 'disbursements',
  number: 'DIS403',
  lines: [line(1, 'LOLO AT PORT', '77', '0'), line(2, 'HBL FEE', '539', '0')],
  totals: { subtotal: '616', vat: '0', total: '616' },
});
const dn = doc({
  id: 'n',
  type: 'debit-notes',
  number: 'JR2609001',
  lines: [line(1, 'TRUCKING FEE', '260', '0'), line(2, 'HANDLING FEE', '35', '0')],
  totals: { subtotal: '295', vat: '0', total: '295' },
});

async function load() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    await new Promise<ArrayBuffer>((resolve) => {
      const fr = new FileReader(); // jsdom's Blob has no arrayBuffer()
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.readAsArrayBuffer(saved.blob!);
    }),
  );
  return wb;
}
const text = (v: ExcelJS.CellValue) =>
  typeof v === 'string' ? v : (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');

describe('Invoice Excel', () => {
  it('exports a tax invoice laid out like its printed sheet', async () => {
    await exportInvoiceExcel(tax, company);
    expect(saved.name).toBe('GS26-360.xlsx');
    const ws = (await load()).getWorksheet('GS26-360')!;
    // Letterhead, then the title under a heavy rule.
    expect(ws.getCell('A2').value).toBe(company.nameKm);
    expect(ws.getCell('A3').value).toBe(company.nameEn);
    expect(ws.getCell('A4').value).toBe('លេខអត្តសញ្ញាណកម្ម អតប (VATTIN) : K008-902404873');
    expect(ws.getCell('H1').value).toBeNull(); // issued: no DRAFT mark
    expect(ws.getCell('A8').value).toBe('វិក្កយបត្រអាករ');
    expect(ws.getCell('A8').border?.top?.style).toBe('thick');
    expect(ws.getCell('A9').value).toBe('TAX INVOICE');
    // Customer on the left, the invoice on the right.
    expect(text(ws.getCell('A12').value)).toBe('JR APPAREL CO.,LTD');
    expect(text(ws.getCell('D11').value)).toBe('លេខវិក្កយបត្រ / Invoice No: GS26-360');
    expect(text(ws.getCell('D12').value)).toBe('កាលបរិច្ឆេទវិក្កយបត្រ / Invoice Date: 03-SEP-2026');
    expect(ws.getCell('D14').value).toBe('GROSS WEIGHT: 16,864.80 KGS');
    expect(ws.getCell('D19').value).toBe('Exchange Rate: 1USD = 4,100 KHR');
    expect(ws.getCell('D19').alignment?.horizontal).toBe('right');
    // Two-line headings between 2px rules; lines with formulas.
    expect(text(ws.getCell('B21').value)).toBe('បរិយាយមុខទំនិញ\nDescription');
    expect(ws.getCell('B21').border?.top?.style).toBe('medium');
    expect(ws.getCell('B22').value).toBe('EXPORT PROCESSING FEE');
    expect(ws.getCell('F22').value).toMatchObject({ formula: 'ROUND(C22*E22,2)', result: 242 });
    expect(ws.getCell('G22').value).toMatchObject({ formula: 'ROUND(F22*0.1,2)', result: 24.2 });
    expect(ws.getCell('H22').value).toMatchObject({ formula: 'F22+G22', result: 266.2 });
    // Totals between double rules, KHR and USD.
    expect(ws.getCell('A24').value).toBe('សរុប SUB TOTAL');
    expect(ws.getCell('A24').border?.top?.style).toBe('double');
    expect(ws.getCell('H24').value).toMatchObject({ formula: 'SUM(F22:F22)', result: 242 });
    expect(ws.getCell('H25').value).toMatchObject({ formula: 'SUM(G22:G22)', result: 24.2 });
    expect(ws.getCell('H26').value).toMatchObject({ formula: 'H24+H25', result: 266.2 });
    expect(ws.getCell('F26').value).toMatchObject({
      formula: 'ROUND(H26*4100,0)',
      result: 1091420,
    });
    expect(ws.getCell('A28').value).toBe('Note: You can make payment by cross cheque to:');
    // Signatures at the page foot.
    expect(ws.getCell('A37').value).toBe('ហត្ថលេខា និង ឈ្មោះអ្នកទិញ');
    expect(ws.getCell('F37').value).toBe('ហត្ថលេខា និង ឈ្មោះអ្នកលក់');
    expect(ws.getRow(34).height).toBeGreaterThan(50);
  });

  it('shows the volume as NON for a shipment by air', async () => {
    await exportInvoiceExcel(tax, company);
    const sea = (await load()).getWorksheet('GS26-360')!;
    expect(sea.getCell('D15').value).toBe('VOLUME: 12 CBM');
    await exportInvoiceExcel({ ...tax, header: { ...tax.header, transportMode: 'AIR' } }, company);
    const ws = (await load()).getWorksheet('GS26-360')!;
    expect(ws.getCell('D15').value).toBe('VOLUME: NON');
  });

  it('exports a draft disbursement at VAT 0%, marked DRAFT', async () => {
    const draft = { ...dis, status: 'DRAFT', number: null } as BillingDoc;
    expect(invoiceFileName(draft)).toBe('Disbursement_JR_draft');
    await exportInvoiceExcel(draft, company);
    const ws = (await load()).worksheets[0]!;
    expect(ws.getCell('A9').value).toBe('DISBURSEMENT');
    expect(ws.getCell('H1').value).toBe('DRAFT');
    expect(ws.getCell('G22').value).toBe('-');
    expect(ws.getCell('H23').value).toMatchObject({ formula: 'F23', result: 539 });
    expect(ws.getCell('H25').value).toMatchObject({ formula: 'SUM(H22:H23)', result: 616 });
    expect(ws.getCell('H26').value).toBe('-');
    expect(ws.getCell('H27').value).toMatchObject({ formula: 'H25', result: 616 });
  });

  it('exports a debit note like its printed sheet', async () => {
    await exportInvoiceExcel(dn, company);
    expect(saved.name).toBe('JR2609001.xlsx');
    const ws = (await load()).getWorksheet('JR2609001')!;
    expect(ws.getCell('A2').value).toBe('DEBIT NOTE');
    expect(text(ws.getCell('A4').value)).toBe('Customer: JR APPAREL CO.,LTD');
    expect(text(ws.getCell('C4').value)).toBe('DN No: JR2609001');
    expect(text(ws.getCell('C5').value)).toBe('DN Date: 03-SEP-2026');
    expect(ws.getCell('A6').value).toBe('SHIPPER: JR APPAREL CO., LTD.');
    expect(ws.getCell('B12').value).toBe('DESCRIPTION');
    expect(ws.getCell('F13').value).toMatchObject({ formula: 'ROUND(C13*E13,2)', result: 260 });
    expect(ws.getCell('A15').value).toBe('GRAND TOTAL:');
    expect(ws.getCell('F15').value).toMatchObject({ formula: 'SUM(F13:F14)', result: 295 });
    expect(ws.getCell('A18').value).toBe('Thank you for your supporting');
    expect(ws.getCell('D18').value).toBe('AUTHORIZED SIGNATURE');
  });
});

describe('Month pack Excel', () => {
  const docs = { 'tax-invoices': [tax], disbursements: [dis], 'debit-notes': [dn] };
  const pack = {
    client: {
      id: 'c',
      code: 'JR',
      name: 'JR Apparel',
      legalName: 'JR Apparel Co., Ltd.',
      address: 'Kaoh Knor Village',
    },
    month: '2026-09',
    rows: [
      {
        recordId: 'r1',
        invDate: '2026-09-02',
        declareNo: 'E 264562',
        docs: Object.fromEntries(
          Object.entries(docs).map(([k, v]) => [
            k,
            v.map((d) => ({ ...d, total: d.totals.total })),
          ]),
        ),
      },
    ],
    others: [],
    docs: [tax, dis, dn],
    statements: {
      INVOICE: {
        kind: 'INVOICE',
        lines: [
          {
            date: '2026-09-03',
            invNo: 'GS26-360',
            disNo: 'DIS403',
            dnNo: null,
            ref: 'COSU6464276980',
            amount: '882.2',
          },
        ],
        total: '882.2',
        received: '0',
        balance: '882.2',
        receipts: [],
        drafts: 0,
      },
      DEBIT_NOTE: {
        kind: 'DEBIT_NOTE',
        lines: [
          {
            date: '2026-09-03',
            invNo: null,
            disNo: null,
            dnNo: 'JR2609001',
            ref: 'COSU6464276980',
            amount: '295',
          },
        ],
        total: '295',
        received: '0',
        balance: '295',
        receipts: [],
        drafts: 0,
      },
    },
    summary: { drafts: 0 },
  } as unknown as BillingPack;

  it('builds the printed pack as sheets, the statements linked by formulas', () => {
    expect(packFileName('JR', '2026-09')).toBe('JR_SEP-2026_Pack');
    const wb = new ExcelJS.Workbook();
    buildPackWorkbook(
      wb,
      pack,
      company,
      null,
      '2026-09',
      ['docs', 'st-INVOICE', 'st-DEBIT_NOTE', 'receipts', 'checklist'],
      'Lycheng',
      '2026-10-03',
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'GS26-360 & DIS403',
      'JR2609001',
      'Statement INV',
      'Statement DN',
      'Receipts',
      'Checklist',
    ]);

    // The tax invoice (A–H) and disbursement (I–P) side by side, their totals on one row.
    const pair = wb.getWorksheet('GS26-360 & DIS403')!;
    expect(pair.getCell('A9').value).toBe('TAX INVOICE');
    expect(pair.getCell('I9').value).toBe('DISBURSEMENT');
    expect(pair.getCell('I2').value).toBe(company.nameKm);
    expect(pair.getCell('P23').value).toMatchObject({ formula: 'N23', result: 539 });
    expect(pair.getCell('H25').value).toMatchObject({ formula: 'SUM(F22:F22)', result: 242 });
    expect(pair.getCell('P25').value).toMatchObject({ formula: 'SUM(P22:P23)', result: 616 });
    expect(pair.getCell('I38').value).toBe('ហត្ថលេខា និង ឈ្មោះអ្នកទិញ');
    expect(pair.pageSetup.printArea).toBe('A1:P40');

    const st = wb.getWorksheet('Statement INV')!;
    expect(st.getCell('A2').value).toBe(company.nameKm); // the invoice's letterhead
    expect(st.getCell('A8').value).toBe('Account Statement');
    expect(st.getCell('A9').value).toBe('Date: 01-09-2026 ~ 30-09-2026');
    expect(st.getCell('A11').value).toBe('JR APPAREL CO., LTD.');
    expect(st.getCell('C14').value).toBe('INV Number');
    expect(st.getCell('C16').value).toBe('GS26-360');
    expect(st.getCell('B16').numFmt).toBe('dd\\-mmm\\-yyyy');
    expect(st.getCell('G16').value).toMatchObject({
      formula: "SUM('GS26-360 & DIS403'!H27,'GS26-360 & DIS403'!P27)",
      result: 882.2,
    });
    expect(text(st.getCell('B18').value)).toBe('BALANCE AS  SEP-2026');
    expect(st.getCell('G18').value).toMatchObject({ formula: 'SUM(G16:G17)', result: 882.2 });
    expect(st.getCell('A18').border?.bottom?.style).toBe('thick');
    expect(st.pageSetup.printTitlesRow).toBe('14:14');
    expect(st.views[0]).toMatchObject({ style: 'pageBreakPreview' });

    const sd = wb.getWorksheet('Statement DN')!;
    expect(sd.getCell('A3').value).toBe('Account Statement'); // no letterhead
    expect(sd.getCell('C11').value).toBe('JR2609001');
    expect(sd.getCell('F11').value).toMatchObject({ formula: "'JR2609001'!F15", result: 295 });

    // Both balances due: an advance receipt for each, the invoices one with the letterhead.
    const or = wb.getWorksheet('Receipts')!;
    expect(or.getCell('A2').value).toBe(company.nameEn);
    expect(or.getCell('A6').value).toBe('OFFICIAL RECEIPT');
    expect(or.getCell('A8').value).toBe('Received from');
    expect(or.getCell('C8').value).toBe(': JR APPAREL CO., LTD.');
    expect(or.getCell('H8').value).toBe('30-Sep-26');
    expect(or.getCell('D9').value).toBe(882.2);
    expect(or.getCell('C10').value).toMatch(/^: EIGHT HUNDRED EIGHTY TWO DOLLARS/);
    expect(or.getCell('C11').value).toBe(': SEP-2026');
    expect(or.getCell('C12').value).toBe(':  ☐ BANK      ☐ CASH      ☐ CHEQUE');
    expect(or.getColumn(1).values.filter((v) => v === 'OFFICIAL RECEIPT')).toHaveLength(2);

    const cl = wb.getWorksheet('Checklist')!;
    expect(text(cl.getCell('A3').value)).toBe('To: JR APPAREL CO., LTD.');
    expect(cl.getCell('B6').value).toBe('DOC NO');
    expect(cl.getCell('B7').value).toBe('GS26-360 · DIS403 · JR2609001');
    expect(cl.getCell('D7').numFmt).toBe('dd\\-mm\\-yyyy');
  });

  it('breaks the shared sheet into two pages', async () => {
    const wb = new ExcelJS.Workbook();
    buildPackWorkbook(wb, pack, company, null, '2026-09', ['docs'], '', '2026-10-03');
    const { workbookBlob } = await import('./invoiceExport');
    const blob = await workbookBlob(wb);
    const buf = await new Promise<ArrayBuffer>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.readAsArrayBuffer(blob);
    });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain(
      '<colBreaks count="1" manualBreakCount="1"><brk id="8" max="1048575" man="1"/></colBreaks>',
    );
    expect(await zip.file('xl/worksheets/sheet2.xml')!.async('string')).not.toContain('colBreaks');
    // Still a workbook Excel can open.
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf);
    expect(back.worksheets[0]!.getCell('I9').value).toBe('DISBURSEMENT');
  });

  it('exports only the parts asked for', () => {
    const wb = new ExcelJS.Workbook();
    buildPackWorkbook(wb, pack, company, null, '2026-09', ['st-INVOICE'], '', '2026-10-03');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Statement INV']);
    // No document sheets: the statement keeps the amounts as values.
    expect(wb.getWorksheet('Statement INV')!.getCell('G16').value).toBe(882.2);
  });
});
