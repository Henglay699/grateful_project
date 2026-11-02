import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { chatMembers, chatMessages } from '../../db/schema';
import { logger } from '../../lib/logger';
import { deleteFile } from '../../lib/storage';
import { publish } from './events';

const EVERY_MS = 60 * 60 * 1000;

/**
 * Delete chat messages older than `days` for good, with their files on disk, so chat
 * doesn't fill the server. Chats and groups themselves are kept.
 */
export async function purgeOldChatMessages(
  days = env.CHAT_RETENTION_DAYS,
  now = new Date(),
): Promise<{ messages: number; files: number }> {
  if (days <= 0) return { messages: 0, files: 0 };
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const old = lt(chatMessages.createdAt, cutoff);
  const files = await db
    .select({ key: chatMessages.fileKey })
    .from(chatMessages)
    .where(and(old, isNotNull(chatMessages.fileKey)));
  const gone = await db
    .delete(chatMessages)
    .where(old)
    .returning({ conversationId: chatMessages.conversationId });
  let removed = 0;
  for (const f of files) {
    try {
      await deleteFile(f.key!);
      removed++;
    } catch (err) {
      logger.warn({ err, key: f.key }, 'Could not delete an old chat file');
    }
  }
  // Refresh the chat list (last message, unread) for everyone in an affected chat.
  const ids = [...new Set(gone.map((g) => g.conversationId))];
  if (ids.length) {
    const members = await db
      .select({ userId: chatMembers.userId, conversationId: chatMembers.conversationId })
      .from(chatMembers)
      .where(inArray(chatMembers.conversationId, ids));
    for (const id of ids)
      publish(
        members.filter((m) => m.conversationId === id).map((m) => m.userId),
        { type: 'conversation', conversationId: id },
      );
  }
  return { messages: gone.length, files: removed };
}

/** Run the clean-up shortly after boot, then every hour. */
export function startChatRetention(): () => void {
  if (env.CHAT_RETENTION_DAYS <= 0) return () => {};
  const run = () =>
    void purgeOldChatMessages()
      .then((r) => r.messages && logger.info(r, 'Deleted old chat messages'))
      .catch((err: unknown) => logger.error({ err }, 'Chat clean-up failed'));
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, EVERY_MS);
  first.unref();
  timer.unref();
  logger.info(`Chat clean-up on: messages are deleted after ${env.CHAT_RETENTION_DAYS} days`);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
