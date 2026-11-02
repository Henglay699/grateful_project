import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CO_STATUS_LABEL, CO_STATUSES, type CoRow, type CoStatus } from '@gs/shared';
import { useLookups } from '../../features/hooks';
import { useCoList } from '../../features/co';
import { TableState, ui } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { icons } from '../../layout/icons';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { CoRecordModal } from './CoRecordModal';
import { exportCoExcel } from './coExport';

const COLS = 13;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const TONE: Record<CoStatus, 'neutral' | 'pending' | 'progress' | 'completed'> = {
  PENDING: 'neutral',
  DRAFT: 'pending',
  SUBMIT: 'progress',
  APPROVE: 'completed',
};
/** "2026-07" → "07-2026", as the CO RECORD sheet shows the month. */
export const sheetMonth = (m: string) => `${m.slice(5, 7)}-${m.slice(0, 4)}`;

export function CoStatusPill({ status }: { status: CoStatus }) {
  return <Pill tone={TONE[status]}>{CO_STATUS_LABEL[status]}</Pill>;
}

/**
 * CO → CO Plans: the certificate of origin of every export invoice (the CO RECORD workbook),
 * by the invoice date's month. Qty, cartons, amount and dates come from the shipping plan;
 * the form, CO no. and date, and status are kept here. Filters sit in the URL.
 */
export function CoPlansPage() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<CoRow | null>(null);

  const to = params.get('to') ?? thisMonth();
  const from = params.get('from') ?? `${to.slice(0, 4)}-01`;
  const clientId = params.get('client') ?? '';
  const status = (params.get('status') ?? '') as CoStatus | '';
  const all = params.get('all') === '1';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: true });
  };

  const list = useCoList({
    from,
    to,
    clientId: clientId || undefined,
    status: status || undefined,
    all: all || undefined,
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({ pcs: t.pcs + r.pcs, ctns: t.ctns + r.ctns, amount: t.amount + r.amount }),
        { pcs: 0, ctns: 0, amount: 0 },
      ),
    [rows],
  );

  return (
    <section className="view active" id="view-co">
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>CO Plans — Certificates of Origin</h3>
          <div className={ui.toolbar}>
            <input
              className={ui.input}
              type="month"
              value={from}
              max={to}
              onChange={(e) => set({ from: e.target.value })}
              aria-label="From month"
            />
            <input
              className={ui.input}
              type="month"
              value={to}
              onChange={(e) =>
                set(
                  e.target.value && e.target.value < from
                    ? { to: e.target.value, from: e.target.value }
                    : { to: e.target.value },
                )
              }
              aria-label="To month"
            />
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => set({ client: e.target.value })}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={status}
              onChange={(e) => set({ status: e.target.value })}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {CO_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {CO_STATUS_LABEL[v]}
                </option>
              ))}
            </select>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => set({ all: e.target.checked ? '1' : null })}
              />
              All export invoices
            </label>
            <button
              type="button"
              className={ui.ghostBtn}
              disabled={!rows.length}
              onClick={() => void exportCoExcel(rows, from, to)}
            >
              {icons.download({ width: 14, height: 14 })} Excel
            </button>
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean seal-plan-table co-plan-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Form</th>
                <th>Mode</th>
                <th>Country</th>
                <th>CO No.</th>
                <th>Date CO</th>
                <th>Inv No.</th>
                <th>Date Inv</th>
                <th className="num">PCS</th>
                <th className="num">CNTS</th>
                <th className="num">Amount</th>
                <th>ATD Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={COLS}
                loading={list.isLoading}
                error={list.error}
                empty={rows.length === 0}
                emptyText={
                  all
                    ? 'No export invoices dated in these months.'
                    : 'No export invoices with a CO form in these months. Tick “All export invoices” to see the rest.'
                }
              />
              {rows.map((r) => (
                <tr
                  key={r.invoiceId}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td>{sheetMonth(r.month)}</td>
                  <td className="val-bold">{r.form ?? '-'}</td>
                  <td>{r.mode}</td>
                  <td>{r.country ?? '-'}</td>
                  <td>
                    {r.coNo ?? (
                      <span
                        style={{
                          color: 'var(--text-tertiary)',
                          display: 'inline-block',
                          maxWidth: 170,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          verticalAlign: 'bottom',
                        }}
                        title={
                          r.shipmentCoNo
                            ? `The shipment’s CO numbers: ${r.shipmentCoNo}`
                            : undefined
                        }
                      >
                        {r.shipmentCoNo ?? '-'}
                      </span>
                    )}
                  </td>
                  <td>{fmtDate(r.coDate)}</td>
                  <td className="val-bold">
                    <Link
                      to={`/plans/${r.shipmentId}`}
                      onClick={(e) => e.stopPropagation()}
                      title={`${r.reference} · ${r.clientName}`}
                    >
                      {r.invoiceNo}
                    </Link>
                  </td>
                  <td>{fmtDate(r.invoiceDate)}</td>
                  <td className="num">{fmtNum(r.pcs, 0)}</td>
                  <td className="num">{fmtNum(r.ctns, 0)}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td>{fmtDate(r.atd)}</td>
                  <td>
                    <CoStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={8}>
                    Total · {rows.length} invoice{rows.length === 1 ? '' : 's'}
                  </td>
                  <td className="num">{fmtNum(totals.pcs, 0)}</td>
                  <td className="num">{fmtNum(totals.ctns, 0)}</td>
                  <td className="num">{fmtMoney(totals.amount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {open && <CoRecordModal row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
