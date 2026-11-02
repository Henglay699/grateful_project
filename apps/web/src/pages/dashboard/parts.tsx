import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import s from './dashboard.module.css';

export { s as dash };

/** Loading skeleton / error / empty wrapper used by every chart. */
export function ChartState({
  loading,
  error,
  empty,
  emptyText = 'No shipments in this period',
  height = 200,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText?: string;
  height?: number;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className={s.skeleton} style={{ height }} aria-busy="true" aria-label="Loading chart" />
    );
  if (error)
    return (
      <div className={s.stateError} style={{ minHeight: height }}>
        {error instanceof ApiError ? error.message : 'Could not load this chart.'}
      </div>
    );
  if (empty)
    return (
      <div className={s.state} style={{ minHeight: height }}>
        {emptyText}
      </div>
    );
  return <>{children}</>;
}

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const CARET = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** The prototype's `.card-dropdown` (Import / Export, By Percentage / By Shipment…). */
export function CardDropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  triggerClass = '',
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  triggerClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className={`card-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button
        className={`card-dropdown-trigger ${triggerClass}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current?.label}</span>
        {CARET}
      </button>
      <div className="card-dropdown-menu" role="menu">
        {options.map((o) => (
          <div
            key={o.value}
            role="menuitemradio"
            aria-checked={o.value === value}
            aria-disabled={o.disabled || undefined}
            tabIndex={o.disabled ? -1 : 0}
            className={`card-dropdown-item${o.value === value ? ' active' : ''}`}
            onClick={() => {
              if (o.disabled) return;
              onChange(o.value);
              setOpen(false);
            }}
            onKeyDown={(e) =>
              !o.disabled &&
              (e.key === 'Enter' || e.key === ' ') &&
              (e.preventDefault(), onChange(o.value), setOpen(false))
            }
          >
            {o.label}
            {CHECK}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One button that steps to the next option on each click (Import → Export → Import…),
 * styled like the dropdown trigger; the new label rolls in.
 */
export function CardToggle<T extends string>({
  value,
  options,
  onChange,
  label,
  triggerClass = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  triggerClass?: string;
}) {
  const i = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const current = options[i]!;
  const next = options[(i + 1) % options.length]!;
  return (
    <button
      className={`card-dropdown-trigger ${s.toggle} ${triggerClass}`}
      type="button"
      aria-label={`${label}: ${current.label}. Switch to ${next.label}`}
      title={`Switch to ${next.label}`}
      onClick={() => onChange(next.value)}
    >
      <span key={current.value} className={s.toggleLabel}>
        {current.label}
      </span>
      <svg
        className={s.toggleIcon}
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
      </svg>
    </button>
  );
}

/** "↗ 12.4%" vs a previous value; null when there is nothing to compare with. */
/**
 * Fewest shipments the year before for a year-on-year change to mean anything: the system
 * holds next to no history before 2026, so a handful of stray records gave "↗ 15233%".
 */
export const MIN_YEAR_BASE = 10;

export function changePct(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return cur ? { text: 'new', up: true } : null;
  const pct = ((cur - prev) / prev) * 100;
  return { text: `${pct >= 0 ? '↗' : '↘'} ${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
}

/** The prototype's `.an-hbar-*` progress list. */
export function HBarList({
  rows,
}: {
  rows: {
    key: string;
    name: string;
    value: number;
    display: string;
    color?: string;
    max?: number;
  }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  return (
    <div className="an-hbar-list">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="an-hbar-row-top">
            <span className="an-hbar-name">{r.name}</span>
            <span className="an-hbar-val">{r.display}</span>
          </div>
          <div className="an-hbar-track">
            <div
              className="an-hbar-fill"
              style={{
                width: `${Math.max(0, (r.value / (r.max ?? max)) * 100)}%`,
                background: r.color ?? 'var(--accent-primary)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MONTHS_LONG = [
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
export const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
/** Per-client series colours: brand cyan first, then muted jewel tones that sit well
 *  together (no traffic-light red/green, which reads as good/bad). */
export const CLIENT_COLORS = [
  '#06B6D4', // cyan
  '#04a1bd', // indigo
  '#0294ad', // soft gold
  '#037e94', // lavender
  '#0EA5E9', // sky
  '#F472B6', // rose pink
  '#2DD4BF', // teal
  '#94A3B8', // slate
];
/** The same colour as a left-to-right gradient, for bars. */
export const barGradient = (c = CLIENT_COLORS[0]!) => `linear-gradient(90deg, ${c}99, ${c})`;

/** Round an axis maximum up to a friendly number (5, 10, 20, 50, 100…). */
export function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
