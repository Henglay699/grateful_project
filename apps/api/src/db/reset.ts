/** Drops and recreates the public schema. Refuses to run in production. */
import { pool } from './client';
import { isProd } from '../config/env';

async function main() {
  if (isProd) throw new Error('db:reset is disabled when NODE_ENV=production');
  await pool.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  // eslint-disable-next-line no-console
  console.log('✔ Database reset');
  await pool.end();
}
main().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  await pool.end();
  process.exit(1);
});
