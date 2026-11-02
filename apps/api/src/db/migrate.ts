import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ROLE_CODES, ROLE_DEFAULT_PERMISSIONS, ROLE_LABEL } from '@gs/shared';
import { db, pool } from './client';
import { roles } from './schema';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/db (tsx) and from dist (bundled): look for the drizzle folder upwards.
const candidates = [
  path.resolve(here, '../../drizzle'),
  path.resolve(here, '../drizzle'),
  path.resolve(process.cwd(), 'drizzle'),
];

async function main() {
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) =>
    fs.existsSync(path.join(p, 'meta', '_journal.json')),
  );
  if (!migrationsFolder)
    throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  await migrate(db, { migrationsFolder });
  // eslint-disable-next-line no-console
  console.log(`✔ Migrations applied from ${migrationsFolder}`);
  // Roles added in code (e.g. Customs Broker) get their row with default permissions. Done
  // after migrating: a new role_code value can't be used inside the migration that adds it.
  const added = await db
    .insert(roles)
    .values(
      ROLE_CODES.map((code) => ({
        code,
        name: ROLE_LABEL[code],
        permissions: [...ROLE_DEFAULT_PERMISSIONS[code]],
      })),
    )
    .onConflictDoNothing()
    .returning({ code: roles.code });
  // eslint-disable-next-line no-console
  if (added.length) console.log(`✔ Added roles: ${added.map((r) => r.code).join(', ')}`);
  await pool.end();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await pool.end();
  process.exit(1);
});
