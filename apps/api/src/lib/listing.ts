import { sql, type SQL } from 'drizzle-orm';
import type { Paginated } from '@gs/shared';

/**
 * Build an ORDER BY from "?sort=-eta,reference" using a whitelist of field → SQL.
 * Unknown fields are ignored (never interpolated), so sort can't inject SQL.
 */
export function orderBy(sort: string | undefined, fields: Record<string, SQL>, fallback: SQL): SQL {
  const parts: SQL[] = [];
  for (const raw of (sort ?? '').split(',').filter(Boolean)) {
    const desc = raw.startsWith('-');
    const col = fields[desc ? raw.slice(1) : raw];
    if (col) parts.push(desc ? sql`${col} DESC NULLS LAST` : sql`${col} ASC NULLS LAST`);
  }
  return sql`ORDER BY ${sql.join(parts.length ? parts : [fallback], sql`, `)}`;
}

export function paginate(page: number, pageSize: number): SQL {
  return sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
}

export function whereAll(conds: SQL[]): SQL {
  return conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
}

/** Escape % and _ so user search text is matched literally inside ILIKE. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function toPaginated<T>(
  rows: (T & { total_count?: string | number })[],
  page: number,
  pageSize: number,
): Paginated<T> {
  const total = Number(rows[0]?.total_count ?? 0);
  const data = rows.map(({ total_count: _t, ...rest }) => rest as T);
  return {
    data,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/** Run raw SQL and type the rows (drizzle's execute<T> only accepts index-signature types). */
export async function queryRows<T>(
  exec: { execute: (q: SQL) => Promise<{ rows: unknown[] }> },
  q: SQL,
): Promise<T[]> {
  const r = await exec.execute(q);
  return r.rows as T[];
}

/** timestamptz → ISO-8601 UTC string ("2026-01-05T10:00:00.000Z"), parseable by every browser. */
export function isoTs(column: string): SQL {
  return sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
}
