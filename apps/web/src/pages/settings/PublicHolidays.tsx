import { useState } from 'react';
import type { PublicHoliday } from '@gs/shared';
import { useApiMutation, usePublicHolidays } from '../../features/admin';
import { ErrorBanner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { icons } from '../../layout/icons';
import h from './PublicHolidays.module.css';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

const MONTH_LONG = [
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
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
/** Today in Cambodia, as YYYY-MM-DD. */
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
const daysUntil = (iso: string) =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000);

type Draft = { id?: string; holidayDate: string; name: string; nameKh: string; note: string };
const INVALIDATE = [['settings', 'holidays']];

/**
 * Settings → Public holidays: the Cambodian public holiday calendar. Tax invoices, DIS and
 * debit notes are dated the next working day after the declaration date, past weekends and
 * these days. Changes apply to documents dated from now on, not to ones already dated.
 */
export function PublicHolidays({ manage }: { manage: boolean }) {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const list = usePublicHolidays(year);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (d: Draft) =>
      d.id
        ? api(`/settings/public-holidays/${d.id}`, { method: 'PATCH', json: d })
        : api('/settings/public-holidays', { method: 'POST', json: d }),
    INVALIDATE,
  );
  const del = useApiMutation(
    (id: string) => api(`/settings/public-holidays/${id}`, { method: 'DELETE' }),
    INVALIDATE,
  );

  const submit = async () => {
    if (!edit) return;
    setError(null);
    try {
      await save.mutateAsync(edit);
      toast(edit.id ? 'Holiday updated.' : 'Holiday added.');
      if (edit.holidayDate.slice(0, 4) !== String(year))
        setYear(Number(edit.holidayDate.slice(0, 4)));
      setEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the holiday.');
    }
  };
  const remove = (r: PublicHoliday) => {
    if (!window.confirm(`Remove ${r.name} (${fmt(r.holidayDate)}) from the holiday calendar?`))
      return;
    void del.mutateAsync(r.id).then(() => toast('Holiday removed.'));
  };
  const rows = list.data ?? [];
  const today = todayIso();
  const next = rows.find((r) => r.holidayDate >= today);
  // Grouped by month ("01" … "12"), in date order.
  const months = [...new Map(rows.map((r) => [r.holidayDate.slice(5, 7), [] as PublicHoliday[]]))];
  for (const r of rows) months.find(([m]) => m === r.holidayDate.slice(5, 7))![1].push(r);

  return (
    <div className="card">
      <div className={h.head}>
        <div>
          <h3 className={h.title}>Public holidays</h3>
        </div>
        <div className={h.tools}>
          <div className={h.year}>
            <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              ‹
            </button>
            <b>{year}</b>
            <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
              ›
            </button>
          </div>
          {manage && (
            <button
              type="button"
              className="new-shipment-btn"
              onClick={() => {
                setError(null);
                setEdit({ holidayDate: `${year}-01-01`, name: '', nameKh: '', note: '' });
              }}
            >
              + Add holiday
            </button>
          )}
        </div>
      </div>
      <ErrorBanner error={list.error} />

      {edit && (
        <div className={h.form}>
          <label>
            Date
            <input
              type="date"
              className="form-field-box"
              value={edit.holidayDate}
              onChange={(e) => setEdit({ ...edit, holidayDate: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Name
            <input
              className="form-field-box"
              value={edit.name}
              placeholder="e.g. Khmer New Year"
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Name in Khmer
            <input
              className="form-field-box"
              lang="km"
              value={edit.nameKh}
              placeholder="e.g. ពិធីបុណ្យចូលឆ្នាំថ្មីប្រពៃណីជាតិ"
              onChange={(e) => setEdit({ ...edit, nameKh: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Note
            <input
              className="form-field-box"
              value={edit.note}
              placeholder="Optional, e.g. the sub-decree"
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
            />
          </label>
          <div className={h.formButtons}>
            <button type="button" className="filter-btn" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="new-shipment-btn"
              disabled={save.isPending || !edit.holidayDate || edit.name.trim().length < 2}
              onClick={() => void submit()}
            >
              Save
            </button>
          </div>
          {error && <p className={h.error}>{error}</p>}
        </div>
      )}

      {rows.length > 0 && (
        <div className={h.summary}>
          <span>
            <b>{rows.length}</b> day{rows.length === 1 ? '' : 's'} in {year}
          </span>
          <span>
            <b>{rows.filter((r) => !isWeekend(r.holidayDate)).length}</b> on weekdays
          </span>
          {next && (
            <span className={h.nextChip}>
              Next: <b>{next.name}</b> · {fmt(next.holidayDate)} ·{' '}
              {daysUntil(next.holidayDate) === 0
                ? 'today'
                : `in ${daysUntil(next.holidayDate)} day${daysUntil(next.holidayDate) === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
      )}

      <div className={h.table}>
        {months.map(([m, items]) => (
          <section key={m} className={h.month}>
            <h4 className={h.monthHead}>
              {MONTH_LONG[Number(m) - 1]}
              <small>
                {items.length} day{items.length === 1 ? '' : 's'}
              </small>
            </h4>
            {items.map((r) => {
              const d = new Date(`${r.holidayDate}T00:00:00Z`);
              const state =
                r.holidayDate < today ? 'past' : r.id === next?.id ? 'next' : 'upcoming';
              return (
                <div
                  key={r.id}
                  className={h.row}
                  data-state={state}
                  data-provisional={/provisional/i.test(r.note ?? '') || undefined}
                >
                  <span className={h.tile} aria-hidden>
                    <small>{WEEKDAY[d.getUTCDay()]}</small>
                    <b>{d.getUTCDate()}</b>
                  </span>
                  <span className={h.name}>
                    <span className={h.nameLine}>
                      {r.name}
                      {state === 'next' && <i className={h.tagNext}>Next</i>}
                      {isWeekend(r.holidayDate) && <i className={h.tag}>Weekend</i>}
                    </span>
                    {r.nameKh && (
                      <span className={h.nameKh} lang="km">
                        {r.nameKh}
                      </span>
                    )}
                    <small>
                      {fmt(r.holidayDate)}
                      {r.note ? ` · ${r.note}` : ''}
                    </small>
                  </span>
                  {manage && (
                    <span className={h.actions}>
                      <button
                        type="button"
                        className={h.iconBtn}
                        title="Edit"
                        aria-label={`Edit ${r.name}`}
                        onClick={() => {
                          setError(null);
                          setEdit({
                            id: r.id,
                            holidayDate: r.holidayDate,
                            name: r.name,
                            nameKh: r.nameKh ?? '',
                            note: r.note ?? '',
                          });
                        }}
                      >
                        {icons.edit({})}
                      </button>
                      <button
                        type="button"
                        className={h.iconBtn}
                        data-danger
                        title="Remove"
                        aria-label={`Remove ${r.name}`}
                        onClick={() => remove(r)}
                      >
                        {icons.trash({})}
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {!list.isLoading && !rows.length && (
          <p className={h.empty}>
            No public holidays entered for {year}.{manage ? ' Add them with “+ Add holiday”.' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
