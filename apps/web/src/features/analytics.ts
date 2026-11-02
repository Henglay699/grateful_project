import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  AccountRow,
  ClearanceStatusRow,
  ClientRevenueRow,
  CountryRow,
  ForwarderRow,
  KpiResponse,
  LiveConsignment,
  MonthlyVolumeRow,
  OverviewSummary,
  PortRow,
  ProfitSummary,
  TransportShareResponse,
} from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export interface AnalyticsFilters {
  from?: string | undefined;
  to?: string | undefined;
  clientId?: string[] | undefined;
  direction?: string | undefined;
  transportMode?: string | undefined;
  loadType?: string | undefined;
}

type Extra = Record<string, string | undefined>;

/** One hook per endpoint; every key starts with ['analytics'] so shipment writes refetch them all. */
function useAnalytics<T>(
  name: string,
  filters: AnalyticsFilters,
  extra: Extra = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...queryKeys.analytics, name, filters, extra],
    queryFn: () => api<T>(`/analytics/${name}`, { query: { ...filters, ...extra } }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export const useKpis = (f: AnalyticsFilters) => useAnalytics<KpiResponse>('kpis', f);
export const useMonthlyVolume = (f: AnalyticsFilters) =>
  useAnalytics<MonthlyVolumeRow[]>('monthly-volume', f);
export const useTransportShare = (f: AnalyticsFilters) =>
  useAnalytics<TransportShareResponse>('transport-share', f);
export const useClearanceStatus = (f: AnalyticsFilters) =>
  useAnalytics<ClearanceStatusRow[]>('clearance-status', f);
export const useByCountry = (f: AnalyticsFilters, flow: 'import' | 'export') =>
  useAnalytics<CountryRow[]>('by-country', f, { flow });
export const useForwarders = (f: AnalyticsFilters) => useAnalytics<ForwarderRow[]>('forwarders', f);
export const usePorts = (f: AnalyticsFilters) => useAnalytics<PortRow[]>('ports', f);
export const useAccounts = (f: AnalyticsFilters) => useAnalytics<AccountRow[]>('accounts', f);
/** Per-client ledger breakdown (accounting roles only). */
export const useClientRevenue = (f: AnalyticsFilters, enabled: boolean) =>
  useAnalytics<ClientRevenueRow[]>(
    'client-revenue',
    { from: f.from, to: f.to, clientId: f.clientId },
    {},
    enabled,
  );
export const useProfit = (f: AnalyticsFilters, year: number, enabled: boolean) =>
  useAnalytics<ProfitSummary>('profit', { clientId: f.clientId }, { year: String(year) }, enabled);

/** The Overview polls every minute so it stays a "live" board. */
/**
 * The Overview's figures for a month (YYYY-MM) or a whole year (YYYY); the current month,
 * refreshed, when neither is given.
 */
export function useOverviewSummary(month?: string, fullYear?: string) {
  // A whole year refreshes while it is the current one (its figures run to today).
  const live = fullYear ? fullYear === String(new Date().getFullYear()) : !month;
  return useQuery({
    queryKey: [...queryKeys.overview, 'summary', fullYear ? `year-${fullYear}` : (month ?? 'live')],
    queryFn: () =>
      api<OverviewSummary>('/overview/summary', {
        query: fullYear ? { fullYear } : month ? { month } : undefined,
      }),
    refetchInterval: live ? 60_000 : false,
    placeholderData: keepPreviousData,
  });
}

export function useLiveConsignments() {
  return useQuery({
    queryKey: [...queryKeys.overview, 'live'],
    queryFn: () => api<LiveConsignment[]>('/overview/live-consignments'),
    refetchInterval: 60_000,
  });
}
