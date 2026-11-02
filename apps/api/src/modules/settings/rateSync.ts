import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ExchangeRateSyncStatus } from '@gs/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { exchangeRates, settings } from '../../db/schema';
import { audit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { queryRows } from '../../lib/listing';

/**
 * Official USD→KHR rate from the Ministry of Economy and Finance open-data API
 * (https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb4). Response:
 *   {"data":{"valid_date":"2026-10-09","currency_id":"USD","unit":1,"bid":4069,"ask":4069,"average":4069,…}}
 * The "average" is the NBC official rate; MEF publishes it around 21:00 for the next day.
 */
const mefResponse = z.object({
  data: z.object({
    valid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency_id: z.literal('USD'),
    unit: z.number().positive().default(1),
    average: z.number().positive(),
  }),
});

export const SYNC_KEY = 'exchangeRateSync';
const EVERY_MS = 3 * 60 * 60 * 1000; // every 3 hours (cheap: an unchanged rate writes nothing)
const TIMEOUT_MS = 15_000;

export async function fetchOfficialRate(): Promise<{ effectiveDate: string; usdToKhr: string }> {
  const res = await fetch(env.EXCHANGE_RATE_API_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MEF API answered ${res.status}`);
  const parsed = mefResponse.safeParse(await res.json());
  if (!parsed.success) throw new Error('MEF API sent an unexpected response');
  const d = parsed.data.data;
  const perUsd = d.average / d.unit;
  if (perUsd < 1000 || perUsd > 10000) throw new Error(`MEF rate ${perUsd} looks wrong; not saved`);
  return { effectiveDate: d.valid_date, usdToKhr: String(perUsd) };
}

/** Fetch the official rate and add / update it under its own date. Never throws. */
export async function syncExchangeRate(
  trigger: ExchangeRateSyncStatus['trigger'],
  userId: string | null = null,
): Promise<ExchangeRateSyncStatus> {
  const at = new Date().toISOString();
  let status: ExchangeRateSyncStatus;
  try {
    const rate = await fetchOfficialRate();
    const [before] = await queryRows<{ r: string }>(
      db,
      sql`SELECT usd_to_khr::text AS r FROM exchange_rates WHERE effective_date = ${rate.effectiveDate}`,
    );
    const result = !before
      ? 'new'
      : Number(before.r) === Number(rate.usdToKhr)
        ? 'same'
        : 'changed';
    if (result !== 'same')
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(exchangeRates)
          .values({ ...rate, createdById: userId })
          .onConflictDoUpdate({
            target: exchangeRates.effectiveDate,
            set: { usdToKhr: rate.usdToKhr },
          })
          .returning();
        await audit(tx, {
          action: 'UPDATE',
          entity: 'exchange_rate',
          entityId: row!.id,
          before: before ?? null,
          after: { ...row, source: 'MEF API', trigger },
          userId,
        });
      });
    status = { at, trigger, ok: true, ...rate, result };
  } catch (e) {
    status = { at, trigger, ok: false, error: e instanceof Error ? e.message : String(e) };
    logger.warn({ err: status.error }, 'Exchange-rate sync failed');
  }
  await db
    .insert(settings)
    .values({ key: SYNC_KEY, value: status, updatedById: userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: status, updatedById: userId, updatedAt: new Date() },
    });
  return status;
}

export async function lastSync(): Promise<ExchangeRateSyncStatus | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, SYNC_KEY));
  return (row?.value as ExchangeRateSyncStatus | undefined) ?? null;
}

/** Start the background schedule: shortly after boot, then every few hours. */
export function startExchangeRateSync(): () => void {
  if (!env.EXCHANGE_RATE_SYNC) return () => {};
  const run = () => void syncExchangeRate('auto');
  const first = setTimeout(run, 10_000);
  const timer = setInterval(run, EVERY_MS);
  first.unref();
  timer.unref();
  logger.info('Exchange-rate sync on: MEF official USD→KHR rate every 3 hours');
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
