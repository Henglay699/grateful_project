/* eslint-disable no-console -- CLI script */
/**
 * pnpm db:init — prepare an EMPTY production database (after migrations):
 * roles, countries, customs ports, forwarders, dropdown lists, quotation templates,
 * company settings, and the first Admin account. Safe to run more than once:
 * existing rows are never overwritten, and no demo data is created.
 *
 * Admin details come from INIT_ADMIN_EMAIL / INIT_ADMIN_NAME / INIT_ADMIN_PASSWORD,
 * or are asked for interactively.
 */
import readline from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { ROLE_CODES, ROLE_DEFAULT_PERMISSIONS, ROLE_LABEL, passwordSchema } from '@gs/shared';
import { db, pool } from './client';
import * as s from './schema';
import { COMPANY, COUNTRIES, FORWARDERS, LOOKUPS, PORTS } from './seed/data/reference';
import quotationTemplates from './seed/data/quotation-templates.json' with { type: 'json' };

async function ask(question: string, fallback?: string): Promise<string> {
  if (fallback) return fallback;
  if (!process.stdin.isTTY)
    throw new Error(
      `Missing ${question}. Set it as an environment variable when running non-interactively.`,
    );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question}: `);
  rl.close();
  return answer.trim();
}

async function main() {
  const counts: Record<string, number> = {};
  const count = (k: string, n: number) => (counts[k] = n);

  count(
    'roles',
    (
      await db
        .insert(s.roles)
        .values(
          ROLE_CODES.map((code) => ({
            code,
            name: ROLE_LABEL[code],
            permissions: [...ROLE_DEFAULT_PERMISSIONS[code]],
          })),
        )
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  count(
    'countries',
    // Every country comes from migration 0041; these fill in the map coordinates if missing.
    (
      await db
        .insert(s.countries)
        .values(COUNTRIES)
        .onConflictDoUpdate({
          target: s.countries.iso2,
          set: {
            lat: sql`coalesce(${s.countries.lat}, excluded.lat)`,
            lng: sql`coalesce(${s.countries.lng}, excluded.lng)`,
          },
        })
        .returning()
    ).length,
  );
  count(
    'ports',
    (
      await db
        .insert(s.ports)
        .values(PORTS.map((p) => ({ ...p, countryIso2: 'KH' })))
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  count(
    'forwarders',
    (
      await db
        .insert(s.forwarders)
        .values(FORWARDERS.map((f) => ({ code: f.code, name: f.name })))
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  count(
    'list values',
    (
      await db
        .insert(s.lookupValues)
        .values(
          Object.entries(LOOKUPS).flatMap(([type, values]) =>
            values.map((v, i) => ({
              type: type as (typeof s.lookupTypeEnum.enumValues)[number],
              value: v,
              label: v,
              sortOrder: i,
            })),
          ),
        )
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  count(
    'quotation templates',
    (
      await db
        .insert(s.quotationTemplates)
        .values(quotationTemplates as (typeof s.quotationTemplates.$inferInsert)[])
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  count(
    'settings',
    (
      await db
        .insert(s.settings)
        .values([
          { key: 'company', value: COMPANY },
          { key: 'defaultClearancePortCode', value: 'SHV11' },
          { key: 'baseExchangeRate', value: 4026 },
        ])
        .onConflictDoNothing()
        .returning()
    ).length,
  );
  console.log(
    'Reference data (new rows):',
    Object.entries(counts)
      .map(([k, n]) => `${k} ${n}`)
      .join(', '),
  );

  const [admins] = (
    await db.execute(sql`
    SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.is_active AND u.deleted_at IS NULL`)
  ).rows as { n: number }[];
  if (admins!.n > 0) {
    console.log(`✔ ${admins!.n} active Admin account(s) already exist — no account created.`);
    return;
  }
  console.log('\nCreate the first Admin account (they add everyone else in Staff Management):');
  const email = (await ask('Admin email', process.env.INIT_ADMIN_EMAIL)).toLowerCase();
  const fullName = await ask('Full name', process.env.INIT_ADMIN_NAME);
  const password = await ask(
    'Password (min. 10 characters, letters and a number)',
    process.env.INIT_ADMIN_PASSWORD,
  );
  const pw = passwordSchema.safeParse(password);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || fullName.length < 2 || !pw.success) {
    throw new Error(
      `Invalid admin details: ${!pw.success ? pw.error.issues[0]!.message : 'check the email and name'}`,
    );
  }
  const [role] = (await db.execute(sql`SELECT id FROM roles WHERE code = 'ADMIN'`)).rows as {
    id: string;
  }[];
  const [u] = await db
    .insert(s.users)
    .values({ email, fullName, passwordHash: await bcrypt.hash(password, 12), roleId: role!.id })
    .returning({ id: s.users.id });
  await db
    .insert(s.staffProfiles)
    .values({
      userId: u!.id,
      jobTitle: 'Administrator',
      department: 'Management',
      joinedOn: new Date().toISOString().slice(0, 10),
    });
  await db
    .insert(s.auditLog)
    .values({
      userId: u!.id,
      action: 'CREATE',
      entity: 'user',
      entityId: u!.id,
      after: { email, fullName, role: 'ADMIN', via: 'db:init' },
    });
  console.log(`\n✔ Admin ${email} created. Sign in and add your team under Staff Management.`);
}

main()
  .then(() => pool.end())
  .catch(async (err: unknown) => {
    console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    process.exit(1);
  });
