import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BillingDocStatus, CreditNoteReviewRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCreditNoteList } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Pager } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { DirectionToggle } from '../../components/DirectionToggle';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { NewCreditNoteModal } from './NewCreditNoteModal';
import { InboxTable, InboxToggle } from './Inbox';
import { cnSeq } from './seq';
import { PackMenu } from './PackMenu';
import { packFilters } from './creditNotePack';
import { REVIEW } from '../accounting/CreditNotesReview';
// Same look as Accounting → Chea Payments.
import s from '../accounting/CreditNotesReview.module.css';

const BASE = '/credit-noted';
const STATUS: Record<BillingDocStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: s.unchecked! },
  ISSUED: { label: 'Submitted', cls: s.checked! },
  VOID: { label: 'Discarded', cls: s.void! },
};
/** Once submitted, accounting's check (Reviewed / Approved) replaces "Submitted". */
const statusOf = (r: CreditNoteReviewRow): { label: string; cls: string } =>
  r.status === 'DRAFT' && r.reviewStatus === 'REVISED'
    ? { label: 'Revised', cls: s.revised! }
    : r.status === 'ISSUED' && r.reviewStatus !== 'UNCHECKED'
      ? REVIEW[r.reviewStatus]
      : STATUS[r.status];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'LAND', RAIL: 'RAIL' };

/** Sidebar → Credit Noted: the broker's vouchers, drafts and submitted. */
export function CreditNotedList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [picking, setPicking] = useState(false);
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) || undefined;
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    clientId: get('clientId'),
    direction: get('direction'),
    q: get('q'),
    month: get('month'),
    year: get('year'),
    status: get('status'),
  };
  const list = useCreditNoteList(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const filtered = !!(q.clientId || q.direction || q.q || q.month || q.year || q.status);
  const open = (id: string) => navigate(`${BASE}/${id}`);
  // ?view=inbox: the table shows accounting's messages instead of the credit notes.
  const inboxView = params.get('view') === 'inbox';
  const toggleInbox = () => set('view', inboxView ? '' : 'inbox');

  return (
    <section className={`view active ${s.page} ${s.fill}`}>
      <ErrorBanner error={list.error} />
      <div className={s.card}>
        <div className={s.toolbar}>
          <InboxToggle active={inboxView} onClick={toggleInbox} />
          <SearchBox
            className={s.search}
            placeholder="Search declare no."
            defaultValue={q.q}
            onChange={(e) => set('q', e.target.value.trim())}
            aria-label="Search by declare no."
          />
          {!inboxView && (
            <>
              <select
                className={s.select}
                value={q.status ?? ''}
                onChange={(e) => set('status', e.target.value)}
                aria-label="Status"
              >
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="ISSUED">Submitted</option>
                <option value="VOID">Discarded</option>
              </select>
              <select
                className={s.select}
                value={q.clientId ?? ''}
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
              <DirectionToggle value={q.direction} onChange={(d) => set('direction', d)} />
              <select
                className={s.select}
                value={q.month ?? ''}
                onChange={(e) => set('month', e.target.value)}
                aria-label="Month"
              >
                <option value="">All months</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className={s.select}
                value={q.year ?? ''}
                onChange={(e) => set('year', e.target.value)}
                aria-label="Year"
              >
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              {filtered && (
                <button
                  type="button"
                  className={s.clear}
                  onClick={() => setParams({}, { replace: true })}
                >
                  Clear
                </button>
              )}
            </>
          )}
          {can('creditnotes:write') && (
            <button type="button" className={s.newBtn} onClick={() => setPicking(true)}>
              {icons.plus({ width: 15, height: 15 })} New Credit Noted
            </button>
          )}
          {!inboxView && (
            <PackMenu filters={packFilters(params)} count={list.data?.meta.total ?? 0} />
          )}
        </div>

        <div className={s.scroll}>
          {inboxView ? (
            <InboxTable search={q.q} />
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Declare No.</th>
                  <th>Date</th>
                  <th>Quantity</th>
                  <th>Port</th>
                  <th>Shipment by</th>
                  <th className={s.num}>Clear fee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading && (
                  <tr>
                    <td colSpan={10} className={s.empty}>
                      Loading…
                    </td>
                  </tr>
                )}
                {list.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={10} className={s.empty}>
                      <span className={s.emptyIcon}>
                        {icons.creditnote({ width: 22, height: 22 })}
                      </span>
                      <b>{filtered ? 'Nothing matches these filters' : 'No credit notes yet'}</b>
                      <span>
                        {filtered
                          ? 'Try another client, month or status.'
                          : 'Start one with “New Credit Noted” and pick the declaration.'}
                      </span>
                    </td>
                  </tr>
                )}
                {list.data?.data.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => open(r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && open(r.id)}
                  >
                    <td className={s.cn}>{cnSeq(r.number)}</td>
                    <td>
                      <span className={s.client}>{r.clientName.toUpperCase()}</span>
                    </td>
                    <td>
                      {r.direction && (
                        <span className={s.type}>
                          <i className={r.direction === 'IMPORT' ? s.imp : s.exp} />
                          {r.direction === 'IMPORT' ? 'Import' : 'Export'}
                        </span>
                      )}
                    </td>
                    <td className={s.mono}>{r.declareNo ?? '-'}</td>
                    <td>{r.date}</td>
                    <td>{r.quantityText ?? '-'}</td>
                    <td>{r.port ?? '-'}</td>
                    <td>{r.transportMode ? MODE[r.transportMode] : '-'}</td>
                    <td className={`${s.num} ${s.fee}`}>{fmtMoney(r.total)}</td>
                    <td>
                      <span className={`${s.statusPill} ${statusOf(r).cls}`}>
                        {statusOf(r).label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!inboxView && list.data && list.data.meta.total > 0 && (
          <div className={s.foot}>
            <Pager
              {...list.data.meta}
              onPage={(p) => set('page', String(p))}
              onPageSize={(n) => set('pageSize', String(n))}
            />
          </div>
        )}
      </div>
      {picking && <NewCreditNoteModal base={BASE} onClose={() => setPicking(false)} />}
    </section>
  );
}
