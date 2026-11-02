import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingClientMonth,
  BillingDraftsInput,
  BillingDraftsResult,
  BillingIssueResult,
  BillingOverview,
  BillingPack,
  OfficialReceipt,
  Paginated,
  ReceiptInput,
} from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/* Client Billing lives under the accounting key, so document changes refresh it too. */
const KEY = ['accounting'] as const;

function useInvalidateBilling() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [KEY, queryKeys.analytics, queryKeys.overview, queryKeys.clients].map((k) =>
        qc.invalidateQueries({ queryKey: k }),
      ),
    );
}

/** Every client with billing in the month. */
export function useBillingOverview(month: string) {
  return useQuery({
    queryKey: [...KEY, 'billing', month],
    queryFn: () => api<BillingOverview>('/accounting/billing', { query: { month } }),
    placeholderData: keepPreviousData,
  });
}

/** One client's month: shipments with their documents, statements, receipts. */
export function useClientMonth(clientId: string, month: string) {
  return useQuery({
    queryKey: [...KEY, 'billing', clientId, month],
    queryFn: () => api<BillingClientMonth>(`/accounting/billing/${clientId}`, { query: { month } }),
    placeholderData: keepPreviousData,
  });
}

export function useBillingPack(clientId: string, month: string, recordId?: string) {
  return useQuery({
    queryKey: [...KEY, 'billing-pack', clientId, month, recordId],
    queryFn: () =>
      api<BillingPack>(`/accounting/billing/${clientId}/pack`, { query: { month, recordId } }),
    enabled: !!month,
  });
}

export function useCreateDrafts(clientId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: BillingDraftsInput) =>
      api<BillingDraftsResult>(`/accounting/billing/${clientId}/drafts`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: invalidate,
  });
}

export function useIssueDrafts(clientId: string) {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (month: string) =>
      api<BillingIssueResult>(`/accounting/billing/${clientId}/issue`, {
        method: 'POST',
        json: { month },
      }),
    onSuccess: invalidate,
  });
}

export function useReceipts(q: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...KEY, 'receipts', q],
    queryFn: () => api<Paginated<OfficialReceipt>>('/accounting/receipts', { query: q }),
    placeholderData: keepPreviousData,
  });
}

export function useReceipt(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'receipt', id],
    queryFn: () => api<OfficialReceipt>(`/accounting/receipts/${id}`),
    enabled: !!id,
  });
}

export function useCreateReceipt() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: ReceiptInput) =>
      api<OfficialReceipt>('/accounting/receipts', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });
}

export function useVoidReceipt() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<OfficialReceipt>(`/accounting/receipts/${id}/void`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: invalidate,
  });
}
