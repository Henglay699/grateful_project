import { and, eq, sql } from 'drizzle-orm';
import type { ClientNote } from '@gs/shared';
import type { Request } from 'express';
import { db } from '../../db/client';
import { clientNotes, clients } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';

export interface NoteValues {
  subject: string;
  body: string;
  hidden: boolean;
}

/** What the audit log keeps of a note: never its text (it may hold a password). */
const trail = (n: { subject: string; hidden: boolean }) => ({
  subject: n.subject,
  hidden: n.hidden,
});

export function listNotes(clientId: string): Promise<ClientNote[]> {
  return queryRows<ClientNote>(
    db,
    sql`
    SELECT n.id, n.subject, n.body, n.hidden, n.updated_at AS "updatedAt", u.full_name AS "updatedBy"
    FROM client_notes n LEFT JOIN users u ON u.id = coalesce(n.updated_by_id, n.created_by_id)
    WHERE n.client_id = ${clientId}
    ORDER BY n.created_at, n.id`,
  );
}

export async function createNote(
  clientId: string,
  input: NoteValues,
  req: Request,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
    if (!c) throw notFound('Client');
    const userId = req.auth?.userId ?? null;
    const [row] = await tx
      .insert(clientNotes)
      .values({ clientId, ...input, createdById: userId, updatedById: userId })
      .returning({ id: clientNotes.id });
    await audit(
      tx,
      { action: 'CREATE', entity: 'client_note', entityId: row!.id, after: trail(input) },
      req,
    );
    return row!;
  });
}

export async function updateNote(
  clientId: string,
  noteId: string,
  input: NoteValues,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId)))
      .for('update');
    if (!before) throw notFound('Note');
    await tx
      .update(clientNotes)
      .set({ ...input, updatedById: req.auth?.userId ?? null })
      .where(eq(clientNotes.id, noteId));
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'client_note',
        entityId: noteId,
        before: trail(before),
        after: { ...trail(input), textChanged: before.body !== input.body },
      },
      req,
    );
  });
}

export async function deleteNote(clientId: string, noteId: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId)))
      .returning();
    if (!before) throw notFound('Note');
    await audit(
      tx,
      { action: 'DELETE', entity: 'client_note', entityId: noteId, before: trail(before) },
      req,
    );
  });
}
