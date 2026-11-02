import { Link, useSearchParams } from 'react-router-dom';
import { PAYMENT_METHOD_LABEL, type OfficialReceipt } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useReceipts, useVoidReceipt } from '../../features/billing';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Pager, TableState, ui } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { SearchBox } from '../../components/SearchBox';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { BillingSections } from './billingParts';
import { periodCode, STATEMENT_TITLE } from './billingUi';
import b from './Billing.module.css';
import { PrintLink } from '../../components/PrintLink';

/**
 * Every official receipt (payments against the clients' account statements). Receipts are
 * recorded from Client Billing; this is the register to find, print or cancel one.
 */
export function ReceiptsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const voidReceipt = useVoidReceipt();
  const [params, setParams] = useSearchParams();
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    clientId: params.get('clientId') || undefined,
    status: params.get('status') || undefined,
    month: params.get('month') || undefined,
  };
  const list = useReceipts(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const doVoid = async (r: OfficialReceipt) => {
    const reason = window.prompt(
      `Cancel receipt ${r.receiptNo} (${fmtMoney(r.amount)})? It keeps its number, and the amount becomes due again on the statement.\n\nReason (kept in the audit log):`,
    );
    if (!reason) return;
    await voidReceipt.mutateAsync({ id: r.id, reason });
    toast(`Receipt ${r.receiptNo} cancelled.`);
  };

  return (
    <section className="view active view-fill">
      <BillingSections className={b.sectionsTop} />
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>Official Receipts</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              Payments received against the account statements. Record a payment from{' '}
              <Link
                to="/accounting/billing"
                style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
              >
                Client Billing
              </Link>
              .
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Receipt no., client, reference…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <input
              type="month"
              className={ui.input}
              value={q.month ?? ''}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month received"
              title="Month received"
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
              <option value="">Issued &amp; cancelled</option>
              <option value="ISSUED">Issued</option>
              <option value="VOID">Cancelled</option>
            </select>
          </div>
        </div>
        <ErrorBanner error={voidReceipt.error} />
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Date</th>
                <th>Client</th>
                <th>For</th>
                <th>Method</th>
                <th className={b.num}>Amount</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={8}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText="No receipts for these filters."
              />
              {list.data?.data.map((r) => (
                <tr key={r.id}>
                  <td className="val-bold">{r.receiptNo}</td>
                  <td>{fmtDate(r.receiptDate)}</td>
                  <td>
                    <span className={b.code}>{r.clientCode}</span>
                  </td>
                  <td>
                    <Link
                      to={`/accounting/billing/${r.clientId}?month=${r.month}`}
                      style={{ color: 'var(--text-primary)', fontWeight: 700 }}
                    >
                      {periodCode(r.month)}
                    </Link>
                    <span className={b.small}>{STATEMENT_TITLE[r.kind]}</span>
                  </td>
                  <td>
                    {PAYMENT_METHOD_LABEL[r.paymentMethod]}
                    {r.paymentRef && <span className={b.small}>{r.paymentRef}</span>}
                  </td>
                  <td className={`${b.num} ${b.strong}`}>{fmtMoney(r.amount)}</td>
                  <td>
                    <Pill tone={r.status === 'VOID' ? 'exception' : 'completed'}>
                      {r.status === 'VOID' ? 'Cancelled' : 'Issued'}
                    </Pill>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {r.status !== 'VOID' && (
                      <>
                        <PrintLink className={b.linkBtn} href={`/print/receipts/${r.id}`}>
                          Print
                        </PrintLink>
                        {can('accounting:write') && (
                          <button
                            type="button"
                            className={b.linkBtn}
                            data-danger="true"
                            style={{ marginLeft: 12 }}
                            onClick={() => void doVoid(r)}
                          >
                            Cancel
                          </button>
                        )}
                      </>
                    )}
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
    </section>
  );
}
