import type { BillingDoc, BillingDocListItem, Paginated } from '@gs/shared';
import { api } from '../../lib/api';

/** The status filter, one option per pill on the list: its document status and accounting's check. */
export const STATUS_FILTER: Record<string, { label: string; status: string; review?: string }> = {
  DRAFT: { label: 'Draft', status: 'DRAFT', review: 'UNCHECKED' },
  REVISED: { label: 'Revised', status: 'DRAFT', review: 'REVISED' },
  ISSUED: { label: 'Submitted', status: 'ISSUED', review: 'UNCHECKED' },
  REVIEWED: { label: 'Reviewed', status: 'ISSUED', review: 'REVIEWED' },
  CHECKED: { label: 'Approved', status: 'ISSUED', review: 'CHECKED' },
  VOID: { label: 'Cancelled', status: 'VOID' },
};

/** The Record Summary list's filters (URL params), as the PDF and Excel packs take them. */
export const PACK_FILTERS = ['status', 'clientId', 'direction', 'month', 'year', 'q'] as const;
export type PackFilters = Partial<Record<(typeof PACK_FILTERS)[number], string>>;

export const packFilters = (params: URLSearchParams): PackFilters =>
  Object.fromEntries(
    PACK_FILTERS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])),
  ) as PackFilters;

/**
 * Every record summary matching the filters (all pages, not just the one on screen), in full,
 * oldest first (by date, then declare no.), as the packs print them.
 */
export async function loadRecordSummaryPack(filters: PackFilters): Promise<BillingDoc[]> {
  const st = filters.status ? STATUS_FILTER[filters.status] : undefined;
  const query = {
    q: filters.q,
    clientId: filters.clientId,
    direction: filters.direction,
    monthOfYear: filters.month,
    year: filters.year,
    status: st?.status,
    review: st?.review,
  };
  const rows: BillingDocListItem[] = [];
  for (let page = 1; ; page++) {
    const res = await api<Paginated<BillingDocListItem>>('/accounting/docs/record-summaries', {
      query: { ...query, page, pageSize: 200 },
    });
    rows.push(...res.data);
    if (page >= res.meta.totalPages) break;
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.declareNo ?? '').localeCompare(b.declareNo ?? ''),
  );
  const docs: BillingDoc[] = [];
  // A few at a time, so a large pack doesn't flood the API.
  for (let i = 0; i < rows.length; i += 6)
    docs.push(
      ...(await Promise.all(
        rows
          .slice(i, i + 6)
          .map((r) => api<BillingDoc>(`/accounting/docs/record-summaries/${r.id}`)),
      )),
    );
  return docs;
}
