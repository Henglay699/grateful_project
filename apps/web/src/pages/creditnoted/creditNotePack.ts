import type { BillingDoc, CreditNoteReviewRow, Paginated } from '@gs/shared';
import { api } from '../../lib/api';

/** The Credit Noted list's filters (URL params), as the PDF and Excel packs take them. */
export const PACK_FILTERS = ['status', 'clientId', 'direction', 'month', 'year', 'q'] as const;
export type PackFilters = Partial<Record<(typeof PACK_FILTERS)[number], string>>;

export const packFilters = (params: URLSearchParams): PackFilters =>
  Object.fromEntries(
    PACK_FILTERS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])),
  ) as PackFilters;

/**
 * Every credit note matching the filters (all pages, not just the one on screen), in full,
 * oldest first (by date, then number) — one per shipment, as the packs print them.
 */
export async function loadCreditNotePack(filters: PackFilters): Promise<BillingDoc[]> {
  const rows: CreditNoteReviewRow[] = [];
  for (let page = 1; ; page++) {
    const res = await api<Paginated<CreditNoteReviewRow>>('/accounting/credit-notes/list', {
      query: { ...filters, page, pageSize: 200 },
    });
    rows.push(...res.data);
    if (page >= res.meta.totalPages) break;
  }
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''),
  );
  const docs: BillingDoc[] = [];
  // A few at a time, so a large pack doesn't flood the API.
  for (let i = 0; i < rows.length; i += 6)
    docs.push(
      ...(await Promise.all(
        rows.slice(i, i + 6).map((r) => api<BillingDoc>(`/accounting/docs/credit-notes/${r.id}`)),
      )),
    );
  return docs;
}
