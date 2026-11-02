import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';

/**
 * Atomically allocate the next number for a sequence key and return it.
 * Call inside the transaction that creates the document so a rollback does not
 * leave a gap… except under concurrency, where PostgreSQL row locks serialize callers.
 */
export async function nextNumber(tx: DbOrTx, key: string, startAt = 1): Promise<number> {
  const res = await tx.execute<{ value: number }>(sql`
    INSERT INTO number_sequences (key, next_value) VALUES (${key}, ${startAt + 1})
    ON CONFLICT (key) DO UPDATE SET next_value = number_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 AS value
  `);
  const value = res.rows[0]?.value;
  if (value === undefined) throw new Error(`Could not allocate number for ${key}`);
  return Number(value);
}

/**
 * Like nextNumber, but never below `atLeast`. Callers pass one more than the highest number
 * already used (typed by hand or carried over from Excel), so an automatic number never
 * repeats one that exists.
 */
export async function nextNumberAtLeast(tx: DbOrTx, key: string, atLeast: number): Promise<number> {
  const res = await tx.execute<{ value: number }>(sql`
    INSERT INTO number_sequences (key, next_value) VALUES (${key}, ${atLeast + 1})
    ON CONFLICT (key) DO UPDATE
      SET next_value = GREATEST(number_sequences.next_value, ${atLeast}) + 1, updated_at = now()
    RETURNING next_value - 1 AS value
  `);
  const value = res.rows[0]?.value;
  if (value === undefined) throw new Error(`Could not allocate number for ${key}`);
  return Number(value);
}

/**
 * The highest running number among `values` (a SQL list of number columns) matching
 * `pattern`, a POSIX regex whose one group is the running number. 0 when none match.
 */
export async function highestNumber(tx: DbOrTx, values: SQL, pattern: string): Promise<number> {
  const res = await tx.execute<{ n: string | null }>(sql`
    SELECT max(substring(upper(v) FROM ${pattern})::bigint)::text AS n
    FROM (${values}) x(v) WHERE upper(v) ~ ${pattern}
  `);
  return Number(res.rows[0]?.n ?? 0);
}

/** Escape a literal (e.g. a client code) for use inside a POSIX regex. */
export const regexLiteral = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Formats used by the prototype. */
export const formatNumber = {
  /** SHP-26-0001 */
  shipment: (yy: string, n: number) => `SHP-${yy}-${String(n).padStart(4, '0')}`,
  /** GS26-212 */
  taxInvoice: (yy: string, n: number) => `GS${yy}-${String(n).padStart(3, '0')}`,
  /** DIS232 */
  disbursement: (n: number) => `DIS${String(n).padStart(3, '0')}`,
  /** JR2606001 — client code + YYMM + 3-digit sequence */
  debitNote: (clientCode: string, yymm: string, n: number) =>
    `${clientCode}${yymm}${String(n).padStart(3, '0')}`,
  /** FLW-0091 */
  followUp: (n: number) => `FLW-${String(n).padStart(4, '0')}`,
  /** OR26-001 — official receipt */
  receipt: (yy: string, n: number) => `OR${yy}-${String(n).padStart(3, '0')}`,
};
