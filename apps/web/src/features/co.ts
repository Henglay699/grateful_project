import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CoBreakdownInput, CoDetail, CoListQuery, CoRecordInput, CoRow } from '@gs/shared';
import { api } from '../lib/api';

/** CO Plans: the export invoices of the months with their certificates of origin. */
export const useCoList = (q: CoListQuery) =>
  useQuery({
    queryKey: ['co', 'list', q],
    queryFn: () => api<CoRow[]>('/co', { query: q }),
    enabled: !!q.from && !!q.to && q.from <= q.to,
  });

/** One invoice with its saved breakdown and the client's last one. */
export const useCoDetail = (invoiceId: string | undefined) =>
  useQuery({
    queryKey: ['co', 'detail', invoiceId],
    queryFn: () => api<CoDetail>(`/co/${invoiceId}`),
    enabled: !!invoiceId,
  });

export function useSaveCoRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, body }: { invoiceId: string; body: CoRecordInput }) =>
      api<undefined>(`/co/${invoiceId}`, { method: 'PUT', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['co'] }),
  });
}

export function useSaveBreakdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, body }: { invoiceId: string; body: CoBreakdownInput }) =>
      api<undefined>(`/co/${invoiceId}/breakdown`, { method: 'PUT', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['co'] }),
  });
}
