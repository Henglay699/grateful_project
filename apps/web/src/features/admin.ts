import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type {
  DeclarationRegisterRow,
  DocumentRow,
  FollowUpRow,
  MarketPrices,
  Paginated,
  PublicHoliday,
  QuotationDetail,
  QuotationRow,
  QuotationTemplate,
  RoleInfo,
  SettingsBundle,
  StaffMember,
} from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

type Query = Record<string, string | number | boolean | undefined>;

/** Mutation that refreshes the given query prefixes afterwards. */
export function useApiMutation<V, R = unknown>(fn: (v: V) => Promise<R>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export const useStaff = () =>
  useQuery({ queryKey: ['staff'], queryFn: () => api<StaffMember[]>('/staff') });
export const useRoles = () =>
  useQuery({ queryKey: ['staff', 'roles'], queryFn: () => api<RoleInfo[]>('/staff/roles') });
export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsBundle>('/settings') });
/** Settings → Rates (fuel and metal boxes). Refetched every 5 minutes so the hourly metal prices show up. */
export const useMarketPrices = () =>
  useQuery({
    queryKey: ['settings', 'market'],
    queryFn: () => api<MarketPrices>('/settings/market-prices'),
    refetchInterval: 5 * 60_000,
  });

/** Settings → Public holidays: one year's Cambodian public holidays, by date. */
export const usePublicHolidays = (year: number) =>
  useQuery({
    queryKey: ['settings', 'holidays', year],
    queryFn: () => api<PublicHoliday[]>('/settings/public-holidays', { query: { year } }),
  });

export const useFollowUps = (q: Query) =>
  useQuery({
    queryKey: ['follow-ups', q],
    queryFn: () => api<Paginated<FollowUpRow>>('/follow-ups', { query: q }),
    placeholderData: keepPreviousData,
  });

export const useDocuments = (q: Query, enabled = true) =>
  useQuery({
    queryKey: ['documents', q],
    queryFn: () => api<Paginated<DocumentRow>>('/documents', { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useDeclarationRegister = (q: Query) =>
  useQuery({
    queryKey: ['operations', q],
    queryFn: () => api<Paginated<DeclarationRegisterRow>>('/operations/declarations', { query: q }),
    placeholderData: keepPreviousData,
  });

export const useQuotationTemplates = () =>
  useQuery({
    queryKey: ['quotations', 'templates'],
    queryFn: () => api<QuotationTemplate[]>('/quotations/templates'),
    staleTime: Infinity,
  });
export const useQuotations = (q: Query) =>
  useQuery({
    queryKey: ['quotations', 'list', q],
    queryFn: () => api<Paginated<QuotationRow>>('/quotations', { query: q }),
    placeholderData: keepPreviousData,
  });
export const useQuotation = (id: string | undefined) =>
  useQuery({
    queryKey: ['quotations', 'detail', id],
    queryFn: () => api<QuotationDetail>(`/quotations/${id}`),
    enabled: !!id,
  });

export const ADMIN_KEYS = { lookups: queryKeys.lookups, nav: queryKeys.navCounts };
