import type { CSSProperties, ReactNode } from 'react';
import s from './StatTiles.module.css';

/** A row of summary tiles (label over value). `columns` = grid tracks at full width. */
export function StatTiles({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <div className={s.tiles} style={{ '--cols': columns } as CSSProperties}>
      {children}
    </div>
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'paid';

/**
 * One tile. `tone` colours it (e.g. net profit, unpaid, over-imported). Pass `onClick` to make it
 * a toggle filter; `pressed` shows it is on.
 */
export function StatTile({
  label,
  value,
  tone,
  span,
  tooltip,
  onClick,
  pressed,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone | undefined;
  /** Grid tracks to take (e.g. 2 for the headline figure). */
  span?: number;
  tooltip?: string;
  onClick?: () => void;
  pressed?: boolean;
}) {
  const props = {
    className: `${s.tile}${onClick ? ` ${s.clickable}` : ''}`,
    'data-tone': tone,
    title: tooltip,
    style: span ? { gridColumn: `span ${span}` } : undefined,
  };
  const body = (
    <>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" {...props} aria-pressed={!!pressed} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div {...props}>{body}</div>
  );
}
