import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOverviewSummary } from '../features/analytics';
import { icons } from './icons';
import { MONTHS, MONTHS_LONG } from '../pages/dashboard/parts';
import { currentMonth, useOverviewMonth } from '../pages/dashboard/overviewMonth';
import s from './LiveMonthPill.module.css';

/** Beside the month picker: opens Overview → Customize (?customize=1) to add or remove widgets. */
export function CustomizeOverviewButton() {
  const [params, setParams] = useSearchParams();
  const open = () => {
    const next = new URLSearchParams(params);
    next.set('customize', '1');
    setParams(next, { replace: true });
  };
  return (
    <button
      type="button"
      className={`time-pill-btn ${s.btn}`}
      onClick={open}
      title="Add or remove Overview widgets"
      aria-label="Edit Overview widgets"
    >
      {icons.edit({ width: 15, height: 15 })}
      <span className={s.long}>Edit widgets</span>
    </button>
  );
}

/**
 * Beside the Overview title: "October 2026 (Live)", or the month being looked at. Click it to
 * pick another month and year (months still to come can't be picked), or a whole year:
 * "Jan – Oct 2026" for this year so far, "Jan – Dec 2025" for a past one.
 */
export function LiveMonthPill() {
  const { month, fullYear, setMonth, setFullYear } = useOverviewMonth();
  const now = currentMonth();
  const nowYear = Number(now.slice(0, 4));
  // This year as a whole is live too (it runs to today).
  const live = fullYear ? Number(fullYear) === nowYear : !month;
  // Same query (and cache) as the Overview page itself.
  const summary = useOverviewSummary(month, fullYear);
  const shown = fullYear
    ? Number(fullYear) === nowYear
      ? now
      : `${fullYear}-12`
    : (month ?? summary.data?.month ?? currentMonth());
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(shown.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setYear(Number(shown.slice(0, 4)));
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
    // Re-sync the year only when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = fullYear
    ? `Jan – ${MONTHS[Number(shown.slice(5, 7)) - 1]} ${fullYear}`
    : `${MONTHS_LONG[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`;
  // Phones: "Oct 2026" / "Jan – Oct 26".
  const short = fullYear
    ? `Jan – ${MONTHS[Number(shown.slice(5, 7)) - 1]} ${fullYear.slice(2)}`
    : `${MONTHS[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`;
  const pick = (m: string) => {
    setMonth(m === now ? undefined : m);
    setOpen(false);
  };
  const pickYear = () => {
    setFullYear(String(year));
    setOpen(false);
  };
  const yearEnd = year === nowYear ? MONTHS[Number(now.slice(5, 7)) - 1] : 'Dec';

  return (
    <div className={s.wrap} ref={box}>
      <button
        type="button"
        className={`time-pill-btn ${s.btn}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={live ? 'Refreshes every minute. Click to pick another month.' : 'Pick a month'}
        onClick={() => setOpen((o) => !o)}
      >
        {live && <i className={s.liveDot} aria-hidden />}
        <span className={s.long}>{label}</span>
        <span className={s.short}>{short}</span>
        {live && <span className={s.liveTag}>(Live)</span>}
        <svg className={s.caret} viewBox="0 0 24 24" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={s.panel} role="dialog" aria-label="Pick a month">
          <div className={s.yearRow}>
            <button
              type="button"
              className={s.step}
              aria-label="Previous year"
              onClick={() => setYear((y) => y - 1)}
            >
              ‹
            </button>
            <b>{year}</b>
            <button
              type="button"
              className={s.step}
              aria-label="Next year"
              disabled={year >= nowYear}
              onClick={() => setYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className={s.grid}>
            {MONTHS.map((name, i) => {
              const m = `${year}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button
                  type="button"
                  key={m}
                  className={s.month}
                  data-selected={(!fullYear && m === shown) || undefined}
                  data-now={m === now || undefined}
                  disabled={m > now}
                  onClick={() => pick(m)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={s.fullYear}
            data-selected={fullYear === String(year) || undefined}
            onClick={pickYear}
          >
            Full year {year}
            <small>
              Jan – {yearEnd}
              {year === nowYear && ' (so far)'}
            </small>
          </button>
          {(month || fullYear) && (
            <button type="button" className={s.back} onClick={() => pick(now)}>
              <i className={s.liveDot} aria-hidden /> Back to this month (Live)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
