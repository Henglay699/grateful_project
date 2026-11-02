import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChatConversationDetail,
  ChatConversationRow,
  ChatMessageRow,
  RoleCode,
} from '@gs/shared';
import { sql } from 'drizzle-orm';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { fileExists } from '../../lib/storage';
import { createUser, resetDb, TEST_PASSWORD } from '../../test/helpers';
import { purgeOldChatMessages } from './retention';

const app = createApp();
const ids: Partial<Record<RoleCode, string>> = {};
let tokens: Partial<Record<RoleCode, string>> = {};

async function as(role: RoleCode) {
  if (!tokens[role]) {
    ids[role] = (await createUser(role)).id;
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
});
afterAll(async () => {
  await pool.end();
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('team chat', () => {
  it('opens one direct chat per pair, sends text and stickers, and counts unread', async () => {
    const admin = await as('ADMIN');
    const op = await as('OPERATOR');
    const first = await request(app)
      .post('/api/v1/chat/direct')
      .set(admin)
      .send({ userId: ids.OPERATOR });
    expect(first.status).toBe(200);
    const again = await request(app)
      .post('/api/v1/chat/direct')
      .set(op)
      .send({ userId: ids.ADMIN });
    expect(again.body.id).toBe(first.body.id);
    expect((again.body as ChatConversationDetail).title).toBe('Test ADMIN');

    const url = `/api/v1/chat/conversations/${first.body.id}/messages`;
    expect((await request(app).post(url).set(admin).send({ body: 'Hello' })).status).toBe(201);
    expect((await request(app).post(url).set(admin).send({ sticker: 'thumbs' })).status).toBe(201);
    expect((await request(app).post(url).set(admin).send({ sticker: 'nope' })).status).toBe(400);

    const list = (await request(app).get('/api/v1/chat/conversations').set(op))
      .body as ChatConversationRow[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      unread: 2,
      lastMessage: { kind: 'STICKER', sticker: 'thumbs' },
    });
    // The sender has nothing unread.
    const mine = (await request(app).get('/api/v1/chat/conversations').set(admin)).body;
    expect(mine[0].unread).toBe(0);

    const msgs = (await request(app).get(url).set(op)).body as ChatMessageRow[];
    expect(msgs.map((m) => m.kind)).toEqual(['TEXT', 'STICKER']);
    await request(app)
      .post(`/api/v1/chat/conversations/${first.body.id}/read`)
      .set(op)
      .send({ seq: msgs[1]!.seq });
    expect((await request(app).get('/api/v1/chat/conversations').set(op)).body[0].unread).toBe(0);
    const newer = await request(app).get(url).query({ after: msgs[0]!.seq }).set(op);
    expect(newer.body.map((m: ChatMessageRow) => m.kind)).toEqual(['STICKER']);
  });

  it('manages a group: members, rename, photo, files, leaving', async () => {
    const admin = await as('ADMIN');
    const op = await as('OPERATOR');
    const viewer = await as('VIEWER');
    const made = await request(app)
      .post('/api/v1/chat/groups')
      .set(admin)
      .send({ title: 'Ops team', memberIds: [ids.OPERATOR] });
    expect(made.status).toBe(201);
    const g = made.body as ChatConversationDetail;
    expect(g.members.map((m) => [m.fullName, m.role])).toEqual([
      ['Test ADMIN', 'OWNER'],
      ['Test OPERATOR', 'MEMBER'],
    ]);
    const base = `/api/v1/chat/conversations/${g.id}`;

    // Outsiders can't see it.
    expect((await request(app).get(base).set(viewer)).status).toBe(404);
    expect((await request(app).get(`${base}/messages`).set(viewer)).status).toBe(404);

    const added = await request(app)
      .post(`${base}/members`)
      .set(op)
      .send({ userIds: [ids.VIEWER] });
    expect(added.body.memberCount).toBe(3);
    const renamed = await request(app).patch(base).set(viewer).send({ title: 'Ops & Docs' });
    expect(renamed.body.title).toBe('Ops & Docs');

    const photo = await request(app).post(`${base}/photo`).set(op).attach('file', PNG, 'g.png');
    expect(photo.body.hasPhoto).toBe(true);
    const pic = await request(app).get(`${base}/photo`).set(viewer);
    expect(pic.status).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');

    const sent = await request(app)
      .post(`${base}/files`)
      .set(op)
      .field('caption', 'Invoice')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'inv.pdf');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ kind: 'FILE', fileName: 'inv.pdf', body: 'Invoice' });
    const dl = await request(app).get(`/api/v1/chat/messages/${sent.body.id}/file`).set(viewer);
    expect(dl.status).toBe(200);
    const fake = await request(app)
      .post(`${base}/files`)
      .set(op)
      .attach('file', Buffer.from('MZ not a pdf'), 'evil.pdf');
    expect(fake.status).toBe(400);

    // Only the owner removes others; anyone can leave; the owner leaving hands over.
    expect((await request(app).delete(`${base}/members/${ids.VIEWER}`).set(op)).status).toBe(403);
    expect((await request(app).delete(`${base}/members/${ids.VIEWER}`).set(admin)).status).toBe(
      204,
    );
    expect((await request(app).get(base).set(viewer)).status).toBe(404);
    expect((await request(app).delete(`${base}/members/${ids.ADMIN}`).set(admin)).status).toBe(204);
    const after = (await request(app).get(base).set(op)).body as ChatConversationDetail;
    expect(after.members).toMatchObject([{ fullName: 'Test OPERATOR', role: 'OWNER' }]);

    const msgs = (await request(app).get(`${base}/messages`).set(op)).body as ChatMessageRow[];
    expect(msgs.filter((m) => m.kind === 'SYSTEM').map((m) => m.body)).toEqual([
      'Test ADMIN created the group "Ops team"',
      'Test OPERATOR added Test VIEWER',
      'Test VIEWER renamed the group to "Ops & Docs"',
      'Test OPERATOR changed the group photo',
      'Test ADMIN removed Test VIEWER',
      'Test ADMIN left the group',
    ]);
  });

  it('keeps @mentions of group members only and counts unread mentions', async () => {
    const admin = await as('ADMIN');
    const op = await as('OPERATOR');
    await as('VIEWER'); // not in the group
    const g = (
      await request(app)
        .post('/api/v1/chat/groups')
        .set(admin)
        .send({ title: 'Ops', memberIds: [ids.OPERATOR] })
    ).body as ChatConversationDetail;
    const sent = await request(app)
      .post(`/api/v1/chat/conversations/${g.id}/messages`)
      .set(admin)
      .send({
        body: '@Test OPERATOR please check',
        mentionIds: [ids.OPERATOR, ids.VIEWER, ids.ADMIN],
      });
    expect(sent.status).toBe(201);
    expect((sent.body as ChatMessageRow).mentionIds).toEqual([ids.OPERATOR]);
    const [row] = (await request(app).get('/api/v1/chat/conversations').set(op))
      .body as ChatConversationRow[];
    expect(row).toMatchObject({ unread: 1, mentions: 1 });
    await request(app)
      .post(`/api/v1/chat/conversations/${g.id}/read`)
      .set(op)
      .send({ seq: (sent.body as ChatMessageRow).seq });
    expect((await request(app).get('/api/v1/chat/conversations').set(op)).body[0].mentions).toBe(0);
  });

  it('lets people delete only their own messages', async () => {
    const admin = await as('ADMIN');
    const op = await as('OPERATOR');
    const c = (
      await request(app).post('/api/v1/chat/direct').set(admin).send({ userId: ids.OPERATOR })
    ).body;
    const m = (
      await request(app)
        .post(`/api/v1/chat/conversations/${c.id}/messages`)
        .set(admin)
        .send({ body: 'oops' })
    ).body as ChatMessageRow;
    expect((await request(app).delete(`/api/v1/chat/messages/${m.id}`).set(op)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/chat/messages/${m.id}`).set(admin)).status).toBe(
      204,
    );
    const [gone] = (await request(app).get(`/api/v1/chat/conversations/${c.id}/messages`).set(op))
      .body;
    expect(gone).toMatchObject({ deleted: true, body: '' });
  });
});

describe('chat clean-up', () => {
  it('deletes messages older than the retention period, with their files', async () => {
    const admin = await as('ADMIN');
    await as('OPERATOR');
    const c = (
      await request(app).post('/api/v1/chat/direct').set(admin).send({ userId: ids.OPERATOR })
    ).body;
    const base = `/api/v1/chat/conversations/${c.id}`;
    const old = (await request(app).post(`${base}/messages`).set(admin).send({ body: 'old' }))
      .body as ChatMessageRow;
    const oldFile = (
      await request(app)
        .post(`${base}/files`)
        .set(admin)
        .attach('file', Buffer.from('%PDF-1.4 old'), 'old.pdf')
    ).body as ChatMessageRow;
    await request(app).post(`${base}/messages`).set(admin).send({ body: 'recent' });
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    await db.execute(
      sql`UPDATE chat_messages SET created_at = ${eightDaysAgo} WHERE id IN (${old.id}, ${oldFile.id})`,
    );
    const [{ key }] = (
      await db.execute<{ key: string }>(
        sql`SELECT file_key AS key FROM chat_messages WHERE id = ${oldFile.id}`,
      )
    ).rows as [{ key: string }];
    expect(await fileExists(key)).toBe(true);

    expect(await purgeOldChatMessages(7)).toEqual({ messages: 2, files: 1 });
    expect(await fileExists(key)).toBe(false);
    const left = (await request(app).get(`${base}/messages`).set(admin)).body as ChatMessageRow[];
    expect(left.map((m) => m.body)).toEqual(['recent']);
    // 0 days = keep everything.
    expect(await purgeOldChatMessages(0)).toEqual({ messages: 0, files: 0 });
    expect((await request(app).get('/api/v1/chat/info').set(admin)).body).toEqual({
      retentionDays: 7,
    });
  });
});
