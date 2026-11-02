import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { AccountRow, MonthlyVolumeRow, ProfitSummary } from '@gs/shared';
import {
  useAccounts,
  useByCountry,
  useForwarders,
  useLiveConsignments,
  usePorts,
} from '../../features/analytics';
import { useAuth } from '../../auth/AuthProvider';
import { ShipmentStatusPill } from '../../components/StatusPill';
import { fmtDate, fmtMoney } from '../../lib/format';
import {
  CardDropdown,
  CardToggle,
  ChartState,
  CLIENT_COLORS,
  barGradient,
  changePct,
  dash,
  MIN_YEAR_BASE,
  MONTHS,
  MONTHS_LONG,
  monthLabel,
  niceMax,
} from './parts';
import { InvoiceNos } from '../plans/columns';
import { WorldMap } from './WorldMap';
import { SingleClientVolume } from './SingleClientVolume';
import acc from './AccountsCard.module.css';
import { fi } from '../plans/formIcons';
export { KpiRow } from './KpiRow';

/* ------------------------------ Shipment Summary ------------------------------ */

function SummaryTooltip({
  active,
  payload,
  year,
}: TooltipProps<number, string> & { year: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as {
    month: string;
    total: number;
    imports: number;
    exports: number;
    future: boolean;
  };
  return (
    <div className={dash.tooltip}>
      <div>
        {MONTHS_LONG[Number(p.month.slice(5, 7)) - 1]} {year}
      </div>
      {p.future ? (
        <div style={{ fontWeight: 600 }}>Not available yet</div>
      ) : (
        <>
          <div>
            Shipments <b>{p.total}</b>
          </div>
          <div style={{ fontWeight: 600 }}>
            Import {p.imports} · Export {p.exports}
          </div>
        </>
      )}
    </div>
  );
}

/** Shipment Summary bar colours: imports bright cyan, exports a deeper teal stacked on top. */
const SS_IMPORT = '#22D3EE';
const SS_EXPORT = '#0E7490';

export function ShipmentSummaryCard({
  year,
  monthly,
  currentMonth,
  loading,
  error,
}: {
  year: number;
  monthly: MonthlyVolumeRow[];
  currentMonth: string;
  loading: boolean;
  error: unknown;
}) {
  const [selected, setSelected] = useState(
    currentMonth.startsWith(String(year)) ? currentMonth : `${year}-01`,
  );
  // Months after the current one haven't happened yet: an empty dashed slot instead of a bar.
  const data = monthly.map((m) => ({
    ...m,
    label: monthLabel(m.month),
    future: !!currentMonth && m.month > currentMonth,
  }));
  const sel = data.find((d) => d.month === selected && !d.future);
  const empty = !loading && data.every((d) => d.total === 0);
  const top = niceMax(Math.max(1, ...data.map((d) => d.total)));
  const pick = (i: number | undefined) => {
    const hit = i === undefined ? undefined : data[i];
    if (hit && !hit.future) setSelected(hit.month);
  };
  return (
    <div className="shipment-summary-card ga-chart">
      <div className="ss-header-row">
        <h3>Shipment Summary of {year}</h3>
        <div className={dash.ssTools}>
          <span className={dash.ssLegend}>
            <i style={{ background: SS_IMPORT }} /> Import
            <i style={{ background: SS_EXPORT }} /> Export
          </span>
          <CardDropdown
            label="Highlight month"
            value={selected}
            onChange={setSelected}
            options={data.map((d) => ({
              value: d.month,
              label: `${MONTHS_LONG[Number(d.month.slice(5, 7)) - 1]}: ${d.future ? '—' : d.total}`,
              disabled: d.future,
            }))}
          />
        </div>
      </div>
      <div className="ss-chart-wrap">
        <ChartState loading={loading} error={error} empty={empty} height={250}>
          <div className={dash.chartBox} style={{ minHeight: 250 }}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={data}
                margin={{ top: 20, right: 8, bottom: 0, left: -12 }}
                barCategoryGap="28%"
                onClick={(e) => pick(e?.activeTooltipIndex)}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border-subtle)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={(p: {
                    x: number;
                    y: number;
                    index: number;
                    payload: { value: string };
                  }) => {
                    const d = data[p.index];
                    const on = d?.month === sel?.month;
                    return (
                      <text
                        x={p.x}
                        y={p.y + 12}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={on ? 800 : 700}
                        fill={on ? '#22D3EE' : 'var(--text-tertiary)'}
                        fillOpacity={d?.future ? 0.45 : 1}
                      >
                        {p.payload.value}
                      </text>
                    );
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, top]}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }}
                />
                <Tooltip
                  content={<SummaryTooltip year={year} />}
                  cursor={{ fill: 'var(--bg-subtle)', fillOpacity: 0.6 }}
                />
                <Bar
                  dataKey="imports"
                  stackId="ss"
                  fill={SS_IMPORT}
                  maxBarSize={30}
                  radius={[3, 3, 0, 0]}
                  // Every month's full-height slot: a faint track, dashed for months to come.
                  background={(raw: unknown) => {
                    const p = raw as {
                      x: number;
                      y: number;
                      width: number;
                      height: number;
                      index: number;
                    };
                    return (
                      <rect
                        key={`slot-${p.index}`}
                        x={p.x}
                        y={p.y}
                        width={p.width}
                        height={p.height}
                        rx={5}
                        fill={data[p.index]?.future ? 'none' : 'var(--bg-subtle)'}
                        fillOpacity={0.5}
                        stroke={data[p.index]?.future ? 'var(--border-strong)' : 'none'}
                        strokeOpacity={0.5}
                        strokeDasharray="4 4"
                      />
                    );
                  }}
                >
                  {data.map((d) => (
                    <Cell key={d.month} fillOpacity={!sel || d.month === sel.month ? 1 : 0.55} />
                  ))}
                </Bar>
                <Bar
                  dataKey="exports"
                  stackId="ss"
                  fill={SS_EXPORT}
                  maxBarSize={30}
                  radius={[3, 3, 0, 0]}
                >
                  {data.map((d) => (
                    <Cell key={d.month} fillOpacity={!sel || d.month === sel.month ? 1 : 0.55} />
                  ))}
                  <LabelList
                    dataKey="total"
                    content={(p) => {
                      const d = data[Number(p.index)];
                      if (!d || d.future || !d.total) return null;
                      const on = d.month === sel?.month;
                      return (
                        <text
                          x={Number(p.x) + Number(p.width) / 2}
                          y={Number(p.y) - 6}
                          textAnchor="middle"
                          fontSize={on ? 12 : 10}
                          fontWeight={on ? 800 : 700}
                          fill={on ? '#22D3EE' : 'var(--text-secondary)'}
                        >
                          {d.total}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Net profit (accounting roles) ------------------------------ */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * Eases a figure from what it last showed (0 at first, unless `fromZero` is off) to
 * `target` over `ms`; jumps straight there when the viewer asks for reduced motion.
 */
function useCountUp(target: number, ms = 800, fromZero = true) {
  const still =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(still || !fromZero ? target : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (still) {
      from.current = target;
      setShown(target);
      return;
    }
    const a = from.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const v = a + (target - a) * (1 - (1 - p) ** 3);
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, still]);
  return shown;
}

/** A number that eases from its last value to each new one (shows its first value as is). */
function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  return <>{format(useCountUp(value, 600, false))}</>;
}

/** The Profit card's period for January to its last month (a whole-year Overview). */
const YEAR_TO_DATE = 'ytd';

/**
 * Net profit for the Overview's period: the figure, the change on the period before, and
 * its split by client. A single month compares with the month before; a whole-year
 * Overview shows January to date against the same stretch of the year before.
 */
export function ProfitCard({
  profit,
  fullYear = false,
  lastYearShipments,
}: {
  profit: ProfitSummary;
  fullYear?: boolean;
  /** Shipments over the same stretch last year: too few and January to date gets no change. */
  lastYearShipments?: number;
}) {
  const month = fullYear ? YEAR_TO_DATE : profit.currentMonth;
  const whole = month === YEAR_TO_DATE;
  const toDate = (m: string) => m <= profit.currentMonth;
  const inPeriod = (m: string) => (whole ? toDate(m) : m === month);
  const lastShort = MONTHS[Number(profit.currentMonth.slice(5, 7)) - 1];
  const periodName = whole ? `Jan – ${lastShort} ${profit.year}` : monthName(month);

  const idx = profit.monthly.findIndex((m) => m.month === month);
  const value = whole
    ? profit.monthly
        .filter((m) => toDate(m.month))
        .reduce((t, m) => t + Math.round(Number(m.netProfit) * 100), 0) / 100
    : Number(profit.monthly[idx]?.netProfit ?? 0);
  const prevMonth = idx > 0 ? profit.monthly[idx - 1]! : null;
  // January's "month before" is last December: only known for the current month.
  const prevValue = whole
    ? Number(profit.lastYearToDate)
    : prevMonth
      ? Number(prevMonth.netProfit)
      : month === profit.currentMonth
        ? Number(profit.lastMonth)
        : null;
  const thinYear = whole && lastYearShipments !== undefined && lastYearShipments < MIN_YEAR_BASE;
  const ch = prevValue === null || thinYear ? null : changePct(value, prevValue);
  const prevLabel = whole
    ? `Jan – ${lastShort} ${profit.year - 1}`
    : prevMonth
      ? MONTH_NAMES[Number(prevMonth.month.slice(5, 7)) - 1]
      : 'December';

  // Each client's profit over the period (their months added up for January to date).
  const rows = Object.values(
    profit.byClientMonthly
      .filter((c) => inPeriod(c.month))
      .reduce<Record<string, ProfitSummary['byClientMonthly'][number]>>((acc, c) => {
        const had = acc[c.clientId];
        acc[c.clientId] = had
          ? { ...had, netProfit: String(Number(had.netProfit) + Number(c.netProfit)) }
          : c;
        return acc;
      }, {}),
  ).sort((a, b) => Number(b.netProfit) - Number(a.netProfit));
  const sum = rows.reduce((t, c) => t + Number(c.netProfit), 0);
  const clients = rows.map((c) => ({
    ...c,
    pct: sum ? Math.round((Number(c.netProfit) / sum) * 1000) / 10 : 0,
  }));
  const positive = clients.filter((c) => Number(c.netProfit) > 0);
  const colorOf = (c: (typeof clients)[number]) =>
    CLIENT_COLORS[clients.indexOf(c) % CLIENT_COLORS.length];
  // Hovering a slice or a legend name highlights that client; slices also show a tooltip
  // at the cursor with the client's profit and share.
  const [hoverId, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const hovered = clients.find((c) => c.clientId === hoverId) ?? null;
  const unbilledRows = profit.unbilled.filter((u) => inPeriod(u.month));
  const unbilled = unbilledRows.length
    ? {
        entries: unbilledRows.reduce((t, u) => t + u.entries, 0),
        costs: unbilledRows.reduce((t, u) => t + Number(u.costs), 0),
      }
    : undefined;

  // The year's months so far, as mini columns beside the figure (hover shows one).
  const trend = profit.monthly.filter((m) => toDate(m.month));
  const trendMax = Math.max(1, ...trend.map((m) => Math.abs(Number(m.netProfit))));
  const [trendHover, setTrendHover] = useState<string | null>(null);
  const trendShown = trend.find((m) => m.month === trendHover);
  // The legend lists the top clients; the rest fold into one line.
  const LEGEND_MAX = 4;
  const shownClients = clients.slice(0, LEGEND_MAX);
  const moreClients = clients.length - shownClients.length;
  const counted = useCountUp(value);

  return (
    <div className={`rc-card ga-revenue ${dash.profitCard}`}>
      <div className={dash.profitHead}>
        <div className="rc-header">
          <div className="rc-title">Total Net Profit</div>
          <div className="rc-subtitle">
            {periodName} · all clients
            {!whole && ` · ${profit.year} to date ${fmtMoney(profit.total)}`}
          </div>
        </div>
      </div>
      <div className={`rc-top-hero ${dash.profitHero}`}>
        <div className="rc-metric-left">
          <div
            className="rc-total-amount"
            style={value < 0 ? { color: 'var(--status-exception-fg)' } : undefined}
          >
            {fmtMoney(Math.round(counted * 100) / 100)}
          </div>
          <div className="rc-trend-pill">
            {!thinYear && (
              <span
                className="rc-pill-badge"
                style={
                  ch && !ch.up
                    ? {
                        background: 'var(--status-exception-bg)',
                        color: 'var(--status-exception-fg)',
                      }
                    : undefined
                }
              >
                {ch?.text ?? '—'}
              </span>
            )}
            <span className="rc-pill-text">
              {thinYear ? `not enough data in ${profit.year - 1}` : `vs ${prevLabel}`}
            </span>
          </div>
          {unbilled && (
            <div
              className={dash.mutedNote}
              title="Ledger entries with costs but no INV, DIS or DN yet. They count once billed."
            >
              Provisional: {unbilled.entries} not billed yet ({fmtMoney(unbilled.costs)} costs not
              counted)
            </div>
          )}
        </div>
        {trend.length > 1 && (
          <div className={dash.profitTrend} onMouseLeave={() => setTrendHover(null)}>
            <div className={dash.profitTrendBars}>
              {trend.map((m, i) => {
                const v = Number(m.netProfit);
                return (
                  <span
                    key={m.month}
                    data-now={
                      (whole ? m.month === profit.currentMonth : m.month === month) || undefined
                    }
                    data-neg={v < 0 || undefined}
                    data-dim={(trendHover && trendHover !== m.month) || undefined}
                    style={
                      {
                        '--h': `${Math.max(6, (Math.abs(v) / trendMax) * 100)}%`,
                        '--d': `${i * 40}ms`,
                      } as CSSProperties
                    }
                    onMouseEnter={() => setTrendHover(m.month)}
                  />
                );
              })}
            </div>
            <div className={dash.profitTrendCap}>
              {trendShown ? (
                <>
                  {MONTHS[Number(trendShown.month.slice(5, 7)) - 1]}{' '}
                  <b>{fmtMoney(trendShown.netProfit)}</b>
                </>
              ) : (
                `Jan – ${lastShort} by month`
              )}
            </div>
          </div>
        )}
      </div>
      <div className={`rc-main-body ${dash.profitBody}`}>
        <div className={`rc-donut-wrapper ${dash.profitPie}`}>
          {positive.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={positive.map((c) => ({ name: c.code, v: Number(c.netProfit) }))}
                  dataKey="v"
                  innerRadius={44}
                  outerRadius={64}
                  cornerRadius={3}
                  paddingAngle={positive.length > 1 ? 2 : 0}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  animationBegin={100}
                  animationDuration={800}
                  animationEasing="ease-out"
                  activeIndex={hovered ? positive.indexOf(hovered) : undefined}
                  activeShape={(p: React.ComponentProps<typeof Sector>) => (
                    <Sector {...p} outerRadius={Number(p.outerRadius) + 5} />
                  )}
                  onMouseMove={(_, i, e) => {
                    setHover(positive[i]!.clientId);
                    setTip({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                >
                  {positive.map((c) => (
                    <Cell
                      key={c.clientId}
                      fill={colorOf(c)}
                      fillOpacity={hovered && hovered !== c ? 0.35 : 1}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : null}
          <div
            className={`rc-donut-center-text ${dash.profitCenter}`}
            key={hovered?.clientId ?? ''}
          >
            {hovered ? (
              <>
                <span className="pct">
                  {hovered.pct}
                  <small>%</small>
                </span>
                <span className="tag">{hovered.code}</span>
              </>
            ) : (
              <>
                <span className="pct">{clients.length}</span>
                <span className="tag">{clients.length === 1 ? 'Client' : 'Clients'}</span>
              </>
            )}
          </div>
        </div>
        <ul className={dash.profitLegend}>
          {shownClients.map((c, i) => (
            <li
              key={c.clientId}
              data-dim={(hovered && hovered !== c) || undefined}
              data-on={hovered === c || undefined}
              style={
                {
                  '--c': colorOf(c),
                  '--w': `${Math.max(0, c.pct)}%`,
                  '--d': `${150 + i * 80}ms`,
                } as CSSProperties
              }
              onMouseEnter={() => setHover(c.clientId)}
              onMouseLeave={() => setHover(null)}
            >
              <div className={dash.profitLegendRow}>
                <i />
                <span className={dash.profitLegendName}>{c.name}</span>
                <b data-neg={Number(c.netProfit) < 0 || undefined}>{fmtMoney(c.netProfit)}</b>
              </div>
              <div className={dash.profitLegendBar}>
                <span />
              </div>
            </li>
          ))}
          {moreClients > 0 && (
            <span className={dash.mutedNote}>
              + {moreClients} more {moreClients === 1 ? 'client' : 'clients'}
            </span>
          )}
          {!clients.length && (
            <span className={dash.mutedNote}>No ledger entries in {periodName} yet.</span>
          )}
        </ul>
        {hovered && tip && (
          <div className={dash.profitTip} style={{ left: tip.x + 14, top: tip.y + 14 }}>
            <div className={dash.profitTipName}>
              <i style={{ background: colorOf(hovered) }} />
              {hovered.name}
            </div>
            <div className={dash.profitTipRow}>
              <b>{fmtMoney(hovered.netProfit)}</b>
              <span>{hovered.pct}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Operators see one client at a time on the Overview, as a user with one client does.
 * With several clients, `value` is the one picked (the first when empty).
 */
export interface ClientPick {
  value: string;
  onChange: (clientId: string) => void;
}

/** The client dropdown for an Operator with several clients. */
function ClientDropdown({ accounts, pick }: { accounts: AccountRow[]; pick: ClientPick }) {
  if (accounts.length < 2) return null;
  return (
    <CardDropdown
      label="Client"
      value={pick.value || accounts[0]!.clientId}
      onChange={pick.onChange}
      options={accounts.map((a) => ({ value: a.clientId, label: a.code }))}
    />
  );
}

/** Shown instead of profit to roles without accounting access: shipment share per client. */
export function ClientShareCard({
  clients,
  accounts,
  month,
  fullYear = false,
  period,
  monthly,
  pick,
}: {
  /** The year's clients (who can be picked, and whether there is only one). */
  clients: AccountRow[];
  /** The Overview period's figures per client. */
  accounts: AccountRow[];
  /** The Overview's month (YYYY-MM); for a full year, the last month of it. */
  month: string;
  fullYear?: boolean;
  /** "October 2026" or "Jan – Oct 2026". */
  period: string;
  monthly: MonthlyVolumeRow[];
  /** Operators: one client at a time, month by month. */
  pick?: ClientPick | undefined;
}) {
  const total = accounts.reduce((s, a) => s + a.all.total, 0);
  // One client: a share-of-total donut is always 100%, so show their year month by month.
  if (clients.length === 1 || (pick && clients.length)) {
    const a = clients.find((x) => x.clientId === pick?.value) ?? clients[0]!;
    return (
      <SingleClientVolume
        key={a.clientId}
        a={a}
        month={month}
        fullYear={fullYear}
        monthly={monthly}
        clientId={clients.length > 1 ? a.clientId : undefined}
        picker={pick && <ClientDropdown accounts={clients} pick={pick} />}
      />
    );
  }
  return (
    <div className={`rc-card ga-revenue ${dash.profitCard}`}>
      <div className="rc-header">
        <div className="rc-title">Shipments by Client</div>
        <div className="rc-subtitle">Share of all shipments in {period}</div>
      </div>
      <div className="rc-top-hero">
        <div className="rc-metric-left">
          <div className="rc-total-amount">{total.toLocaleString()}</div>
        </div>
      </div>
      <div className="rc-main-body">
        <div className="rc-donut-wrapper">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={accounts.map((a) => ({ v: a.all.total }))}
                dataKey="v"
                innerRadius={44}
                outerRadius={56}
                startAngle={90}
                endAngle={-270}
                paddingAngle={2}
                stroke="none"
              >
                {accounts.map((a, i) => (
                  <Cell key={a.clientId} fill={CLIENT_COLORS[i % CLIENT_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="rc-donut-center-text">
            <span className="pct">{accounts.length}</span>
            <span className="tag">Clients</span>
          </div>
        </div>
        <div className="rc-client-list">
          {accounts.slice(0, 5).map((a, i) => {
            const pct = total ? (a.all.total / total) * 100 : 0;
            return (
              <div className="rc-client-row" key={a.clientId}>
                <div className="rc-bar-group">
                  <div className="rc-client-name">
                    <span
                      className="dot"
                      style={{ background: CLIENT_COLORS[i % CLIENT_COLORS.length] }}
                    />
                    {a.name}
                  </div>
                  <div className="rc-bar-track">
                    <div
                      className="rc-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: barGradient(CLIENT_COLORS[i % CLIENT_COLORS.length]),
                      }}
                    />
                  </div>
                </div>
                <div className="rc-val-group">
                  <span className="rc-client-pct">{pct.toFixed(1)}%</span>
                  <span className="rc-client-val">{a.all.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Countries (map card) ------------------------------ */

export function CountryMapCard({ filters }: { filters: { from: string; to: string } }) {
  const [flow, setFlow] = useState<'import' | 'export'>('import');
  const q = useByCountry(filters, flow);
  const rows = q.data ?? [];
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="world-map-card ga-map">
      <div>
        <div className="world-map-header-row">
          <div>
            <div className="world-map-title-wrap">
              <span className="world-map-title-bar" />
              <div className="world-map-title">
                {flow === 'import' ? 'Imported By Countries' : 'Exported By Countries'}
              </div>
            </div>
            <div className="world-map-sub">
              {rows.length
                ? `${total.toLocaleString()} shipments · ${rows.length} ${rows.length === 1 ? 'country' : 'countries'}`
                : 'No shipments in this period'}
            </div>
          </div>
          <CardToggle
            label="Flow"
            value={flow}
            onChange={setFlow}
            options={[
              { value: 'import', label: 'Import' },
              { value: 'export', label: 'Export' },
            ]}
          />
        </div>
        <div className="world-map-visual">
          <WorldMap rows={rows} />
        </div>
      </div>
      <div className="world-country-list">
        <ChartState loading={q.isLoading} error={q.error} empty={!rows.length} height={90}>
          {rows.slice(0, 3).map((r, i) => (
            <div
              className="world-country-row"
              key={r.iso2}
              title={`${r.count} shipments`}
              data-top={i === 0 || undefined}
            >
              <span className="c-rank">{i + 1}</span>
              <span className="c-name">{r.name}</span>
              <span className="c-val">{r.pct}%</span>
              <span className="c-bar">
                <span style={{ width: `${Math.min(100, r.pct)}%` }} />
              </span>
            </div>
          ))}
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Key accounts ------------------------------ */

export function AccountsCard({
  filters,
  period,
  pick,
  clients = [],
}: {
  filters: { from: string; to: string };
  /** The Overview's period: "October 2026" or "Jan – Oct 2026". */
  period: string;
  /** Operators: one client at a time, picked here or on the Shipments card. */
  pick?: ClientPick | undefined;
  /** The clients to pick from (this year's accounts). */
  clients?: AccountRow[];
}) {
  const [type, setType] = useState<'all' | 'import' | 'export'>('all');
  // A user limited to one client (and every Operator) sees no All / Import / Export
  // (their card already shows the import/export split).
  const { user } = useAuth();
  const single = user?.clientIds?.length === 1 || !!pick;
  const picked = pick && clients.length > 1 ? pick.value || clients[0]!.clientId : '';
  const q = useAccounts(filters);
  const rows = picked ? q.data?.filter((a) => a.clientId === picked) : q.data;
  const pickedName = clients.find((c) => c.clientId === picked)?.code;
  return (
    <div className="accounts-card ga-accounts">
      <div className="accounts-card-header">
        <h3 className={acc.title}>
          <span className={acc.titleChip}>
            <fi.users />
          </span>
          Key Logistics Accounts
        </h3>
        {single ? (
          pick && (
            <div className={acc.controls}>
              <ClientDropdown accounts={clients} pick={pick} />
            </div>
          )
        ) : (
          <div className="accounts-seg-control" role="tablist">
            {(['all', 'import', 'export'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={type === t}
                className={`accounts-seg-btn ${acc.segBtn}${type === t ? ' active' : ''}`}
                onClick={() => setType(t)}
              >
                {t === 'import' ? <fi.importBox /> : t === 'export' ? <fi.exportBox /> : null}
                {t === 'all' ? 'All' : t === 'import' ? 'Import' : 'Export'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="accounts-table-wrap">
        <ChartState
          loading={q.isLoading}
          error={q.error}
          empty={!rows?.length}
          emptyText={`No shipments${pickedName ? ` for ${pickedName}` : ''} in ${period}`}
          height={120}
        >
          {rows?.length === 1 ? (
            <SingleAccount a={rows[0]!} type={single ? 'all' : type} period={period} />
          ) : (
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>CLIENT NAME</th>
                  {(
                    [
                      ['Total', fi.hash],
                      ['CY / CY', fi.container],
                      ['LCL', fi.box],
                      ['AIR', fi.plane],
                    ] as const
                  ).map(([label, Icon]) => (
                    <th key={label} style={{ textAlign: 'center' }}>
                      <span className={acc.th}>
                        <Icon />
                        {label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data?.map((a) => {
                  const d = a[type];
                  return (
                    <tr key={a.clientId}>
                      <td>
                        <Link
                          to={`/clients/${a.clientId}`}
                          className={`accounts-name ${acc.nameLink}`}
                        >
                          <span className={acc.nameChip}>
                            <fi.building />
                          </span>
                          {a.name}
                        </Link>
                      </td>
                      <td className="accounts-val-bold" style={{ textAlign: 'center' }}>
                        {d.total.toLocaleString()}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.cy}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.lcl}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.air}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ChartState>
      </div>
    </div>
  );
}

/**
 * One client only (e.g. a user limited to one client): a summary instead of a one-row
 * table: total, import/export split, then CY/CY, LCL and AIR with their share.
 */
function SingleAccount({
  a,
  type,
  period,
}: {
  a: AccountRow;
  type: 'all' | 'import' | 'export';
  /** "October 2026" or "Jan – Oct 2026". */
  period: string;
}) {
  const d = a[type];
  const pct = (n: number) => (d.total ? Math.round((n / d.total) * 100) : 0);
  const flows = a.all.total
    ? { imp: (a.import.total / a.all.total) * 100, exp: (a.export.total / a.all.total) * 100 }
    : { imp: 0, exp: 0 };
  return (
    <div className={acc.single}>
      <div className={acc.head}>
        <span className={acc.badge}>{a.code}</span>
        <div className={acc.who}>
          <Link to={`/clients/${a.clientId}`} className={acc.name}>
            {a.name}
          </Link>
          <span className={acc.sub}>
            {type === 'all' ? 'All shipments' : type === 'import' ? 'Imports' : 'Exports'} in{' '}
            {period}
          </span>
        </div>
        <div className={acc.total}>
          <b>{d.total.toLocaleString()}</b>
          <span>shipments</span>
        </div>
      </div>

      <div className={acc.flow}>
        <div className={acc.flowBar} role="img" aria-label="Import and export split">
          <span style={{ width: `${flows.imp}%` }} data-on={type !== 'export' || undefined} />
          <span style={{ width: `${flows.exp}%` }} data-on={type !== 'import' || undefined} />
        </div>
        <div className={acc.flowLegend}>
          <span>
            <i data-kind="imp" /> Import <b>{a.import.total}</b>
          </span>
          <span>
            <i data-kind="exp" /> Export <b>{a.export.total}</b>
          </span>
        </div>
      </div>

      <div className={acc.modes}>
        {(
          [
            ['CY / CY', d.cy],
            ['LCL', d.lcl],
            ['AIR', d.air],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className={acc.mode}>
            <span className={acc.modeLabel}>{label}</span>
            <span className={acc.modeVal}>
              {n.toLocaleString()} <small>{pct(n)}%</small>
            </span>
            <span className={acc.modeBar}>
              <span style={{ width: `${pct(n)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Port of discharge ------------------------------ */

export function PortCard({ filters }: { filters: { from: string; to: string } }) {
  const [mode, setMode] = useState<'percentage' | 'shipment'>('percentage');
  // Legend hover/focus spotlights one flow across every bar.
  const [focusFlow, setFocusFlow] = useState<'imp' | 'exp' | null>(null);
  const q = usePorts(filters);
  const rows = useMemo(() => {
    const list = (q.data ?? [])
      .map((p) => ({ name: p.shortName, imp: p.imports, exp: p.exports, v: p.imports + p.exports }))
      .filter((p) => p.v > 0)
      .sort((a, b) => b.v - a.v);
    const top = list.slice(0, 3);
    const rest = list.slice(3);
    if (!rest.length) return top;
    const add = (k: 'imp' | 'exp' | 'v') => rest.reduce((s, p) => s + p[k], 0);
    return [...top, { name: 'OTHERS', imp: add('imp'), exp: add('exp'), v: add('v') }];
  }, [q.data]);
  const sum = rows.reduce((s, r) => s + r.v, 0);
  const totals = rows.reduce((s, r) => ({ imp: s.imp + r.imp, exp: s.exp + r.exp }), {
    imp: 0,
    exp: 0,
  });
  const values = rows.map((r) =>
    mode === 'percentage' ? Math.round((r.v / (sum || 1)) * 100) : r.v,
  );
  const fmt = (v: number) => (mode === 'percentage' ? `${v}%` : v.toLocaleString());
  const share = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`;
  const max = mode === 'percentage' ? 100 : niceMax(Math.max(1, ...values));
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((max / 5) * i));
  const legend = (kind: 'imp' | 'exp', label: string, n: number) => (
    <button
      type="button"
      className="port-legend-item"
      data-kind={kind}
      data-active={focusFlow === kind || undefined}
      onMouseEnter={() => setFocusFlow(kind)}
      onMouseLeave={() => setFocusFlow(null)}
      onFocus={() => setFocusFlow(kind)}
      onBlur={() => setFocusFlow(null)}
    >
      <i /> {label} <b>{n.toLocaleString()}</b>
    </button>
  );
  return (
    <div className="port-card ga-port">
      <div className="port-card-header">
        <h3>Port of Discharge</h3>
        <div className="port-card-controls">
          <CardToggle
            label="Measure"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'percentage', label: 'By Percentage' },
              { value: 'shipment', label: 'By Shipment' },
            ]}
          />
        </div>
      </div>
      {rows.length > 0 && (
        <div className="port-legend">
          {legend('imp', 'Import', totals.imp)}
          {legend('exp', 'Export', totals.exp)}
        </div>
      )}
      <ChartState loading={q.isLoading} error={q.error} empty={!rows.length} height={230}>
        <div className="port-chart-wrap">
          <div className="port-chart-plot" data-focus={focusFlow ?? undefined}>
            {rows.map((r, i) => {
              const w = Math.min(100, (values[i]! / max) * 100);
              return (
                <div
                  className="port-bar-row"
                  key={r.name}
                  tabIndex={0}
                  style={{ '--i': i } as CSSProperties}
                  aria-label={`${r.name}: ${fmt(values[i]!)} — ${r.imp} import, ${r.exp} export`}
                >
                  <span className="port-bar-label" title={r.name}>
                    {r.name}
                  </span>
                  <div className="port-bar-track">
                    <div
                      className="port-bar"
                      data-inside={w > 82 || undefined}
                      style={{ width: `${w}%` }}
                    >
                      <div className="port-bar-fill">
                        {r.imp > 0 && (
                          <span className="port-seg" data-kind="imp" style={{ flexGrow: r.imp }} />
                        )}
                        {r.exp > 0 && (
                          <span className="port-seg" data-kind="exp" style={{ flexGrow: r.exp }} />
                        )}
                      </div>
                      <span className="port-bar-value">
                        <CountUp value={values[i]!} format={(v) => fmt(Math.round(v))} />
                      </span>
                    </div>
                    <div
                      className="port-tip"
                      role="presentation"
                      style={{ left: `${Math.min(w, 58)}%` }}
                    >
                      <b className="port-tip-title">{r.name}</b>
                      <span data-kind="imp">
                        <i /> Import <b>{r.imp.toLocaleString()}</b>
                        <small>{share(r.imp, r.v)}</small>
                      </span>
                      <span data-kind="exp">
                        <i /> Export <b>{r.exp.toLocaleString()}</b>
                        <small>{share(r.exp, r.v)}</small>
                      </span>
                      <span className="port-tip-total">
                        Total <b>{r.v.toLocaleString()}</b>
                        <small>{share(r.v, sum)} of all</small>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="port-chart-xaxis" key={`${mode}-${max}`}>
            {ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>
      </ChartState>
    </div>
  );
}

/* ------------------------------ Forwarder radar ------------------------------ */

type ForwarderMetric = 'imports' | 'exports';

export function ForwarderCard({ filters }: { filters: { from: string; to: string } }) {
  const [metric, setMetric] = useState<ForwarderMetric>('imports');
  const q = useForwarders(filters);
  const data = (q.data ?? []).slice(0, 6).map((f) => ({
    name: f.name.replace(' Logistics', '').replace('Global Forwarding', ''),
    v: f[metric] ?? 0,
  }));
  return (
    <div className="forwarder-card ga-forwarder">
      <div className="forwarder-card-header">
        <div className="forwarder-card-title">
          <span className="accent-bar" />
          <h3>Forwarder Statistics</h3>
        </div>
        <CardToggle
          label="Measure"
          value={metric}
          onChange={setMetric}
          triggerClass="forwarder-filter-trigger"
          options={[
            { value: 'imports', label: 'Import' },
            { value: 'exports', label: 'Export' },
          ]}
        />
      </div>
      <div className="forwarder-radar-wrap">
        <ChartState
          loading={q.isLoading}
          error={q.error}
          empty={data.length < 3}
          emptyText={
            data.length ? 'Needs at least 3 forwarders to compare' : 'No shipments in this period'
          }
          height={230}
        >
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={data} outerRadius="70%">
              <PolarGrid stroke="var(--border-subtle)" />
              <PolarAngleAxis
                dataKey="name"
                tick={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--text-secondary)' }}
              />
              <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 'auto']} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className={dash.tooltipPlain}>
                      {(payload[0]!.payload as { name: string }).name}:{' '}
                      <b>{payload[0]!.value} shipments</b>
                    </div>
                  ) : null
                }
              />
              <Radar
                dataKey="v"
                stroke="#22D3EE"
                strokeWidth={2}
                fill="#22D3EE"
                fillOpacity={0.25}
                dot={{ r: 3, fill: '#22D3EE' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Live consignments ------------------------------ */

export function LiveConsignmentsCard() {
  const q = useLiveConsignments();
  const navigate = useNavigate();
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header-row">
        <div>
          <h3>Live Consignments Tracking</h3>
          <div className="create-header-desc" style={{ marginTop: 4 }}>
            Exceptions first, then shipments in progress closest to their ETA.
          </div>
        </div>
        <Link to="/plans" className="filter-btn">
          Open Shipping Plans
        </Link>
      </div>
      <div className="plans-table-scroll">
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Client</th>
              <th>Transport</th>
              <th>Forwarder</th>
              <th>Clearance Port</th>
              <th>ETA Port</th>
              <th>Shipment Status</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={7}>
                  <div className={dash.skeleton} style={{ minHeight: 120 }} />
                </td>
              </tr>
            )}
            {!q.isLoading && !q.data?.length && (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}
                >
                  Nothing in progress right now.
                </td>
              </tr>
            )}
            {q.data?.map((r) => (
              <tr
                key={r.id}
                className="plans-row-clickable"
                tabIndex={0}
                onClick={() => navigate(`/plans/${r.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${r.id}`)}
              >
                <td className="val-bold">
                  {r.invoiceNos.length ? <InvoiceNos nos={r.invoiceNos} /> : r.reference}
                </td>
                <td>{r.clientCode}</td>
                <td>{r.direction}</td>
                <td>{r.forwarderName ?? '-'}</td>
                <td>{r.clearancePortName ?? '-'}</td>
                <td>{fmtDate(r.eta)}</td>
                <td>
                  <ShipmentStatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { MONTHS };
