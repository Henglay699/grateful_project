/**
 * Route-protection audit. Reads every router file, finds every endpoint, and proves:
 *  1. without a token each one answers 401 (except the public auth/health routes);
 *  2. a Viewer (read-only role) gets 403 on every write endpoint.
 * A new endpoint added without requireAuth / requirePermission fails this test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { pool } from '../db/client';
import { createUser, resetDb, TEST_PASSWORD } from '../test/helpers';
import { contentMatchesExtension } from './documents/router';

// fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/..." and breaks path.join.
const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(here, '..', 'app.ts'), 'utf8');
const mounts = new Map(
  [...appSrc.matchAll(/v1\.use\('([^']+)', (\w+)\)/g)].map((m) => [m[2]!, m[1]!]),
);

interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
}
const routes: Route[] = [];
for (const dir of fs.readdirSync(here)) {
  const file = path.join(here, dir, 'router.ts');
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(\w+Router)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    const base = mounts.get(m[1]!);
    if (base)
      routes.push({
        method: m[2] as Route['method'],
        path: `/api/v1${base}${m[3] === '/' ? '' : m[3]}`,
      });
  }
  // settings/router.ts registers its CRUD routes through a helper: crud('/ports', …)
  for (const m of src.matchAll(/crud\('([^']+)'/g)) {
    routes.push(
      { method: 'post', path: `/api/v1/settings${m[1]}` },
      { method: 'patch', path: `/api/v1/settings${m[1]}/:id` },
    );
  }
}

const PUBLIC = new Set([
  'post /api/v1/auth/login',
  'post /api/v1/auth/refresh',
  'post /api/v1/auth/logout',
  'get /api/v1/health',
]);
/** Endpoints any signed-in user may call (they act only on the caller, or change no data). */
const SELF_SERVICE = new Set([
  'post /api/v1/auth/change-password',
  'patch /api/v1/auth/me', // my own name
  'post /api/v1/auth/me/avatar', // my own profile picture
  'delete /api/v1/auth/me/avatar',
  'post /api/v1/accounting/credit-notes/inbox/read', // marks my own inbox messages read
  'post /api/v1/accounting/record-summaries/inbox/read', // same, for record summaries
  'post /api/v1/assistant/chat', // "Ask AI": everyone may ask; it writes nothing
  'post /api/v1/assistant/follow-ups', // "Ask AI" follow-up questions: also writes nothing
  // Team chat: everyone may chat; each call is limited to chats the caller is a member of.
  'post /api/v1/chat/direct',
  'post /api/v1/chat/groups',
  'patch /api/v1/chat/conversations/:id',
  'post /api/v1/chat/conversations/:id/photo',
  'delete /api/v1/chat/conversations/:id/photo',
  'post /api/v1/chat/conversations/:id/members',
  'delete /api/v1/chat/conversations/:id/members/:userId',
  'post /api/v1/chat/conversations/:id/messages',
  'post /api/v1/chat/conversations/:id/files',
  'delete /api/v1/chat/messages/:id',
  'post /api/v1/chat/conversations/:id/read',
]);
const concrete = (p: string) =>
  p
    .replace(':id', '00000000-0000-4000-8000-000000000000')
    .replace(':type', 'tax-invoices')
    .replace(':code', 'VIEWER');

const app = createApp();
let viewer = '';
beforeAll(async () => {
  await resetDb();
  const u = await createUser('VIEWER');
  viewer = (
    await request(app).post('/api/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD })
  ).body.accessToken;
});
afterAll(async () => {
  await pool.end();
});

describe('route protection audit', () => {
  it('found the routers and their endpoints', () => {
    expect(mounts.size).toBeGreaterThanOrEqual(14);
    expect(routes.length).toBeGreaterThan(90);
  });

  it('every non-public endpoint rejects anonymous requests (401)', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await request(app)[r.method](concrete(r.path)).send({});
      if (res.status !== 401) leaks.push(`${key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('a read-only Viewer is refused on every write endpoint (403)', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (r.method === 'get' || PUBLIC.has(key) || SELF_SERVICE.has(key)) continue;
      const res = await request(app)
        [r.method](concrete(r.path))
        .set('Authorization', `Bearer ${viewer}`)
        .send({});
      if (res.status !== 403) leaks.push(`${key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('a Viewer cannot read staff or audit-sensitive admin data', async () => {
    for (const p of ['/api/v1/staff', '/api/v1/staff/roles']) {
      expect((await request(app).get(p).set('Authorization', `Bearer ${viewer}`)).status).toBe(403);
    }
  });
});

describe('upload content checks', () => {
  it.each([
    ['report.pdf', Buffer.from('%PDF-1.7\n'), true],
    ['report.pdf', Buffer.from('MZ\x90\x00 not a pdf'), false],
    ['photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), true],
    ['photo.jpg', Buffer.from([0x89, 0x50, 0x4e, 0x47]), false],
    ['sheet.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), true],
    ['notes.txt', Buffer.from('plain text'), true],
    ['notes.txt', Buffer.from([0x41, 0x00, 0x42]), false],
    ['tool.exe', Buffer.from('MZ'), false],
  ])('%s → %s', (name, buf, ok) => expect(contentMatchesExtension(name, buf)).toBe(ok));
});

describe('security headers', () => {
  it('sends a strict CSP and no HTTPS upgrade on plain-HTTP deployments', async () => {
    const res = await request(app).get('/api/v1/health');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
