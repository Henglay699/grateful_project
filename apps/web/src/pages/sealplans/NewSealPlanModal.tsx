import { useState } from 'react';
import type { SealPlanShipmentOption } from '@gs/shared';
import { useSealPlanShipments } from '../../features/hooks';
import { ErrorBanner, Modal } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { fmtDate } from '../../lib/format';
// Same look as the Credit Noted declaration picker.
import s from '../creditnoted/NewCreditNoteModal.module.css';

const COLUMNS =
  'minmax(130px, 1fr) minmax(200px, 1.7fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(110px, 0.9fr) minmax(150px, 1.1fr) 120px';

/** "MRKU8974303 +2" and "3 × 40HQ". */
function containers(o: SealPlanShipmentOption) {
  if (!o.containerNo) return <b>—</b>;
  return (
    <>
      <b>
        {o.containerNo}
        {o.containerCount > 1 && <span className={s.more}> +{o.containerCount - 1}</span>}
      </b>
      {o.containerSize && (
        <span>
          {o.containerCount} × {o.containerSize}
        </span>
      )}
    </>
  );
}

function planned(o: SealPlanShipmentOption) {
  if (!o.plannedCount) return <span className={s.none}>None yet</span>;
  return (
    <span className={s.has}>
      {o.plannedCount >= o.containerCount ? 'Planned' : `${o.plannedCount} of ${o.containerCount}`}
    </span>
  );
}

/** Pick the export CY/CY shipment a new Seal Plan fills from, or start blank. */
export function NewSealPlanModal({
  onPick,
  onBlank,
  onClose,
}: {
  onPick: (shipmentId: string) => void;
  onBlank: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const list = useSealPlanShipments(q);
  const rows = (list.data ?? []).filter(
    (o) => !(hideDone && o.containerCount > 0 && o.plannedCount >= o.containerCount),
  );
  const grid = { gridTemplateColumns: COLUMNS, minWidth: 1060 };

  return (
    <Modal
      title="New Seal Plan"
      sub="Choose an export CY/CY shipment. Factory, SO no., port, vessel, ETD and containers fill in from it."
      onClose={onClose}
      width={1500}
    >
      <div className={s.toolbar}>
        <div className={s.search}>
          <SearchBox
            placeholder="Shipment ref, SO no, container, client, vessel…"
            onChange={(e) => setQ(e.target.value.trim())}
            aria-label="Search shipments"
          />
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
          />
          Hide ones already planned
        </label>
      </div>
      <ErrorBanner error={list.error} />

      <div className={s.table} role="list" aria-label="Export shipments">
        <div className={`${s.grid} ${s.head}`} style={grid} aria-hidden="true">
          <span>Shipment</span>
          <span>Client</span>
          <span>SO No.</span>
          <span>Vessel</span>
          <span>Port</span>
          <span>Containers</span>
          <span>Seal plan</span>
        </div>
        {list.isLoading && <div className={s.empty}>Loading…</div>}
        {!list.isLoading && rows.length === 0 && (
          <div className={s.empty}>
            {list.data?.length
              ? 'No shipments match these filters.'
              : 'No export CY/CY shipments match.'}
          </div>
        )}
        {rows.map((o) => (
          <div key={o.id} role="listitem">
            <button
              type="button"
              className={`${s.grid} ${s.row}`}
              style={grid}
              onClick={() => onPick(o.id)}
              aria-label={`Use shipment ${o.reference} for ${o.clientName}`}
            >
              <span className={s.cell}>
                <b className={s.declare}>{o.reference}</b>
                <span>ETD {fmtDate(o.etd)}</span>
              </span>
              <span className={`${s.cell} ${s.client}`}>
                <span className={s.code}>{o.clientCode}</span>
                <b title={o.clientName}>{o.clientName}</b>
              </span>
              <span className={s.cell}>
                <b>{o.bookingNo ?? '—'}</b>
              </span>
              <span className={s.cell}>
                <b title={o.vesselName ?? undefined}>{o.vesselName ?? '—'}</b>
              </span>
              <span className={s.cell}>
                <b>{o.portName ?? '—'}</b>
              </span>
              <span className={s.cell}>{containers(o)}</span>
              <span className={s.cell}>{planned(o)}</span>
            </button>
          </div>
        ))}
      </div>

      <div className={s.footer}>
        <span className={s.count}>
          {list.data
            ? `${rows.length} of the latest ${list.data.length} export CY/CY shipments. Search to find older ones.`
            : ''}
        </span>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          onClick={onBlank}
          title="Start an empty Seal Plan without a shipping plan"
        >
          Start new
        </button>
      </div>
    </Modal>
  );
}
