/**
 * Central TanStack Query keys. Mutations invalidate by prefix, e.g. creating a
 * shipment invalidates ['shipments'], ['analytics'] and ['overview'] so every chart refetches.
 */
export const queryKeys = {
  navCounts: ['meta', 'nav-counts'] as const,
  lookups: ['lookups'] as const,
  clients: ['clients'] as const,
  client: (id: string) => ['clients', id] as const,
  shipments: ['shipments'] as const,
  shipment: (id: string) => ['shipments', 'detail', id] as const,
  /** Under shipments, so saving a shipment refreshes its containers here too. */
  sealPlans: ['shipments', 'seal-plans'] as const,
  cutStock: ['cut-stock'] as const,
  cutStockItem: (id: string) => ['cut-stock', 'item', id] as const,
  /** Phase 4 dashboards: invalidated whenever shipments or ledger data change. */
  analytics: ['analytics'] as const,
  overview: ['overview'] as const,
};
