import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ClientRevenueRow } from '@gs/shared';
import { Bar } from '../../components/bklit/charts/bar';
import { BarChart } from '../../components/bklit/charts/bar-chart';
import { BarXAxis } from '../../components/bklit/charts/bar-x-axis';
import { useChartHover, useChartStable } from '../../components/bklit/charts/chart-context';
import { Grid } from '../../components/bklit/charts/grid';
import { ChartTooltip } from '../../components/bklit/charts/tooltip/chart-tooltip';
import '../../components/bklit/bklit.css';
import type { AnalyticsFilters } from '../../features/analytics';
import { useClientRevenue } from '../../features/analytics';
import { fmtDate, fmtMoney } from '../../lib/format';
import { ChartState, monthLabel } from '../dashboard/parts';
import s from './ClientRevenueCards.module.css';

/** Revenue mix (INV / DIS / DN) as three shades of the one accent colour. */
const shade = (pct: number) => `color-mix(in srgb, var(--accent-primary) ${pct}%, transparent)`;
const MIX = [
  { key: 'invRevenue', label: 'INV (Service)', color: shade(100) },
  { key: 'disTotal', label: 'Disbursements', color: shade(55) },
  { key: 'dnTotal', label: 'Debit notes', color: shade(25) },
] as const;
const COSTS = [
  { key: 'clearFee', label: 'Clear fee' },
  { key: 'thc', label: 'THC' },
  { key: 'commission', label: 'Commission' },
  { key: 'otherPay', label: 'Other' },
] as const;

/** Cards shown before "View All". */
const COLLAPSED = 2;

/** Ledger link for the card: a single month, a single year, or just the client. */
function ledgerLink(clientId: string, from?: string, to?: string) {
  const q = new URLSearchParams({ clientId });
  if (from && to && from.slice(0, 7) === to.slice(0, 7)) q.set('month', from.slice(0, 7));
  else if (from && to && from.slice(0, 4) === to.slice(0, 4)) q.set('year', from.slice(0, 4));
  return `/accounting/ledger?${q}`;
}

/** Net profit bars use the Shipment Summary's import cyan. */
const TREND_FILL = '#22D3EE';

/**
 * A faint full-height slot behind every month's bar, as on the Shipment Summary. Placed before
 * `<Bar>` so it draws underneath; the hovered month's slot darkens a little.
 */
export function BarSlots() {
  const { data, barScale, bandWidth, barXAccessor, innerHeight } = useChartStable();
  const on = useChartHover().hoveredBarIndex ?? null;
  if (!barScale || !bandWidth || !barXAccessor) return null;
  return (
    <g aria-hidden="true">
      {data.map((d, i) => (
        <rect
          key={i}
          x={barScale(barXAccessor(d)) ?? 0}
          y={0}
          width={bandWidth}
          height={innerHeight}
          rx={3}
          fill="var(--bg-subtle)"
          fillOpacity={on === i ? 0.9 : 0.5}
          style={{ transition: 'fill-opacity 0.15s ease-in-out' }}
        />
      ))}
    </g>
  );
}

/**
 * Net profit month by month as Bklit bars: hovering a month fades the others and shows its
 * profit and billed total. Months carry the year when the period spans more than one.
 */
function Trend({ rows }: { rows: ClientRevenueRow['monthly'] }) {
  const years = new Set(rows.map((m) => m.month.slice(0, 4))).size;
  const data = rows.map((m) => ({
    month: years > 1 ? `${monthLabel(m.month)} ’${m.month.slice(2, 4)}` : monthLabel(m.month),
    netProfit: Number(m.netProfit),
    revenue: Number(m.revenue),
  }));
  return (
    <div className={`bklit ${s.trend}`}>
      <BarChart
        data={data}
        xDataKey="month"
        aspectRatio="3.2 / 1"
        barGap={0.3}
        margin={{ top: 8, right: 0, bottom: 40, left: 0 }}
      >
        <Grid horizontal />
        <BarSlots />
        <Bar dataKey="netProfit" fill={TREND_FILL} lineCap={3} fadedOpacity={0.35} />
        <BarXAxis showAllLabels />
        <ChartTooltip
          rows={(p) => [
            { color: TREND_FILL, label: 'Net profit', value: fmtMoney(Number(p.netProfit)) },
            { color: 'var(--text-tertiary)', label: 'Billed', value: fmtMoney(Number(p.revenue)) },
          ]}
        />
      </BarChart>
    </div>
  );
}

function ClientCard({ r, link }: { r: ClientRevenueRow; link: string }) {
  const revenue = Number(r.revenue);
  const loss = Number(r.netProfit) < 0;
  return (
    <article className={s.card}>
      <header className={s.head}>
        <span className={s.badge}>{r.code}</span>
        <div className={s.who}>
          <h4 className={s.name} title={r.name}>
            {r.name}
          </h4>
          <div className={s.meta}>
            {r.entries} {r.entries === 1 ? 'entry' : 'entries'} · last invoice{' '}
            {fmtDate(r.lastInvDate)}
          </div>
        </div>
        {r.sharePct !== null && (
          <span className={s.share} title="Share of all clients' net profit">
            <b>{r.sharePct}%</b> of profit
          </span>
        )}
      </header>

      <div className={s.body}>
        {/* Left: the headline number and how it moved month to month. */}
        <div className={s.summary}>
          <div className={s.label}>Net profit</div>
          <div className={s.value} data-loss={loss || undefined}>
            {fmtMoney(r.netProfit)}
          </div>
          {r.marginPct !== null && (
            <div className={s.margin} data-loss={loss || undefined}>
              {r.marginPct}% margin
            </div>
          )}
          {r.monthly.length > 1 && <Trend rows={r.monthly} />}
        </div>

        {/* Right: where the money came from and where it went. */}
        <div className={s.detail}>
          <div className={s.mix}>
            <div className={s.mixBar} role="img" aria-label="Revenue mix">
              {MIX.map((m) => {
                const v = Number(r[m.key]);
                return v > 0 && revenue > 0 ? (
                  <span
                    key={m.key}
                    style={{ width: `${(v / revenue) * 100}%`, background: m.color }}
                    title={`${m.label}: ${fmtMoney(v)} (${((v / revenue) * 100).toFixed(1)}%)`}
                  />
                ) : null;
              })}
            </div>
          </div>
          <div className={s.cols}>
            <div>
              <h5 className={s.label}>Revenue</h5>
              <dl className={s.lines}>
                {MIX.map((m) => (
                  <div key={m.key}>
                    <dt>
                      <i style={{ background: m.color }} />
                      {m.label}
                    </dt>
                    <dd>{fmtMoney(r[m.key])}</dd>
                  </div>
                ))}
                <div className={s.total}>
                  <dt>Total billed</dt>
                  <dd>{fmtMoney(r.revenue)}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5 className={s.label}>Costs</h5>
              <dl className={s.lines}>
                {COSTS.map((c) => (
                  <div key={c.key}>
                    <dt>{c.label}</dt>
                    <dd>{fmtMoney(r[c.key])}</dd>
                  </div>
                ))}
                <div className={s.total}>
                  <dt>Total costs</dt>
                  <dd>{fmtMoney(r.costs)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <footer className={s.foot}>
        <span title="Collected for the tax office, not profit">
          VAT <b>{fmtMoney(r.vat)}</b>
        </span>
        <span className={s.dot} aria-hidden="true" />
        <span data-warn={r.unpaid > 0 || undefined} className={s.unpaid}>
          {r.unpaid} unpaid (Chea)
        </span>
        {r.unbilled > 0 && (
          <>
            <span className={s.dot} aria-hidden="true" />
            <span
              data-warn
              className={s.unpaid}
              title={`Costs ${fmtMoney(r.unbilledCosts)} not counted until billed`}
            >
              {r.unbilled} not billed yet
            </span>
          </>
        )}
        <Link to={link} className={s.open}>
          Open monthly
        </Link>
      </footer>
    </article>
  );
}

/** Analytics section: one card per client with every ledger figure for the period. */
export function ClientRevenueCards({
  filters,
  periodLabel,
}: {
  filters: AnalyticsFilters;
  periodLabel: string;
}) {
  const q = useClientRevenue(filters, true);
  const rows = q.data ?? [];
  const ignored = filters.direction || filters.transportMode;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, COLLAPSED);
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="an-section-title-row">
        <div>
          <h3>Client Revenue — Full Breakdown</h3>
          <div className="an-section-sub">
            Every revenue and cost line per client from the Monthly Ledger, by invoice date. Entries
            not billed yet are left out. {periodLabel}
            {ignored && ' · Import/export and transport filters don’t apply to the ledger.'}
          </div>
        </div>
        {rows.length > COLLAPSED && (
          <button type="button" className={s.toggle} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `View All (${rows.length})`}
          </button>
        )}
      </div>
      <ChartState
        loading={q.isLoading}
        error={q.error}
        empty={!rows.length}
        emptyText="No ledger entries in this period"
        height={160}
      >
        <div className={s.grid}>
          {shown.map((r) => (
            <ClientCard
              key={r.clientId}
              r={r}
              link={ledgerLink(r.clientId, filters.from, filters.to)}
            />
          ))}
        </div>
      </ChartState>
    </div>
  );
}
