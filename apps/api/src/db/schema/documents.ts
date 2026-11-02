import { pgTable, text, uuid, bigint, index, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  documentCategoryEnum,
  followUpPriorityEnum,
  followUpStatusEnum,
} from './_common';
import { users } from './auth';
import { clients } from './reference';
import { shipments } from './shipments';
import { creditNotes, recordSummaries } from './accounting';

/** File metadata. The bytes live in storage (disk volume or S3), keyed by storage_key. */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    title: text('title').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    category: documentCategoryEnum('category').notNull().default('OTHER'),
    statusLabel: text('status_label'),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /** Support documents of a credit note or record summary. */
    creditNoteId: uuid('credit_note_id').references(() => creditNotes.id, {
      onDelete: 'set null',
    }),
    recordSummaryId: uuid('record_summary_id').references(() => recordSummaries.id, {
      onDelete: 'set null',
    }),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('documents_shipment_idx').on(t.shipmentId),
    index('documents_credit_note_idx').on(t.creditNoteId),
    index('documents_record_summary_idx').on(t.recordSummaryId),
    index('documents_client_idx').on(t.clientId),
    index('documents_category_idx').on(t.category),
  ],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    reference: text('reference').notNull(),
    subject: text('subject').notNull(),
    notes: text('notes'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    priority: followUpPriorityEnum('priority').notNull().default('MEDIUM'),
    status: followUpStatusEnum('status').notNull().default('OPEN'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('follow_ups_reference_unique').on(t.reference),
    index('follow_ups_open_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} <> 'DONE' AND ${t.deletedAt} IS NULL`),
    index('follow_ups_assignee_idx').on(t.assigneeId),
  ],
);
