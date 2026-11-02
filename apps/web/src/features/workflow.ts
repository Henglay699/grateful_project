import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlertItem,
  BrokerAgentInput,
  BrokerAgentRow,
  ClientAuthorizationInput,
  ClientAuthorizationRow,
  ClientSignatoryInput,
  ClientSignatoryRow,
  CustomsPermitInput,
  ShipmentWorkflow,
  VendorInvoiceInput,
  WorkQueueItem,
  WorkflowAdvanceInput,
  WorkflowFiguresInput,
  WorkflowReturnInput,
} from '@gs/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export const workflowKeys = {
  all: ['workflow'] as const,
  shipment: (id: string) => ['workflow', 'shipment', id] as const,
  queue: (scope: string) => ['workflow', 'queue', scope] as const,
  alerts: ['workflow', 'alerts'] as const,
  brokers: ['workflow', 'brokers'] as const,
  signatories: (clientId: string) => ['workflow', 'signatories', clientId] as const,
  authorizations: (clientId: string) => ['workflow', 'authorizations', clientId] as const,
};

export const useWorkflow = (shipmentId: string | undefined) =>
  useQuery({
    queryKey: workflowKeys.shipment(shipmentId ?? ''),
    queryFn: () => api<ShipmentWorkflow>(`/workflow/shipments/${shipmentId}`),
    enabled: !!shipmentId,
  });

export const useWorkQueue = (scope: 'mine' | 'all', enabled = true) =>
  useQuery({
    enabled,
    queryKey: workflowKeys.queue(scope),
    queryFn: () =>
      api<{ items: WorkQueueItem[]; counts: Record<string, number> }>(
        `/workflow/queue?scope=${scope}`,
      ),
    refetchInterval: 60_000,
  });

export const useAlerts = () =>
  useQuery({
    queryKey: workflowKeys.alerts,
    queryFn: () => api<AlertItem[]>('/workflow/alerts'),
    refetchInterval: 2 * 60_000,
    staleTime: 30_000,
  });

/**
 * Every change to a shipment's workflow returns the fresh workflow; it is put straight into the
 * cache, and the lists that show stages (plans, My Work, alerts, nav counts) refetch.
 */
function useWorkflowMutation<V>(shipmentId: string, fn: (v: V) => Promise<ShipmentWorkflow>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(workflowKeys.shipment(shipmentId), data);
      void qc.invalidateQueries({ queryKey: ['workflow', 'queue'] });
      void qc.invalidateQueries({ queryKey: workflowKeys.alerts });
      void qc.invalidateQueries({ queryKey: queryKeys.shipments });
      void qc.invalidateQueries({ queryKey: queryKeys.navCounts });
    },
  });
}

export const useAdvanceStage = (id: string) =>
  useWorkflowMutation(id, (v: WorkflowAdvanceInput) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/advance`, { method: 'POST', json: v }),
  );

export const useSendBack = (id: string) =>
  useWorkflowMutation(id, (v: WorkflowReturnInput) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/return`, { method: 'POST', json: v }),
  );

export const useSaveFigures = (id: string) =>
  useWorkflowMutation(id, (v: WorkflowFiguresInput) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/figures`, { method: 'PUT', json: v }),
  );

export const useSavePermit = (id: string) =>
  useWorkflowMutation(id, ({ permitId, body }: { permitId?: string; body: CustomsPermitInput }) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/permits${permitId ? `/${permitId}` : ''}`, {
      method: permitId ? 'PUT' : 'POST',
      json: body,
    }),
  );

export const useDeletePermit = (id: string) =>
  useWorkflowMutation(id, (permitId: string) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/permits/${permitId}`, { method: 'DELETE' }),
  );

export const useSaveVendorInvoice = (id: string) =>
  useWorkflowMutation(id, ({ invoiceId, body }: { invoiceId?: string; body: VendorInvoiceInput }) =>
    api<ShipmentWorkflow>(
      `/workflow/shipments/${id}/vendor-invoices${invoiceId ? `/${invoiceId}` : ''}`,
      { method: invoiceId ? 'PUT' : 'POST', json: body },
    ),
  );

export const useDeleteVendorInvoice = (id: string) =>
  useWorkflowMutation(id, (invoiceId: string) =>
    api<ShipmentWorkflow>(`/workflow/shipments/${id}/vendor-invoices/${invoiceId}`, {
      method: 'DELETE',
    }),
  );

/* ---------- Master data ---------- */

export const useBrokerAgents = () =>
  useQuery({
    queryKey: workflowKeys.brokers,
    queryFn: () => api<BrokerAgentRow[]>('/workflow/broker-agents'),
  });

export function useSaveBrokerAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: BrokerAgentInput }) =>
      api(`/workflow/broker-agents${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.brokers });
      void qc.invalidateQueries({ queryKey: workflowKeys.alerts });
    },
  });
}

export const useSignatories = (clientId: string) =>
  useQuery({
    queryKey: workflowKeys.signatories(clientId),
    queryFn: () => api<ClientSignatoryRow[]>(`/workflow/clients/${clientId}/signatories`),
  });

export function useSaveSignatory(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ClientSignatoryInput }) =>
      api(`/workflow/clients/${clientId}/signatories${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKeys.signatories(clientId) }),
  });
}

export function useDeleteSignatory(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/workflow/clients/${clientId}/signatories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowKeys.signatories(clientId) }),
  });
}

export const useAuthorizations = (clientId: string) =>
  useQuery({
    queryKey: workflowKeys.authorizations(clientId),
    queryFn: () => api<ClientAuthorizationRow[]>(`/workflow/clients/${clientId}/authorizations`),
  });

export function useSaveAuthorization(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ClientAuthorizationInput }) =>
      api(`/workflow/clients/${clientId}/authorizations${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.authorizations(clientId) });
      void qc.invalidateQueries({ queryKey: workflowKeys.alerts });
    },
  });
}

export function useDeleteAuthorization(clientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/workflow/clients/${clientId}/authorizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.authorizations(clientId) });
      void qc.invalidateQueries({ queryKey: workflowKeys.alerts });
    },
  });
}
