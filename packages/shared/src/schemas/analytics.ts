import { z } from 'zod';
import {
  DIRECTIONS,
  LOAD_TYPES,
  TRANSPORT_MODES,
  type ClearanceStatus,
  type Direction,
  type ShipmentStatus,
} from '../enums';
import { multi } from './fields';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Filters shared by every analytics endpoint. The period applies to the shipment's ETA
 * (its operational month); profit figures use the ledger's invoice date.
 */
export const analyticsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    clientId: multi(z.string().uuid()),
    direction: z.enum(DIRECTIONS).optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    loadType: z.enum(LOAD_TYPES).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '"from" must be on or before "to"',
    path: ['to'],
  });
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

export const flowQuerySchema = z.object({ flow: z.enum(['import', 'export']).default('import') });

export interface Period {
  from: string;
  to: string;
}

export interface KpiResponse {
  period: Period;
  previousPeriod: Period;
  total: number;
  imports: number;
  exports: number;
  cleared: number;
  clearancePending: number;
  exceptions: number;
  previous: { total: number; imports: number; exports: number; cleared: number };
}

export interface MonthlyVolumeRow {
  month: string; // YYYY-MM
  imports: number;
  exports: number;
  total: number;
}

export interface TransportShareResponse {
  imports: number;
  exports: number;
  total: number;
  byMode: { mode: string; count: number }[];
}

export interface ClearanceStatusRow {
  status: ClearanceStatus;
  count: number;
}

export interface CountryRow {
  iso2: string;
  name: string;
  count: number;
  pct: number;
}

export interface ForwarderRow {
  id: string;
  code: string;
  name: string;
  shipments: number;
  imports: number;
  exports: number;
  /** Imports delivered to the factory (Arrive FTY recorded). */
  factory: number;
  arrived: number;
  onTimePct: number | null;
  avgDelayDays: number | null;
  exceptionPct: number;
  clearedPct: number;
}

export interface PortRow {
  id: string;
  code: string;
  name: string;
  shortName: string;
  imports: number;
  exports: number;
  total: number;
}

export interface AccountBreakdown {
  total: number;
  cy: number;
  lcl: number;
  air: number;
}

export interface AccountRow {
  clientId: string;
  code: string;
  name: string;
  all: AccountBreakdown;
  import: AccountBreakdown;
  export: AccountBreakdown;
}

export interface ProfitSummary {
  year: number;
  total: string;
  thisMonth: string;
  lastMonth: string;
  /** The same stretch of the year before (January to the same day), for a whole-year view. */
  lastYearToDate: string;
  monthly: { month: string; netProfit: string }[];
  byClient: { clientId: string; code: string; name: string; netProfit: string; pct: number }[];
  /** The month the card opens on (YYYY-MM): this month, or December for a past year. */
  currentMonth: string;
  /** Each client's net profit per month of the year (months with ledger entries only). */
  byClientMonthly: {
    month: string;
    clientId: string;
    code: string;
    name: string;
    netProfit: string;
  }[];
  /**
   * Ledger rows with costs but nothing billed yet (INV + DIS + DN = 0), per month (months
   * with such rows only). They are left out of every profit figure above.
   */
  unbilled: { month: string; entries: number; costs: string }[];
}

/** One client's ledger figures for a period (by invoice date), for the Analytics cards. */
export interface ClientRevenueRow {
  clientId: string;
  code: string;
  name: string;
  /** Billed ledger entries (one per customs declaration); every figure below is from these. */
  entries: number;
  /** Billed entries Chea hasn't been paid for yet. */
  unpaid: number;
  /** Entries with costs but nothing billed yet (INV + DIS + DN = 0): left out of the figures. */
  unbilled: number;
  /** Clear fee + THC + CM + Other of the unbilled entries. */
  unbilledCosts: string;
  invRevenue: string;
  disTotal: string;
  dnTotal: string;
  vat: string;
  clearFee: string;
  thc: string;
  commission: string;
  otherPay: string;
  /** INV + DIS + DN. */
  revenue: string;
  /** Clear fee + THC + CM + Other. */
  costs: string;
  netProfit: string;
  /** Net profit as a % of revenue; null when there is no revenue. */
  marginPct: number | null;
  /** This client's share of all clients' net profit in the period. */
  sharePct: number | null;
  lastInvDate: string | null;
  /** Every month of the period, zero-filled. */
  monthly: { month: string; revenue: string; netProfit: string }[];
}

export interface OverviewSummary {
  year: number;
  /** The day the figures run to: today for the live month, else the chosen month's last day. */
  today: string;
  /** The month shown (YYYY-MM); for a full year, its last month (this month for this year). */
  month: string;
  /** True when the KPIs cover January to `month` (kpis.period) instead of one month. */
  fullYear: boolean;
  /** True for the current month or year (figures refresh); false for a past one. */
  live: boolean;
  kpis: KpiResponse;
  monthly: MonthlyVolumeRow[];
  /** Present only for roles with accounting:read. */
  profit?: ProfitSummary;
}

export interface LiveConsignment {
  id: string;
  reference: string;
  clientCode: string;
  direction: Direction;
  invoiceNos: string[];
  forwarderName: string | null;
  clearancePortName: string | null;
  eta: string | null;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
}
