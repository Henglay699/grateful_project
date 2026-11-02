import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../lib/api';
import s from './ui.module.css';

export { s as ui };

export function Modal({
  title,
  sub,
  onClose,
  children,
  width = 560,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  // Portalled to <body>: an animated/transformed ancestor would otherwise turn the fixed
  // overlay into a box clipped to the content area instead of covering the screen.
  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={s.dialog}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        ref={ref}
      >
        <div className={s.dialogHead}>
          <div>
            <h2 className={s.dialogTitle} id="dlg-title">
              {title}
            </h2>
            {sub && <div className={s.dialogSub}>{sub}</div>}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The page sizes a table's "Rows" picker offers. */
export const PAGE_SIZES = [10, 25, 50, 100];
/** The most rows a list API returns in one page. */
const MAX_PAGE_SIZE = 1000;
const CUSTOM = 'custom';

/** The preset sizes, or "Custom…" to type any number of rows (Enter or leaving the box applies it). */
function RowsPicker({
  pageSize,
  onPageSize,
}: {
  pageSize: number;
  onPageSize: (n: number) => void;
}) {
  const [typing, setTyping] = useState(false);
  const sizes = PAGE_SIZES.includes(pageSize)
    ? PAGE_SIZES
    : [...PAGE_SIZES, pageSize].sort((a, b) => a - b);
  const apply = (raw: string) => {
    setTyping(false);
    const n = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.round(Number(raw))));
    if (Number.isFinite(n) && n !== pageSize) onPageSize(n);
  };
  return (
    <label className={s.pagerRows}>
      Rows
      {typing ? (
        <input
          className={s.pagerInput}
          type="number"
          min={1}
          max={MAX_PAGE_SIZE}
          defaultValue={pageSize}
          autoFocus
          onFocus={(e) => e.target.select()}
          onBlur={(e) => apply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = String(pageSize);
              e.currentTarget.blur();
            }
          }}
          aria-label={`Rows per page, 1 to ${MAX_PAGE_SIZE}`}
        />
      ) : (
        <select
          className={s.pagerSelect}
          value={pageSize}
          onChange={(e) =>
            e.target.value === CUSTOM ? setTyping(true) : onPageSize(Number(e.target.value))
          }
        >
          {sizes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      )}
    </label>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  children,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  /** Shows a "Rows" picker before the count when given. */
  onPageSize?: (n: number) => void;
  /** Extra content in the free space between the count and the buttons. */
  children?: ReactNode;
}) {
  if (total === 0) return children ? <div className={s.pager}>{children}</div> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={s.pager} aria-label="Pagination">
      <span className={s.pagerCount}>
        {onPageSize && <RowsPicker pageSize={pageSize} onPageSize={onPageSize} />}
        <span className={s.pagerInfo}>
          {from}–{to} of {total.toLocaleString()}
        </span>
      </span>
      {children}
      <div className={s.pagerBtns}>
        <button
          type="button"
          className="filter-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className={s.pagerInfo}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="filter-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/** Server error → readable banner, listing field details when present. */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const details = Array.isArray(e?.details)
    ? (e!.details as { path?: string; message: string }[])
    : [];
  return (
    <div className={s.alert} role="alert">
      {e?.message ?? 'Something went wrong. Check your connection and try again.'}
      {details.length > 0 && (
        <ul>
          {details.slice(0, 8).map((d, i) => (
            <li key={i}>
              {d.path ? `${d.path}: ` : ''}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TableState({
  cols,
  loading,
  error,
  empty,
  emptyText,
}: {
  cols: number;
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
}) {
  if (loading)
    return (
      <>
        {Array.from({ length: 6 }, (_, i) => (
          <tr key={i} className={s.skeletonRow}>
            {Array.from({ length: cols }, (_, j) => (
              <td key={j}>
                <div className={s.skeleton} style={{ width: `${50 + ((i * 7 + j * 13) % 45)}%` }} />
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  if (error)
    return (
      <tr>
        <td colSpan={cols} className={s.empty} style={{ color: 'var(--status-exception-fg)' }}>
          {error instanceof ApiError ? error.message : 'Could not load data.'} Reload the page to
          try again.
        </td>
      </tr>
    );
  if (empty)
    return (
      <tr>
        <td colSpan={cols} className={s.empty}>
          {emptyText}
        </td>
      </tr>
    );
  return null;
}

export function FieldError({ message }: { message?: string | undefined }) {
  return message ? (
    <span className={s.fieldError} role="alert">
      {message}
    </span>
  ) : null;
}

/** Chevron button at a card's top right: shows more of the card (or all of it) when open. */
export function ExpandToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  /** What it shows, e.g. "all forwarders" ("Show all forwarders" / "Show fewer…"). */
  label: string;
}) {
  return (
    <button
      type="button"
      className={s.expandToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
      title={`${open ? 'Hide' : 'Show'} ${label}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
