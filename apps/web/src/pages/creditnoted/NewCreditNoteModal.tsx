import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreditNoteDeclaration } from '@gs/shared';
import { useCreditNoteDeclarations } from '../../features/accounting';
import { ErrorBanner, Modal } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { fmtDate, fmtNum } from '../../lib/format';
import { cnSeq } from './seq';
import s from './NewCreditNoteModal.module.css';

type Flow = 'ALL' | 'IMPORT' | 'EXPORT';
const MODE = { SEA: 'Sea', AIR: 'Air', ROAD: 'Road', RAIL: 'Rail' } as const;

/** "MRKU8974303 +2" and "3 × 40HC". */
function containers(d: CreditNoteDeclaration) {
  if (!d.containerNo) return null;
  return (
    <>
      <b>
        {d.containerNo}
        {d.containerCount > 1 && <span className={s.more}> +{d.containerCount - 1}</span>}
      </b>
      {d.containerSize && (
        <span>
          {d.containerCount} × {d.containerSize}
        </span>
      )}
    </>
  );
}

/** Pick the customs declaration a new Credit Noted is for; the form fills from its shipment. */
export function NewCreditNoteModal({ base, onClose }: { base: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [flow, setFlow] = useState<Flow>('ALL');
  const [hideDone, setHideDone] = useState(false);
  const list = useCreditNoteDeclarations(q, true);
  const rows = (list.data ?? []).filter(
    (d) => (flow === 'ALL' || d.direction === flow) && !(hideDone && d.creditNoteNo),
  );

  return (
    <Modal
      title="New Credit Noted"
      sub="Choose the declaration. Shipper, port, container, house bill and weights fill in from the shipment."
      onClose={onClose}
      width={1800}
    >
      <div className={s.toolbar}>
        <div className={s.search}>
          <SearchBox
            placeholder="Declare no, shipment ref, client, house bill…"
            onChange={(e) => setQ(e.target.value.trim())}
            aria-label="Search declarations"
          />
        </div>
        <div className={s.segment} role="radiogroup" aria-label="Import or export">
          {(['ALL', 'IMPORT', 'EXPORT'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={flow === f}
              onClick={() => setFlow(f)}
            >
              {f === 'ALL' ? 'All' : f === 'IMPORT' ? 'Import' : 'Export'}
            </button>
          ))}
        </div>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
          />
          Hide ones with a credit note
        </label>
      </div>
      <ErrorBanner error={list.error} />

      <div className={s.table} role="list" aria-label="Declarations">
        <div className={`${s.grid} ${s.head}`} aria-hidden="true">
          <span>Declaration</span>
          <span>Client</span>
          <span>Shipment</span>
          <span>Port</span>
          <span>House bill</span>
          <span>Containers</span>
          <span>Weight</span>
          <span>Type</span>
          <span>Credit note</span>
        </div>
        {list.isLoading && <div className={s.empty}>Loading…</div>}
        {!list.isLoading && rows.length === 0 && (
          <div className={s.empty}>
            {list.data?.length ? 'No declarations match these filters.' : 'No declarations match.'}
          </div>
        )}
        {rows.map((d) => (
          <div key={d.id} role="listitem">
            <button
              type="button"
              className={`${s.grid} ${s.row}`}
              onClick={() => navigate(`${base}/new?declarationId=${d.id}`)}
              aria-label={`Use declaration ${d.declareNo} for ${d.clientName}`}
            >
              <span className={s.cell}>
                <b className={s.declare}>{d.declareNo}</b>
                <span>{fmtDate(d.declareDate)}</span>
              </span>
              <span className={`${s.cell} ${s.client}`}>
                <span className={s.code}>{d.clientCode}</span>
                <b title={d.clientName}>{d.clientName}</b>
              </span>
              <span className={s.cell}>
                <b>{d.shipmentReference}</b>
                <span>
                  {MODE[d.transportMode]}
                  {d.loadType !== 'NONE' ? ` · ${d.loadType}` : ''}
                </span>
              </span>
              <span className={s.cell}>
                <b>{d.portName ?? '—'}</b>
              </span>
              <span className={s.cell}>
                <b>{d.hblNo ?? '—'}</b>
              </span>
              <span className={s.cell}>{containers(d) ?? <b>—</b>}</span>
              <span className={s.cell}>
                <b>{Number(d.grossWeightKg) ? `${fmtNum(d.grossWeightKg, 1)} kg` : '—'}</b>
                {Number(d.cbm) > 0 && <span>{fmtNum(d.cbm, 2)} CBM</span>}
              </span>
              <span className={s.cell}>
                <span className={d.direction === 'IMPORT' ? s.imp : s.exp}>
                  {d.direction === 'IMPORT' ? 'Import' : 'Export'}
                </span>
              </span>
              <span className={s.cell}>
                {d.creditNoteNo ? (
                  <span className={s.has} title="This declaration already has a credit note">
                    Has No. {cnSeq(d.creditNoteNo)}
                  </span>
                ) : (
                  <span className={s.none}>None yet</span>
                )}
              </span>
            </button>
          </div>
        ))}
      </div>

      <div className={s.footer}>
        <span className={s.count}>
          {list.data
            ? `${rows.length} of the latest ${list.data.length} declarations. Search to find older ones.`
            : ''}
        </span>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          onClick={() => navigate(`${base}/new`)}
          title="Start an empty Credit Noted without a declaration"
        >
          Start new
        </button>
      </div>
    </Modal>
  );
}
