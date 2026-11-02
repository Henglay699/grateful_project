import {
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_PILL,
  type CheaPaymentStatus,
  type ShipmentStatus,
} from '@gs/shared';

type Tone = 'completed' | 'progress' | 'pending' | 'exception' | 'neutral';

/** The prototype's `.status-tag` pill. */
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`status-tag ${tone}`}>{children}</span>
  );
}

export function ShipmentStatusPill({ status }: { status: ShipmentStatus }) {
  return <Pill tone={SHIPMENT_STATUS_PILL[status]}>{SHIPMENT_STATUS_LABEL[status]}</Pill>;
}

/** A ledger row's Chea payment: Paid, Unpaid, or N/A when it has no clear fee. */
export function CheaPill({ status }: { status: CheaPaymentStatus | undefined }) {
  if (status === 'NA') return <Pill tone="neutral">N/A</Pill>;
  return (
    <Pill tone={status === 'PAID' ? 'completed' : 'pending'}>
      {status === 'PAID' ? 'Paid' : 'Unpaid'}
    </Pill>
  );
}
