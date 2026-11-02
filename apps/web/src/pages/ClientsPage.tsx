import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useClients } from '../features/hooks';
import { Pill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { fmtDate, fmtMoney } from '../lib/format';
import { ClientFormModal } from './clients/ClientFormModal';

export const CLIENT_STATUS_PILL = {
  ACTIVE: { tone: 'completed', label: 'Active' },
  ONBOARDING: { tone: 'pending', label: 'Onboarding' },
  INACTIVE: { tone: 'exception', label: 'Inactive' },
} as const;

export function ClientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const page = Number(params.get('page') ?? 1);
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const list = useClients({
    page,
    pageSize: Number(params.get('pageSize') ?? 50),
    q: q || undefined,
    status: status || undefined,
    sort: 'name',
  });
  const showProfit = can('accounting:read');
  const cols = showProfit ? 7 : 6;

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <section className="view active view-fill">
      <div className="card">
        <div className="card-header-row">
          <h3>Registered Shipping Clients</h3>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Search name or code…"
              defaultValue={q}
              aria-label="Search clients"
              onChange={(e) => set('q', e.target.value.trim())}
            />
            <select
              className={ui.input}
              value={status}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ONBOARDING">Onboarding</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            {can('clients:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setAdding(true)}>
                + Add Client
              </button>
            )}
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Company</th>
                <th>Country</th>
                <th style={{ textAlign: 'center' }}>Active Runs</th>
                <th style={{ textAlign: 'center' }}>Total Shipments</th>
                <th>Last ETA</th>
                {showProfit && <th style={{ textAlign: 'right' }}>Net Profit (YTD)</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  q || status
                    ? 'No clients match these filters.'
                    : 'No clients yet. Add your first client to start recording shipments.'
                }
              />
              {list.data?.data.map((c) => (
                <tr
                  key={c.id}
                  className="plans-row-clickable"
                  onClick={() => navigate(`/clients/${c.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/clients/${c.id}`)}
                >
                  <td>
                    <div className="val-bold">{c.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 700 }}>
                      {c.code}
                    </div>
                  </td>
                  <td>{c.countryName}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{c.activeShipments}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{c.shipmentCount}</td>
                  <td>{fmtDate(c.lastEta)}</td>
                  {showProfit && (
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color:
                          Number(c.netProfitYtd) < 0
                            ? 'var(--status-exception-fg)'
                            : 'var(--text-primary)',
                      }}
                    >
                      {fmtMoney(c.netProfitYtd)}
                    </td>
                  )}
                  <td>
                    <Pill tone={CLIENT_STATUS_PILL[c.status].tone}>
                      {CLIENT_STATUS_PILL[c.status].label}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          />
        )}
      </div>
      {adding && (
        <ClientFormModal
          onClose={() => setAdding(false)}
          onSaved={(id) => navigate(`/clients/${id}`)}
        />
      )}
    </section>
  );
}
