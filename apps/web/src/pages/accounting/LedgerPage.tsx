import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { vatLabel, type LedgerRow } from '@gs/shared';
import { useLedger } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { Pager, TableState, ui } from '../../components/ui';
import { CheaPill, Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtNum } from '../../lib/format';
import { icons } from '../../layout/icons';
import { SearchBox } from '../../components/SearchBox';
import { StatTile, StatTiles } from '../../components/StatTiles';
import { LedgerModal } from './LedgerModal';
import { ClearFeePayments } from './ClearFeePayments';
import l from './LedgerPage.module.css';

const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()).slice(0, 7);
const m = (v: string) => fmtNum(v, 2);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** 2026-08-22 → Saturday (the date is a plain calendar day, so read it as UTC). */
const weekday = (iso: string | null | undefined) =>
  iso ? (WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()] ?? '-') : '-';
const docNo = (
  r: LedgerRow,
  type: 'tax-invoices' | 'disbursements' | 'debit-notes',
  value: string | null,
) => {
  const d = r.documents.find((x) => x.type === type && x.number === value && x.status !== 'VOID');
  if (!value) return '-';
  return d ? (
    <Link
      to={`/accounting/${type}/${d.id}`}
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
    >
      {value}
    </Link>
  ) : (
    value
  );
};

export function LedgerPage() {
  const toast = useToast();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<LedgerRow | null>(null);
  // Period: a month (default) or a whole year (?year=2026, Jan–Dec).
  const year = params.get('year');
  const month = year ? '' : (params.get('month') ?? thisMonth());
  const currentYear = Number(thisMonth().slice(0, 4));
  const years = Array.from({ length: 8 }, (_, i) => String(currentYear + 1 - i));
  const q = {
    month: month || undefined,
    year: year || undefined,
    clientId: params.get('clientId') || undefined,
    cheaStatus: params.get('chea') || undefined,
    q: params.get('q') || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
  };
  const list = useLedger(q);
  const t = list.data?.totals;
  // "VAT 10%" while every row shown has the same percent; just "VAT" across a rate change.
  const vatRates = new Set((list.data?.data ?? []).map((r) => Number(r.vatRate)));
  const vatHead = vatRates.size === 1 ? vatLabel([...vatRates][0]) : 'VAT';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v || k === 'month') next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const setPeriod = (p: { month: string } | { year: string }) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if ('year' in p) {
      next.delete('month');
      next.set('year', p.year);
    } else {
      next.delete('year');
      next.set('month', p.month);
    }
    setParams(next, { replace: true });
  };

  return (
    <section className={`view active ${l.fill}`}>
      <div className="card">
        <div className={l.filters}>
          <select
            className={ui.input}
            value={year ? 'year' : 'month'}
            onChange={(e) =>
              e.target.value === 'year'
                ? setPeriod({ year: (month || thisMonth()).slice(0, 4) })
                : setPeriod({
                    // Back to this month if it's the year being viewed, else that year's January.
                    month: year && !thisMonth().startsWith(year) ? `${year}-01` : thisMonth(),
                  })
            }
            aria-label="View by"
          >
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
          {year ? (
            <select
              className={ui.input}
              value={year}
              onChange={(e) => setPeriod({ year: e.target.value })}
              aria-label="Year"
            >
              {(years.includes(year) ? years : [year, ...years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="month"
              className={ui.input}
              value={month}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            />
          )}
          <span className={l.divider} aria-hidden="true" />
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
            value={q.cheaStatus ?? ''}
            onChange={(e) => set('chea', e.target.value)}
            aria-label="Chea payment"
          >
            <option value="">Paid &amp; unpaid</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PAID">Paid</option>
          </select>
          <SearchBox
            className={l.search}
            placeholder="Search declare, INV or DN no…"
            defaultValue={q.q}
            onChange={(e) => set('q', e.target.value.trim())}
            aria-label="Search"
          />
          <div className={l.actions}>
            <button
              type="button"
              className={l.export}
              onClick={() =>
                downloadFile('/accounting/ledger/export.xlsx', {
                  month: month || undefined,
                  year: year || undefined,
                  clientId: q.clientId,
                }).catch(() => toast('Export failed.'))
              }
            >
              {icons.download({})}
              Export Excel
            </button>
          </div>
        </div>
        {t && (
          <StatTiles columns={8}>
            <StatTile label="Entries" value={fmtNum(t.rows)} />
            <StatTile label="INV (Service revenue)" value={`$${m(t.invRevenue)}`} />
            <StatTile label="Disbursements" value={`$${m(t.disTotal)}`} />
            <StatTile label="Debit notes" value={`$${m(t.dnTotal)}`} />
            <StatTile label={`${vatHead} (Not profit)`} value={`$${m(t.vat)}`} />
            <StatTile
              label="Net profit"
              value={`$${m(t.netProfit)}`}
              tone={Number(t.netProfit) < 0 ? 'danger' : 'success'}
              span={2}
              tooltip="(INV + DIS + DN) − (Clear fee + THC + CM + Other)"
            />
            <StatTile
              label="Unpaid (Chea)"
              value={t.unpaid}
              tone={t.unpaid > 0 ? 'warning' : undefined}
              pressed={q.cheaStatus === 'UNPAID'}
              onClick={() => set('chea', q.cheaStatus === 'UNPAID' ? '' : 'UNPAID')}
              tooltip={q.cheaStatus === 'UNPAID' ? 'Show all' : 'Show unpaid only'}
            />
          </StatTiles>
        )}
        <div className={`plans-table-scroll ${l.tableScroll}`}>
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Chea Payment</th>
                <th>Port Number</th>
                <th>Port Code</th>
                <th>Port Name</th>
                <th>Declare</th>
                <th>Date</th>
                <th>Client</th>
                <th>INV</th>
                <th>Disbursement</th>
                <th>DN</th>
                <th>Date (INV)</th>
                <th style={{ textAlign: 'right' }}>Exchange Rate</th>
                <th>Weekday</th>
                <th style={{ textAlign: 'right' }}>Clear Fee</th>
                <th style={{ textAlign: 'right' }}>THC</th>
                <th style={{ textAlign: 'right' }}>Other Pay</th>
                <th style={{ textAlign: 'right' }}>CM</th>
                <th style={{ textAlign: 'right' }}>INV (Revenue)</th>
                <th style={{ textAlign: 'right' }}>DIS (Formula)</th>
                <th style={{ textAlign: 'right' }}>{vatHead}</th>
                <th style={{ textAlign: 'right' }}>DN Total</th>
                <th style={{ textAlign: 'right' }}>Net Profit</th>
                <th>Mark</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={23}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText="No ledger entries for these filters."
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td>
                    <CheaPill status={r.cheaStatus} />
                  </td>
                  <td>{r.portNo ?? '-'}</td>
                  <td>{r.portCode ?? '-'}</td>
                  <td>{r.portName ?? '-'}</td>
                  <td className="val-bold">{r.declareNo}</td>
                  <td>{fmtDate(r.declareDate)}</td>
                  <td>{r.clientCode}</td>
                  <td>
                    {r.invNo ? (
                      docNo(r, 'tax-invoices', r.invNo)
                    ) : (
                      <Pill tone="pending">Not invoiced</Pill>
                    )}
                  </td>
                  <td>{docNo(r, 'disbursements', r.disNo)}</td>
                  <td>{docNo(r, 'debit-notes', r.dnNo)}</td>
                  <td>{fmtDate(r.invDate)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtNum(r.exchangeRate, 0)}</td>
                  <td>{weekday(r.invDate)}</td>
                  {[
                    r.clearFee,
                    r.thc,
                    r.otherPay,
                    r.commission,
                    r.invRevenue,
                    r.disTotal,
                    r.vat,
                    r.dnTotal,
                  ].map((v, i) => (
                    <td key={i} style={{ textAlign: 'right' }}>
                      {m(v)}
                    </td>
                  ))}
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 700,
                      color:
                        Number(r.netProfit) < 0
                          ? 'var(--status-exception-fg)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {m(r.netProfit)}
                  </td>
                  <td className={l.mark} title={r.mark ?? undefined}>
                    {r.mark || '-'}
                  </td>
                </tr>
              ))}
              {t && t.rows > 0 && (
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={13}>Total</td>
                  {[
                    t.clearFee,
                    t.thc,
                    t.otherPay,
                    t.commission,
                    t.invRevenue,
                    t.disTotal,
                    t.vat,
                    t.dnTotal,
                    t.netProfit,
                  ].map((v, i) => (
                    <td key={i} style={{ textAlign: 'right' }}>
                      {m(v)}
                    </td>
                  ))}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          >
            {month && <ClearFeePayments month={month} />}
          </Pager>
        )}
      </div>
      {open && <LedgerModal row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
