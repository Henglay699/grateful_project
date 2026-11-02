import { Router } from 'express';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  boolParam,
  companySchema,
  consigneeInputSchema,
  consigneeUpdateSchema,
  exchangeRateInputSchema,
  exchangeRateUpdateSchema,
  type ExchangeRateImportResult,
  forwarderInputSchema,
  forwarderUpdateSchema,
  fuelPriceInputSchema,
  lookupValueInputSchema,
  portInputSchema,
  publicHolidayInputSchema,
  vatRateInputSchema,
  type PublicHoliday,
  type SettingsBundle,
} from '@gs/shared';
import { db } from '../../db/client';
import {
  consignees,
  exchangeRates,
  forwarders,
  fuelPrices,
  lookupValues,
  ports,
  publicHolidays,
  settings,
  vatRates,
} from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { env } from '../../config/env';
import { lastSync, syncExchangeRate } from './rateSync';
import { marketPrices, syncFuelPrices, syncMetalPrices } from './marketSync';
import { excelUpload, requireFile } from '../../lib/http';
import { queryRows } from '../../lib/listing';
import { parseRateWorkbook } from './rateImport';
import { listVatRates } from '../accounting/ledger';
import type { PgTable } from 'drizzle-orm/pg-core';

const idParam = z.object({ id: z.string().uuid() });
export const settingsRouter = Router();
settingsRouter.use(requireAuth);
const manage = requirePermission('settings:manage');

settingsRouter.get('/', requirePermission('settings:read'), async (_req, res) => {
  const [company] = await db.select().from(settings).where(eq(settings.key, 'company'));
  const [base] = await db.select().from(settings).where(eq(settings.key, 'baseExchangeRate'));
  const [rates, p, f, c, lv] = await Promise.all([
    queryRows<SettingsBundle['exchangeRates'][number]>(
      db,
      sql`SELECT id, to_char(effective_date, 'YYYY-MM-DD') AS "effectiveDate", usd_to_khr::text AS "usdToKhr" FROM exchange_rates ORDER BY effective_date DESC`,
    ),
    queryRows<SettingsBundle['ports'][number]>(
      db,
      sql`SELECT p.id, p.code, p.customs_port_no AS "customsPortNo", p.name, p.short_name AS "shortName", p.kind, p.is_active AS "isActive",
      (SELECT count(*) FROM shipments s WHERE s.clearance_port_id = p.id AND s.deleted_at IS NULL)::int AS shipments FROM ports p ORDER BY p.code`,
    ),
    queryRows<SettingsBundle['forwarders'][number]>(
      db,
      sql`SELECT f.id, f.code, f.name, f.contact_email AS "contactEmail", f.is_active AS "isActive",
      (SELECT count(*) FROM shipments s WHERE s.forwarder_id = f.id AND s.deleted_at IS NULL)::int AS shipments FROM forwarders f ORDER BY f.name`,
    ),
    queryRows<SettingsBundle['consignees'][number]>(
      db,
      sql`SELECT c.id, c.name, c.client_id AS "clientId", c.country_iso2 AS "countryIso2", c.address, c.is_active AS "isActive",
      (SELECT count(*) FROM shipments s WHERE s.consignee_id = c.id AND s.deleted_at IS NULL)::int AS shipments FROM consignees c ORDER BY c.name`,
    ),
    db
      .select()
      .from(lookupValues)
      .orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder), asc(lookupValues.value)),
  ]);
  const body: SettingsBundle = {
    company: (company?.value ?? { nameEn: '' }) as SettingsBundle['company'],
    baseExchangeRate: Number(base?.value ?? 4026),
    exchangeRates: rates,
    exchangeRateSync: await lastSync(),
    exchangeRateAutoSync: env.EXCHANGE_RATE_SYNC,
    ports: p,
    forwarders: f,
    consignees: c,
    lookupValues: lv.map((x) => ({
      id: x.id,
      type: x.type,
      value: x.value,
      label: x.label,
      sortOrder: x.sortOrder,
      isActive: x.isActive,
    })),
  };
  res.json(body);
});

async function putSetting(key: string, value: unknown, req: Parameters<typeof audit>[2]) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(settings).where(eq(settings.key, key));
    await tx
      .insert(settings)
      .values({ key, value, updatedById: req!.auth!.userId })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedById: req!.auth!.userId, updatedAt: new Date() },
      });
    await audit(
      tx,
      { action: 'UPDATE', entity: 'setting', entityId: key, before: before?.value, after: value },
      req,
    );
  });
}

settingsRouter.put('/company', manage, async (req, res) => {
  const parsed = parse(companySchema, req.body);
  // The first account is also stored in the legacy single-bank fields.
  const first = parsed.banks?.[0];
  const v = parsed.banks
    ? {
        ...parsed,
        bankName: first?.bankName ?? null,
        bankAccountName: first?.accountName ?? null,
        bankAccountNo: first?.accountNo ?? null,
      }
    : parsed;
  await putSetting('company', v, req);
  res.json(v);
});
settingsRouter.put('/base-exchange-rate', manage, async (req, res) => {
  const { value } = parse(z.object({ value: z.coerce.number().min(1).max(100000) }), req.body);
  await putSetting('baseExchangeRate', value, req);
  res.json({ value });
});

settingsRouter.post('/exchange-rates', manage, async (req, res) => {
  const v = parse(exchangeRateInputSchema, req.body);
  const [row] = await db
    .insert(exchangeRates)
    .values({
      effectiveDate: v.effectiveDate,
      usdToKhr: v.usdToKhr!,
      createdById: req.auth!.userId,
    })
    .onConflictDoUpdate({ target: exchangeRates.effectiveDate, set: { usdToKhr: v.usdToKhr! } })
    .returning();
  await audit(
    db,
    { action: 'UPDATE', entity: 'exchange_rate', entityId: v.effectiveDate, after: row },
    req,
  );
  res.status(201).json(row);
});
settingsRouter.patch('/exchange-rates/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(exchangeRateUpdateSchema, req.body);
  const [before] = await db.select().from(exchangeRates).where(eq(exchangeRates.id, id));
  if (!before) throw notFound('Exchange rate');
  if (v.effectiveDate && v.effectiveDate !== before.effectiveDate) {
    const [clash] = await db
      .select({ id: exchangeRates.id })
      .from(exchangeRates)
      .where(eq(exchangeRates.effectiveDate, v.effectiveDate));
    if (clash) throw conflict(`There is already a rate for ${v.effectiveDate}. Edit that one.`);
  }
  const [row] = await db
    .update(exchangeRates)
    .set({
      ...(v.effectiveDate ? { effectiveDate: v.effectiveDate } : {}),
      ...(v.usdToKhr ? { usdToKhr: v.usdToKhr } : {}),
    })
    .where(eq(exchangeRates.id, id))
    .returning();
  await audit(
    db,
    { action: 'UPDATE', entity: 'exchange_rate', entityId: id, before, after: row },
    req,
  );
  res.json(row);
});

/**
 * Import dated rates from a spreadsheet (e.g. the NBC monthly rate sheet). Each date is
 * added, or its rate replaced. `?dryRun=1` only reports what would change.
 */
settingsRouter.post('/exchange-rates/import', manage, excelUpload, async (req, res) => {
  const { dryRun } = parse(z.object({ dryRun: boolParam }), req.query);
  const file = requireFile(req.file);
  const parsed = await parseRateWorkbook(file.buffer, file.originalname);
  if (parsed.rates.size === 0)
    throw badRequest(
      'No dated rates found. The sheet needs a date column (e.g. "September 30, 2026") and a rate column (e.g. 4055).',
    );
  const existing = new Map(
    (
      await queryRows<{ d: string; r: string }>(
        db,
        sql`SELECT to_char(effective_date, 'YYYY-MM-DD') AS d, usd_to_khr::text AS r FROM exchange_rates`,
      )
    ).map((x) => [x.d, Number(x.r)]),
  );
  const rates: ExchangeRateImportResult['rates'] = [...parsed.rates]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([effectiveDate, usdToKhr]) => ({
      effectiveDate,
      usdToKhr,
      status: !existing.has(effectiveDate)
        ? 'new'
        : existing.get(effectiveDate) === Number(usdToKhr)
          ? 'same'
          : 'changed',
    }));
  const count = (s: string) => rates.filter((r) => r.status === s).length;
  if (!dryRun) {
    const toWrite = rates.filter((r) => r.status !== 'same');
    await db.transaction(async (tx) => {
      for (const r of toWrite)
        await tx
          .insert(exchangeRates)
          .values({
            effectiveDate: r.effectiveDate,
            usdToKhr: r.usdToKhr,
            createdById: req.auth!.userId,
          })
          .onConflictDoUpdate({
            target: exchangeRates.effectiveDate,
            set: { usdToKhr: r.usdToKhr },
          });
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: 'exchange_rate',
          entityId: null,
          after: { file: file.originalname, rates: toWrite },
        },
        req,
      );
    });
  }
  const body: ExchangeRateImportResult = {
    dryRun: !!dryRun,
    rates,
    created: count('new'),
    updated: count('changed'),
    unchanged: count('same'),
    skipped: parsed.skipped,
  };
  res.json(body);
});

/** "Update now": fetch today's official rate from the MEF API (also runs automatically). */
settingsRouter.post('/exchange-rates/sync', manage, async (req, res) => {
  const status = await syncExchangeRate('manual', req.auth!.userId);
  if (!status.ok)
    throw new AppError(502, 'UPSTREAM_ERROR', `Couldn't get the rate from MEF: ${status.error}`);
  res.json(status);
});

/* ---------- Fuel & metal prices ---------- */

settingsRouter.get('/market-prices', requirePermission('settings:read'), async (_req, res) => {
  res.json(await marketPrices());
});

/** Add a fuel period by hand (e.g. the notice is out but MEF hasn't published it yet). */
settingsRouter.post('/fuel-prices', manage, async (req, res) => {
  const v = parse(fuelPriceInputSchema, req.body);
  const values = {
    startDate: v.startDate,
    endDate: v.endDate,
    gasoline92: v.gasoline92!,
    gasoil: v.gasoil!,
    source: 'manual',
  };
  const [row] = await db
    .insert(fuelPrices)
    .values({ ...values, createdById: req.auth!.userId })
    .onConflictDoUpdate({ target: fuelPrices.startDate, set: values })
    .returning();
  await audit(db, { action: 'UPDATE', entity: 'fuel_price', entityId: row!.id, after: row }, req);
  res.status(201).json(row);
});

/* ---------- Public holidays: document issue dates skip them ---------- */

const holidayColumns = sql`id, to_char(holiday_date, 'YYYY-MM-DD') AS "holidayDate", name, name_kh AS "nameKh", note`;

/** A year's Cambodian public holidays (?year=2026; this year when absent), by date. */
settingsRouter.get('/public-holidays', requirePermission('settings:read'), async (req, res) => {
  const { year } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    req.query,
  );
  const y = year ?? new Date().getFullYear();
  res.json(
    await queryRows<PublicHoliday>(
      db,
      sql`SELECT ${holidayColumns} FROM public_holidays
          WHERE holiday_date BETWEEN make_date(${y}, 1, 1) AND make_date(${y}, 12, 31)
          ORDER BY holiday_date`,
    ),
  );
});

/** Add a holiday (a date already in the calendar is updated instead). */
settingsRouter.post('/public-holidays', manage, async (req, res) => {
  const v = parse(publicHolidayInputSchema, req.body);
  const [row] = await db
    .insert(publicHolidays)
    .values({ ...v, createdById: req.auth!.userId })
    .onConflictDoUpdate({
      target: publicHolidays.holidayDate,
      set: { name: v.name, nameKh: v.nameKh, note: v.note },
    })
    .returning();
  await audit(
    db,
    { action: 'UPDATE', entity: 'public_holiday', entityId: row!.id, after: row },
    req,
  );
  res.status(201).json(row);
});

settingsRouter.patch('/public-holidays/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(publicHolidayInputSchema, req.body);
  const [before] = await db.select().from(publicHolidays).where(eq(publicHolidays.id, id));
  if (!before) throw notFound('Public holiday');
  try {
    const [row] = await db
      .update(publicHolidays)
      .set(v)
      .where(eq(publicHolidays.id, id))
      .returning();
    await audit(
      db,
      { action: 'UPDATE', entity: 'public_holiday', entityId: id, before, after: row },
      req,
    );
    res.json(row);
  } catch (err) {
    const code =
      (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === '23505') throw conflict(`${v.holidayDate} is already a public holiday`);
    throw err;
  }
});

settingsRouter.delete('/public-holidays/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db.delete(publicHolidays).where(eq(publicHolidays.id, id)).returning();
  if (!row) throw notFound('Public holiday');
  await audit(db, { action: 'DELETE', entity: 'public_holiday', entityId: id, before: row }, req);
  res.status(204).end();
});

/* ---------- Tax management: VAT percent by effective date ---------- */

settingsRouter.get('/vat-rates', requirePermission('settings:read'), async (_req, res) => {
  res.json(await listVatRates());
});

const isUnique = (err: unknown) =>
  ((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) ===
  '23505';

/**
 * A new VAT percent from a date. Only documents made (or re-dated) from now on take it;
 * documents already made keep the percent they were made with.
 */
settingsRouter.post('/vat-rates', manage, async (req, res) => {
  const v = parse(vatRateInputSchema, req.body);
  try {
    const [row] = await db
      .insert(vatRates)
      .values({ ...v, percent: String(v.percent), createdById: req.auth!.userId })
      .returning();
    await audit(db, { action: 'CREATE', entity: 'vat_rate', entityId: row!.id, after: row }, req);
    res.status(201).json(row);
  } catch (err) {
    if (isUnique(err))
      throw conflict(`There is already a VAT rate from ${v.effectiveDate}. Edit that one.`);
    throw err;
  }
});

settingsRouter.patch('/vat-rates/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(vatRateInputSchema, req.body);
  const [before] = await db.select().from(vatRates).where(eq(vatRates.id, id));
  if (!before) throw notFound('VAT rate');
  try {
    const [row] = await db
      .update(vatRates)
      .set({ ...v, percent: String(v.percent), updatedAt: new Date() })
      .where(eq(vatRates.id, id))
      .returning();
    await audit(
      db,
      { action: 'UPDATE', entity: 'vat_rate', entityId: id, before, after: row },
      req,
    );
    res.json(row);
  } catch (err) {
    if (isUnique(err))
      throw conflict(`There is already a VAT rate from ${v.effectiveDate}. Edit that one.`);
    throw err;
  }
});

settingsRouter.delete('/vat-rates/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db.delete(vatRates).where(eq(vatRates.id, id)).returning();
  if (!row) throw notFound('VAT rate');
  await audit(db, { action: 'DELETE', entity: 'vat_rate', entityId: id, before: row }, req);
  res.status(204).end();
});

settingsRouter.delete('/fuel-prices/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db.delete(fuelPrices).where(eq(fuelPrices.id, id)).returning();
  if (!row) throw notFound('Fuel price');
  await audit(db, { action: 'DELETE', entity: 'fuel_price', entityId: id, before: row }, req);
  res.status(204).end();
});

settingsRouter.post('/fuel-prices/sync', manage, async (req, res) => {
  const status = await syncFuelPrices('manual', req.auth!.userId);
  if (!status.ok)
    throw new AppError(502, 'UPSTREAM_ERROR', `Couldn't get fuel prices: ${status.error}`);
  res.json(status);
});

settingsRouter.post('/metal-prices/sync', manage, async (req, res) => {
  const status = await syncMetalPrices('manual', req.auth!.userId);
  if (!status.ok)
    throw new AppError(502, 'UPSTREAM_ERROR', `Couldn't get metal prices: ${status.error}`);
  res.json(status);
});

settingsRouter.delete('/exchange-rates/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db.delete(exchangeRates).where(eq(exchangeRates.id, id)).returning();
  if (!row) throw notFound('Exchange rate');
  await audit(db, { action: 'DELETE', entity: 'exchange_rate', entityId: id, before: row }, req);
  res.status(204).end();
});

/** Generic create / patch for the simple reference tables. */
function crud<S extends z.ZodTypeAny, P extends z.ZodTypeAny>(
  path: string,
  table: PgTable & { id: never },
  entity: string,
  create: S | null,
  patch: P,
) {
  if (create)
    settingsRouter.post(path, manage, async (req, res) => {
      const v = parse(create, req.body) as Record<string, unknown>;
      if (entity === 'forwarder' && !v.code)
        v.code = String(v.name)
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '')
          .slice(0, 12);
      const [row] = (await db
        .insert(table)
        .values(v as never)
        .returning()) as Record<string, unknown>[];
      await audit(db, { action: 'CREATE', entity, entityId: row!.id as string, after: row }, req);
      res.status(201).json(row);
    });
  settingsRouter.patch(`${path}/:id`, manage, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const v = Object.fromEntries(
      Object.entries(parse(patch, req.body) as Record<string, unknown>).filter(
        ([, x]) => x !== undefined,
      ),
    );
    const idCol = (table as unknown as { id: Parameters<typeof eq>[0] }).id;
    const [row] = (await db
      .update(table)
      .set(v as never)
      .where(eq(idCol, id))
      .returning()) as Record<string, unknown>[];
    if (!row) throw notFound(entity);
    await audit(db, { action: 'UPDATE', entity, entityId: id, after: row }, req);
    res.json(row);
  });
}
crud('/ports', ports as never, 'port', portInputSchema, portInputSchema.partial());
crud('/forwarders', forwarders as never, 'forwarder', forwarderInputSchema, forwarderUpdateSchema);
crud('/consignees', consignees as never, 'consignee', consigneeInputSchema, consigneeUpdateSchema);
crud(
  '/lookups',
  lookupValues as never,
  'lookup_value',
  lookupValueInputSchema.transform((v) => ({ ...v, label: v.label ?? v.value })),
  lookupValueInputSchema.partial(),
);

/**
 * Delete a port nobody uses yet (e.g. one added by mistake). A port that shipments,
 * declarations or accounting already point to can't go; untick Active to hide it instead.
 */
settingsRouter.delete('/ports/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  let row: Record<string, unknown> | undefined;
  try {
    [row] = await db.delete(ports).where(eq(ports.id, id)).returning();
  } catch (err) {
    const code =
      (err as { code?: string; cause?: { code?: string } }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23503')
      throw conflict(
        'This port is already used by shipments or records. Untick Active to hide it instead.',
      );
    throw err;
  }
  if (!row) throw notFound('Port');
  await audit(db, { action: 'DELETE', entity: 'port', entityId: id, before: row }, req);
  res.status(204).end();
});

/**
 * Delete a forwarder nobody uses yet. One that shipments or record summaries name can't go
 * (deleting would blank it on them); untick Active to hide it instead.
 */
settingsRouter.delete('/forwarders/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [use] = await queryRows<{ n: number }>(
    db,
    sql`SELECT ((SELECT count(*) FROM shipments WHERE forwarder_id = ${id})
              + (SELECT count(*) FROM record_summaries WHERE forwarder_id = ${id}))::int AS n`,
  );
  if (use!.n > 0)
    throw conflict(
      'This forwarder is already used by shipments or record summaries. Untick Active to hide it instead.',
    );
  const [row] = await db.delete(forwarders).where(eq(forwarders.id, id)).returning();
  if (!row) throw notFound('Forwarder');
  await audit(db, { action: 'DELETE', entity: 'forwarder', entityId: id, before: row }, req);
  res.status(204).end();
});

settingsRouter.delete('/lookups/:id', manage, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db.delete(lookupValues).where(eq(lookupValues.id, id)).returning();
  if (!row) throw notFound('List value');
  await audit(db, { action: 'DELETE', entity: 'lookup_value', entityId: id, before: row }, req);
  res.status(204).end();
});
