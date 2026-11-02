import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomsReportData, ProductionReportData, RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { pool } from '../../db/client';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

const app = createApp();
let basics: Awaited<ReturnType<typeof seedBasics>>;
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

let invoiceNo = 0;
/** An export shipment with one invoice (one HTS code) dated `invoiceDate`. */
async function exportInvoice(
  invoiceDate: string | null,
  etd: string,
  hts: string,
  lines: [description: string, pcs: number][],
) {
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('OPERATOR'))
    .send({
      clientId: basics.jr.id,
      direction: 'EXPORT',
      transportMode: 'SEA',
      loadType: 'FCL',
      status: 'IN_PROGRESS',
      clearancePortId: basics.port.id,
      destinationCountryIso2: 'US',
      etd,
      invoices: [
        {
          invoiceNo: `JR-EXP-${++invoiceNo}`,
          invoiceDate,
          lines: lines.map(([description, pcs]) => ({ description, pcs, htsCode: hts })),
        },
      ],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
}

const report = async (month: string, role: RoleCode = 'ACCOUNTANT') =>
  request(app)
    .get('/api/v1/reports/production')
    .query({ clientId: basics.jr.id, month })
    .set(await as(role));

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('capacity report', () => {
  it('sums the month’s export invoice lines by product line, by invoice date', async () => {
    await exportInvoice('2026-08-02', '2026-08-02', '6104.69', [
      ['LADIES PANT KNITTED 68% RAYON 27% POLY 5% SPANDEX', 3448],
      ['LADIES PANTS KNITTED 95% POLYESTER 5% SPANDEX', 1312],
    ]);
    await exportInvoice('2026-08-20', '2026-08-24', '6108.32', [
      ['LADIES 2PC PAJAMAS KNITTED 96% POLY 4% SPANDEX', 3036],
    ]);
    // Invoiced in July though it sails in August: July's.
    await exportInvoice('2026-07-30', '2026-08-03', '6104.69', [
      ['LADIES PANT KNITTED 95% POLY', 999],
    ]);
    // No invoice date: its ETD's month.
    await exportInvoice(null, '2026-08-31', '6208.22', [
      ['LADIES 2PCS PAJAMAS WOVEN 92% POLY', 2280],
    ]);

    const res = await report('2026-08');
    expect(res.status).toBe(200);
    const body = res.body as ProductionReportData;
    expect(body.lines.map((l) => [l.key, l.pcs, l.invoiceLines, l.shipments.length])).toEqual([
      ['LADIES|PANT|KNITTED', 4760, 2, 1],
      ['LADIES|PAJAMAS|KNITTED', 3036, 1, 1],
      ['LADIES|PAJAMAS|WOVEN', 2280, 1, 1],
    ]);
    expect(body.destinations).toEqual(['UNITED STATES']);
    expect(body.profile).toBeNull();
    expect((await report('2026-07')).body.lines).toMatchObject([{ pcs: 999 }]);
  });

  it('saves the setup per client; only report writers may change it', async () => {
    const put = async (role: RoleCode, body: object) =>
      request(app)
        .put(`/api/v1/reports/production/profile/${basics.jr.id}`)
        .set(await as(role))
        .send(body);
    const saved = await put('ACCOUNTANT', {
      companyName: 'JR APPAREL CO.,LTD',
      machines: [
        { labelKh: 'តុកាត់', labelEn: 'Cutting Table', unitKh: 'តុ', total: 2, working: 2 },
      ],
      unitWeights: { PANT: 0.55 },
      otPcs: { '2026-08': { 'LADIES|PANT|KNITTED': 894 } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ regularHours: 208, overtimeHours: 30, otSharePct: 2.5 });
    expect((await report('2026-08')).body.profile).toMatchObject({
      companyName: 'JR APPAREL CO.,LTD',
      unitWeights: { PANT: 0.55 },
      otPcs: { '2026-08': { 'LADIES|PANT|KNITTED': 894 } },
    });

    expect((await put('OPERATOR', { companyName: 'X' })).status).toBe(403);
    expect((await report('2026-08', 'OPERATOR')).status).toBe(403);
    expect((await report('2026-08', 'VIEWER')).status).toBe(403);
    expect((await put('ACCOUNTANT', { otSharePct: 120 })).status).toBe(400);
  });
});

describe('saved payroll months', () => {
  const person = (card: string, gender: 'F' | 'M', gross: number, net: number) => ({
    row: 7,
    no: '1',
    card,
    nameEn: card,
    nameKh: card,
    gender,
    birthDate: null,
    joinDate: '2026-07-03',
    section: 'Chinese',
    department: card.replace(/\d+/, ''),
    category: card.startsWith('SW') ? 'sewing' : 'production',
    baseSalary: 210,
    daysWorked: 26,
    otHours: 10,
    holidayHours: 0,
    pay: { basic: 210 },
    gross,
    advance: 0,
    pension: 0,
    tax: 0,
    net,
  });
  const month = (extra: object = {}) => ({
    period: '2026-07',
    company: 'JR APPAREL CO.,LTD',
    clientId: basics.jr.id,
    sheetName: 'Sheet1',
    fileName: 'Payroll FOR 07.2026.xlsx',
    sections: ['Chinese'],
    staff: [person('SW1006', 'F', 388.62, 277.67), person('QC0024', 'M', 282.83, 182.83)],
    issues: [{ row: 9, card: 'QC0024', message: 'Blank pension 2% (counted as 0).' }],
    ...extra,
  });
  const save = async (body: object, role: RoleCode = 'ACCOUNTANT') =>
    request(app)
      .post('/api/v1/reports/payroll')
      .set(await as(role))
      .send(body);

  it('saves a month, lists it with its totals and reopens it as imported', async () => {
    const res = await save(month());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      period: '2026-07',
      staffCount: 2,
      female: 1,
      male: 1,
      gross: '671.45',
      net: '460.50',
      savedByName: expect.any(String),
    });
    const list = await request(app)
      .get('/api/v1/reports/payroll')
      .set(await as('MANAGER'));
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('staff');
    const open = await request(app)
      .get(`/api/v1/reports/payroll/${res.body.id}`)
      .set(await as('MANAGER'));
    expect(open.body.staff.map((s: { card: string }) => s.card)).toEqual(['SW1006', 'QC0024']);
    expect(open.body.issues).toHaveLength(1);
  });

  it('asks before replacing a saved month, then replaces it', async () => {
    const first = await save(month());
    // Same company in other letter case, same month.
    const again = await save(
      month({ company: 'jr apparel co.,ltd', staff: [person('SW1', 'F', 100, 90)] }),
    );
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ id: first.body.id });
    const replaced = await save(month({ staff: [person('SW1', 'F', 100, 90)], replace: true }));
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({ id: first.body.id, staffCount: 1, gross: '100.00' });
    // Another month is a new row.
    expect((await save(month({ period: '2026-08' }))).status).toBe(201);
    const list = await request(app)
      .get('/api/v1/reports/payroll')
      .set(await as('ACCOUNTANT'));
    expect(list.body.map((m: { period: string }) => m.period)).toEqual(['2026-08', '2026-07']);
  });

  it('keeps payroll from roles without reports access; only writers save or delete', async () => {
    const saved = await save(month());
    expect((await save(month({ period: '2026-09' }), 'OPERATOR')).status).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/reports/payroll')
          .set(await as('VIEWER'))
      ).status,
    ).toBe(403);
    const del = (role: RoleCode) =>
      as(role).then((h) => request(app).delete(`/api/v1/reports/payroll/${saved.body.id}`).set(h));
    expect((await del('OPERATOR')).status).toBe(403);
    expect((await del('ACCOUNTANT')).status).toBe(204);
    expect((await del('ACCOUNTANT')).status).toBe(404);
  });
});

describe('import & export report', () => {
  /** A JR shipment with one invoice and the given declarations. */
  async function shipment(
    direction: 'IMPORT' | 'EXPORT',
    date: string,
    declarations: string[],
    lines: [description: string, pcs: number, nw: number, price: number][],
  ) {
    const res = await request(app)
      .post('/api/v1/shipments')
      .set(await as('OPERATOR'))
      .send({
        clientId: basics.jr.id,
        direction,
        transportMode: 'SEA',
        loadType: 'FCL',
        clearancePortId: basics.port.id,
        destinationCountryIso2: direction === 'EXPORT' ? 'US' : 'KH',
        originCountryIso2: direction === 'EXPORT' ? 'KH' : 'CN',
        etd: date,
        eta: date,
        invoices: [
          {
            invoiceNo: `JR-CD-${++invoiceNo}`,
            invoiceDate: date,
            lines: lines.map(([description, pcs, nw, fobUnitPrice]) => ({
              description,
              pcs,
              netWeightKg: nw,
              grossWeightKg: nw + 1,
              fobUnitPrice,
            })),
          },
        ],
        declarations: declarations.map((declareNo) => ({
          declareNo,
          declareDate: date,
          portId: basics.port.id,
        })),
      });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  }
  const get = async (direction: 'IMPORT' | 'EXPORT', from: string, to: string) =>
    request(app)
      .get('/api/v1/reports/customs')
      .query({ clientId: basics.jr.id, direction, from, to })
      .set(await as('ACCOUNTANT'));

  it('lists each invoice line under its I/E declaration, by declaration date', async () => {
    // The CO number kept as a second "declaration" is not a customs one.
    await shipment(
      'EXPORT',
      '2026-09-25',
      ['E 291340', 'LAT2026-00358'],
      [
        ['LADIES PANT KNITTED 95% POLYESTER 5% SPANDEX', 2416, 1283.5, 2.05],
        ['LADIES PANT KNITTED 78% NYLON', 576, 324, 2],
      ],
    );
    await shipment(
      'EXPORT',
      '2026-08-14',
      ['E245477'],
      [['LADIES 2PC PAJAMAS', 1284, 395.9, 1.325]],
    );
    await shipment('EXPORT', '2026-07-30', ['E 1'], [['OUT OF RANGE', 1, 1, 1]]);
    await shipment('IMPORT', '2026-09-19', ['I 136252'], [['KNITTED FABRIC', 43579.5, 23993.3, 1]]);
    // Invoiced in the period but not declared yet: listed apart.
    await shipment('EXPORT', '2026-09-28', [], [['WAITING', 10, 1, 1]]);

    const res = await get('EXPORT', '2026-08', '2026-09');
    expect(res.status).toBe(200);
    const body = res.body as CustomsReportData;
    expect(body).toMatchObject({ companyName: expect.any(String), direction: 'EXPORT' });
    expect(
      body.lines.map((l) => [l.declareNo, l.declareDate, l.qty, l.netWeightKg, l.value]),
    ).toEqual([
      ['E 245477', '2026-08-14', 1284, 395.9, 1701.3],
      ['E 291340', '2026-09-25', 2416, 1283.5, 4952.8],
      ['E 291340', '2026-09-25', 576, 324, 1152],
    ]);
    expect(body.undeclared).toMatchObject([{ lines: 1, date: '2026-09-28' }]);

    const imports = (await get('IMPORT', '2026-01', '2026-09')).body as CustomsReportData;
    expect(imports.lines.map((l) => [l.declareNo, l.description, l.value])).toEqual([
      ['I 136252', 'KNITTED FABRIC', 43579.5],
    ]);
    expect((await get('IMPORT', '2026-09', '2026-08')).status).toBe(400);
  });
});
