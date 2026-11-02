import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  analyticsQuerySchema,
  flowQuerySchema,
  hasPermission,
  type OverviewSummary,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';
import { scopeClients } from '../../lib/clientScope';

/** Parse filters; default period is the current business year. */
async function filters(req: Request) {
  const q = parse(analyticsQuerySchema, req.query);
  const today = await svc.businessToday();
  const year = Number(today.slice(0, 4));
  const range = svc.yearRange(year);
  return {
    ...q,
    // Users limited to some clients only ever see those clients' figures.
    clientId: scopeClients(req, q.clientId),
    from: q.from ?? range.from,
    to: q.to ?? range.to,
    today,
  };
}

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requirePermission('dashboard:read'));

analyticsRouter.get('/kpis', async (req, res) => res.json(await svc.kpis(await filters(req))));
analyticsRouter.get('/monthly-volume', async (req, res) =>
  res.json(await svc.monthlyVolume(await filters(req))),
);
analyticsRouter.get('/transport-share', async (req, res) =>
  res.json(await svc.transportShare(await filters(req))),
);
analyticsRouter.get('/clearance-status', async (req, res) =>
  res.json(await svc.clearanceStatus(await filters(req))),
);
analyticsRouter.get('/by-country', async (req, res) => {
  const { flow } = parse(flowQuerySchema, { flow: req.query.flow });
  res.json(await svc.byCountry(await filters(req), flow));
});
analyticsRouter.get('/forwarders', async (req, res) =>
  res.json(await svc.forwarders(await filters(req))),
);
analyticsRouter.get('/ports', async (req, res) => res.json(await svc.ports(await filters(req))));
analyticsRouter.get('/accounts', async (req, res) =>
  res.json(await svc.accounts(await filters(req))),
);
analyticsRouter.get('/profit', requirePermission('accounting:read'), async (req, res) => {
  const f = await filters(req);
  const { year } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    { year: req.query.year },
  );
  res.json(await svc.profit(year ?? Number(f.today.slice(0, 4)), f.today, f.clientId));
});

analyticsRouter.get('/client-revenue', requirePermission('accounting:read'), async (req, res) =>
  res.json(await svc.clientRevenue(await filters(req))),
);

export const overviewRouter = Router();
overviewRouter.use(requireAuth, requirePermission('dashboard:read'));

/**
 * Everything the Overview's top half needs in one round trip: a month's KPIs vs the month
 * before, that year's monthly volume, and (for accounting roles) net profit. The month is
 * ?month=YYYY-MM (the Overview's month picker), the current month when absent; never later.
 * ?fullYear=YYYY reads a whole year instead (January to today for the current year), its
 * KPIs against the same stretch of the year before.
 */
overviewRouter.get('/summary', async (req, res) => {
  const {
    year: y,
    month: asked,
    fullYear: askedYear,
  } = parse(
    z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
        .optional(),
      fullYear: z.coerce.number().int().min(2000).max(2100).optional(),
    }),
    { year: req.query.year, month: req.query.month, fullYear: req.query.fullYear },
  );
  const today = await svc.businessToday();
  const current = today.slice(0, 7);
  const fullYear = askedYear !== undefined;
  // A whole year ends at its December (the current month for this year).
  const lastOfYear = fullYear ? `${askedYear}-12` : undefined;
  const ask = lastOfYear ?? asked;
  const month = ask && ask < current ? ask : current;
  const live = month === current;
  const monthStart = `${month}-01`;
  const d = new Date(`${monthStart}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  // A past month is read as at its last day: its own "this month" and "last month".
  const asOf = live ? today : monthEnd;
  const year = fullYear ? Number(month.slice(0, 4)) : (y ?? Number(month.slice(0, 4)));
  // The year so far, against the same days of the year before (29 Feb → 28 Feb).
  const yearFrom = `${year}-01-01`;
  const sameDayLastYear = `${year - 1}${asOf.slice(4)}`.replace(/-02-29$/, '-02-28');
  const period = fullYear
    ? svc.kpis(
        { from: yearFrom, to: asOf, clientId: scopeClients(req) },
        { from: `${year - 1}-01-01`, to: sameDayLastYear },
      )
    : svc.kpis({ from: monthStart, to: monthEnd, clientId: scopeClients(req) });
  const [kpis, monthly, profit] = await Promise.all([
    period,
    svc.monthlyVolume({ ...svc.yearRange(year), clientId: scopeClients(req) }),
    hasPermission(req.auth!.permissions, 'accounting:read')
      ? svc.profit(year, asOf, scopeClients(req))
      : Promise.resolve(undefined),
  ]);
  const body: OverviewSummary = {
    year,
    today: asOf,
    month,
    fullYear,
    live,
    kpis,
    monthly,
    ...(profit ? { profit } : {}),
  };
  res.json(body);
});

overviewRouter.get('/live-consignments', async (req, res) => {
  const f = parse(analyticsQuerySchema, req.query);
  res.json(await svc.liveConsignments({ ...f, clientId: scopeClients(req, f.clientId) }));
});
