import { z } from 'zod';

/* ------------------------------ Global search (top bar) ------------------------------ */

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
});

export const SEARCH_HIT_KINDS = [
  'shipment',
  'client',
  'tax-invoice',
  'disbursement',
  'debit-note',
  'credit-note',
  'record-summary',
  'quotation',
] as const;
export type SearchHitKind = (typeof SEARCH_HIT_KINDS)[number];

/** One suggestion under the top-bar search: what it is, and where opening it goes. */
export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  /** The number or name the user is most likely looking for (invoice no., client code…). */
  title: string;
  /** Context: client, date, HBL or container, whatever helps tell rows apart. */
  subtitle: string;
  /** App path to open, e.g. /plans/<id>. */
  url: string;
}

export interface GlobalSearchResponse {
  hits: SearchHit[];
}
