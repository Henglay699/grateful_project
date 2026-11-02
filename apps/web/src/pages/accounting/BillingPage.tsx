import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BillingOverviewRow } from '@gs/shared';
import { useBillingOverview } from '../../features/billing';
import { ErrorBanner, TableState } from '../../components/ui';
import { StatTile, StatTiles } from '../../components/StatTiles';
import { fmtMoney, fmtNum } from '../../lib/format';
import { BillingSections, MonthStepper, StagePill } from './billingParts';
import { isMonth, monthName, thisMonth } from './billingUi';
import b from './Billing.module.css';

/**
 * Client Billing: every client with shipments, documents or payments in the month, and how
 * far its month-end billing has got (invoiced → statements → paid). Open a client to work on it.
 */
export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : thisMonth();
  const overview = useBillingOverview(month);
  const t = overview.data?.totals;
  const rows = overview.data?.rows ?? [];
  const open = (r: BillingOverviewRow) =>
    navigate(`/accounting/billing/${r.clientId}?month=${month}`);

  return (
    <section className="view active view-fill">
      <div className="card">
        <div className={b.bar}>
          <MonthStepper
            month={month}
            onChange={(m) => setParams({ month: m }, { replace: true })}
          />
          <span className={b.barHint}>
            A shipment counts in the month of its Monthly Ledger invoice date.
          </span>
          <BillingSections className={b.sectionsEnd} />
        </div>
        <ErrorBanner error={overview.error} />
        {t && (
          <StatTiles columns={7}>
            <StatTile label="Clients" value={fmtNum(t.clients)} />
            <StatTile label="Shipments" value={fmtNum(t.shipments)} />
            <StatTile
              label="Not invoiced"
              value={fmtNum(t.notInvoiced)}
              tone={t.notInvoiced > 0 ? 'danger' : undefined}
              tooltip="Shipments without a tax invoice"
            />
            <StatTile
              label="Drafts to issue"
              value={fmtNum(t.drafts)}
              tone={t.drafts > 0 ? 'warning' : undefined}
            />
            <StatTile label="Billed" value={fmtMoney(t.billed)} tone="info" />
            <StatTile label="Received" value={fmtMoney(t.received)} tone="paid" />
            <StatTile
              label="Balance due"
              value={fmtMoney(t.balance)}
              tone={
                Number(t.balance) > 0 ? 'warning' : Number(t.billed) > 0 ? 'success' : undefined
              }
            />
          </StatTiles>
        )}
        <div className="plans-table-scroll" style={{ maxHeight: 'none' }}>
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Client</th>
                <th className={b.num}>Shipments</th>
                <th>Documents</th>
                <th className={b.num}>Invoices &amp; DIS</th>
                <th className={b.num}>Debit notes</th>
                <th className={b.num}>Received</th>
                <th className={b.num}>Balance due</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={9}
                loading={overview.isLoading}
                error={null}
                empty={false}
                emptyText=""
              />
              {rows.map((r) => (
                <tr
                  key={r.clientId}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => open(r)}
                  onKeyDown={(e) => e.key === 'Enter' && open(r)}
                >
                  <td>
                    <div className={b.clientCell}>
                      <span className={b.code}>{r.clientCode}</span>
                      <span className={b.clientName}>{r.clientName}</span>
                    </div>
                  </td>
                  <td className={b.num}>{r.shipments}</td>
                  <td>
                    <div className={b.flags}>
                      {(r.issued > 0 || r.manual === 0) && (
                        <span className={b.flag}>{r.issued} issued</span>
                      )}
                      {r.manual > 0 && (
                        <span
                          className={b.flag}
                          title="Numbers typed in the Monthly Ledger: documents made outside the system"
                        >
                          {r.issued > 0 ? '· ' : ''}
                          {r.manual} in ledger
                        </span>
                      )}
                      {r.drafts > 0 && (
                        <span className={b.flag} data-tone="warning">
                          · {r.drafts} draft{r.drafts === 1 ? '' : 's'}
                        </span>
                      )}
                      {r.missing['tax-invoices'] > 0 && (
                        <span className={b.flag} data-tone="danger">
                          · {r.missing['tax-invoices']} not invoiced
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={b.num}>{fmtMoney(r.invoiceTotal)}</td>
                  <td className={b.num}>{fmtMoney(r.debitNoteTotal)}</td>
                  <td className={b.num}>{fmtMoney(r.received)}</td>
                  <td className={`${b.num} ${Number(r.balance) > 0 ? b.due : b.strong}`}>
                    {fmtMoney(r.balance)}
                  </td>
                  <td>
                    <StagePill stage={r.stage} />
                  </td>
                  <td className={b.chevron} aria-hidden="true">
                    ›
                  </td>
                </tr>
              ))}
              {t && rows.length > 1 && (
                <tr className={b.totalRow}>
                  <td>Total</td>
                  <td className={b.num}>{t.shipments}</td>
                  <td />
                  <td className={b.num}>
                    {fmtMoney(rows.reduce((s, r) => s + Number(r.invoiceTotal), 0))}
                  </td>
                  <td className={b.num}>
                    {fmtMoney(rows.reduce((s, r) => s + Number(r.debitNoteTotal), 0))}
                  </td>
                  <td className={b.num}>{fmtMoney(t.received)}</td>
                  <td className={b.num}>{fmtMoney(t.balance)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
          {overview.data && rows.length === 0 && (
            <div className={b.emptyState}>
              <b>No billing in {monthName(month)}</b>
              Shipments show here once they have a Monthly Ledger entry dated this month.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
