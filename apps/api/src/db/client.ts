import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import * as schema from './schema';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (no time-zone shifts).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export type Db = NodePgDatabase<typeof schema>;
export const db: Db = drizzle(pool, { schema, casing: undefined });

/** Transaction handle type, for services that accept either `db` or a transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
