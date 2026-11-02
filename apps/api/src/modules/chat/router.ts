import { Router, type Request } from 'express';
import multer from 'multer';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CHAT_FILE_MAX_BYTES,
  CHAT_PAGE_SIZE,
  CHAT_STICKERS,
  chatAddMembersSchema,
  chatDirectSchema,
  chatGroupCreateSchema,
  chatGroupUpdateSchema,
  chatMessagesQuerySchema,
  chatReadSchema,
  chatSendSchema,
  type ChatConversationDetail,
  type ChatConversationRow,
  type ChatEvent,
  type ChatMember,
  type ChatMessageRow,
  type ChatUser,
} from '@gs/shared';
import { env } from '../../config/env';
import { db, type DbOrTx } from '../../db/client';
import { chatConversations, chatMembers, chatMessages, users } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { isoTs, queryRows } from '../../lib/listing';
import { fileExists, putFile, readFile } from '../../lib/storage';
import { contentMatchesExtension } from '../documents/router';
import { publish, subscribe } from './events';

const FILE_TYPES = /\.(pdf|png|jpe?g|webp|xlsx|xls|csv|docx|doc|txt)$/i;
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_FILE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    FILE_TYPES.test(file.originalname)
      ? cb(null, true)
      : cb(badRequest('Allowed files: PDF, images (PNG/JPG/WEBP), Excel, CSV, Word or text')),
}).single('file');
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /\.(png|jpe?g|webp)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(badRequest('Use a PNG, JPG or WEBP picture')),
}).single('file');
const INLINE_TYPES = /^(application\/pdf|image\/(png|jpeg|webp))$/;
const PHOTO_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const idParam = z.object({ id: z.string().uuid() });
const memberParam = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

const MESSAGE_SELECT = sql`
  SELECT m.id, m.seq::float8 AS seq, m.conversation_id AS "conversationId", m.kind,
         m.sender_id AS "senderId", u.full_name AS "senderName", u.avatar_url AS "senderAvatarUrl",
         CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
         CASE WHEN m.deleted_at IS NULL THEN m.sticker END AS sticker,
         CASE WHEN m.deleted_at IS NULL THEN m.file_name END AS "fileName",
         CASE WHEN m.deleted_at IS NULL THEN m.file_mime END AS "fileMime",
         CASE WHEN m.deleted_at IS NULL THEN m.file_size::float8 END AS "fileSize",
         ${isoTs('m.created_at')} AS "createdAt", m.deleted_at IS NOT NULL AS deleted,
         m.mention_ids AS "mentionIds"
  FROM chat_messages m LEFT JOIN users u ON u.id = m.sender_id`;

const me = (req: Request) => req.auth!.userId;

async function memberIds(conversationId: string, exec: DbOrTx = db): Promise<string[]> {
  const rows = await exec
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(eq(chatMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

/** The conversation, if the user is in it; otherwise 404 (no hint that it exists). */
async function membership(conversationId: string, userId: string) {
  const [row] = await db
    .select({ conversation: chatConversations, role: chatMembers.role })
    .from(chatMembers)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMembers.conversationId))
    .where(and(eq(chatMembers.conversationId, conversationId), eq(chatMembers.userId, userId)));
  if (!row) throw notFound('Chat');
  return row;
}
async function groupMembership(conversationId: string, userId: string) {
  const m = await membership(conversationId, userId);
  if (m.conversation.kind !== 'GROUP') throw badRequest('Only groups can do that');
  return m;
}

async function userName(id: string): Promise<string> {
  const [u] = await db.select({ n: users.fullName }).from(users).where(eq(users.id, id));
  return u?.n ?? 'Someone';
}

/** Active users among `ids` (others are dropped silently). */
async function activeUsers(ids: string[]): Promise<{ id: string; fullName: string }[]> {
  if (!ids.length) return [];
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true), sql`${users.deletedAt} IS NULL`));
}

async function messageRow(id: string): Promise<ChatMessageRow> {
  const [row] = await queryRows<ChatMessageRow>(db, sql`${MESSAGE_SELECT} WHERE m.id = ${id}`);
  return row!;
}

/** Store a message, bump the chat to the top, and tell every member. */
async function addMessage(
  conversationId: string,
  values: Omit<typeof chatMessages.$inferInsert, 'conversationId'>,
  exec: DbOrTx = db,
): Promise<{ id: string; seq: number }> {
  const [row] = await exec
    .insert(chatMessages)
    .values({ ...values, conversationId })
    .returning({ id: chatMessages.id, seq: chatMessages.seq, at: chatMessages.createdAt });
  await exec
    .update(chatConversations)
    .set({ lastMessageAt: row!.at })
    .where(eq(chatConversations.id, conversationId));
  // The sender has read their own message.
  if (values.senderId)
    await exec
      .update(chatMembers)
      .set({ lastReadSeq: row!.seq })
      .where(
        and(
          eq(chatMembers.conversationId, conversationId),
          eq(chatMembers.userId, values.senderId),
        ),
      );
  return { id: row!.id, seq: row!.seq };
}
const notify = async (conversationId: string, e: ChatEvent, also: string[] = []) =>
  publish([...(await memberIds(conversationId)), ...also], e);

async function conversationRows(userId: string, onlyId?: string): Promise<ChatConversationRow[]> {
  const rows = await queryRows<Omit<ChatConversationRow, 'lastMessage'>>(
    db,
    sql`
    SELECT c.id, c.kind,
           CASE WHEN c.kind = 'GROUP' THEN coalesce(c.title, 'Group') ELSE coalesce(p.full_name, 'Deleted user') END AS title,
           c.photo_key IS NOT NULL AS "hasPhoto",
           CASE WHEN c.photo_key IS NOT NULL THEN md5(c.photo_key) END AS "photoVersion",
           p.avatar_url AS "avatarUrl", p.id AS "peerId",
           (SELECT count(*)::int FROM chat_members x WHERE x.conversation_id = c.id) AS "memberCount",
           (SELECT count(*)::int FROM chat_messages n
             WHERE n.conversation_id = c.id AND n.seq > me.last_read_seq AND n.deleted_at IS NULL
               AND n.sender_id IS DISTINCT FROM me.user_id AND n.kind <> 'SYSTEM') AS unread,
           (SELECT count(*)::int FROM chat_messages n
             WHERE n.conversation_id = c.id AND n.seq > me.last_read_seq AND n.deleted_at IS NULL
               AND me.user_id = ANY(n.mention_ids)) AS mentions,
           ${isoTs('c.last_message_at')} AS "lastMessageAt"
    FROM chat_members me
    JOIN chat_conversations c ON c.id = me.conversation_id
    LEFT JOIN LATERAL (
      SELECT u.id, u.full_name, u.avatar_url FROM chat_members o JOIN users u ON u.id = o.user_id
      WHERE c.kind = 'DIRECT' AND o.conversation_id = c.id AND o.user_id <> me.user_id LIMIT 1
    ) p ON true
    WHERE me.user_id = ${userId} ${onlyId ? sql`AND c.id = ${onlyId}` : sql``}
    ORDER BY c.last_message_at DESC`,
  );
  if (!rows.length) return [];
  const last = await queryRows<ChatMessageRow>(
    db,
    sql`${MESSAGE_SELECT} WHERE m.id IN (
          SELECT DISTINCT ON (l.conversation_id) l.id FROM chat_messages l
          WHERE l.conversation_id IN (${sql.join(
            rows.map((r) => sql`${r.id}`),
            sql`, `,
          )})
          ORDER BY l.conversation_id, l.seq DESC)`,
  );
  const lastBy = new Map(last.map((m) => [m.conversationId, m]));
  return rows.map((r) => ({ ...r, lastMessage: lastBy.get(r.id) ?? null }));
}

async function detail(conversationId: string, userId: string): Promise<ChatConversationDetail> {
  const [row] = await conversationRows(userId, conversationId);
  if (!row) throw notFound('Chat');
  const members = await queryRows<ChatMember>(
    db,
    sql`SELECT u.id, u.full_name AS "fullName", u.avatar_url AS "avatarUrl", m.role
        FROM chat_members m JOIN users u ON u.id = m.user_id
        WHERE m.conversation_id = ${conversationId}
        ORDER BY m.role = 'OWNER' DESC, u.full_name`,
  );
  const [c] = await db
    .select({ createdById: chatConversations.createdById })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId));
  return { ...row, members, createdById: c?.createdById ?? null };
}

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** Chat-wide settings the browser shows: how long messages are kept (0 = forever). */
chatRouter.get('/info', (_req, res) => {
  res.json({ retentionDays: env.CHAT_RETENTION_DAYS });
});

/** People you can chat with: every active user but you. */
chatRouter.get('/users', async (req, res) => {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        sql`${users.deletedAt} IS NULL`,
        sql`${users.id} <> ${me(req)}`,
      ),
    )
    .orderBy(users.fullName);
  res.json(rows satisfies ChatUser[]);
});

/**
 * Live updates as newline-delimited JSON (fetch-streamed by the browser so it can send the
 * Bearer token). A ping every 25 s keeps proxies from closing an idle connection.
 */
chatRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (e: ChatEvent) => res.write(`${JSON.stringify(e)}\n`);
  const off = subscribe(me(req), send);
  const ping = setInterval(() => send({ type: 'ping' }), 25_000);
  send({ type: 'ping' });
  res.on('close', () => {
    clearInterval(ping);
    off();
  });
});

chatRouter.get('/conversations', async (req, res) => {
  res.json(await conversationRows(me(req)));
});

chatRouter.get('/conversations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(await detail(id, me(req)));
});

/** Open (or start) the one-to-one chat with a user. */
chatRouter.post('/direct', async (req, res) => {
  const { userId } = parse(chatDirectSchema, req.body);
  if (userId === me(req)) throw badRequest("You can't start a chat with yourself");
  if (!(await activeUsers([userId])).length) throw notFound('User');
  const directKey = [me(req), userId].sort().join(':');
  const id = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(chatConversations)
      .values({ kind: 'DIRECT', directKey, createdById: me(req) })
      .onConflictDoNothing({ target: chatConversations.directKey })
      .returning({ id: chatConversations.id });
    if (!made) {
      const [found] = await tx
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(eq(chatConversations.directKey, directKey));
      return found!.id;
    }
    await tx.insert(chatMembers).values([
      { conversationId: made.id, userId: me(req), role: 'MEMBER' },
      { conversationId: made.id, userId, role: 'MEMBER' },
    ]);
    return made.id;
  });
  res.json(await detail(id, me(req)));
});

chatRouter.post('/groups', async (req, res) => {
  const v = parse(chatGroupCreateSchema, req.body);
  const others = (await activeUsers(v.memberIds)).filter((u) => u.id !== me(req));
  if (!others.length) throw badRequest('Pick at least one member');
  const name = await userName(me(req));
  const id = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(chatConversations)
      .values({ kind: 'GROUP', title: v.title, createdById: me(req) })
      .returning({ id: chatConversations.id });
    await tx
      .insert(chatMembers)
      .values([
        { conversationId: c!.id, userId: me(req), role: 'OWNER' },
        ...others.map((u) => ({ conversationId: c!.id, userId: u.id, role: 'MEMBER' as const })),
      ]);
    await addMessage(
      c!.id,
      { kind: 'SYSTEM', senderId: null, body: `${name} created the group "${v.title}"` },
      tx,
    );
    return c!.id;
  });
  await notify(id, { type: 'conversation', conversationId: id });
  res.status(201).json(await detail(id, me(req)));
});

/** Rename a group (any member). */
chatRouter.patch('/conversations/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { title } = parse(chatGroupUpdateSchema, req.body);
  const m = await groupMembership(id, me(req));
  if (m.conversation.title !== title) {
    await db
      .update(chatConversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(chatConversations.id, id));
    const { seq } = await addMessage(id, {
      kind: 'SYSTEM',
      senderId: null,
      body: `${await userName(me(req))} renamed the group to "${title}"`,
    });
    await notify(id, { type: 'message', conversationId: id, seq });
    await notify(id, { type: 'conversation', conversationId: id });
  }
  res.json(await detail(id, me(req)));
});

/** Set the group photo (any member); the browser crops it square first. */
chatRouter.post('/conversations/:id/photo', photoUpload, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await groupMembership(id, me(req));
  const file = req.file;
  if (!file) throw badRequest('Choose a picture to upload');
  if (!contentMatchesExtension(file.originalname, file.buffer))
    throw badRequest('That file is not a valid picture');
  const { key } = await putFile(file.buffer, file.originalname);
  await db
    .update(chatConversations)
    .set({ photoKey: key, updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
  const { seq } = await addMessage(id, {
    kind: 'SYSTEM',
    senderId: null,
    body: `${await userName(me(req))} changed the group photo`,
  });
  await notify(id, { type: 'message', conversationId: id, seq });
  await notify(id, { type: 'conversation', conversationId: id });
  res.json(await detail(id, me(req)));
});

chatRouter.delete('/conversations/:id/photo', async (req, res) => {
  const { id } = parse(idParam, req.params);
  await groupMembership(id, me(req));
  await db
    .update(chatConversations)
    .set({ photoKey: null, updatedAt: new Date() })
    .where(eq(chatConversations.id, id));
  await notify(id, { type: 'conversation', conversationId: id });
  res.json(await detail(id, me(req)));
});

chatRouter.get('/conversations/:id/photo', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { conversation: c } = await membership(id, me(req));
  if (!c.photoKey || !(await fileExists(c.photoKey))) throw notFound('Picture');
  res.setHeader('Content-Type', PHOTO_TYPES[c.photoKey.split('.').pop()!] ?? 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  readFile(c.photoKey)
    .on('error', () => res.destroy())
    .pipe(res);
});

/** Add people to a group (any member). */
chatRouter.post('/conversations/:id/members', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { userIds } = parse(chatAddMembersSchema, req.body);
  await groupMembership(id, me(req));
  const current = new Set(await memberIds(id));
  const adding = (await activeUsers(userIds)).filter((u) => !current.has(u.id));
  if (adding.length) {
    const { seq } = await db.transaction(async (tx) => {
      await tx
        .insert(chatMembers)
        .values(adding.map((u) => ({ conversationId: id, userId: u.id })))
        .onConflictDoNothing();
      return addMessage(
        id,
        {
          kind: 'SYSTEM',
          senderId: null,
          body: `${await userName(me(req))} added ${adding.map((u) => u.fullName).join(', ')}`,
        },
        tx,
      );
    });
    await notify(id, { type: 'message', conversationId: id, seq });
    await notify(id, { type: 'conversation', conversationId: id });
  }
  res.json(await detail(id, me(req)));
});

/**
 * Remove someone from a group (the owner only), or leave it yourself. When the owner leaves,
 * the longest-standing member takes over; an empty group is deleted.
 */
chatRouter.delete('/conversations/:id/members/:userId', async (req, res) => {
  const { id, userId } = parse(memberParam, req.params);
  const mine = await groupMembership(id, me(req));
  const leaving = userId === me(req);
  if (!leaving && mine.role !== 'OWNER') throw forbidden('Only the group owner can remove members');
  const [target] = await db
    .select({ role: chatMembers.role })
    .from(chatMembers)
    .where(and(eq(chatMembers.conversationId, id), eq(chatMembers.userId, userId)));
  if (!target) throw notFound('Member');
  const actor = await userName(me(req));
  const targetName = await userName(userId);
  const seq = await db.transaction(async (tx) => {
    await tx
      .delete(chatMembers)
      .where(and(eq(chatMembers.conversationId, id), eq(chatMembers.userId, userId)));
    const rest = await tx
      .select({ userId: chatMembers.userId, role: chatMembers.role })
      .from(chatMembers)
      .where(eq(chatMembers.conversationId, id))
      .orderBy(chatMembers.joinedAt);
    if (!rest.length) {
      await tx.delete(chatConversations).where(eq(chatConversations.id, id));
      return null;
    }
    if (target.role === 'OWNER' && !rest.some((r) => r.role === 'OWNER'))
      await tx
        .update(chatMembers)
        .set({ role: 'OWNER' })
        .where(and(eq(chatMembers.conversationId, id), eq(chatMembers.userId, rest[0]!.userId)));
    const msg = await addMessage(
      id,
      {
        kind: 'SYSTEM',
        senderId: null,
        body: leaving ? `${actor} left the group` : `${actor} removed ${targetName}`,
      },
      tx,
    );
    return msg.seq;
  });
  publish([userId], { type: 'removed', conversationId: id });
  if (seq !== null) {
    await notify(id, { type: 'message', conversationId: id, seq });
    await notify(id, { type: 'conversation', conversationId: id });
  }
  res.status(204).end();
});

/** Newest page by default; `before` pages back, `after` catches up on new ones. */
chatRouter.get('/conversations/:id/messages', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const q = parse(chatMessagesQuerySchema, req.query);
  await membership(id, me(req));
  const rows =
    q.after !== undefined
      ? await queryRows<ChatMessageRow>(
          db,
          sql`${MESSAGE_SELECT} WHERE m.conversation_id = ${id} AND m.seq > ${q.after}
              ORDER BY m.seq LIMIT 500`,
        )
      : (
          await queryRows<ChatMessageRow>(
            db,
            sql`${MESSAGE_SELECT} WHERE m.conversation_id = ${id}
                ${q.before ? sql`AND m.seq < ${q.before}` : sql``}
                ORDER BY m.seq DESC LIMIT ${CHAT_PAGE_SIZE}`,
          )
        ).reverse();
  res.json(rows);
});

/** Send a text message or a sticker. */
chatRouter.post('/conversations/:id/messages', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(chatSendSchema, req.body);
  await membership(id, me(req));
  // Only other members of this chat can be mentioned.
  const members = new Set(await memberIds(id));
  const mentionIds =
    'body' in v ? [...new Set(v.mentionIds)].filter((u) => u !== me(req) && members.has(u)) : [];
  const msg = await addMessage(
    id,
    'sticker' in v
      ? { kind: 'STICKER', senderId: me(req), sticker: v.sticker, body: CHAT_STICKERS[v.sticker] }
      : { kind: 'TEXT', senderId: me(req), body: v.body, mentionIds },
  );
  await notify(id, { type: 'message', conversationId: id, seq: msg.seq });
  res.status(201).json(await messageRow(msg.id));
});

/** Send a file (multipart: file, optional caption). */
chatRouter.post('/conversations/:id/files', fileUpload, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await membership(id, me(req));
  const file = req.file;
  if (!file) throw badRequest('Attach the file in a form field named "file"');
  if (!contentMatchesExtension(file.originalname, file.buffer))
    throw badRequest(
      `The file's content doesn't match its .${file.originalname.split('.').pop()} extension`,
    );
  const caption = String(req.body?.caption ?? '')
    .trim()
    .slice(0, 4000);
  const stored = await putFile(file.buffer, file.originalname);
  const msg = await addMessage(id, {
    kind: 'FILE',
    senderId: me(req),
    body: caption,
    fileKey: stored.key,
    fileName: file.originalname.slice(0, 200),
    fileMime: file.mimetype || 'application/octet-stream',
    fileSize: file.size,
  });
  await notify(id, { type: 'message', conversationId: id, seq: msg.seq });
  res.status(201).json(await messageRow(msg.id));
});

chatRouter.get('/messages/:id/file', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.deletedAt || !m.fileKey) throw notFound('File');
  await membership(m.conversationId, me(req));
  if (!(await fileExists(m.fileKey))) throw notFound('File');
  const mime = m.fileMime ?? 'application/octet-stream';
  const inline = req.query.inline === '1' && INLINE_TYPES.test(mime);
  res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
  if (m.fileSize) res.setHeader('Content-Length', String(m.fileSize));
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(m.fileName ?? 'file')}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  readFile(m.fileKey)
    .on('error', () => res.destroy())
    .pipe(res);
});

/** Delete one of your own messages (it shows as "Message deleted"). */
chatRouter.delete('/messages/:id', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.deletedAt) throw notFound('Message');
  await membership(m.conversationId, me(req));
  if (m.senderId !== me(req)) throw forbidden('You can only delete your own messages');
  await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, id));
  await notify(m.conversationId, {
    type: 'deleted',
    conversationId: m.conversationId,
    messageId: id,
  });
  res.status(204).end();
});

/** Mark messages up to `seq` as read. */
chatRouter.post('/conversations/:id/read', async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { seq } = parse(chatReadSchema, req.body);
  await membership(id, me(req));
  await db
    .update(chatMembers)
    .set({ lastReadSeq: sql`greatest(${chatMembers.lastReadSeq}, ${seq})` })
    .where(and(eq(chatMembers.conversationId, id), eq(chatMembers.userId, me(req))));
  publish([me(req)], { type: 'read', conversationId: id });
  res.status(204).end();
});
