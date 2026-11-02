import { useEffect, useState } from 'react';
import {
  CLEARANCE_STATUS_LABEL,
  type ClearanceStatusRow,
  type TransportShareResponse,
} from '@gs/shared';
import { ChartState } from '../dashboard/parts';
import s from './ShareCards.module.css';

/*
 * Analytics → Import vs Export Share and Customs Clearance Status. A segmented ring and
 * segmented bars that draw in on load, numbers that count up, and hover focus that dims
 * the other parts — all in the primary cyan, darker shades for the second series.
 */

export const IMPORT = 'var(--accent-primary)';
export const EXPORT = 'color-mix(in srgb, var(--accent-primary) 55%, #083344)';
/** Transport modes: primary cyan stepping lighter. */
const MODE_TONES = [100, 72, 48, 30].map(
  (p) => `color-mix(in srgb, var(--accent-primary) ${p}%, var(--bg-subtle))`,
);
const CLEARANCE_TONE = {
  CLEARED: 'var(--accent-primary)',
  IN_PROGRESS: 'var(--accent-blue)',
  PENDING: 'var(--accent-amber)',
  EXCEPTION: 'var(--accent-rose)',
} as const;
const MODE_LABEL: Record<string, string> = { FCL: 'CY/CY', SEA: 'Sea' };

const pct = (v: number, of: number) => (of ? (v / of) * 100 : 0);
const fmtPct = (v: number, of: number) => `${pct(v, of).toFixed(1)}%`;

/** Counts from 0 up to `value` (ease-out, ~0.7s); jumps straight there for reduced motion. */
export function useCountUp(value: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      setN(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return n;
}

export function Count({
  value,
  format = (n) => n.toLocaleString(),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  return <>{format(useCountUp(value))}</>;
}

/** Ring of rounded segments with small gaps; the hovered one stays bright. */
function Ring({
  parts,
  active,
  onActive,
}: {
  parts: { key: string; value: number; color: string }[];
  active: number | null;
  onActive: (i: number | null) => void;
}) {
  const size = 156;
  const width = 14;
  const r = (size - width) / 2 - 4;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((t, p) => t + p.value, 0);
  const shown = parts.filter((p) => p.value > 0).length;
  // Round caps reach width/2 past each end, so the gap leaves room for both.
  const gap = shown > 1 ? width + 4 : 0;
  let offset = 0;
  return (
    <svg className={s.ring} viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-subtle)"
        strokeWidth={width}
      />
      {parts.map((p, i) => {
        const full = (p.value / total) * c;
        const len = Math.max(full - gap, 0.001);
        const el = (
          <circle
            key={p.key}
            className={s.arc}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={p.color}
            strokeWidth={active === i ? width + 4 : width}
            strokeLinecap="round"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-(offset + gap / 2)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            data-dim={active !== null && active !== i ? '' : undefined}
            style={{ ['--c' as string]: c, animationDelay: `${i * 120}ms` }}
            onMouseEnter={() => onActive(i)}
            onMouseLeave={() => onActive(null)}
          />
        );
        offset += full;
        return p.value > 0 ? el : null;
      })}
    </svg>
  );
}

/** One thin bar split into rounded segments, each growing in from the left. */
function SegBar({
  parts,
  active,
  onActive,
}: {
  parts: { key: string; value: number; color: string; label: string }[];
  active: number | null;
  onActive: (i: number | null) => void;
}) {
  const total = parts.reduce((t, p) => t + p.value, 0);
  return (
    <div className={s.segBar} role="img" aria-label="Share breakdown">
      {parts.map((p, i) =>
        p.value > 0 ? (
          <span
            key={p.key}
            className={s.seg}
            title={`${p.label}: ${p.value.toLocaleString()} · ${fmtPct(p.value, total)}`}
            data-dim={active !== null && active !== i ? '' : undefined}
            style={{
              flexGrow: p.value,
              background: p.color,
              animationDelay: `${i * 90}ms`,
            }}
            onMouseEnter={() => onActive(i)}
            onMouseLeave={() => onActive(null)}
          />
        ) : null,
      )}
    </div>
  );
}

export function FlowShareCard({
  data,
  loading,
  error,
}: {
  data: TransportShareResponse | undefined;
  loading: boolean;
  error: unknown;
}) {
  const [flow, setFlow] = useState<number | null>(null);
  const [mode, setMode] = useState<number | null>(null);
  const total = data?.total ?? 0;
  const flows = [
    { key: 'import', label: 'Import', value: data?.imports ?? 0, color: IMPORT },
    { key: 'export', label: 'Export', value: data?.exports ?? 0, color: EXPORT },
  ];
  const modes = [...(data?.byMode ?? [])]
    .sort((a, b) => b.count - a.count)
    .map((m, i) => ({
      key: m.mode,
      label: MODE_LABEL[m.mode] ?? m.mode,
      value: m.count,
      color: MODE_TONES[Math.min(i, MODE_TONES.length - 1)]!,
    }));
  const modeTotal = modes.reduce((t, m) => t + m.value, 0);
  const focus = flow !== null ? flows[flow] : null;

  return (
    <div className="card">
      <div className="an-section-title-row">
        <div>
          <h3>Import vs Export Share</h3>
          <div className="an-section-sub">
            Share of shipments in the selected period by flow direction.
          </div>
        </div>
      </div>
      <ChartState loading={loading} error={error} empty={!total} height={180}>
        <div className={s.flowBody} key={total}>
          <div className={s.ringWrap}>
            <Ring parts={flows} active={flow} onActive={setFlow} />
            <div className={s.ringCenter}>
              <span className={s.ringValue}>
                {/* Keyed so each hover remounts it and counts up again. */}
                {focus ? <Count key={focus.key} value={focus.value} /> : <Count value={total} />}
              </span>
              <span className={s.ringLabel}>
                {focus ? `${focus.label} · ${fmtPct(focus.value, total)}` : 'Shipments'}
              </span>
            </div>
          </div>

          <div className={s.flowSide}>
            <div className={s.tiles}>
              {flows.map((f, i) => (
                <div
                  key={f.key}
                  className={s.tile}
                  data-active={flow === i ? '' : undefined}
                  onMouseEnter={() => setFlow(i)}
                  onMouseLeave={() => setFlow(null)}
                >
                  <span className={s.tileHead}>
                    <span className={s.dot} style={{ background: f.color }} />
                    {f.label}
                  </span>
                  <span className={s.tileValue}>
                    <Count value={f.value} />
                  </span>
                  <span className={s.pill} style={{ ['--tone' as string]: f.color }}>
                    {fmtPct(f.value, total)}
                  </span>
                </div>
              ))}
            </div>

            {modes.length > 0 && (
              <div className={s.modes}>
                <div className={s.miniHead}>By transport mode</div>
                <SegBar parts={modes} active={mode} onActive={setMode} />
                <div className={s.legend}>
                  {modes.map((m, i) => (
                    <span
                      key={m.key}
                      className={s.legendItem}
                      data-dim={mode !== null && mode !== i ? '' : undefined}
                      onMouseEnter={() => setMode(i)}
                      onMouseLeave={() => setMode(null)}
                    >
                      <span className={s.dot} style={{ background: m.color }} />
                      {m.label}
                      <b>{m.value.toLocaleString()}</b>
                      <small>{fmtPct(m.value, modeTotal)}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </ChartState>
    </div>
  );
}

export function ClearanceCard({
  rows,
  loading,
  error,
}: {
  rows: ClearanceStatusRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const [active, setActive] = useState<number | null>(null);
  const list = (rows ?? []).map((r) => ({
    key: r.status,
    label: CLEARANCE_STATUS_LABEL[r.status],
    value: r.count,
    color: CLEARANCE_TONE[r.status],
  }));
  const total = list.reduce((t, r) => t + r.value, 0);
  const cleared = list.find((r) => r.key === 'CLEARED')?.value ?? 0;
  const open = total - cleared;
  const clearedPct = pct(cleared, total);

  return (
    <div className="card">
      <div className="an-section-title-row">
        <div>
          <h3>Customs Clearance Status</h3>
          <div className="an-section-sub">Clearance stage of every shipment in the period.</div>
        </div>
      </div>
      <ChartState loading={loading} error={error} empty={!total} height={180}>
        <div className={s.clearBody} key={total}>
          <div className={s.headline}>
            <span className={s.bigValue}>
              {/* Counted in tenths so the percent climbs with one decimal. */}
              <Count
                value={Math.round(clearedPct * 10)}
                format={(n) => `${(n / 10).toFixed(1)}%`}
              />
            </span>
            <div className={s.headlineText}>
              <b>cleared</b>
              <span>
                {cleared.toLocaleString()} of {total.toLocaleString()} shipments
              </span>
            </div>
            <span className={s.pill} data-warn={open ? '' : undefined}>
              {open ? `${open.toLocaleString()} still open` : 'All clear'}
            </span>
          </div>

          <SegBar parts={list} active={active} onActive={setActive} />

          <div className={s.statusGrid}>
            {list.map((r, i) => (
              <div
                key={r.key}
                className={s.status}
                data-active={active === i ? '' : undefined}
                data-dim={active !== null && active !== i ? '' : undefined}
                data-zero={r.value ? undefined : ''}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                <span className={s.statusHead}>
                  <span className={s.dot} style={{ background: r.color }} />
                  {r.label}
                </span>
                <span className={s.statusNums}>
                  <b>{r.value.toLocaleString()}</b>
                  <small>{fmtPct(r.value, total)}</small>
                </span>
                <span className={s.track}>
                  <span
                    className={s.fill}
                    style={{
                      width: `${Math.max(pct(r.value, total), r.value ? 1.5 : 0)}%`,
                      background: r.color,
                      animationDelay: `${150 + i * 80}ms`,
                    }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      </ChartState>
    </div>
  );
}
