import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { cutStockItems } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

/* Shipping Plan → Import Excel: download the template, fill it, check it, save it. */

const app = createApp();
let tokens: Partial<Record<RoleCode, string>> = {};
async function as(role: RoleCode) {
  if (!tokens[role]) {
    await createUser(role);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}

/** The downloaded template, as a workbook to fill in. */
async function template() {
  const res = await request(app)
    .get('/api/v1/shipments/import-template.xlsx')
    .set(await as('OPERATOR'))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return wb;
}
/** Adds rows to a sheet by heading (any order), e.g. { 'Ref *': 1, 'Client *': 'JR' }. */
function fill(wb: ExcelJS.Workbook, sheet: string, rows: Record<string, unknown>[]) {
  const ws = wb.getWorksheet(sheet)!;
  const cols = new Map<string, number>();
  ws.getRow(1).eachCell((c, i) => cols.set(String(c.value), i));
  // The template formats 500 rows ahead: fill from the first row with nothing in it.
  let next = 3;
  while (
    ws.getRow(next).values.length &&
    (ws.getRow(next).values as unknown[]).some((v) => v !== undefined && v !== null && v !== '')
  )
    next++;
  for (const r of rows) {
    const row = ws.getRow(next++);
    for (const [h, v] of Object.entries(r))
      row.getCell(cols.get(h)!).value = v as ExcelJS.CellValue;
  }
}
async function upload(wb: ExcelJS.Workbook, save: boolean) {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return request(app)
    .post(`/api/v1/shipments/import${save ? '?save=1' : ''}`)
    .set(await as('OPERATOR'))
    .attach('file', buf, 'plan.xlsx');
}
let basics: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
  await db.insert(cutStockItems).values(
    [
      ['II-124', 'WOVEN FABRIC'],
      ['II-125', 'KNITTED FABRIC'],
      ['III-130', 'INTERLINING'],
    ].map(([declareRef, name], i) => ({
      clientId: basics.jr.id,
      lineNo: i + 1,
      declareRef: declareRef!,
      category: 'RAW_MATERIAL' as const,
      name: name!,
      unit: 'MTR',
      qty: '100000',
    })),
  );
});
afterAll(async () => {
  await pool.end();
});

/** Rows as they appear on the client's import schedule: two shipments, three invoices. */
function importRows(wb: ExcelJS.Workbook) {
  fill(wb, 'Imports', [
    {
      'Client *': 'JR',
      'ETA PORT': new Date(Date.UTC(2026, 8, 23)),
      'ETA FTY': '28-Sep-26',
      'F.W\nBROKER': 'FWF\nGRATEFUL',
      SHIPPER: 'SHANGHAI YOUNGYUE',
      INV: 'CNQ26044',
      DATE: '31-Aug-26',
      'QTY PKGS': 635,
      'ORG / DEST': 'CH-SHV',
      MONTH: '09-2026',
      MATERIAL: 'II. RAW MATERIAL',
      ITEM: 'KNITTED FABRIC',
      'CDC NO': 'II-125',
      QUANTITY: 32636.7,
      'CDC UNIT': 'MTR',
      'NW.KGS': 17932.6,
      'GW.KGS': 18111.7,
      'UNIT PRICE': 1,
      AMOUNT: 32636.7,
      HBL: 'SHSIN6090031',
      MARK: 'Unload at XIN YI YANG\nCTNR No. ZCSU7954124 / 40’HQ\nSeal No. A4250250303\nVessel: NUUK MAERSK / 634S',
      DECLARE: 'I 138735',
      'DECLARE\nDATE': '25-Sep-26',
      'THC\nFEE': '$599.50',
      'INVOICE\nDATE': '22-Sep-26',
      'INVOICE\nNUMBER': 'FWFTI268937\nFWFTI268938',
    },
    {
      // Merged cells read as empty: this row runs on into the shipment and invoice above.
      MATERIAL: 'III. ACCESSORY',
      ITEM: 'INTERLINING',
      'CDC NO': 'III-130',
      QUANTITY: 4968.8,
      'CDC UNIT': 'MTR',
      'NW.KGS': 678.8,
      'GW.KGS': 697.8,
      'UNIT PRICE': 0.2,
      DECLARE: 'I 138735',
    },
    {
      'ETA PORT': '17-Sep-26',
      'F.W\nBROKER': 'FWF / GRATEFUL',
      SHIPPER: 'SHANGHAI YOUNGYUE',
      INV: 'CNQ26046',
      DATE: '10-Sep-26',
      'QTY PKGS': 797,
      'ORG / DEST': 'CH-SHV',
      MATERIAL: 'II. RAW MATERIAL',
      ITEM: 'KNITTED FABRIC',
      'CDC NO': 'II-125',
      QUANTITY: 43579.5,
      'UNIT PRICE': 1,
      HBL: 'SHSIN6090083',
      MARK: 'CTNR No. OOCU7012318 / 40’HQ\nSeal No. CX793514\nVessel: PALAWAN / 038S',
      DECLARE: 'I 136252',
      'DECLARE\nDATE': '19-Sep-26',
    },
    {
      INV: 'CNQ26047',
      'QTY PKGS': 688,
      ITEM: 'WOVEN FABRIC',
      'CDC NO': 'II-124',
      QUANTITY: 69565,
      'UNIT PRICE': 1.8,
    },
  ]);
}

describe('shipping plan Excel import', () => {
  it('the template has an Imports sheet like the import schedule, without PO# or Style', async () => {
    const wb = await template();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Instructions',
      'Lists',
      'Imports',
      'Exports',
      'Export Containers',
      'Export Invoices',
      'Export Declarations',
    ]);
    const heads = (sheet: string) =>
      (wb.getWorksheet(sheet)!.getRow(1).values as unknown[]).filter(Boolean).map(String);
    expect(heads('Imports')).toEqual(
      expect.arrayContaining(['ETA PORT', 'CDC NO', 'QUANTITY', 'HBL', 'MARK', 'DECLARE']),
    );
    expect(heads('Imports')).not.toContain('PO#');
    expect(heads('Imports')).not.toContain('Style');
    expect(wb.getWorksheet('Imports')!.getCell('A2').value).toBe('EXAMPLE');
    expect(wb.getWorksheet('Imports')!.getCell('A4').dataValidation?.type).toBe('list');
    expect(wb.getWorksheet('Exports')!.getCell('B3').dataValidation?.type).toBe('list');
  });

  it('reads import schedule rows into shipments with invoices, declarations and CDC lines', async () => {
    const wb = await template();
    importRows(wb);
    const check = await upload(wb, false);
    expect(check.body.errors).toEqual([]);
    expect(check.body.shipments).toMatchObject([
      {
        ref: 'SHSIN6090031',
        clientCode: 'JR',
        direction: 'IMPORT',
        transport: 'SEA FCL',
        containers: 1,
        invoices: 1,
        declarations: 1,
        date: '2026-09-23',
      },
      { ref: 'SHSIN6090083', containers: 1, invoices: 2, declarations: 1, date: '2026-09-17' },
    ]);
    expect(check.body.newForwarders).toEqual(['FWF']);

    const saved = await upload(wb, true);
    expect(saved.body.errors).toEqual([]);
    expect(saved.body.saved).toBe(true);
    const detail = await request(app)
      .get(`/api/v1/shipments/${saved.body.shipments[0].id}`)
      .set(await as('OPERATOR'));
    expect(detail.body).toMatchObject({
      direction: 'IMPORT',
      // It has its ETA Factory date, so it is completed.
      status: 'COMPLETED',
      hblNo: 'SHSIN6090031',
      shipperName: 'SHANGHAI YOUNGYUE',
      broker: 'GRATEFUL',
      originCountryIso2: 'CN',
      eta: '2026-09-23',
      arriveFty: '2026-09-28',
      quantityUnit: 'PKGS',
      vesselName: 'NUUK MAERSK',
      voyageNo: '634S',
      thcHblNo: 'FWFTI268937, FWFTI268938',
      thcHblDate: '2026-09-22',
    });
    expect(Number(detail.body.quantity)).toBe(635);
    expect(Number(detail.body.thcHblAmount)).toBe(599.5);
    expect(detail.body.containers).toMatchObject([
      { containerNo: 'ZCSU7954124', size: '40HQ', linerSeal: null },
    ]);
    expect(detail.body.invoices).toHaveLength(1);
    expect(Number(detail.body.invoices[0].packages)).toBe(635);
    // Import lines are CDC items, as on the import schedule: no PO / style / HTS.
    expect(detail.body.invoices[0].lines[1]).toMatchObject({
      material: 'III. ACCESSORY',
      description: 'INTERLINING',
      cdcNo: 'III-130',
      unit: 'MTR',
      poNo: null,
      styleNo: null,
      htsCode: null,
    });
    expect(Number(detail.body.invoices[0].lines[1].pcs)).toBe(4968.8);
    expect(Number(detail.body.invoices[0].lines[1].fobAmount)).toBe(993.76);
    expect(detail.body.declarations[0]).toMatchObject({
      declareNo: 'I 138735',
      declareDate: '2026-09-25',
    });
    // Each CDC NO draws down the client's master list.
    expect(
      detail.body.invoices[0].lines.map(
        (l: { cutStockItemId: string | null }) => !!l.cutStockItemId,
      ),
    ).toEqual([true, true]);

    const second = await request(app)
      .get(`/api/v1/shipments/${saved.body.shipments[1].id}`)
      .set(await as('OPERATOR'));
    expect(Number(second.body.quantity)).toBe(1485);
    // Declared but no ETA Factory yet.
    expect(second.body.status).toBe('IN_PROGRESS');
    expect(
      second.body.invoices.flatMap((i: { lines: { cutStockItemId: string | null }[] }) =>
        i.lines.map((l) => !!l.cutStockItemId),
      ),
    ).toEqual([true, true]);
  });

  it('points at the import rows that are wrong', async () => {
    const wb = await template();
    fill(wb, 'Imports', [
      {
        'Client *': 'JR',
        INV: 'CNQ1',
        'ORG / DEST': 'XX-ZZZ',
        'CDC NO': 'IX-999',
        QUANTITY: 5,
        HBL: 'HBL1',
        DECLARE: 'I 1',
      },
      { ITEM: 'NO INVOICE', 'Client *': 'JYX', HBL: 'HBL2' },
    ]);
    const res = await upload(wb, false);
    const msgs = res.body.errors.map(
      (e: { sheet: string; row: number | null; message: string }) =>
        `${e.sheet}:${e.row}: ${e.message}`,
    );
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Imports:4: ORG / DEST "XX-ZZZ": XX is not a known country.',
        'Imports:4: ORG / DEST "XX-ZZZ": ZZZ is not one port; fill in Clearance Port.',
        "Imports:4: CDC NO IX-999 is not on JR's CDC master list.",
        'Imports:4: DECLARE DATE is empty for I 1.',
        'Imports:5: INV is empty and there is no invoice above it for this shipment.',
      ]),
    );
  });

  it('checks first, then saves exports with their containers, invoices and declarations', async () => {
    const wb = await template();
    fill(wb, 'Exports', [
      {
        'Ref *': 1,
        'Client *': 'JR',
        'Freight *': 'Sea',
        Load: 'CY/CY',
        Consignee: 'CHAPTERONE SPORTSWEAR',
        Forwarder: 'COSCO Shipping',
        'Clearance Port': 'SHV11',
        'Destination Country': 'United States',
        Quantity: 1150,
        Unit: 'ctns',
        'HBL No.': 'cosu6464276980',
        ETD: new Date(Date.UTC(2026, 8, 3)),
        ATD: '2026-09-04',
        'CO Status': 'Approved',
      },
    ]);
    fill(wb, 'Export Containers', [
      { 'Ref *': 1, 'Container No. *': 'CXDU2223299', Size: '45HQ' },
      { 'Ref *': 1, 'Container No. *': 'TEMU8045497', Size: '40HQ' },
    ]);
    fill(wb, 'Export Invoices', [
      {
        'Ref *': 1,
        'Invoice No. *': 'JRA26051',
        'Invoice Date': '2026-08-28',
        'PO#': '003816',
        Style: 'RT26731CH',
        'HTS Code': '6104.69',
        PCS: 6000,
        CTNS: 600,
        'G.W KGS': 8000,
        'FOB Price': 2.5,
      },
      { 'Ref *': 1, 'HTS Code': '6104.69', PCS: 6000, CTNS: 550, 'FOB Price': 2.5 },
    ]);
    fill(wb, 'Export Declarations', [
      { 'Ref *': 1, 'Declare No. *': 'E 264562', 'Declare Date *': '2026-09-02' },
    ]);
    const check = await upload(wb, false);
    expect(check.status).toBe(200);
    expect(check.body.errors).toEqual([]);
    expect(check.body.saved).toBe(false);
    expect(check.body.shipments).toMatchObject([
      {
        ref: '1',
        clientCode: 'JR',
        direction: 'EXPORT',
        transport: 'SEA FCL',
        containers: 2,
        invoices: 1,
        declarations: 1,
        date: '2026-09-03',
      },
    ]);
    expect(check.body.newForwarders).toEqual(['COSCO Shipping']);
    expect(check.body.newConsignees).toEqual([{ name: 'CHAPTERONE SPORTSWEAR', clientCode: 'JR' }]);
    // Nothing saved by the check.
    const none = await request(app)
      .get('/api/v1/shipments')
      .set(await as('OPERATOR'));
    expect(none.body.meta.total).toBe(0);

    const saved = await upload(wb, true);
    expect(saved.body.saved).toBe(true);
    expect(saved.body.shipments[0].reference).toBe('SHP-26-0001');
    const detail = await request(app)
      .get(`/api/v1/shipments/${saved.body.shipments[0].id}`)
      .set(await as('OPERATOR'));
    expect(detail.body).toMatchObject({
      direction: 'EXPORT',
      loadType: 'FCL',
      status: 'COMPLETED',
      hblNo: 'COSU6464276980',
      quantityUnit: 'CTNS',
      etd: '2026-09-03',
      eta: null,
      coStatus: 'Approved',
      destinationCountryIso2: 'US',
    });
    expect(detail.body.containers.map((c: { containerNo: string }) => c.containerNo)).toEqual([
      'CXDU2223299',
      'TEMU8045497',
    ]);
    // The empty Invoice No. continued JRA26051: one invoice, two lines.
    expect(detail.body.invoices).toHaveLength(1);
    expect(detail.body.invoices[0].lines).toHaveLength(2);
    expect(detail.body.invoices[0].lines[0]).toMatchObject({
      poNo: '003816',
      styleNo: 'RT26731CH',
    });

    // Uploading the same file again: its numbers are already in the system.
    const again = await upload(wb, true);
    expect(again.body.saved).toBe(false);
    expect(again.body.errors.map((e: { message: string }) => e.message)).toEqual(
      expect.arrayContaining([
        'Declare No. E 264562 (1) is already in the system.',
        'Invoice No. JRA26051 (1) is already in the system.',
      ]),
    );
  });

  it('lists every export problem by sheet and row and saves nothing', async () => {
    const wb = await template();
    fill(wb, 'Exports', [
      { 'Ref *': 1, 'Client *': 'ZZZ', 'Freight *': 'Boat' },
      {
        'Ref *': 2,
        'Client *': 'JR',
        'Freight *': 'Sea',
        Load: 'LCL',
        'Clearance Port': 'Nowhere',
      },
    ]);
    fill(wb, 'Export Containers', [{ 'Ref *': 2, 'Container No. *': 'ABCD1234567', Size: '99XX' }]);
    fill(wb, 'Export Declarations', [
      { 'Ref *': 2, 'Declare No. *': 'E 1', 'Declare Date *': 'soon' },
      { 'Ref *': 7, 'Declare No. *': 'E 2', 'Declare Date *': '2026-09-01' },
    ]);
    const res = await upload(wb, true);
    expect(res.body.saved).toBe(false);
    const msgs = res.body.errors.map(
      (e: { sheet: string; row: number | null; message: string }) =>
        `${e.sheet}:${e.row}: ${e.message}`,
    );
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Exports:3: Client "ZZZ" is not in the system.',
        'Exports:3: Freight must be Sea, Air, Truck or Rail.',
        'Exports:4: Clearance Port "Nowhere" is not in the system.',
        'Export Containers:3: Size "99XX" must be 20GP, 40GP, 40HQ or 45HQ.',
        'Export Declarations:3: Declare Date: "soon" is not a date (use 2026-09-03 or 03/09/2026).',
        'Export Declarations:4: Ref 7 is not on the Exports sheet.',
      ]),
    );
    // Containers on an LCL shipment: the form's own rule.
    expect(msgs.some((m: string) => m.includes('Containers are only recorded for CY/CY'))).toBe(
      true,
    );
    const none = await request(app)
      .get('/api/v1/shipments')
      .set(await as('OPERATOR'));
    expect(none.body.meta.total).toBe(0);
  });

  it('needs shipments write access', async () => {
    const res = await request(app)
      .post('/api/v1/shipments/import')
      .set(await as('VIEWER'))
      .attach('file', Buffer.from('x'), 'plan.xlsx');
    expect(res.status).toBe(403);
  });
});
