import { useState } from 'react';
import type { ForwarderRow } from '@gs/shared';
import { FunnelChart, type FunnelStage } from '../../components/bklit/charts/funnel-chart';
import '../../components/bklit/bklit.css';
import { ChartState } from '../dashboard/parts';
import s from './ForwarderFunnelCard.module.css';

/*
 * Analytics → Most Common Forwarders: Bklit's funnel chart with halo rings, the busiest
 * forwarders in order, labelled by forwarder code. Hovering a stage highlights it.
 */

/** Stages shown; the funnel reads best with a handful. */
const TOP = 5;
const COLOR = 'var(--accent-primary)';

export function ForwarderFunnelCard({
  rows,
  loading,
  error,
}: {
  rows: ForwarderRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const all = (rows ?? []).reduce((t, f) => t + f.shipments, 0);
  const top = [...(rows ?? [])]
    .filter((f) => f.shipments > 0)
    .sort((a, b) => b.shipments - a.shipments)
    .slice(0, TOP);
  const max = top[0]?.shipments ?? 0;
  const topShare = all ? Math.round((top.reduce((t, f) => t + f.shipments, 0) / all) * 100) : 0;

  const data: FunnelStage[] = top.map((f) => ({
    label: f.code,
    value: f.shipments,
    displayValue: f.shipments.toLocaleString(),
  }));

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="an-section-title-row">
        <div>
          <h3>Most Common Forwarders</h3>
          <div className="an-section-sub">
            The {top.length || TOP} forwarders handling the most shipments in the period; each
            stage&apos;s % is its share of all shipments.
          </div>
        </div>
        {all > 0 && (
          <span className={s.pill}>
            Top {top.length} carry {topShare}% of {all.toLocaleString()} shipments
          </span>
        )}
      </div>
      <ChartState loading={loading} error={error} empty={!top.length} height={300}>
        <div className={`bklit ${s.body}`}>
          <FunnelChart
            color={COLOR}
            data={data}
            hoveredIndex={hovered}
            layers={3}
            onHoverChange={setHovered}
            // The funnel's own % is against the biggest stage; show share of all instead.
            formatPercentage={(pct) => `${Math.round((pct * max) / all)}%`}
            style={{ aspectRatio: 'auto', height: 260 }}
          />
        </div>
      </ChartState>
    </div>
  );
}
