import type { ReactNode } from 'react';
import type { MonthlyVolumeRow } from '@gs/shared';
import { Bar } from '../../components/bklit/charts/bar';
import { BarChart } from '../../components/bklit/charts/bar-chart';
import { BarXAxis } from '../../components/bklit/charts/bar-x-axis';
import { Grid } from '../../components/bklit/charts/grid';
import { ChartTooltip } from '../../components/bklit/charts/tooltip/chart-tooltip';
import '../../components/bklit/bklit.css';
import { ChartState } from '../dashboard/parts';
import { BarSlots } from './ClientRevenueCards';
import { Count } from './ShareCards';
import s from './TrendCards.module.css';

/*
 * Analytics → Monthly Shipment Volume as Bklit bars, like Client Revenue's net profit trend:
 * a faint slot behind each month, hovering a month fades the rest, pills its label and shows
 * a tooltip card. Import cyan, export blue.
 */

const IMPORT_FILL = 'var(--accent-cyan)';
const EXPORT_FILL = 'var(--accent-blue)';

type MonthPoint = MonthlyVolumeRow & { label: string };

const icon = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width={18}
    height={18}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);
/** Summary strip icons: shipments, average, peak, import/export split. */
const STAT_ICONS = {
  total: icon(
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>,
  ),
  average: icon(<path d="M3 3v18h18M7 16v-3M12 16V9M17 16v-6M6 8.5l5-2.5 4 2 5-3" />),
  peak: icon(<path d="m22 7-8.5 8.5-5-5L2 17M16 7h6v6" />),
  split: icon(<path d="M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4" />),
};

export function MonthlyVolumeCard({
  data,
  loading,
  error,
  periodLabel,
}: {
  data: MonthPoint[];
  loading: boolean;
  error: unknown;
  periodLabel: string;
}) {
  const withData = data.filter((m) => m.total);
  const total = data.reduce((t, m) => t + m.total, 0);
  const imports = data.reduce((t, m) => t + m.imports, 0);
  const avg = withData.length ? total / withData.length : 0;
  const peak = withData.reduce<MonthPoint | null>(
    (best, m) => (!best || m.total > best.total ? m : best),
    null,
  );
  const importPct = total ? Math.round((imports / total) * 100) : 0;
  const stats = [
    { label: 'Shipments', icon: STAT_ICONS.total, value: <Count value={total} /> },
    { label: 'Monthly average', icon: STAT_ICONS.average, value: avg.toFixed(1) },
    {
      label: 'Peak month',
      icon: STAT_ICONS.peak,
      value: peak ? `${peak.label} · ${peak.total}` : '–',
    },
    {
      label: 'Import / export',
      icon: STAT_ICONS.split,
      value: total ? `${importPct} / ${100 - importPct}` : '–',
    },
  ];

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className={s.volHead}>
        <div>
          <h3 className={s.volTitle}>Monthly Shipment Volume</h3>
          <div className={s.volSub}>
            Shipments per ETA month, split by flow direction · {periodLabel}
          </div>
        </div>
        <div className={s.legend}>
          <span>
            <i style={{ background: IMPORT_FILL }} />
            Import
          </span>
          <span>
            <i style={{ background: EXPORT_FILL }} />
            Export
          </span>
        </div>
      </div>
      <div className={s.stats}>
        {stats.map((x) => (
          <div key={x.label} className={s.stat}>
            <div className={s.statText}>
              <span>{x.label}</span>
              <b>{x.value}</b>
            </div>
            <span className={s.statIcon}>{x.icon}</span>
          </div>
        ))}
      </div>
      <ChartState loading={loading} error={error} empty={!total} height={280}>
        <div className={`bklit ${s.chart}`}>
          <BarChart
            data={data as unknown as Record<string, unknown>[]}
            xDataKey="label"
            aspectRatio="4.6 / 1"
            barGap={0.3}
            margin={{ top: 8, right: 0, bottom: 40, left: 0 }}
          >
            <Grid horizontal />
            <BarSlots />
            <Bar
              dataKey="imports"
              fill={IMPORT_FILL}
              lineCap={3}
              fadedOpacity={0.35}
              groupGap={4}
            />
            <Bar
              dataKey="exports"
              fill={EXPORT_FILL}
              lineCap={3}
              fadedOpacity={0.35}
              groupGap={4}
            />
            <BarXAxis showAllLabels />
            <ChartTooltip
              rows={(p) => [
                { color: IMPORT_FILL, label: 'Import', value: Number(p.imports).toLocaleString() },
                { color: EXPORT_FILL, label: 'Export', value: Number(p.exports).toLocaleString() },
                {
                  color: 'var(--text-tertiary)',
                  label: 'Total',
                  value: Number(p.total).toLocaleString(),
                },
              ]}
            />
          </BarChart>
        </div>
      </ChartState>
    </div>
  );
}
