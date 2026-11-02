import type { CSSProperties } from 'react';
import type { PortRow } from '@gs/shared';
import { Bar } from '../../components/bklit/charts/bar';
import { BarChart } from '../../components/bklit/charts/bar-chart';
import { BarYAxis } from '../../components/bklit/charts/bar-y-axis';
import { useChartHover, useChartStable } from '../../components/bklit/charts/chart-context';
import { ChartTooltip } from '../../components/bklit/charts/tooltip/chart-tooltip';
import '../../components/bklit/bklit.css';
import { ChartState } from '../dashboard/parts';
import s from './PortsCard.module.css';

/*
 * Analytics → Port of Discharge as ranked horizontal Bklit bars: one row per port, busiest
 * first, import and export stacked so the row length is the port's total. Hovering a port
 * fades the others, darkens its slot and shows a tooltip, as on Monthly Shipment Volume.
 */

const IMPORT_FILL = 'var(--accent-cyan)';
const EXPORT_FILL = 'var(--accent-blue)';
const ROW = 34;
const MARGIN = { top: 4, right: 44, bottom: 4, left: 84 };

/** A faint full-width slot behind each port's row; the hovered one darkens. */
function RowSlots() {
  const { data, barScale, bandWidth, barXAccessor, innerWidth } = useChartStable();
  const on = useChartHover().hoveredBarIndex ?? null;
  if (!barScale || !bandWidth || !barXAccessor) return null;
  return (
    <g aria-hidden="true">
      {data.map((d, i) => (
        <rect
          key={i}
          x={0}
          y={barScale(barXAccessor(d)) ?? 0}
          width={innerWidth}
          height={bandWidth}
          rx={4}
          fill="var(--bg-subtle)"
          fillOpacity={on === i ? 0.9 : 0.45}
          style={{ transition: 'fill-opacity 0.15s ease-in-out' }}
        />
      ))}
    </g>
  );
}

/** Each port's total just past the end of its bar. */
function TotalLabels() {
  const { data, barScale, bandWidth, barXAccessor, yScale } = useChartStable();
  const on = useChartHover().hoveredBarIndex ?? null;
  if (!barScale || !bandWidth || !barXAccessor) return null;
  return (
    <g aria-hidden="true">
      {data.map((d, i) => (
        <text
          key={i}
          className={s.total}
          x={yScale(Number(d.total)) + 8}
          y={(barScale(barXAccessor(d)) ?? 0) + bandWidth / 2}
          dominantBaseline="central"
          fillOpacity={on === null || on === i ? 1 : 0.35}
          style={{ transition: 'fill-opacity 0.15s ease-in-out' }}
        >
          {Number(d.total).toLocaleString()}
        </text>
      ))}
    </g>
  );
}

export function PortsCard({
  rows,
  loading,
  error,
}: {
  rows: PortRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const data = [...(rows ?? [])].sort((a, b) => b.total - a.total);
  const all = data.reduce((t, p) => t + p.total, 0);
  const top = data[0];
  const height = data.length * ROW + MARGIN.top + MARGIN.bottom;

  return (
    <div className="card">
      <div className="an-section-title-row">
        <div>
          <h3>Port of Discharge — Import vs Export</h3>
          <div className="an-section-sub">
            Shipments per clearance port, busiest first; each bar splits import and export.
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
      {top && all > 0 && (
        <div className={s.lead}>
          Busiest: <b>{top.shortName}</b> with {top.total.toLocaleString()} shipments ·{' '}
          {Math.round((top.total / all) * 100)}% of all
        </div>
      )}
      <ChartState loading={loading} error={error} empty={!data.length} height={230}>
        <div className={`bklit ${s.chart}`} style={{ '--chart-h': `${height}px` } as CSSProperties}>
          <BarChart
            data={data as unknown as Record<string, unknown>[]}
            xDataKey="shortName"
            orientation="horizontal"
            stacked
            stackGap={2}
            barGap={0.32}
            margin={MARGIN}
          >
            <RowSlots />
            <Bar dataKey="imports" fill={IMPORT_FILL} lineCap={3} fadedOpacity={0.35} />
            <Bar dataKey="exports" fill={EXPORT_FILL} lineCap={3} fadedOpacity={0.35} />
            <TotalLabels />
            <BarYAxis showAllLabels />
            <ChartTooltip
              rows={(p) => {
                const total = Number(p.total) || 1;
                const pct = (n: unknown) => `${Math.round((Number(n) / total) * 100)}%`;
                return [
                  {
                    color: IMPORT_FILL,
                    label: 'Import',
                    value: `${Number(p.imports).toLocaleString()} · ${pct(p.imports)}`,
                  },
                  {
                    color: EXPORT_FILL,
                    label: 'Export',
                    value: `${Number(p.exports).toLocaleString()} · ${pct(p.exports)}`,
                  },
                  {
                    color: 'var(--text-tertiary)',
                    label: 'Total',
                    value: Number(p.total).toLocaleString(),
                  },
                ];
              }}
            />
          </BarChart>
        </div>
      </ChartState>
    </div>
  );
}
