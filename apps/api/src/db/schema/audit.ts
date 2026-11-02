import { pgTable, text, uuid, bigserial, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { auditActionEnum } from './_common';
import { users } from './auth';

/** Who changed what. `before`/`after` hold the changed row (secrets stripped). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: auditActionEnum('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId),
    index('audit_log_at_idx').on(t.at),
    index('audit_log_user_idx').on(t.userId),
  ],
);
