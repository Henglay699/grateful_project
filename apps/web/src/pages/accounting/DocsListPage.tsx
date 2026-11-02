import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BILLING_DOC_TYPES, type BillingDocType, type BillingDocStatus } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDocs } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { Pager, TableState, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { Pill } from '../../components/StatusPill';
import { fmtDate, fmtMoney } from '../../lib/format';
import { NotFoundPage } from '../NotFoundPage';
import { NewCreditNoteModal } from '../creditnoted/NewCreditNoteModal';
import { BILLING_SECTION_PATHS, BillingSections } from './billingParts';
import { DOC_CONFIG } from './docConfig';
import b from './Billing.module.css';

export const DOC_STATUS_PILL: Record<
  BillingDocStatus,
  { tone: 'completed' | 'pending' | 'exception'; label: string }
> = {
  DRAFT: { tone: 'pending', label: 'Draft' },
  ISSUED: { tone: 'completed', label: 'Issued' },
  VOID: { tone: 'exception', label: 'Cancelled' },
};

/** `base` is where rows link to: /accounting/<type>, or /credit-noted for the broker tab. */
export function DocsListPage({ type, base }: { type: string; base?: string }) {
  if (!(BILLING_DOC_TYPES as readonly string[]).includes(type)) return <NotFoundPage />;
  return <DocsList type={type as BillingDocType} base={base ?? `/accounting/${type}`} />;
}

function DocsList({ type, base }: { type: BillingDocType; base: string }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const cfg = DOC_CONFIG[type];
  const isCn = type === 'credit-notes';
  const canWrite = can(isCn ? 'creditnotes:write' : 'accounting:write');
  const [picking, setPicking] = useState(false);
  const [params, setParams] = useSearchParams();
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    status: params.get('status') || undefined,
    clientId: params.get('clientId') || undefined,
    month: params.get('month') || undefined,
  };
  const list = useDocs(type, q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <section className="view active view-fill">
      {BILLING_SECTION_PATHS.includes(base) && <BillingSections className={b.sectionsTop} />}
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>{isCn ? 'Credit Noted' : `${cfg.title}s`}</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              {isCn
                ? 'Customs broker payment vouchers. Start one from a declaration; "Submit to Monthly" posts its total as the Clear Fee.'
                : 'Create from a ledger row (Monthly Ledger → open a row) to fill everything from the shipment, or start blank here.'}
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Number, customer, declare no…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <input
              type="month"
              className={ui.input}
              value={q.month ?? ''}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            />
            <select
              className={ui.input}
              value={q.clientId ?? ''}
              onChange={(e) => set('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
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
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="VOID">Cancelled</option>
            </select>
            {canWrite &&
              (isCn ? (
                <button type="button" className="new-shipment-btn" onClick={() => setPicking(true)}>
                  + New {cfg.title}
                </button>
              ) : (
                <Link to={`${base}/new`} className="new-shipment-btn">
                  + New {cfg.title}
                </Link>
              ))}
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>{cfg.numberField ? 'No.' : 'Declare No.'}</th>
                <th>Date</th>
                <th>Client</th>
                <th>{type === 'record-summaries' ? 'Declare No.' : 'Bill to'}</th>
                <th>Declare No.</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={7}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={`No ${cfg.title.toLowerCase()}s yet.`}
              />
              {list.data?.data.map((d) => (
                <tr
                  key={d.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => navigate(`${base}/${d.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/${d.id}`)}
                >
                  <td className="val-bold">{d.number ?? d.declareNo ?? '-'}</td>
                  <td>{fmtDate(d.date)}</td>
                  <td>{d.clientCode}</td>
                  <td>{d.billTo ?? '-'}</td>
                  <td>{d.declareNo ?? '-'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(d.total)}</td>
                  <td>
                    <Pill tone={DOC_STATUS_PILL[d.status].tone}>
                      {DOC_STATUS_PILL[d.status].label}
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
      {picking && <NewCreditNoteModal base={base} onClose={() => setPicking(false)} />}
    </section>
  );
}
