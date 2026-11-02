import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { QuotationStatus } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useQuotations, useQuotationTemplates } from '../features/admin';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { Pill } from '../components/StatusPill';
import { fmtDate } from '../lib/format';

export const QUOTE_STATUS: Record<
  QuotationStatus,
  { tone: 'pending' | 'progress' | 'completed' | 'exception'; label: string }
> = {
  DRAFT: { tone: 'pending', label: 'Draft' },
  SENT: { tone: 'progress', label: 'Sent' },
  ACCEPTED: { tone: 'completed', label: 'Accepted' },
  SUPERSEDED: { tone: 'exception', label: 'Superseded' },
};

export function QuotationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const templates = useQuotationTemplates();
  const [params, setParams] = useSearchParams();
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    status: params.get('status') || undefined,
    templateKey: params.get('template') || undefined,
    latestOnly: params.get('all') ? undefined : 'true',
  };
  const list = useQuotations(q);
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        if (k !== 'page') n.delete('page');
        return n;
      },
      { replace: true },
    );
  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <h3>Quotation Builder</h3>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Quote no., customer…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <select
              className={ui.input}
              value={q.templateKey ?? ''}
              onChange={(e) => set('template', e.target.value)}
              aria-label="Service category"
            >
              <option value="">All services</option>
              {templates.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={q.status ?? ''}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {Object.entries(QUOTE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <label
              className="filter-check-item"
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              <input
                type="checkbox"
                checked={!!params.get('all')}
                onChange={(e) => set('all', e.target.checked ? '1' : '')}
              />{' '}
              Show old versions
            </label>
            {can('quotations:write') && (
              <Link to="/quotations/new" className="new-shipment-btn">
                + New Quotation
              </Link>
            )}
          </div>
        </div>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Quote No.</th>
              <th>Service</th>
              <th>To</th>
              <th>Date</th>
              <th style={{ textAlign: 'center' }}>Rows</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={6}
              loading={list.isLoading}
              error={list.error}
              empty={list.data?.data.length === 0}
              emptyText="No quotations yet."
            />
            {list.data?.data.map((r) => (
              <tr
                key={r.id}
                className="plans-row-clickable"
                tabIndex={0}
                onClick={() => navigate(`/quotations/${r.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/quotations/${r.id}`)}
              >
                <td className="val-bold">
                  {r.quoteNo}
                  {r.version > 1 ? ` v${r.version}` : ''}
                </td>
                <td>{r.templateLabel}</td>
                <td>{r.clientName ?? r.toName}</td>
                <td>{fmtDate(r.quoteDate)}</td>
                <td style={{ textAlign: 'center' }}>{r.lineCount}</td>
                <td>
                  <Pill tone={QUOTE_STATUS[r.status].tone}>{QUOTE_STATUS[r.status].label}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          />
        )}
      </div>
    </section>
  );
}
