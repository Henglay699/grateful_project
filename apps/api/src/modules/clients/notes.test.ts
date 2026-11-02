import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { ClientNote, RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { queryRows } from '../../lib/listing';
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

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('client remarks', () => {
  it('keeps notes per client and never writes their text to the audit log', async () => {
    const url = `/api/v1/clients/${basics.jr.id}/notes`;
    const created = await request(app)
      .post(url)
      .set(await as('OPERATOR'))
      .send({
        subject: 'GDCE e-Customs login',
        body: 'https://example.gov.kh\nUser: jr\nPassword: s3cret!',
        hidden: true,
      });
    expect(created.status).toBe(201);
    const noteId = created.body.id as string;

    const list = await request(app)
      .get(url)
      .set(await as('VIEWER'));
    expect(list.body as ClientNote[]).toMatchObject([
      { id: noteId, subject: 'GDCE e-Customs login', hidden: true },
    ]);
    // Notes belong to their client only.
    const other = await request(app)
      .get(`/api/v1/clients/${basics.jyx.id}/notes`)
      .set(await as('VIEWER'));
    expect(other.body).toEqual([]);

    const upd = await request(app)
      .put(`${url}/${noteId}`)
      .set(await as('OPERATOR'))
      .send({ subject: 'GDCE login', body: 'Password: n3w!', hidden: true });
    expect(upd.status).toBe(204);
    const viewer = await request(app)
      .delete(`${url}/${noteId}`)
      .set(await as('VIEWER'));
    expect(viewer.status).toBe(403);
    const wrongClient = await request(app)
      .delete(`/api/v1/clients/${basics.jyx.id}/notes/${noteId}`)
      .set(await as('OPERATOR'));
    expect(wrongClient.status).toBe(404);
    const del = await request(app)
      .delete(`${url}/${noteId}`)
      .set(await as('OPERATOR'));
    expect(del.status).toBe(204);
    expect(
      (
        await request(app)
          .get(url)
          .set(await as('VIEWER'))
      ).body,
    ).toEqual([]);

    const trail = await queryRows<{ before: unknown; after: unknown }>(
      db,
      sql`SELECT before, after FROM audit_log WHERE entity = 'client_note'`,
    );
    expect(trail).toHaveLength(3);
    expect(JSON.stringify(trail)).not.toMatch(/s3cret|n3w!|Password/);
  });

  it('needs a subject', async () => {
    const res = await request(app)
      .post(`/api/v1/clients/${basics.jr.id}/notes`)
      .set(await as('OPERATOR'))
      .send({ subject: '  ', body: 'x' });
    expect(res.status).toBe(400);
  });
});
