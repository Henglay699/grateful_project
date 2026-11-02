import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { pool } from '../db/client';
import { createUser, refreshCookieFrom, resetDb, seedBasics, TEST_PASSWORD } from '../test/helpers';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let admin: { Authorization: string };
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  request(app)[m](`/api/v1${path}`);

async function login(email: string, password: string) {
  const res = await api('post', '/auth/login').send({ email, password });
  return { res, h: { Authorization: `Bearer ${res.body.accessToken as string}` } };
}

async function ship(clientId: string) {
  const res = await api('post', '/shipments').set(admin).send({
    clientId,
    direction: 'IMPORT',
    transportMode: 'SEA',
    loadType: 'FCL',
    status: 'IN_PROGRESS',
    forwarderId: b.fwd.id,
    clearancePortId: b.port.id,
    originCountryIso2: 'CN',
    destinationCountryIso2: 'KH',
    eta: '2026-03-10',
    invoices: [],
    declarations: [],
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string };
}

beforeEach(async () => {
  await resetDb();
  b = await seedBasics();
  const u = await createUser('ADMIN');
  admin = (await login(u.email, TEST_PASSWORD)).h;
});
afterAll(async () => {
  await pool.end();
});

describe('per-user client access and permission tweaks', () => {
  async function jrOnlyOperator(extra: Record<string, unknown> = {}) {
    const res = await api('post', '/staff')
      .set(admin)
      .send({
        email: 'thnin@gs.local',
        fullName: 'Thnin',
        role: 'OPERATOR',
        password: 'Temp-Pass-2026',
        clientIds: [b.jr.id],
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('a user limited to JR only sees and changes JR records', async () => {
    const jrShip = await ship(b.jr.id);
    const jyxShip = await ship(b.jyx.id);
    await jrOnlyOperator();
    const { res, h } = await login('thnin@gs.local', 'Temp-Pass-2026');
    expect(res.body.user.clientIds).toEqual([b.jr.id]);

    // Lists only hold JR, even when asking for JYX.
    const list = await api('get', '/shipments').set(h);
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([jrShip.id]);
    const asked = await api('get', '/shipments').query({ clientId: b.jyx.id }).set(h);
    expect(asked.body.data).toEqual([]);
    const lookups = await api('get', '/lookups').set(h);
    expect(lookups.body.clients.map((c: { code: string }) => c.code)).toEqual(['JR']);
    const clients = await api('get', '/clients').set(h);
    expect(clients.body.data.map((c: { code: string }) => c.code)).toEqual(['JR']);
    const kpis = await api('get', '/analytics/kpis')
      .query({ from: '2026-01-01', to: '2026-12-31' })
      .set(h);
    expect(kpis.body.total).toBe(1);

    // Another client's records look like they don't exist, and can't be created or changed.
    expect((await api('get', `/shipments/${jyxShip.id}`).set(h)).status).toBe(404);
    expect(
      (await api('get', '/cut-stock/options').query({ clientId: b.jyx.id }).set(h)).status,
    ).toBe(404);
    expect((await api('get', `/clients/${b.jyx.id}`).set(h)).status).toBe(404);
    expect((await api('get', '/cut-stock').query({ clientId: b.jyx.id }).set(h)).status).toBe(404);
    const steal = await api('put', `/shipments/${jrShip.id}`).set(h).send({
      clientId: b.jyx.id,
      direction: 'IMPORT',
      transportMode: 'SEA',
      loadType: 'FCL',
      status: 'IN_PROGRESS',
      invoices: [],
      declarations: [],
    });
    expect(steal.status).toBe(403);
    expect((await api('get', `/shipments/${jrShip.id}`).set(h)).status).toBe(200);

    // The admin still sees everything.
    expect((await api('get', '/shipments').set(admin)).body.data).toHaveLength(2);
  });

  it('a section with its own client access replaces the main one there', async () => {
    const jrShip = await ship(b.jr.id);
    const jyxShip = await ship(b.jyx.id);
    // Main: JR only. Shipments: every client. Clients: JYX only.
    const s = await jrOnlyOperator({ clientScopes: { shipments: null, clients: [b.jyx.id] } });
    expect(
      (await api('get', '/staff').set(admin)).body.find((m: { id: string }) => m.id === s.id),
    ).toMatchObject({ clientScopes: { shipments: null, clients: [b.jyx.id] } });
    const { res, h } = await login('thnin@gs.local', 'Temp-Pass-2026');
    expect(res.body.user.clientScopes).toEqual({ shipments: null, clients: [b.jyx.id] });

    const list = await api('get', '/shipments').set(h);
    expect(list.body.data.map((x: { id: string }) => x.id).sort()).toEqual(
      [jrShip.id, jyxShip.id].sort(),
    );
    expect((await api('get', `/shipments/${jyxShip.id}`).set(h)).status).toBe(200);
    const clients = await api('get', '/clients').set(h);
    expect(clients.body.data.map((c: { code: string }) => c.code)).toEqual(['JYX']);
    expect((await api('get', `/clients/${b.jr.id}`).set(h)).status).toBe(404);
    // The CDC Master List has no own setting, so it follows the main one (JR only).
    expect((await api('get', '/cut-stock').query({ clientId: b.jyx.id }).set(h)).status).toBe(404);
    // Pickers offer every client usable in some section.
    const lookups = await api('get', '/lookups').set(h);
    expect(lookups.body.clients.length).toBeGreaterThan(1);

    // A section can't be set to an empty list.
    const empty = await api('patch', `/staff/${s.id}`)
      .set(admin)
      .send({ clientScopes: { sealplans: [] } });
    expect(empty.status).toBe(400);
  });

  it('per-user permission tweaks add and remove permissions on top of the role', async () => {
    await jrOnlyOperator({
      permissionsAdd: ['accounting:read'],
      permissionsRemove: ['followups:write'],
    });
    const { res, h } = await login('thnin@gs.local', 'Temp-Pass-2026');
    expect(res.body.user.permissions).toContain('accounting:read');
    expect(res.body.user.permissions).not.toContain('followups:write');
    expect((await api('get', '/accounting/ledger').set(h)).status).toBe(200);
    expect((await api('post', '/follow-ups').set(h).send({ subject: 'x' })).status).toBe(403);
  });

  it('changing access signs the person out; admins cannot limit themselves', async () => {
    const s = await jrOnlyOperator();
    const first = await login('thnin@gs.local', 'Temp-Pass-2026');
    const cookie = refreshCookieFrom(first.res.headers['set-cookie'])!;
    const upd = await api('patch', `/staff/${s.id}`)
      .set(admin)
      .send({ clientIds: [b.jr.id, b.jyx.id] });
    expect(upd.status).toBe(200);
    expect(upd.body.clientIds.sort()).toEqual([b.jr.id, b.jyx.id].sort());
    expect((await api('post', '/auth/refresh').set('Cookie', cookie)).status).toBe(401);

    const me = (await api('get', '/staff').set(admin)).body.find(
      (m: { role: string }) => m.role === 'ADMIN',
    );
    expect(
      (
        await api('patch', `/staff/${me.id}`)
          .set(admin)
          .send({ clientIds: [b.jr.id] })
      ).status,
    ).toBe(422);
    expect(
      (
        await api('patch', `/staff/${me.id}`)
          .set(admin)
          .send({ permissionsRemove: ['staff:manage'] })
      ).status,
    ).toBe(422);
  });
});
