import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CoBreakdownInput, CoDetail, CoRow, RoleCode } from '@gs/shared';
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

async function exportShipment(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('OPERATOR'))
    .send({
      clientId: basics.jr.id,
      direction: 'EXPORT',
      transportMode: 'SEA',
      loadType: 'LCL',
      status: 'IN_PROGRESS',
      clearancePortId: basics.port.id,
      destinationCountryIso2: 'US',
      atd: '2026-09-28',
      coForm: 'CRF',
      invoices: [
        {
          invoiceNo: 'JRA26057',
          invoiceDate: '2026-09-23',
          lines: [
            { htsCode: '6104.69', pcs: 5600, ctns: 237, netWeightKg: '2921.1', fobUnitPrice: 3.02 },
          ],
        },
      ],
      ...overrides,
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string };
}

const list = async (query: Record<string, string>) =>
  (
    await request(app)
      .get('/api/v1/co')
      .query({ from: '2026-09', to: '2026-09', ...query })
      .set(await as('VIEWER'))
  ).body as CoRow[];

const breakdown: CoBreakdownInput = {
  htsCode: '6104.69',
  date: '2026-09-23',
  kinds: 'As Per Invoice and Packing List.',
  poNo: 'As Per Invoice and Packing List.',
  styleNo: 'As Per Invoice and Packing List.',
  fabricName: 'KNITTED FABRIC',
  fabricOrigin: 'Taiwan',
  accessoriesOrigin: 'China',
  targetFob: 2.95,
  importShare: 0.51,
  transportCost: 0.09,
  base: { fabric: 1.15, accessories: 0.54, local: 0.49, overhead: 0.47, profit: 0.5 },
  accountant: 'KENDY',
  manager: 'KONG YEKSEAM',
};

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('CO', () => {
  it('lists export invoices with a CO form, from the shipment until one is saved', async () => {
    await exportShipment();
    // No CO form or number: only listed with `all`.
    await exportShipment({
      coForm: null,
      invoices: [{ invoiceNo: 'JRA26060', invoiceDate: '2026-09-25', lines: [{ pcs: 10 }] }],
    });

    const rows = await list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNo: 'JRA26057',
      month: '2026-09',
      form: 'CRF',
      mode: 'SEA',
      country: 'USA',
      pcs: 5600,
      ctns: 237,
      amount: 16912,
      atd: '2026-09-28',
      status: 'PENDING',
      saved: false,
      hasBreakdown: false,
    });
    expect((await list({ all: 'true' })).map((r) => r.invoiceNo)).toEqual(['JRA26057', 'JRA26060']);
    expect(await list({ from: '2026-10', to: '2026-10' })).toEqual([]);
  });

  it('saves a CO record and a breakdown; Viewers can only read', async () => {
    await exportShipment();
    const [row] = await list({});
    const url = `/api/v1/co/${row!.invoiceId}`;

    const denied = await request(app)
      .put(url)
      .set(await as('VIEWER'))
      .send({ status: 'SUBMIT' });
    expect(denied.status).toBe(403);

    const put = await request(app)
      .put(url)
      .set(await as('OPERATOR'))
      .send({ form: 'CRF', coNo: 'KHUS2610000001', coDate: '2026-09-30', status: 'APPROVE' });
    expect(put.status).toBe(204);
    expect((await list({ status: 'APPROVE' }))[0]).toMatchObject({
      coNo: 'KHUS2610000001',
      coDate: '2026-09-30',
      saved: true,
    });

    const bad = await request(app)
      .put(`${url}/breakdown`)
      .set(await as('OPERATOR'))
      .send({ ...breakdown, importShare: 2 });
    expect(bad.status).toBe(400);
    const saved = await request(app)
      .put(`${url}/breakdown`)
      .set(await as('OPERATOR'))
      .send(breakdown);
    expect(saved.status).toBe(204);

    const detail = (
      await request(app)
        .get(url)
        .set(await as('VIEWER'))
    ).body as CoDetail;
    expect(detail).toMatchObject({
      htsCode: '6104.69',
      netWeightKg: 2921.1,
      hasBreakdown: true,
      status: 'APPROVE',
      breakdown,
      template: null,
    });
  });

  it('starts a new breakdown from the client’s last one', async () => {
    await exportShipment();
    const [first] = await list({});
    await request(app)
      .put(`/api/v1/co/${first!.invoiceId}/breakdown`)
      .set(await as('OPERATOR'))
      .send(breakdown);
    await exportShipment({
      invoices: [{ invoiceNo: 'JRA26061', invoiceDate: '2026-09-26', lines: [{ pcs: 10 }] }],
    });
    const second = (await list({})).find((r) => r.invoiceNo === 'JRA26061')!;
    const detail = (
      await request(app)
        .get(`/api/v1/co/${second.invoiceId}`)
        .set(await as('VIEWER'))
    ).body as CoDetail;
    expect(detail.breakdown).toBeNull();
    expect(detail.template).toMatchObject({ accountant: 'KENDY' });
  });

  it('404s for an import invoice', async () => {
    await exportShipment({
      direction: 'IMPORT',
      originCountryIso2: 'CN',
      destinationCountryIso2: null,
    });
    const res = await request(app)
      .get('/api/v1/co/00000000-0000-4000-8000-000000000000')
      .set(await as('VIEWER'));
    expect(res.status).toBe(404);
  });
});
