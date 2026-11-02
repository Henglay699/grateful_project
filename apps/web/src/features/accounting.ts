import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingDoc,
  BillingDocListItem,
  BillingDocType,
  ClearFeePaymentInput,
  ClearFeePaymentMonth,
  CreditNoteMessage,
  CreditNoteReviewCounts,
  CreditNoteReviewRow,
  CreditNoteReviewStatus,
  CreditNoteDeclaration,
  DeclarationOption,
  EligibleRecord,
  LedgerEntryInput,
  LedgerRow,
  LedgerSummary,
  NumberedShipment,
  Paginated,
  RecordSummaryMessage,
  RecordSummaryReviewRow,
  RecordSummaryShipment,
  ReleasedInvoiceSet,
  VatRate,
} from '@gs/shared';
import { vatPercentOn } from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

const KEY = ['accounting'] as const;
type Query = Record<string, string | number | undefined>;

/** Ledger changes move net profit on the dashboards, so refresh those too. */
function useInvalidateAccounting() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [KEY, queryKeys.analytics, queryKeys.overview, queryKeys.clients].map((k) =>
        qc.invalidateQueries({ queryKey: k }),
      ),
    );
}

export function useLedger(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'ledger', q],
    queryFn: () =>
      api<Paginated<LedgerRow> & { totals: LedgerSummary }>('/accounting/ledger', { query: q }),
    placeholderData: keepPreviousData,
  });
}

export function useLedgerRow(id: string | null) {
  return useQuery({
    queryKey: [...KEY, 'ledger-row', id],
    queryFn: () => api<LedgerRow>(`/accounting/ledger/${id}`),
    enabled: !!id,
  });
}

export function useDeclarationOptions(q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'decl-options', q],
    queryFn: () =>
      api<DeclarationOption[]>('/accounting/declarations', { query: { q: q || undefined } }),
    enabled,
  });
}

/** Shipments ready for a tax invoice, DIS or debit note (the Declare No. picker). */
export function useEligible(type: 'tax-invoices' | 'disbursements' | 'debit-notes') {
  return useQuery({
    queryKey: [...KEY, 'eligible', type],
    queryFn: () => api<EligibleRecord[]>(`/accounting/eligible/${type}`),
  });
}

/** Shipping-plan declarations a record summary can start from, in the ledger or not yet. */
export function useRecordSummaryShipments() {
  return useQuery({
    queryKey: [...KEY, 'eligible', 'record-summaries'],
    queryFn: () => api<RecordSummaryShipment[]>('/accounting/eligible/record-summaries'),
  });
}

export function useSaveLedger() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<LedgerEntryInput> }) =>
      id
        ? api<LedgerRow>(`/accounting/ledger/${id}`, { method: 'PATCH', json: body })
        : api<LedgerRow>('/accounting/ledger', { method: 'POST', json: body }),
    onSuccess: invalidate,
  });
}

/** Deletes a shipment's invoice set and releases its numbers to the next approved shipment. */
export function useDeleteInvoice() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({ recordId, reason }: { recordId: string; reason: string }) =>
      api<ReleasedInvoiceSet>(`/accounting/ledger/${recordId}/delete-invoice`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: invalidate,
  });
}

/** A ledger month's clear fee against the payments made to Chea (in one or more parts). */
export function useClearFeePayments(month: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'clear-fee-payments', month],
    queryFn: () =>
      api<ClearFeePaymentMonth>('/accounting/clear-fee-payments', { query: { month } }),
    enabled: enabled && !!month,
  });
}

export function useSaveClearFeePayment(month: string) {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Omit<ClearFeePaymentInput, 'month'> }) =>
      id
        ? api<undefined>(`/accounting/clear-fee-payments/${id}`, { method: 'PATCH', json: body })
        : api<ClearFeePaymentMonth>('/accounting/clear-fee-payments', {
            method: 'POST',
            json: { ...body, month },
          }),
    // Payments settle months, so ledger rows' Chea status and later months' carry change too.
    onSuccess: invalidate,
  });
}

export function useDeleteClearFeePayment() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/accounting/clear-fee-payments/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDeleteLedger() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/accounting/ledger/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useDocs(type: BillingDocType, q: Query, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'docs', type, q],
    queryFn: () => api<Paginated<BillingDocListItem>>(`/accounting/docs/${type}`, { query: q }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDoc(type: BillingDocType, id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'doc', type, id],
    queryFn: () => api<BillingDoc>(`/accounting/docs/${type}/${id}`),
    enabled: !!id,
  });
}

/**
 * A ready-to-edit draft from a ledger row (or, for credit notes and record summaries, from a
 * declaration; for a document of no shipment, e.g. a monthly fee debit note, from a client and
 * date).
 */
export function usePrefill(
  type: BillingDocType,
  recordId: string | null,
  declarationId: string | null = null,
  client: { clientId: string; date: string } | null = null,
) {
  return useQuery({
    queryKey: [...KEY, 'prefill', type, recordId, declarationId, client],
    queryFn: () =>
      api<Record<string, unknown>>(`/accounting/docs/${type}/prefill`, {
        query: declarationId
          ? { declarationId }
          : recordId
            ? { recordId }
            : { clientId: client!.clientId, date: client!.date },
      }),
    enabled: !!recordId || !!declarationId || !!client,
    staleTime: Infinity,
  });
}

/** Declarations a new Credit Noted can start from (with or without a ledger row). */
export function useCreditNoteDeclarations(q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'cn-declarations', q],
    queryFn: () =>
      api<CreditNoteDeclaration[]>('/accounting/credit-notes/declarations', {
        query: { q: q || undefined },
      }),
    enabled,
  });
}

/** Accounting → Credit Noted: submitted notes with Checked / Unchecked / Revised counts. */
export function useCreditNoteReview(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'cn-review', q],
    queryFn: () =>
      api<Paginated<CreditNoteReviewRow> & { counts: CreditNoteReviewCounts }>(
        '/accounting/credit-notes/review',
        { query: q },
      ),
    placeholderData: keepPreviousData,
  });
}

/** Sidebar → Credit Noted: every credit note (drafts too) with shipment details. */
export function useCreditNoteList(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'cn-list', q],
    queryFn: () =>
      api<Paginated<CreditNoteReviewRow>>('/accounting/credit-notes/list', { query: q }),
    placeholderData: keepPreviousData,
  });
}

/** Accounting's check; "Revised" sends the note back to the broker with a message. */
export function useSetCreditNoteReview() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({
      id,
      reviewStatus,
      message,
    }: {
      id: string;
      reviewStatus: CreditNoteReviewStatus;
      message?: string;
    }) =>
      // Checked: the shipments that got their INV / DIS / DN numbers.
      api<{ numbered: NumberedShipment[] }>(`/accounting/docs/credit-notes/${id}/review`, {
        method: 'PATCH',
        json: { reviewStatus, message },
      }),
    // Checking adds to the ledger and revising takes the fee out: refresh all of accounting.
    onSuccess: invalidate,
  });
}

/** Accounting → Expense to Clients: Operations' submitted record summaries to check. */
export function useRecordSummaryReview(q: Query) {
  return useQuery({
    queryKey: [...KEY, 'rs-review', q],
    queryFn: () =>
      api<Paginated<RecordSummaryReviewRow> & { counts: CreditNoteReviewCounts }>(
        '/accounting/record-summaries/review',
        { query: q },
      ),
    placeholderData: keepPreviousData,
  });
}

/** Accounting's check; "Revised" sends the summary back to Operations with a note. */
export function useSetRecordSummaryReview() {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({
      id,
      reviewStatus,
      message,
    }: {
      id: string;
      reviewStatus: CreditNoteReviewStatus;
      message?: string;
    }) =>
      // Checked: how many tax invoice / DIS / DN drafts were made for the shipment.
      api<{ drafts?: number }>(`/accounting/docs/record-summaries/${id}/review`, {
        method: 'PATCH',
        json: { reviewStatus, message },
      }),
    // Checking fills the ledger and revising takes the amounts out: refresh all of accounting.
    onSuccess: invalidate,
  });
}

/** My Credit Noted inbox (messages from accounting). */
export function useCreditNoteInbox(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'cn-inbox'],
    queryFn: () =>
      api<{ data: CreditNoteMessage[]; unread: number }>('/accounting/credit-notes/inbox'),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMarkInboxRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId?: string) =>
      api<undefined>('/accounting/credit-notes/inbox/read', {
        method: 'POST',
        json: { messageId },
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, 'cn-inbox'] }),
        qc.invalidateQueries({ queryKey: queryKeys.navCounts }),
      ]),
  });
}

/** My Record Summary inbox (messages from accounting's Expense to Clients). */
export function useRecordSummaryInbox() {
  return useQuery({
    queryKey: [...KEY, 'rs-inbox'],
    queryFn: () =>
      api<{ data: RecordSummaryMessage[]; unread: number }>('/accounting/record-summaries/inbox'),
    refetchInterval: 60_000,
  });
}

export function useMarkRecordSummaryInboxRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId?: string) =>
      api<undefined>('/accounting/record-summaries/inbox/read', {
        method: 'POST',
        json: { messageId },
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, 'rs-inbox'] }),
        qc.invalidateQueries({ queryKey: queryKeys.navCounts }),
      ]),
  });
}

/** Accounting's messages about one credit note, newest first. */
export function useCreditNoteMessages(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'cn-messages', id],
    queryFn: () => api<CreditNoteMessage[]>(`/accounting/docs/credit-notes/${id}/messages`),
    enabled: !!id,
  });
}

export function useDocAction(type: BillingDocType) {
  const invalidate = useInvalidateAccounting();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id?: string;
      action: 'create' | 'update' | 'issue' | 'resubmit' | 'void' | 'correct' | 'delete';
      body?: unknown;
    }) => {
      const base = `/accounting/docs/${type}`;
      switch (action) {
        case 'create':
          return api<BillingDoc>(base, { method: 'POST', json: body });
        case 'update':
          return api<BillingDoc>(`${base}/${id}`, { method: 'PUT', json: body });
        case 'issue':
          return api<BillingDoc>(`${base}/${id}/issue`, { method: 'POST' });
        // A submitted credit note / record summary revised: saved and sent back as Request Revise.
        case 'resubmit':
          return api<BillingDoc>(`${base}/${id}/resubmit`, { method: 'POST', json: body });
        case 'void':
          return api<BillingDoc>(`${base}/${id}/void`, { method: 'POST', json: body });
        // An authorised correction of an issued document's number / date (with a reason).
        case 'correct':
          return api<BillingDoc>(`${base}/${id}/correct`, { method: 'POST', json: body });
        case 'delete':
          return api<undefined>(`${base}/${id}`, { method: 'DELETE' });
      }
    },
    onSuccess: invalidate,
  });
}

export interface CompanyInfo {
  nameEn?: string;
  nameKm?: string;
  vattin?: string;
  addressEn?: string;
  addressKm?: string;
  phone?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  banks?: { bankName?: string | null; accountName?: string | null; accountNo?: string | null }[];
}
export function useCompany() {
  return useQuery({
    queryKey: ['meta', 'company'],
    queryFn: () => api<CompanyInfo>('/meta/company'),
    staleTime: 10 * 60_000,
  });
}

/** The dated VAT percents (Settings → Tax Management), for previewing a document's VAT. */
export function useVatRates() {
  return useQuery({
    queryKey: ['meta', 'vat-rates'],
    queryFn: () => api<VatRate[]>('/meta/vat-rates'),
    staleTime: 10 * 60_000,
  });
}

/**
 * The VAT percent a document works at: its own stored percent while its date is unchanged,
 * otherwise the percent in force on the (new) date, as the server will store it on save.
 */
export function useDocVatPercent(
  date: string | null | undefined,
  saved?: { date: string | null | undefined; vatRate: string | null | undefined } | null,
): number {
  const rates = useVatRates();
  if (saved?.vatRate != null && saved.date === date) return Number(saved.vatRate);
  return vatPercentOn(rates.data, date);
}
