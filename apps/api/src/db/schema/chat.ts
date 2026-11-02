import {
  pgTable,
  text,
  uuid,
  bigint,
  bigserial,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id } from './_common';
import { users } from './auth';

/** A one-to-one chat (kind DIRECT, direct_key = the two user ids sorted) or a group. */
export const chatConversations = pgTable('chat_conversations', {
  id: id(),
  kind: text('kind', { enum: ['DIRECT', 'GROUP'] }).notNull(),
  title: text('title'),
  /** Group photo in storage. */
  photoKey: text('photo_key'),
  directKey: text('direct_key').unique(),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatMembers = pgTable(
  'chat_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['OWNER', 'MEMBER'] })
      .notNull()
      .default('MEMBER'),
    /** Last message seq this member has seen; later ones count as unread. */
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('chat_members_user_idx').on(t.userId),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['TEXT', 'STICKER', 'FILE', 'SYSTEM'] }).notNull(),
    body: text('body').notNull().default(''),
    sticker: text('sticker'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileMime: text('file_mime'),
    fileSize: bigint('file_size', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    mentionIds: uuid('mention_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (t) => [index('chat_messages_conversation_idx').on(t.conversationId, t.seq)],
);
