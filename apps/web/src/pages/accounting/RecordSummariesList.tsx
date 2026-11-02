import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BillingDocListItem } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDocs } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Pager } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { DirectionToggle } from '../../components/DirectionToggle';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { REVIEW } from './CreditNotesReview';
import { RecordSummaryInboxTable, RecordSummaryInboxToggle } from './RecordSummaryInbox';
import { RecordSummaryPackMenu } from './RecordSummaryPackMenu';
import { packFilters, STATUS_FILTER } from './recordSummaryPack';
// Same look as Credit Noted and Accounting → Chea Payments.
import s from './CreditNotesReview.module.css';

const TYPE = 'record-summaries' as const;
/** Draft / Submitted / Reviewed or Approved by accounting / Revised (sent back) / Cancelled. */
const statusOf = (d: BillingDocListItem): { label: string; cls: string } =>
  d.status === 'VOID'
    ? { label: 'Cancelled', cls: s.void! }
    : d.status === 'DRAFT'
      ? d.reviewStatus === 'REVISED'
        ? { label: 'Revised', cls: s.revised! }
        : { label: 'Draft', cls: s.unchecked! }
      : d.reviewStatus && d.reviewStatus !== 'UNCHECKED'
        ? REVIEW[d.reviewStatus]
        : { label: 'Submitted', cls: s.neutral! };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'TRUCK', RAIL: 'RAIL' };

/**
 * Sidebar → Record Summary (Operations), laid out like Credit Noted: one card with the
 * filters, the table and the pager; a row opens the editor at `base`/:id. Accounting checks
 * the submitted ones in Accounting → Expense to Clients.
 */
export function RecordSummariesList({ base }: { base: string }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) || undefined;
  const filters = {
    q: get('q'),
    clientId: get('clientId'),
    direction: get('direction'),
    monthOfYear: get('month'),
    year: get('year'),
  };
  const statusKey = get('status');
  const statusFilter = statusKey ? STATUS_FILTER[statusKey] : undefined;
  const q = {
    ...filters,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    status: statusFilter?.status,
    review: statusFilter?.review,
  };
  const list = useDocs(TYPE, q);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const filtered = !!(q.q || q.clientId || q.direction || q.monthOfYear || q.year || q.status);
  const open = (id: string) => navigate(`${base}/${id}`);
  // ?view=inbox: the table shows accounting's messages instead of the summaries.
  const inboxView = params.get('view') === 'inbox';
  const toggleInbox = () => set('view', inboxView ? '' : 'inbox');

  return (
    <section className={`view active ${s.page} ${s.fill}`}>
      <ErrorBanner error={list.error} />
      <div className={s.card}>
        <div className={s.toolbar}>
          <RecordSummaryInboxToggle active={inboxView} onClick={toggleInbox} />
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
                value={statusFilter ? statusKey : ''}
                onChange={(e) => set('status', e.target.value)}
                aria-label="Status"
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_FILTER).map(([k, f]) => (
                  <option key={k} value={k}>
                    {f.label}
                  </option>
                ))}
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
                value={q.monthOfYear ?? ''}
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
          {can('recordsummaries:write') && (
            <button type="button" className={s.newBtn} onClick={() => navigate(`${base}/new`)}>
              {icons.plus({ width: 15, height: 15 })} New Record Summary
            </button>
          )}
          {!inboxView && (
            <RecordSummaryPackMenu
              filters={packFilters(params)}
              count={list.data?.meta.total ?? 0}
            />
          )}
        </div>

        <div className={s.scroll}>
          {inboxView ? (
            <RecordSummaryInboxTable base={base} search={q.q} />
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Declare No.</th>
                  <th>Date</th>
                  <th>Invoice No.</th>
                  <th>Quantity</th>
                  <th>Port</th>
                  <th>Shipment by</th>
                  <th className={s.num}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading && (
                  <tr>
                    <td colSpan={11} className={s.empty}>
                      Loading…
                    </td>
                  </tr>
                )}
                {list.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={11} className={s.empty}>
                      <span className={s.emptyIcon}>
                        {icons.recordsummary({ width: 22, height: 22 })}
                      </span>
                      <b>
                        {filtered ? 'Nothing matches these filters' : 'No record summaries yet'}
                      </b>
                      <span>
                        {filtered
                          ? 'Try another client, month or status.'
                          : 'Start one with “New Record Summary” and pick the declaration.'}
                      </span>
                    </td>
                  </tr>
                )}
                {list.data?.data.map((d, i) => (
                  <tr
                    key={d.id}
                    tabIndex={0}
                    onClick={() => open(d.id)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && e.target === e.currentTarget && open(d.id)
                    }
                  >
                    <td className={s.cn}>{(q.page - 1) * q.pageSize + i + 1}</td>
                    <td>
                      <span className={s.client}>{d.clientName.toUpperCase()}</span>
                    </td>
                    <td>
                      {d.direction && (
                        <span className={s.type}>
                          <i className={d.direction === 'IMPORT' ? s.imp : s.exp} />
                          {d.direction === 'IMPORT' ? 'Import' : 'Export'}
                        </span>
                      )}
                    </td>
                    <td className={s.mono}>{d.billTo ?? d.declareNo ?? '-'}</td>
                    <td>{d.date}</td>
                    <td className={s.mono}>{d.invNo ?? '-'}</td>
                    <td>{d.quantityText ?? '-'}</td>
                    <td>{d.port?.toUpperCase() ?? '-'}</td>
                    <td>{d.transportMode ? (MODE[d.transportMode] ?? d.transportMode) : '-'}</td>
                    <td className={`${s.num} ${s.fee}`}>{fmtMoney(d.total)}</td>
                    <td>
                      <span className={`${s.statusPill} ${statusOf(d).cls}`}>
                        {statusOf(d).label}
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
    </section>
  );
}
