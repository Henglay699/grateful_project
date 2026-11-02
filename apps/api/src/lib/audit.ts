import type { AuditAction } from '@gs/shared';
import type { Request } from 'express';
import { auditLog } from '../db/schema';
import type { DbOrTx } from '../db/client';

const SECRET_KEYS = new Set([
  'passwordHash',
  'password_hash',
  'tokenHash',
  'token_hash',
  'password',
]);

function strip(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(strip);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEYS.has(k))
        .map(([k, val]) => [k, strip(val)]),
    );
  }
  return v;
}

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  userId?: string | null;
}

/** Write an audit row inside the caller's transaction (so it commits or rolls back with the change). */
export async function audit(tx: DbOrTx, entry: AuditEntry, req?: Request): Promise<void> {
  await tx.insert(auditLog).values({
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: strip(entry.before) ?? null,
    after: strip(entry.after) ?? null,
    reason: entry.reason ?? null,
    userId: entry.userId ?? req?.auth?.userId ?? null,
    ip: req?.ip ?? null,
    userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
    requestId: (req?.id as string | undefined) ?? null,
  });
}
