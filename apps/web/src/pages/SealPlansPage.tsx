import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useSealPlans } from '../features/hooks';
import { TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { fmtDate } from '../lib/format';
import { NewSealPlanModal } from './sealplans/NewSealPlanModal';
import { SealPlanModal, type SealPlanTarget } from './sealplans/SealPlanModal';
import { SealPlansMenu } from './sealplans/SealPlansMenu';
import { fmtTare, groupByMonth, monthHeading, MONTHS } from './sealplans/sealPlanFormat';

const COLS = 21;
const dash = (v: string | null) => v || '-';

/**
 * Seal Plan — container shipment schedule: every container of an export shipment, by the month
 * it is loaded, with its seals, vessel, trucking and depot (the SEAL PLAN spreadsheet).
 */
export function SealPlansPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<SealPlanTarget | null>(null);
  const [picking, setPicking] = useState(false);

  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const month = params.get('month') ?? '';
  const clientId = params.get('clientId') ?? '';
  const q = params.get('q') ?? '';
  const list = useSealPlans({
    year,
    month: month || undefined,
    clientId: clientId || undefined,
    q: q || undefined,
  });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const groups = useMemo(() => groupByMonth(list.data ?? []), [list.data]);

  return (
    <section className="view active" id="view-sealplans">
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>Seal Plan — Container Shipment Schedule</h3>
          <div className={ui.toolbar}>
            <select
              className={ui.input}
              value={year}
              onChange={(e) =>
                set('year', e.target.value === String(thisYear) ? '' : e.target.value)
              }
              aria-label="Year"
            >
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={month}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            >
              <option value="">All months</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => set('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <SearchBox
              placeholder="Search container, seal, SO no…"
              defaultValue={q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search seal plans"
            />
            {can('sealplans:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setPicking(true)}>
                + New Seal Plan
              </button>
            )}
            <SealPlansMenu
              filters={{ year: String(year), month, clientId, q }}
              count={list.data?.length ?? 0}
            />
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean seal-plan-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>GS Inv No.</th>
                <th>Client</th>
                <th>Carrier</th>
                <th>SO No.</th>
                <th>Port</th>
                <th>Destination</th>
                <th>Container No.</th>
                <th>Size</th>
                <th>Carrier Seal</th>
                <th>Customs Seal</th>
                <th>Vessel</th>
                <th style={{ textAlign: 'right' }}>Tare Weight</th>
                <th>ETD</th>
                <th>Truck By</th>
                <th>Driver Phone</th>
                <th>Truck No.</th>
                <th>Deliver To</th>
                <th>Date</th>
                <th>Depot</th>
                <th>Other</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={COLS}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.length === 0}
                emptyText={
                  q || clientId || month
                    ? 'No containers match these filters.'
                    : `No seal plans in ${year} yet. Containers of export CY/CY Shipping Plans appear here; “+ New Seal Plan” adds one.`
                }
              />
              {groups.map((g) => (
                <Fragment key={g.month}>
                  <tr className="seal-plan-month">
                    <td colSpan={COLS}>
                      <span>
                        {monthHeading(g.month)} · {g.rows.length} container
                        {g.rows.length === 1 ? '' : 's'}
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr
                      key={r.id ?? `${r.shipmentId}:${r.containerNo}`}
                      className="plans-row-clickable"
                      tabIndex={0}
                      onClick={() => setOpen({ kind: 'row', row: r })}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen({ kind: 'row', row: r })}
                    >
                      <td>{i + 1}</td>
                      <td style={r.invNo ? undefined : { color: 'var(--text-tertiary)' }}>
                        {r.invNo ?? 'TBA'}
                      </td>
                      <td className="val-bold" title={r.clientName}>
                        {r.clientCode}
                      </td>
                      <td>{dash(r.carrier)}</td>
                      <td>{dash(r.bookingNo)}</td>
                      <td>{dash(r.portName)}</td>
                      <td>{r.destination ?? dash(r.destinationCountry)}</td>
                      <td className="val-bold">{r.containerNo}</td>
                      <td>{dash(r.size)}</td>
                      <td>{dash(r.linerSeal)}</td>
                      <td>{dash(r.customsSeal)}</td>
                      <td>{dash(r.vesselName)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtTare(r.tareWeightKg)}</td>
                      <td>{fmtDate(r.etd)}</td>
                      <td>{dash(r.truckBy)}</td>
                      <td>{dash(r.driverPhone)}</td>
                      <td>{dash(r.truckNo)}</td>
                      <td>{dash(r.deliverTo)}</td>
                      <td>{fmtDate(r.loadingDate)}</td>
                      <td>{dash(r.depot)}</td>
                      <td>{dash(r.other)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {picking && (
        <NewSealPlanModal
          onPick={(shipmentId) => {
            setPicking(false);
            setOpen({ kind: 'shipment', shipmentId });
          }}
          onBlank={() => {
            setPicking(false);
            setOpen({ kind: 'blank' });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {open && <SealPlanModal target={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
