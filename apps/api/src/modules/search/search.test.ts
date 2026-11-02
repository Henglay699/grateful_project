import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SearchHit } from '@gs/shared';
import { createApp } from '../../app';
import { pool } from '../../db/client';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let admin: { Authorization: string };
const api = (m: 'get' | 'post', path: string) => request(app)[m](`/api/v1${path}`);

async function login(email: string, password: string) {
  const res = await api('post', '/auth/login').send({ email, password });
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

async function ship(clientId: string, invoiceNo: string, containerNo: string) {
  const res = await api('post', '/shipments')
    .set(admin)
    .send({
      clientId,
      direction: 'IMPORT',
      transportMode: 'SEA',
      loadType: 'FCL',
      status: 'IN_PROGRESS',
      forwarderId: b.fwd.id,
      clearancePortId: b.port.id,
      originCountryIso2: 'CN',
      destinationCountryIso2: 'KH',
      hblNo: 'SHSIN6090119',
      eta: '2026-10-01',
      containers: [{ containerNo, size: '40HQ' }],
      invoices: [{ invoiceNo, lines: [{ pcs: 10, fobUnitPrice: 1 }] }],
      declarations: [],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string };
}

const search = async (q: string, h = admin) => {
  const res = await api('get', '/search').query({ q }).set(h);
  expect(res.status).toBe(200);
  return res.body.hits as SearchHit[];
};

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  const u = await createUser('ADMIN');
  admin = await login(u.email, TEST_PASSWORD);
});
afterAll(async () => {
  await pool.end();
});

describe('global search', () => {
  it('finds shipments by invoice no. or container, and clients by code or name', async () => {
    const s = await ship(b.jr.id, 'JRA26056', 'TRHU5821292');
    const byInvoice = await search('jra260');
    expect(byInvoice).toContainEqual({
      kind: 'shipment',
      id: s.id,
      title: 'JRA26056',
      subtitle: 'JR · Import · SHSIN6090119 · TRHU5821292',
      url: `/plans/${s.id}`,
    });
    expect((await search('5821292')).map((h) => h.id)).toEqual([s.id]);

    const byName = await search('jin yuan');
    expect(byName).toEqual([expect.objectContaining({ kind: 'client', title: 'JYX' })]);
    expect(await search('nothing-like-this')).toEqual([]);
  });

  it('only shows what the user may read, and only their own clients', async () => {
    await ship(b.jr.id, 'JRA26056', 'TRHU5821292');
    const jyx = await ship(b.jyx.id, 'JYX26001', 'TCNU5209621');
    const staff = await api('post', '/staff')
      .set(admin)
      .send({
        email: 'limited@gs.local',
        fullName: 'Limited',
        role: 'OPERATOR',
        password: 'Temp-Pass-2026',
        clientIds: [b.jyx.id],
      });
    expect(staff.status).toBe(201);
    const h = await login('limited@gs.local', 'Temp-Pass-2026');
    // "SHSIN" is on both shipments' HBL; only the JYX one is theirs.
    const hits = await search('shsin', h);
    expect(hits.map((x) => x.id)).toEqual([jyx.id]);
    expect(hits.every((x) => x.kind === 'shipment')).toBe(true);
  });

  it('asks for at least 2 characters', async () => {
    const res = await api('get', '/search').query({ q: 'j' }).set(admin);
    expect(res.status).toBe(400);
  });
});
