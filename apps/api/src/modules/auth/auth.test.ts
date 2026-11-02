import request from 'supertest';
import express from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { auditLog, refreshTokens } from '../../db/schema';
import { createUser, refreshCookieFrom, resetDb, TEST_PASSWORD } from '../../test/helpers';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error';
import { signAccessToken } from './tokens';

const app = createApp();

async function login(email: string, password = TEST_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await pool.end();
});

describe('POST /auth/login', () => {
  it('returns an access token and sets an httpOnly, path-scoped refresh cookie', async () => {
    await createUser('MANAGER', 'aden@test.local');
    const res = await login('ADEN@test.local'); // email is case-insensitive
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'aden@test.local', role: 'MANAGER' });
    expect(res.body.user.permissions).toContain('shipments:write');
    expect(res.body.user.permissions).not.toContain('settings:manage');
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('gs_rt='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejects a wrong password with the standard error shape and audits it', async () => {
    const u = await createUser('OPERATOR');
    const res = await login(u.email, 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect' },
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'LOGIN_FAILED'));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(TEST_PASSWORD);
  });

  it('gives the same answer for an unknown email', async () => {
    const res = await login('nobody@test.local');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email or password is incorrect');
  });

  it('refuses deactivated users', async () => {
    const u = await createUser('VIEWER', 'gone@test.local', false);
    expect((await login(u.email)).status).toBe(401);
  });

  it('validates input with field details', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ path: 'password' }),
      ]),
    );
  });
});

describe('GET /auth/me', () => {
  it('returns the user for a valid access token', async () => {
    const u = await createUser('ACCOUNTANT');
    const { body } = await login(u.email);
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ACCOUNTANT');
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nonsense')).status,
    ).toBe(401);
    const forged = (await import('jsonwebtoken')).default.sign(
      { role: 'ADMIN', perms: [] },
      'some-other-secret-some-other-secret-1',
      { subject: crypto.randomUUID() },
    );
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)).status,
    ).toBe(401);
  });
});

describe('my profile', () => {
  // Smallest valid PNG (1×1).
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('any role can rename itself and set or remove a profile picture', async () => {
    const u = await createUser('VIEWER');
    const { body } = await login(u.email);
    const h = { Authorization: `Bearer ${body.accessToken}` };

    const renamed = await request(app)
      .patch('/api/v1/auth/me')
      .set(h)
      .send({ fullName: ' Sea Sokchea ' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.fullName).toBe('Sea Sokchea');
    expect(
      (await request(app).patch('/api/v1/auth/me').set(h).send({ fullName: 'x' })).status,
    ).toBe(400);

    const up = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set(h)
      .attach('file', PNG, 'me.png');
    expect(up.status).toBe(200);
    const url = up.body.user.avatarUrl as string;
    expect(url).toMatch(/^\/api\/v1\/auth\/avatars\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);

    // Served to <img> without a token, as an image.
    const img = await request(app).get(url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    // A non-image renamed .png is refused.
    const fake = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set(h)
      .attach('file', Buffer.from('MZ not a picture'), 'evil.png');
    expect(fake.status).toBe(400);

    const removed = await request(app).delete('/api/v1/auth/me/avatar').set(h);
    expect(removed.body.user.avatarUrl).toBeNull();
    // Once it's no longer anyone's avatar, the file isn't served.
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).patch('/api/v1/auth/me').send({ fullName: 'Nobody' })).status).toBe(
      401,
    );
  });
});

describe('refresh token rotation', () => {
  it('rotates the cookie and detects reuse of an old token', async () => {
    const u = await createUser('OPERATOR');
    const first = refreshCookieFrom((await login(u.email)).headers['set-cookie']);
    expect(first).toBeDefined();

    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', first!);
    expect(r1.status).toBe(200);
    const second = refreshCookieFrom(r1.headers['set-cookie']);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);

    // Replaying the first (already rotated) token is treated as theft…
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first!);
    expect(replay.status).toBe(401);
    // …and revokes the whole family, including the newest token.
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', second!)).status).toBe(
      401,
    );
    const live = await db
      .select()
      .from(refreshTokens)
      .where(sql`${refreshTokens.revokedAt} IS NULL`);
    expect(live).toHaveLength(0);
    // Both attempts after the theft signal are logged as reuse.
    expect(await db.select().from(auditLog).where(eq(auditLog.action, 'TOKEN_REUSE'))).toHaveLength(
      2,
    );
  });

  it('logout revokes the session', async () => {
    const u = await createUser('VIEWER');
    const cookie = refreshCookieFrom((await login(u.email)).headers['set-cookie']);
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookie!)).status).toBe(
      204,
    );
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie!)).status).toBe(
      401,
    );
  });

  it('refresh without a cookie is 401', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('RBAC middleware', () => {
  const probe = express();
  probe.get('/write', requireAuth, requirePermission('shipments:write'), (_req, res) => {
    res.json({ ok: true });
  });
  probe.use(errorHandler);

  it.each([
    ['ADMIN', 200],
    ['MANAGER', 200],
    ['OPERATOR', 200],
    ['ACCOUNTANT', 403],
    ['VIEWER', 403],
  ] as const)('%s → %i on shipments:write', async (role, status) => {
    const u = await createUser(role);
    const { body } = await login(u.email);
    const res = await request(probe)
      .get('/write')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ignores unknown permissions smuggled into a token', async () => {
    const u = await createUser('VIEWER');
    const token = signAccessToken(u.id, 'VIEWER', ['made:up' as never]);
    const res = await request(probe).get('/write').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('system', () => {
  it('health checks the database', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('unknown routes use the error format', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/auth/refresh', '/meta/nav-counts']),
    );
  });

  it('nav counts come from the database', async () => {
    const u = await createUser('VIEWER');
    const { body } = await login(u.email);
    const res = await request(app)
      .get('/api/v1/meta/nav-counts')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.body).toEqual({
      openFollowUps: 0,
      overdueFollowUps: 0,
      unreadNotifications: 0,
      creditNoteInbox: 0,
      recordSummaryInbox: 0,
    });
  });
});
