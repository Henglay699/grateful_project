import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClientDetail, RoleCode } from '@gs/shared';
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

const detail = async () =>
  (
    await request(app)
      .get(`/api/v1/clients/${basics.jr.id}`)
      .set(await as('VIEWER'))
  ).body as ClientDetail;

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('client suppliers and consignees', () => {
  it("lists the import shippers as suppliers and keeps each one's address", async () => {
    for (const shipperName of ['Shanghai Yongyue Co.', 'SHANGHAI YONGYUE CO.', 'Ningbo Textile'])
      await request(app)
        .post('/api/v1/shipments')
        .set(await as('OPERATOR'))
        .send({
          clientId: basics.jr.id,
          direction: 'IMPORT',
          transportMode: 'SEA',
          loadType: 'LCL',
          shipperName,
          originCountryIso2: 'CN',
          clearancePortId: basics.port.id,
        });

    // One row per name (any case), no address yet.
    expect((await detail()).suppliers).toEqual([
      { id: null, name: 'Ningbo Textile', address: null },
      { id: null, name: expect.stringMatching(/^shanghai yongyue co\.$/i), address: null },
    ]);

    const saved = await request(app)
      .put(`/api/v1/clients/${basics.jr.id}/suppliers`)
      .set(await as('OPERATOR'))
      .send({ name: 'Shanghai Yongyue Co.', address: 'Pudong, Shanghai' });
    expect(saved.status).toBe(200);
    await request(app)
      .put(`/api/v1/clients/${basics.jr.id}/suppliers`)
      .set(await as('OPERATOR'))
      .send({ name: 'Guangzhou Trims', address: 'Guangzhou' });
    expect((await detail()).suppliers).toMatchObject([
      { name: 'Guangzhou Trims', address: 'Guangzhou' },
      { id: null, name: 'Ningbo Textile', address: null },
      { id: saved.body.id, name: 'Shanghai Yongyue Co.', address: 'Pudong, Shanghai' },
    ]);

    // Delete hides a supplier, saved or only a shipper name; the shipments keep the name.
    const delSupplier = async (name: string) =>
      request(app)
        .delete(`/api/v1/clients/${basics.jr.id}/suppliers`)
        .query({ name })
        .set(await as('OPERATOR'));
    expect((await delSupplier('shanghai yongyue co.')).status).toBe(204);
    expect((await delSupplier('Ningbo Textile')).status).toBe(204);
    expect((await delSupplier('Never Used')).status).toBe(404);
    expect((await detail()).suppliers.map((x) => x.name)).toEqual(['Guangzhou Trims']);
    const ships = await request(app)
      .get('/api/v1/shipments')
      .query({ clientId: basics.jr.id })
      .set(await as('VIEWER'));
    expect(ships.body.meta.total).toBe(3);

    // "+ Add" brings a deleted one back, without its old address.
    await request(app)
      .put(`/api/v1/clients/${basics.jr.id}/suppliers`)
      .set(await as('OPERATOR'))
      .send({ name: 'NINGBO TEXTILE', address: null });
    expect((await detail()).suppliers.map((x) => [x.name.toUpperCase(), x.address])).toEqual([
      ['GUANGZHOU TRIMS', 'Guangzhou'],
      ['NINGBO TEXTILE', null],
    ]);

    const viewer = await request(app)
      .put(`/api/v1/clients/${basics.jr.id}/suppliers`)
      .set(await as('VIEWER'))
      .send({ name: 'X', address: 'Y' });
    expect(viewer.status).toBe(403);
  });

  it("sets a consignee's address, only for that client's consignees", async () => {
    const added = await request(app)
      .post('/api/v1/lookups/consignees')
      .set(await as('OPERATOR'))
      .send({ name: 'TJX AU PTY LIMITED', clientId: basics.jr.id });
    const id = added.body.id as string;
    const res = await request(app)
      .patch(`/api/v1/clients/${basics.jr.id}/consignees/${id}`)
      .set(await as('OPERATOR'))
      .send({ address: '1 Smith St\nSydney NSW' });
    expect(res.status).toBe(204);
    expect((await detail()).consignees).toMatchObject([
      { id, name: 'TJX AU PTY LIMITED', address: '1 Smith St\nSydney NSW' },
    ]);
    const other = await request(app)
      .patch(`/api/v1/clients/${basics.jyx.id}/consignees/${id}`)
      .set(await as('OPERATOR'))
      .send({ address: 'x' });
    expect(other.status).toBe(404);
  });

  it('deletes a consignee by making it inactive, and quick-add brings it back', async () => {
    const add = async () =>
      request(app)
        .post('/api/v1/lookups/consignees')
        .set(await as('OPERATOR'))
        .send({ name: 'TJX AU PTY LIMITED', clientId: basics.jr.id });
    const id = (await add()).body.id as string;
    const del = await request(app)
      .delete(`/api/v1/clients/${basics.jr.id}/consignees/${id}`)
      .set(await as('OPERATOR'));
    expect(del.status).toBe(204);
    expect((await detail()).consignees).toEqual([]);
    const lookups = await request(app)
      .get('/api/v1/lookups')
      .set(await as('VIEWER'));
    expect(lookups.body.consignees.map((c: { id: string }) => c.id)).not.toContain(id);

    const again = await add();
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(id);
    expect((await detail()).consignees.map((c) => c.id)).toEqual([id]);
  });

  it('adds a consignee with its address from Client Details', async () => {
    const add = async (clientId: string, name: string, address: string | null = null) =>
      request(app)
        .post(`/api/v1/clients/${clientId}/consignees`)
        .set(await as('OPERATOR'))
        .send({ name, address });
    const created = await add(basics.jr.id, 'TJX AU PTY LIMITED', '1 Smith St');
    expect(created.status).toBe(201);
    expect((await detail()).consignees).toMatchObject([
      { id: created.body.id, name: 'TJX AU PTY LIMITED', address: '1 Smith St' },
    ]);
    // Names are unique across clients.
    expect((await add(basics.jr.id, 'tjx au pty limited')).status).toBe(409);
    expect((await add(basics.jyx.id, 'TJX AU PTY LIMITED')).status).toBe(409);

    // A deleted one comes back, with the new address.
    await request(app)
      .delete(`/api/v1/clients/${basics.jr.id}/consignees/${created.body.id as string}`)
      .set(await as('OPERATOR'));
    const back = await add(basics.jr.id, 'TJX AU PTY LIMITED', '2 George St');
    expect(back.status).toBe(201);
    expect(back.body.id).toBe(created.body.id);
    expect((await detail()).consignees).toMatchObject([{ address: '2 George St' }]);

    const viewer = await request(app)
      .post(`/api/v1/clients/${basics.jr.id}/consignees`)
      .set(await as('VIEWER'))
      .send({ name: 'X Ltd' });
    expect(viewer.status).toBe(403);
  });
});
