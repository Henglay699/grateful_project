import { useMemo, type ReactNode } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { AccountRow, MonthlyVolumeRow } from '@gs/shared';
import { useMonthlyVolume } from '../../features/analytics';
import { MONTHS_LONG, monthLabel } from './parts';
import s from './SingleClientVolume.module.css';

const IMPORT = 'var(--accent-primary)';
const EXPORT = 'var(--accent-blue)';

type Point = {
  key: string;
  label: string;
  name: string;
  imports: number;
  exports: number;
  total: number;
};

/**
 * "Shipments by Client" when the user sees one client. Follows the Overview's period: the
 * headline is that month, or January to it for a full year (import and export); the bars
 * are its year month by month up to it.
 */
export function SingleClientVolume({
  a,
  month,
  fullYear = false,
  monthly,
  clientId,
  picker,
}: {
  a: AccountRow;
  /** The Overview's month (YYYY-MM); for a full year, the last month of it. */
  month: string;
  fullYear?: boolean;
  /** The Overview's year month by month (all of the user's clients). */
  monthly: MonthlyVolumeRow[];
  /** Set when the user has several clients: the year is fetched for this one client. */
  clientId?: string | undefined;
  /** The client dropdown, shown at the top right. */
  picker?: ReactNode;
}) {
  const year = month.slice(0, 4);
  const other = useMonthlyVolume({
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    clientId: clientId ? [clientId] : undefined,
  });
  const rows = useMemo(
    () => (clientId ? (other.data ?? []) : monthly),
    [clientId, monthly, other.data],
  );

  const points = useMemo<Point[]>(
    () =>
      rows.map((m) => ({
        key: m.month,
        label: monthLabel(m.month).slice(0, 1),
        name: `${MONTHS_LONG[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`,
        imports: m.imports,
        exports: m.exports,
        total: m.total,
      })),
    [rows],
  );

  // Months after the Overview's month keep their letter on the axis but draw no bar.
  const upcoming = (p: Point) => p.key > month;
  const chartData = points.map((p) => (upcoming(p) ? { ...p, imports: 0, exports: 0 } : p));
  const sofar = points.filter((p) => !upcoming(p));
  const headline = fullYear ? sofar : points.filter((p) => p.key === month);
  const imports = headline.reduce((n, p) => n + p.imports, 0);
  const exports = headline.reduce((n, p) => n + p.exports, 0);
  const total = imports + exports;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const ytd = sofar.reduce((n, p) => n + p.total, 0);
  const avg = sofar.length ? ytd / sofar.length : 0;
  const busiest = sofar.reduce<Point | null>((b, p) => (p.total > (b?.total ?? 0) ? p : b), null);
  const quietest = sofar.reduce<Point | null>((q, p) => (!q || p.total < q.total ? p : q), null);
  const periodName = fullYear
    ? `Jan – ${monthLabel(month)} ${year}`
    : `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${year}`;

  return (
    <div className={`rc-card ga-revenue ${s.card}`}>
      <div className={s.head}>
        <div className={s.titles}>
          <div className="rc-title">Shipments · {a.name}</div>
          <div className="rc-subtitle">Month by month, {year}</div>
        </div>
        {picker && <div className={s.controls}>{picker}</div>}
      </div>

      <div className={s.hero}>
        <div>
          <div className={s.total}>{total.toLocaleString()}</div>
          <div className={s.totalLabel}>shipments in {periodName}</div>
        </div>
        <div className={s.legend}>
          <span>
            <i style={{ background: IMPORT }} /> Import <b>{imports}</b>
            <small>{share(imports)}%</small>
          </span>
          <span>
            <i style={{ background: EXPORT }} /> Export <b>{exports}</b>
            <small>{share(exports)}%</small>
          </span>
        </div>
      </div>

      <div
        className={s.chart}
        role="img"
        aria-label={`Shipments per month in ${year}`}
        aria-busy={!!clientId && other.isLoading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            barCategoryGap="22%"
          >
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={({
                x,
                y,
                index,
                payload,
              }: {
                x: number;
                y: number;
                index: number;
                payload: { value: string };
              }) => {
                const p = points[index];
                return (
                  <text
                    x={x}
                    y={y + 10}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={
                      p?.key === month && !fullYear
                        ? 'var(--accent-primary)'
                        : p && upcoming(p)
                          ? 'var(--border-strong)'
                          : 'var(--text-tertiary)'
                    }
                  >
                    {payload.value}
                  </text>
                );
              }}
            />
            <Tooltip
              cursor={{ fill: 'var(--bg-subtle)', radius: 4 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
                return p ? (
                  <div className={s.tip}>
                    <b>{p.name}</b>
                    {upcoming(p) ? (
                      <span>Not available</span>
                    ) : (
                      <span>
                        Import {p.imports} · Export {p.exports}
                      </span>
                    )}
                  </div>
                ) : null;
              }}
            />
            {(['imports', 'exports'] as const).map((k) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="v"
                fill={k === 'imports' ? IMPORT : EXPORT}
                radius={k === 'exports' ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={s.stats}>
        {fullYear ? (
          <div>
            <span>Quietest month</span>
            <b>
              {quietest ? (
                <>
                  {monthLabel(quietest.key)} <small>{quietest.total}</small>
                </>
              ) : (
                '—'
              )}
            </b>
          </div>
        ) : (
          <div>
            <span>Year to date</span>
            <b>{ytd}</b>
          </div>
        )}
        <div>
          <span>Average per month</span>
          <b>{avg.toFixed(1)}</b>
        </div>
        <div>
          <span>Busiest month</span>
          <b>
            {busiest ? (
              <>
                {monthLabel(busiest.key)} <small>{busiest.total}</small>
              </>
            ) : (
              '—'
            )}
          </b>
        </div>
      </div>
    </div>
  );
}
