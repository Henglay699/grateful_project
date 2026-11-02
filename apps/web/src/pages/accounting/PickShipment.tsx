import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import type { BillingDocType } from '@gs/shared';
import { useEligible } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, ui } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { DOC_CONFIG } from './docConfig';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** The last day of a YYYY-MM month (a monthly-fee document's date). */
const monthEnd = (m: string) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};

/**
 * A new tax invoice, DIS or debit note starts from a shipment: choose the client, the month
 * and the Declare No. Only approved shipments (Chea payment checked, so they have their
 * number) without that document yet are listed; everything else fills in from the shipment.
 */
export function PickShipment({ type }: { type: 'tax-invoices' | 'disbursements' | 'debit-notes' }) {
  const cfg = DOC_CONFIG[type as BillingDocType];
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const lookups = useLookups();
  const list = useEligible(type);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState('');
  const rows = (list.data ?? []).filter(
    (r) => (!clientId || r.clientId === clientId) && (!month || r.invDate.startsWith(month)),
  );
  const clients = (lookups.data?.clients ?? []).filter((c) =>
    (list.data ?? []).some((r) => r.clientId === c.id),
  );
  // Months with shipments waiting, plus this month and last (for a monthly-fee document).
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' })
    .format(new Date())
    .slice(0, 7);
  const prev = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 2, 1))
    .toISOString()
    .slice(0, 7);
  const months = [
    ...new Set([...(list.data ?? []).map((r) => r.invDate.slice(0, 7)), prev, now]),
  ].sort();
  const go = (query: Record<string, string>) => {
    const next = new URLSearchParams(query);
    const back = params.get('back');
    if (back) next.set('back', back);
    navigate(`/accounting/${type}/new?${next.toString()}`);
  };

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div className={backRow}>
            <BackLink to={params.get('back') ?? `/accounting/${type}`} label="the previous page" />
            <div className="create-header-title">New {cfg.title.toLowerCase()}</div>
            <div className="create-header-desc">
              Choose the shipment. Its number, date, rate and details fill in automatically.
            </div>
          </div>
        </div>
        <ErrorBanner error={list.error} />
        <div className="cx-card">
          <div className="form-fields-grid">
            <div className="form-field-group">
              <label htmlFor="pk-client">Client</label>
              <select
                id="pk-client"
                className="form-select-box"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group">
              <label htmlFor="pk-month">Month</label>
              <select
                id="pk-month"
                className="form-select-box"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                <option value="">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="pk-declare">Declare No.</label>
              <select
                id="pk-declare"
                className="form-select-box"
                value=""
                onChange={(e) => e.target.value && go({ recordId: e.target.value })}
              >
                <option value="">
                  {list.isLoading
                    ? 'Loading…'
                    : rows.length
                      ? `Choose… (${rows.length} ready)`
                      : 'No approved shipment is waiting for one'}
                </option>
                {rows.map((r) => (
                  <option key={r.recordId} value={r.recordId}>
                    {r.declareNo} · {r.clientCode} · {r.number} · {fmtDate(r.invDate)}
                    {r.hbl && r.hbl !== 'NON' ? ` · ${r.hbl}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className={ui.dialogSub} style={{ marginTop: 12 }}>
            A shipment is listed once its Chea payment is checked and until its{' '}
            {cfg.title.toLowerCase()} is made.
            {clientId && month && (
              <>
                {' '}
                Not for a shipment (e.g. a monthly fee)?{' '}
                <button
                  type="button"
                  className="filter-mini-link"
                  onClick={() => go({ clientId, date: monthEnd(month) })}
                >
                  Start one for {monthLabel(month)}
                </button>
                .
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
