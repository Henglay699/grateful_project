import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { MihDraft, MihMonth, MihMonthInput, MihYear, RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { countries } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';
import { materialGroupOf } from './mih';

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
/** A shipment with one invoice dated `date`; lines are [description, qty, unit price, unit?]. */
async function shipment(
  direction: 'EXPORT' | 'IMPORT',
  country: string,
  date: string,
  lines: [description: string, pcs: number, price: number, unit?: string][],
) {
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('OPERATOR'))
    .send({
      clientId: basics.jr.id,
      direction,
      transportMode: 'SEA',
      loadType: 'FCL',
      status: 'IN_PROGRESS',
      clearancePortId: basics.port.id,
      ...(direction === 'EXPORT'
        ? { destinationCountryIso2: country }
        : { originCountryIso2: country }),
      etd: date,
      invoices: [
        {
          invoiceNo: `JR-${direction}-${++invoiceNo}`,
          invoiceDate: date,
          lines: lines.map(([description, pcs, fobUnitPrice, unit]) => ({
            description,
            pcs,
            fobUnitPrice,
            unit,
            htsCode: '6104.69',
          })),
        },
      ],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
}

const get = async <T>(path: string, query: object, role: RoleCode = 'ACCOUNTANT') => {
  const res = await request(app)
    .get(`/api/v1/reports/mih${path}`)
    .query(query)
    .set(await as(role));
  return res as Omit<typeof res, 'body'> & { body: T };
};
const save = async (body: Partial<MihMonthInput>, role: RoleCode = 'ACCOUNTANT') =>
  request(app)
    .post('/api/v1/reports/mih')
    .set(await as(role))
    .send({ clientId: basics.jr.id, ...body });

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
  await db.insert(countries).values([
    { iso2: 'CA', name: 'Canada' },
    { iso2: 'DE', name: 'Germany' },
    { iso2: 'GB', name: 'United Kingdom' },
  ]);
});
afterAll(async () => {
  await pool.end();
});

describe('MIH draft', () => {
  it('fills products by market from export invoices and materials from imports', async () => {
    await shipment('EXPORT', 'US', '2026-09-03', [
      ['LADIES PANTS KNITTED 95% POLY 5% SPANDEX', 1000, 2],
      ['LADIES 2PC PAJAMAS KNITTED 96% POLY', 300, 1.5],
    ]);
    await shipment('EXPORT', 'CA', '2026-09-20', [['LADIES PANT KNITTED 95% POLY', 200, 2.1]]);
    await shipment('EXPORT', 'DE', '2026-09-21', [['LADIES PANT KNITTED', 10, 3]]);
    await shipment('EXPORT', 'GB', '2026-09-22', [['LADIES PANT KNITTED', 5, 3]]);
    // August's: not in September.
    await shipment('EXPORT', 'US', '2026-08-30', [['LADIES PANT KNITTED', 999, 2]]);
    await shipment('IMPORT', 'CN', '2026-09-05', [
      ['KNITTED FABRIC 95% POLY', 1500.5, 1.2, 'MTR'],
      ['METAL BUTTON', 20, 3, 'GRO'],
      ['GENERATOR (DIESEL) (350KVA)', 1, 11000, 'SET'],
    ]);

    const res = await get<MihDraft>('/draft', { clientId: basics.jr.id, month: '2026-09' });
    expect(res.status).toBe(200);
    const { data, sources } = res.body;
    expect(data.companyName).toBe('JR Apparel Corp');
    expect(data.products.map((p) => [p.kind, p.product, p.unit])).toEqual([
      ['LADIES', 'PANT', 'PCS'],
      ['LADIES', 'PAJAMAS', 'PCS'],
    ]);
    expect(data.products[0]!.markets).toEqual({
      US: { qty: 1000, value: 2000 },
      CA: { qty: 200, value: 420 },
      CN: { qty: 0, value: 0 },
      EU: { qty: 10, value: 30 },
      OTHER: { qty: 5, value: 15 },
    });
    const byName = Object.fromEntries(data.materials.map((m) => [m.name, m.origins.CN]));
    expect(byName).toEqual({
      'MACHINERIES & EQUIPMENTS': { qty: 1, value: 11000 },
      'RAW MATERIAL': { qty: 1500.5, value: 1800.6 },
      ACCESSORY: { qty: 20, value: 60 },
    });
    expect(data.energy).toMatchObject([{ name: 'EDC', unit: 'KW', qty: 0 }]);
    expect(sources).toMatchObject({ exportLines: 5, importLines: 3, carriedFrom: null });
  });

  it('carries the factory details and row wording from the last saved month', async () => {
    await save({
      period: '2026-08',
      data: {
        companyName: 'JR APPAREL CO., LTD',
        totalAsset: 1000000,
        products: [
          { kind: 'LADIES', product: 'PANTS', unit: 'PCS' },
          { kind: 'LADIES', product: 'SKORT' },
        ],
        energy: [{ name: 'EDC', unit: 'KW', qty: 11368, unitPrice: 0.137, value: 1557.42 }],
        directorName: 'NI, CUNLAN',
      },
    });
    await shipment('EXPORT', 'US', '2026-09-03', [['LADIES PANT KNITTED', 100, 2]]);
    const { body } = await get<MihDraft>('/draft', { clientId: basics.jr.id, month: '2026-09' });
    expect(body.sources.carriedFrom).toBe('2026-08');
    expect(body.data).toMatchObject({
      companyName: 'JR APPAREL CO., LTD',
      totalAsset: 1000000,
      directorName: 'NI, CUNLAN',
      energy: [{ name: 'EDC', unitPrice: 0.137, qty: 0, value: 0 }],
    });
    // The invoice's PANT keeps August's "PANTS"; SKORT stays on with nothing this month.
    expect(body.data.products.map((p) => [p.product, p.markets.US.qty])).toEqual([
      ['PANTS', 100],
      ['SKORT', 0],
    ]);
  });
});

describe('saved MIH months', () => {
  it('saves, lists with totals, gives the year in order, and asks before replacing', async () => {
    const product = (qty: number, value: number) => ({
      kind: 'LADIES',
      product: 'PANTS',
      markets: { US: { qty, value } },
    });
    const sep = await save({
      period: '2026-09',
      data: { employees: 148, female: 101, salary: 50419.75, products: [product(100, 200)] },
    });
    expect(sep.status).toBe(201);
    expect(sep.body).toMatchObject({ exportQty: '100.00', exportValue: '200.00', employees: 148 });
    await save({ period: '2026-08', data: { products: [product(50, 100)] }, source: 'excel' });
    await save({ period: '2025-12', data: { products: [product(1, 1)] } });

    const year = await get<MihYear>('/year', { clientId: basics.jr.id, year: 2026 });
    expect(year.body.months.map((m) => m.period)).toEqual(['2026-08', '2026-09']);
    expect(year.body.months[0]!.source).toBe('excel');

    const again = await save({ period: '2026-09', data: { products: [product(7, 7)] } });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ id: sep.body.id });
    const replaced = await save({ period: '2026-09', data: {}, replace: true });
    expect(replaced.body).toMatchObject({ id: sep.body.id, exportQty: '0.00' });

    const list = await get<MihMonth[]>('', {}, 'MANAGER');
    expect(list.body.map((m) => m.period)).toEqual(['2026-09', '2026-08', '2025-12']);
    expect(list.body[0]).not.toHaveProperty('data');
  });

  it('shows the year’s payroll months for comparing staff and salary', async () => {
    await request(app)
      .post('/api/v1/reports/payroll')
      .set(await as('ACCOUNTANT'))
      .send({
        period: '2026-07',
        // Not linked to the client, but its name starts with the client's.
        company: 'JR APPAREL CORP CO.,LTD',
        staff: [
          {
            row: 7,
            no: '1',
            card: 'SW1',
            nameEn: 'A',
            nameKh: 'A',
            gender: 'F',
            birthDate: null,
            joinDate: null,
            section: '',
            department: 'SW',
            category: 'sewing',
            baseSalary: 210,
            daysWorked: 26,
            otHours: 0,
            holidayHours: 0,
            pay: {},
            gross: 300,
            advance: 0,
            pension: 0,
            tax: 0,
            net: 290,
          },
        ],
      });
    const year = await get<MihYear>('/year', { clientId: basics.jr.id, year: 2026 });
    expect(year.body.payroll).toEqual([
      { period: '2026-07', staffCount: 1, female: 1, gross: '300.00' },
    ]);
  });

  it('keeps MIH from roles without reports access; only writers save or delete', async () => {
    const saved = await save({ period: '2026-09', data: {} });
    expect((await save({ period: '2026-10', data: {} }, 'OPERATOR')).status).toBe(403);
    expect((await get('', {}, 'VIEWER')).status).toBe(403);
    expect((await save({ period: '2026-13', data: {} })).status).toBe(400);
    const del = (role: RoleCode) =>
      as(role).then((h) => request(app).delete(`/api/v1/reports/mih/${saved.body.id}`).set(h));
    expect((await del('OPERATOR')).status).toBe(403);
    expect((await del('ACCOUNTANT')).status).toBe(204);
    expect((await del('ACCOUNTANT')).status).toBe(404);
  });
});

describe('material groups', () => {
  it('puts machines, fabric and the rest in the sheet’s three groups', () => {
    expect(materialGroupOf('GENERATOR (DIESEL) (350KVA)', 'SET')).toBe('MACHINERIES & EQUIPMENTS');
    expect(materialGroupOf('SEWING MACHINE', 'UNIT')).toBe('MACHINERIES & EQUIPMENTS');
    expect(materialGroupOf('KNITTED FABRIC', 'MTR')).toBe('RAW MATERIAL');
    expect(materialGroupOf('INTERLINING', 'MTR')).toBe('ACCESSORY');
  });
});
