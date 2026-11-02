import { z } from 'zod';

/**
 * Team chat: one-to-one chats and groups between signed-in users. Files are stored on the
 * server; stickers are a fixed built-in set, sent by key.
 */
export const CHAT_KINDS = ['DIRECT', 'GROUP'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];
export const CHAT_MESSAGE_KINDS = ['TEXT', 'STICKER', 'FILE', 'SYSTEM'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.txt';
export const CHAT_GROUP_MAX_MEMBERS = 200;
export const CHAT_PAGE_SIZE = 50;

/** Built-in stickers (key → emoji), shown large. Packs group them in the picker. */
export const CHAT_STICKER_PACKS = [
  {
    name: 'Faces',
    stickers: {
      grin: '😁',
      joy: '😂',
      love: '😍',
      cool: '😎',
      think: '🤔',
      wow: '😮',
      cry: '😢',
      angry: '😡',
      sleepy: '😴',
      party: '🥳',
      hug: '🤗',
      shush: '🤫',
    },
  },
  {
    name: 'Work',
    stickers: {
      thumbs: '👍',
      ok: '👌',
      clap: '👏',
      pray: '🙏',
      muscle: '💪',
      done: '✅',
      fire: '🔥',
      rocket: '🚀',
      ship: '🚢',
      truck: '🚚',
      box: '📦',
      money: '💰',
    },
  },
  {
    name: 'Fun',
    stickers: {
      heart: '❤️',
      star: '⭐',
      tada: '🎉',
      coffee: '☕',
      cake: '🎂',
      sun: '☀️',
      cat: '🐱',
      dog: '🐶',
      panda: '🐼',
      unicorn: '🦄',
      flower: '🌸',
      hundred: '💯',
    },
  },
] as const;
export const CHAT_STICKERS: Record<string, string> = Object.assign(
  {},
  ...CHAT_STICKER_PACKS.map((p) => p.stickers),
);

const uuidList = z.array(z.string().uuid()).max(CHAT_GROUP_MAX_MEMBERS);

export const chatDirectSchema = z.object({ userId: z.string().uuid() });
export const chatGroupCreateSchema = z.object({
  title: z.string().trim().min(1, 'Name the group').max(80),
  memberIds: uuidList.min(1, 'Pick at least one member'),
});
export const chatGroupUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Name the group').max(80),
});
export const chatAddMembersSchema = z.object({ userIds: uuidList.min(1) });
export const chatSendSchema = z.union([
  z.object({
    body: z.string().trim().min(1).max(4000),
    /** People @mentioned in the text (group members only; others are dropped). */
    mentionIds: z.array(z.string().uuid()).max(50).default([]),
  }),
  z.object({ sticker: z.string().refine((k) => k in CHAT_STICKERS, 'Unknown sticker') }),
]);
export const chatMessagesQuerySchema = z.object({
  /** Messages older than this seq (scrolling up). */
  before: z.coerce.number().int().positive().optional(),
  /** Messages newer than this seq (catching up). */
  after: z.coerce.number().int().nonnegative().optional(),
});
export const chatReadSchema = z.object({ seq: z.number().int().nonnegative() });

export interface ChatUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ChatMessageRow {
  id: string;
  /** Increases with every message in the system; used as the paging cursor. */
  seq: number;
  conversationId: string;
  kind: ChatMessageKind;
  senderId: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  body: string;
  sticker: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  createdAt: string;
  deleted: boolean;
  /** Users @mentioned in the text, shown as "@Full Name". */
  mentionIds: string[];
}

export interface ChatConversationRow {
  id: string;
  kind: ChatKind;
  /** Group name, or the other person's name in a one-to-one chat. */
  title: string;
  /** Group photo (fetched with auth from /chat/conversations/:id/photo) or the person's avatar. */
  hasPhoto: boolean;
  avatarUrl: string | null;
  /** The other person, in a one-to-one chat. */
  peerId: string | null;
  memberCount: number;
  lastMessage: ChatMessageRow | null;
  lastMessageAt: string;
  unread: number;
  /** Unread messages that @mention you. */
  mentions: number;
  /** Bumped when the photo changes, so a cached photo is refetched. */
  photoVersion: string | null;
}

export interface ChatMember extends ChatUser {
  role: 'OWNER' | 'MEMBER';
}

export interface ChatConversationDetail extends ChatConversationRow {
  members: ChatMember[];
  createdById: string | null;
}

/** Pushed on GET /chat/stream (newline-delimited JSON). */
export type ChatEvent =
  | { type: 'message'; conversationId: string; seq: number }
  | { type: 'deleted'; conversationId: string; messageId: string }
  | { type: 'conversation'; conversationId: string }
  | { type: 'removed'; conversationId: string }
  | { type: 'read'; conversationId: string }
  | { type: 'ping' };
