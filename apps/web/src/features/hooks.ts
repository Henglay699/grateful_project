import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClientDetail,
  ClientInput,
  ClientListItem,
  ClientNote,
  ClientConsigneeInput,
  ClientNoteInput,
  ConsigneeAddressInput,
  SupplierInput,
  CutStockImportResult,
  CutStockItemInput,
  CutStockMovement,
  CutStockRow,
  CutStockSummary,
  LookupsResponse,
  Paginated,
  SealPlanInput,
  SealPlanRow,
  SealPlanShipment,
  SealPlanShipmentOption,
  SealPlanStandaloneInput,
  ShipmentDetail,
  ShipmentInput,
  ShipmentListItem,
} from '@gs/shared';
import { api } from '../lib/api';
import { uploadFile } from '../lib/files';
import { queryKeys } from '../lib/queryKeys';

type Query = Record<
  string,
  string | number | boolean | undefined | null | readonly (string | number)[]
>;

/* ---------- Lookups (dropdowns) ---------- */
export function useLookups() {
  return useQuery({
    queryKey: queryKeys.lookups,
    queryFn: () => api<LookupsResponse>('/lookups'),
    staleTime: 5 * 60_000,
  });
}

export function useAddConsignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; clientId?: string | null; countryIso2?: string | null }) =>
      api<{ id: string; name: string }>('/lookups/consignees', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lookups }),
  });
}

export function useAddForwarder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api<{ id: string; name: string }>('/lookups/forwarders', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lookups }),
  });
}

/** "+ Add New" in a shipping plan's CO Form: returns the stored code ("Form XYZ" → XYZ). */
export function useAddCoForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string }) =>
      api<{ value: string; label: string }>('/lookups/co-forms', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lookups }),
  });
}

/* ---------- Clients ---------- */
export function useClients(query: Query) {
  return useQuery({
    queryKey: [...queryKeys.clients, 'list', query],
    queryFn: () => api<Paginated<ClientListItem>>('/clients', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: queryKeys.client(id),
    queryFn: () => api<ClientDetail>(`/clients/${id}`),
  });
}

/* ---------- Client suppliers / consignees (addresses for the INV + PL) ---------- */
export function useSaveSupplier(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupplierInput) =>
      api<{ id: string }>(`/clients/${clientId}/suppliers`, { method: 'PUT', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.client(clientId) }),
  });
}

/** Hides a supplier (by name) from the client's list and clears its address. */
export function useDeleteSupplier(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<undefined>(`/clients/${clientId}/suppliers`, { method: 'DELETE', query: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.client(clientId) }),
  });
}

/** Client Details → Consignees → "+ Add": a consignee for this client, with its address. */
export function useAddClientConsignee(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClientConsigneeInput) =>
      api<{ id: string }>(`/clients/${clientId}/consignees`, { method: 'POST', json: body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.client(clientId) }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

/** Makes a consignee inactive: off the client's list and the dropdowns; shipments keep it. */
export function useDeleteConsignee(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/clients/${clientId}/consignees/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.client(clientId) }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

export function useSetConsigneeAddress(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConsigneeAddressInput }) =>
      api<undefined>(`/clients/${clientId}/consignees/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.client(clientId) }),
  });
}

/* ---------- Client remarks (notes under a subject) ---------- */
const clientNotesKey = (clientId: string) => [...queryKeys.client(clientId), 'notes'] as const;

export function useClientNotes(clientId: string) {
  return useQuery({
    queryKey: clientNotesKey(clientId),
    queryFn: () => api<ClientNote[]>(`/clients/${clientId}/notes`),
  });
}

export function useSaveClientNote(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string | null; body: ClientNoteInput }) =>
      id
        ? api<undefined>(`/clients/${clientId}/notes/${id}`, { method: 'PUT', json: body })
        : api<{ id: string }>(`/clients/${clientId}/notes`, { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientNotesKey(clientId) }),
  });
}

export function useDeleteClientNote(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/clients/${clientId}/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: clientNotesKey(clientId) }),
  });
}

export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<ClientInput> }) =>
      id
        ? api<{ id: string }>(`/clients/${id}`, { method: 'PATCH', json: body })
        : api<{ id: string }>('/clients', { method: 'POST', json: body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.clients }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.clients }),
        qc.invalidateQueries({ queryKey: queryKeys.lookups }),
      ]),
  });
}

/* ---------- Shipments ---------- */
export function useShipments(query: Query) {
  return useQuery({
    queryKey: [...queryKeys.shipments, 'list', query],
    queryFn: () => api<Paginated<ShipmentListItem>>('/shipments', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.shipment(id ?? 'new'),
    queryFn: () => api<ShipmentDetail>(`/shipments/${id}`),
    enabled: !!id,
  });
}

/** Everything that shows shipment-derived numbers must refetch after a write. */
function invalidateShipmentData(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    [
      queryKeys.shipments,
      queryKeys.clients,
      queryKeys.cutStock,
      queryKeys.analytics,
      queryKeys.overview,
      queryKeys.navCounts,
    ].map((k) => qc.invalidateQueries({ queryKey: k })),
  );
}

export function useSaveShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ShipmentInput }) =>
      id
        ? api<ShipmentDetail>(`/shipments/${id}`, { method: 'PUT', json: body })
        : api<ShipmentDetail>('/shipments', { method: 'POST', json: body }),
    onSuccess: () => invalidateShipmentData(qc),
  });
}

export function useDeleteShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/shipments/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateShipmentData(qc),
  });
}

/* ---------- Seal plans ---------- */
export function useSealPlans(query: Query & { year: number }) {
  return useQuery({
    queryKey: [...queryKeys.sealPlans, query],
    queryFn: () => api<SealPlanRow[]>('/seal-plans', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveSealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      shipmentId,
      containerNo,
      body,
    }: {
      shipmentId: string;
      containerNo: string;
      body: SealPlanInput;
    }) =>
      api<undefined>(`/seal-plans/${shipmentId}/${encodeURIComponent(containerNo)}`, {
        method: 'PUT',
        json: body,
      }),
    // The seals (and a container added here) also show on the shipment itself.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.shipments }),
  });
}

/** "+ New Seal Plan": export CY/CY shipments to fill from. */
export function useSealPlanShipments(q: string) {
  return useQuery({
    queryKey: [...queryKeys.sealPlans, 'shipments', q],
    queryFn: () =>
      api<SealPlanShipmentOption[]>('/seal-plans/shipments', { query: { q: q || undefined } }),
    placeholderData: keepPreviousData,
  });
}

export function useSealPlanShipment(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.sealPlans, 'shipment', id],
    queryFn: () => api<SealPlanShipment>(`/seal-plans/shipments/${id}`),
    enabled: !!id,
  });
}

/** A plan without a shipment: create (no id), update or delete. */
export function useSaveStandaloneSealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string | null; body: SealPlanStandaloneInput }) =>
      id
        ? api<undefined>(`/seal-plans/${id}`, { method: 'PUT', json: body })
        : api<{ id: string }>('/seal-plans', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sealPlans }),
  });
}

export function useDeleteSealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/seal-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sealPlans }),
  });
}

/* ---------- Cut stock ---------- */
export type CutStockList = Paginated<CutStockRow> & { summary: CutStockSummary };

export function useCutStock(query: Query & { clientId?: string }, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.cutStock, 'list', query],
    queryFn: () => api<CutStockList>('/cut-stock', { query }),
    enabled: enabled && !!query.clientId,
    placeholderData: keepPreviousData,
  });
}

export function useCutStockItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.cutStockItem(id ?? 'none'),
    queryFn: () =>
      api<CutStockRow & { movements: CutStockMovement[]; openingImportedQty: string }>(
        `/cut-stock/${id}`,
      ),
    enabled: !!id,
  });
}

export function useSaveCutStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CutStockItemInput> }) =>
      id
        ? api<CutStockRow>(`/cut-stock/${id}`, { method: 'PATCH', json: body })
        : api<CutStockRow>('/cut-stock', { method: 'POST', json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}

export function useDeleteCutStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/cut-stock/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}

export function useImportMasterList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      file,
      dryRun,
      updateOpening,
    }: {
      clientId: string;
      file: File;
      dryRun: boolean;
      updateOpening: boolean;
    }) =>
      uploadFile<CutStockImportResult>('/cut-stock/import', file, {
        clientId,
        dryRun: String(dryRun),
        updateOpening: String(updateOpening),
      }),
    onSuccess: (r) =>
      r.dryRun ? undefined : qc.invalidateQueries({ queryKey: queryKeys.cutStock }),
  });
}
