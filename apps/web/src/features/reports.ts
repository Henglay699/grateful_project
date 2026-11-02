import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomsReportData,
  MihDraft,
  MihMonth,
  MihMonthInput,
  MihMonthRow,
  MihYear,
  PayrollMonthDetail,
  PayrollMonthInput,
  PayrollMonthRow,
  ProductionProfile,
  ProductionProfileInput,
  ProductionReportData,
} from '@gs/shared';
import { api } from '../lib/api';

/** Reports → Payroll → Capacity report: the month's exports by product line and the setup. */
export const useProductionReport = (clientId: string | undefined, month: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'production', clientId, month],
    queryFn: () => api<ProductionReportData>('/reports/production', { query: { clientId, month } }),
    enabled: !!clientId && !!month,
  });

export function useSaveProductionProfile(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: ProductionProfileInput) =>
      api<ProductionProfile>(`/reports/production/profile/${clientId}`, {
        method: 'PUT',
        json: profile,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'production', clientId] }),
  });
}

/** Reports → Payroll: the saved months, newest first. */
export const usePayrollMonths = () =>
  useQuery({
    queryKey: ['reports', 'payroll'],
    queryFn: () => api<PayrollMonthRow[]>('/reports/payroll'),
  });

/** One saved month with its staff rows. */
export const usePayrollMonth = (id: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'payroll', id],
    queryFn: () => api<PayrollMonthDetail>(`/reports/payroll/${id}`),
    enabled: !!id,
  });

export function useSavePayrollMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayrollMonthInput) =>
      api<PayrollMonthDetail>('/reports/payroll', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'payroll'] }),
  });
}

export function useDeletePayrollMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/reports/payroll/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'payroll'] }),
  });
}

/* ---------- MIH ---------- */

/** MIH → every saved month (all factories), newest first. */
export const useMihMonths = () =>
  useQuery({
    queryKey: ['reports', 'mih', 'list'],
    queryFn: () => api<MihMonthRow[]>('/reports/mih'),
  });

/** A factory's saved months of the year, with its payroll months. */
export const useMihYear = (clientId: string | undefined, year: number) =>
  useQuery({
    queryKey: ['reports', 'mih', 'year', clientId, year],
    queryFn: () => api<MihYear>('/reports/mih/year', { query: { clientId, year } }),
    enabled: !!clientId,
  });

/** A new month filled in from the payroll, the invoices and the last saved month. */
export const useMihDraft = (clientId: string | undefined, month: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'mih', 'draft', clientId, month],
    queryFn: () => api<MihDraft>('/reports/mih/draft', { query: { clientId, month } }),
    enabled: !!clientId && !!month,
    staleTime: 0,
  });

export function useSaveMihMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MihMonthInput) =>
      api<MihMonth>('/reports/mih', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'mih'] }),
  });
}

export function useDeleteMihMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/reports/mih/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'mih'] }),
  });
}

/* ---------- Import & Export ---------- */

/** A factory's import or export invoice lines by customs declaration, `from`–`to` months. */
export const useCustomsReport = (q: {
  clientId: string | undefined;
  direction: 'IMPORT' | 'EXPORT';
  from: string;
  to: string;
}) =>
  useQuery({
    queryKey: ['reports', 'customs', q],
    queryFn: () => api<CustomsReportData>('/reports/customs', { query: q }),
    enabled: !!q.clientId && !!q.from && !!q.to && q.from <= q.to,
  });
