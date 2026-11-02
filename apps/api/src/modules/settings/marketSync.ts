import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  METAL_SYMBOLS,
  type MarketPrices,
  type MarketSyncStatus,
  type MetalSymbol,
} from '@gs/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { fuelPrices, metalPrices, settings } from '../../db/schema';
import { audit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { queryRows } from '../../lib/listing';

/*
 * Fuel: Ministry of Commerce retail price ceilings, from the MEF open-data dataset
 * "Historical Data of Fuel Prices Over Time"
 * (https://data.mef.gov.kh/datasets/pd_681d89b4dbc953000126f5e7). Response, newest first:
 *   {"items":[{"start_date":"2026-10-01","end_date":"2026-10-11","gasoline_92_unit_price":5150.0,
 *     "gasoil_50ppm_unit_price":5650.0,"source_link":"https://www.moc.gov.kh/kh/news/4621",…}],…}
 * (The dataset page swaps the descriptions of the price and change columns; the values are right.)
 *
 * Metals: international spot prices from gold-api.com (free, no key):
 *   GET …/price/XAU → {"name":"Gold","price":4189.0,"symbol":"XAU","updatedAt":"2026-10-12T05:17:39Z",…}
 */

const FUEL_KEY = 'fuelPriceSync';
const METAL_KEY = 'metalPriceSync';
const FUEL_EVERY_MS = 3 * 60 * 60 * 1000; // every 3 hours; an unchanged period writes nothing
const METAL_EVERY_MS = 60 * 60 * 1000; // hourly
const TIMEOUT_MS = 15_000;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mefFuel = z.object({
  items: z.array(
    z.object({
      start_date: ymd,
      end_date: ymd.nullish(),
      gasoline_92_unit_price: z.number(),
      gasoil_50ppm_unit_price: z.number(),
      source_link: z.string().url().nullish(),
    }),
  ),
});
const goldApi = z.object({ price: z.number(), updatedAt: z.string() });

type Trigger = MarketSyncStatus['trigger'];
/** Riel per litre outside this band means the feed is broken, not that fuel got cheap. */
const plausibleRiel = (v: number) => v >= 1000 && v <= 20000;

async function getJson(url: string, name: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return res.json();
}

async function saveStatus(key: string, status: MarketSyncStatus, userId: string | null) {
  await db
    .insert(settings)
    .values({ key, value: status, updatedById: userId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: status, updatedById: userId, updatedAt: new Date() },
    });
}

async function readStatus(key: string): Promise<MarketSyncStatus | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as MarketSyncStatus | undefined) ?? null;
}

/** Fetch the latest fuel periods and add / update them by start date. Never throws. */
export async function syncFuelPrices(
  trigger: Trigger,
  userId: string | null = null,
): Promise<MarketSyncStatus> {
  const at = new Date().toISOString();
  let status: MarketSyncStatus;
  try {
    const parsed = mefFuel.safeParse(await getJson(env.FUEL_PRICE_API_URL, 'MEF API'));
    if (!parsed.success) throw new Error('MEF API sent an unexpected response');
    const items = parsed.data.items.filter(
      (i) => plausibleRiel(i.gasoline_92_unit_price) && plausibleRiel(i.gasoil_50ppm_unit_price),
    );
    if (!items.length) throw new Error('MEF API sent no usable fuel prices');

    const existing = new Map(
      (
        await queryRows<{ d: string; g: string; o: string; e: string | null }>(
          db,
          sql`SELECT to_char(start_date, 'YYYY-MM-DD') AS d, gasoline_92::text AS g, gasoil_50ppm::text AS o,
            to_char(end_date, 'YYYY-MM-DD') AS e FROM fuel_prices`,
        )
      ).map((r) => [r.d, r]),
    );
    let added = 0;
    let updated = 0;
    const changes: unknown[] = [];
    await db.transaction(async (tx) => {
      for (const i of items) {
        const row = {
          startDate: i.start_date,
          endDate: i.end_date ?? null,
          gasoline92: String(Math.round(i.gasoline_92_unit_price)),
          gasoil: String(Math.round(i.gasoil_50ppm_unit_price)),
          sourceLink: i.source_link ?? null,
        };
        const before = existing.get(row.startDate);
        if (
          before &&
          Number(before.g) === Number(row.gasoline92) &&
          Number(before.o) === Number(row.gasoil) &&
          before.e === row.endDate
        )
          continue;
        if (before) updated++;
        else added++;
        changes.push(row);
        await tx
          .insert(fuelPrices)
          .values({ ...row, source: 'MEF', createdById: userId })
          .onConflictDoUpdate({
            target: fuelPrices.startDate,
            set: { ...row, source: 'MEF' },
          });
      }
      if (changes.length)
        await audit(tx, {
          action: 'UPDATE',
          entity: 'fuel_price',
          entityId: null,
          after: { source: 'MEF API', trigger, periods: changes },
          userId,
        });
    });
    status = { at, trigger, ok: true, added, updated };
  } catch (e) {
    status = { at, trigger, ok: false, error: e instanceof Error ? e.message : String(e) };
    logger.warn({ err: status.error }, 'Fuel-price sync failed');
  }
  await saveStatus(FUEL_KEY, status, userId);
  return status;
}

const phnomPenhDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date(iso));

/** Fetch gold, silver and platinum and store today's price for each. Never throws. */
export async function syncMetalPrices(
  trigger: Trigger,
  userId: string | null = null,
): Promise<MarketSyncStatus> {
  const at = new Date().toISOString();
  let status: MarketSyncStatus;
  try {
    const base = env.METAL_PRICE_API_URL.replace(/\/+$/, '');
    const quotes = await Promise.all(
      METAL_SYMBOLS.map(async (symbol) => {
        const parsed = goldApi.safeParse(await getJson(`${base}/${symbol}`, 'Metal price API'));
        if (!parsed.success) throw new Error('Metal price API sent an unexpected response');
        const { price, updatedAt } = parsed.data;
        const when = new Date(updatedAt);
        if (!(price > 0 && price < 1_000_000) || Number.isNaN(when.getTime()))
          throw new Error(`${symbol} price ${price} looks wrong; not saved`);
        return { symbol, price, fetchedAt: when };
      }),
    );
    let added = 0;
    let updated = 0;
    for (const q of quotes) {
      const priceDate = phnomPenhDate(q.fetchedAt.toISOString());
      const [before] = await queryRows<{ p: string }>(
        db,
        sql`SELECT usd_per_oz::text AS p FROM metal_prices WHERE symbol = ${q.symbol} AND price_date = ${priceDate}`,
      );
      if (before && Number(before.p) === Number(q.price.toFixed(4))) continue;
      if (before) updated++;
      else added++;
      await db
        .insert(metalPrices)
        .values({ symbol: q.symbol, priceDate, usdPerOz: String(q.price), fetchedAt: q.fetchedAt })
        .onConflictDoUpdate({
          target: [metalPrices.symbol, metalPrices.priceDate],
          set: { usdPerOz: String(q.price), fetchedAt: q.fetchedAt },
        });
    }
    status = { at, trigger, ok: true, added, updated };
  } catch (e) {
    status = { at, trigger, ok: false, error: e instanceof Error ? e.message : String(e) };
    logger.warn({ err: status.error }, 'Metal-price sync failed');
  }
  await saveStatus(METAL_KEY, status, userId);
  return status;
}

/** Fuel and metal figures for Settings → Rates. */
export async function marketPrices(): Promise<MarketPrices> {
  const [fuel, metals, [rate], fuelSync, metalSync] = await Promise.all([
    queryRows<MarketPrices['fuel'][number]>(
      db,
      sql`SELECT id, to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate",
        gasoline_92::text AS "gasoline92", gasoil_50ppm::text AS "gasoil", source_link AS "sourceLink", source
        FROM fuel_prices ORDER BY start_date DESC LIMIT 120`,
    ),
    // The two most recent days per metal: today's price and the one to compare it with.
    queryRows<{ symbol: MetalSymbol; usdPerOz: string; priceDate: string; fetchedAt: string }>(
      db,
      sql`SELECT symbol, "usdPerOz", "priceDate", "fetchedAt" FROM (
          SELECT symbol, usd_per_oz::text AS "usdPerOz", to_char(price_date, 'YYYY-MM-DD') AS "priceDate",
            fetched_at AS "fetchedAt", row_number() OVER (PARTITION BY symbol ORDER BY price_date DESC) AS n
          FROM metal_prices) m WHERE n <= 2 ORDER BY symbol, "priceDate" DESC`,
    ),
    queryRows<{ r: string }>(
      db,
      sql`SELECT usd_to_khr::text AS r FROM exchange_rates ORDER BY effective_date DESC LIMIT 1`,
    ),
    readStatus(FUEL_KEY),
    readStatus(METAL_KEY),
  ]);
  return {
    fuel,
    fuelSync,
    fuelAutoSync: env.FUEL_PRICE_SYNC,
    metals: METAL_SYMBOLS.map((symbol) => {
      const [latest, previous] = metals.filter((m) => m.symbol === symbol);
      return {
        symbol,
        latest: latest
          ? {
              usdPerOz: latest.usdPerOz,
              priceDate: latest.priceDate,
              fetchedAt: new Date(latest.fetchedAt).toISOString(),
            }
          : null,
        previous: previous ? { usdPerOz: previous.usdPerOz, priceDate: previous.priceDate } : null,
      };
    }),
    metalSync,
    metalAutoSync: env.METAL_PRICE_SYNC,
    usdToKhr: rate?.r ?? null,
  };
}

/** Start the background schedules: shortly after boot, then on their intervals. */
export function startMarketSync(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const schedule = (run: () => void, firstMs: number, everyMs: number) => {
    const first = setTimeout(run, firstMs);
    const every = setInterval(run, everyMs);
    first.unref();
    every.unref();
    timers.push(first, every);
  };
  if (env.FUEL_PRICE_SYNC) {
    schedule(() => void syncFuelPrices('auto'), 15_000, FUEL_EVERY_MS);
    logger.info('Fuel-price sync on: MEF / Ministry of Commerce prices every 3 hours');
  }
  if (env.METAL_PRICE_SYNC) {
    schedule(() => void syncMetalPrices('auto'), 20_000, METAL_EVERY_MS);
    logger.info('Metal-price sync on: gold, silver, platinum spot prices every hour');
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
