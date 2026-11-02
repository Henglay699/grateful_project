import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_VAT_PERCENT, fmtVatPercent, vatPercentOn, type VatRate } from '@gs/shared';
import { useApiMutation } from '../../features/admin';
import { ErrorBanner } from '../../components/ui';
import { InfoTip } from '../../components/InfoTip';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import { icons } from '../../layout/icons';
import h from './PublicHolidays.module.css';

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
/** Today in Cambodia, as YYYY-MM-DD. */
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

type Draft = { id?: string; effectiveDate: string; percent: string; note: string };
const INVALIDATE = [
  ['settings', 'vat-rates'],
  ['meta', 'vat-rates'],
];

/**
 * Settings → Tax Management: the VAT percent by effective date. A document takes the
 * percent in force on its own date when it is made, and keeps it: a new rate never changes
 * tax invoices, record summaries, credit notes or Monthly Ledger rows already made.
 */
export function InvoiceManagement({ manage }: { manage: boolean }) {
  const toast = useToast();
  const list = useQuery({
    queryKey: ['settings', 'vat-rates'],
    queryFn: () => api<VatRate[]>('/settings/vat-rates'),
  });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (d: Draft) =>
      d.id
        ? api(`/settings/vat-rates/${d.id}`, { method: 'PATCH', json: d })
        : api('/settings/vat-rates', { method: 'POST', json: d }),
    INVALIDATE,
  );
  const del = useApiMutation(
    (id: string) => api(`/settings/vat-rates/${id}`, { method: 'DELETE' }),
    INVALIDATE,
  );

  const rows = list.data ?? [];
  const today = todayIso();
  const current = vatPercentOn(rows, today);
  const currentRow = rows.find((r) => r.effectiveDate <= today);
  const next = [...rows].reverse().find((r) => r.effectiveDate > today);
  const percentOk =
    edit !== null &&
    edit.percent.trim() !== '' &&
    Number(edit.percent) >= 0 &&
    Number(edit.percent) <= 100;

  const submit = async () => {
    if (!edit) return;
    setError(null);
    try {
      await save.mutateAsync(edit);
      toast(
        edit.id
          ? 'VAT rate updated.'
          : `VAT ${fmtVatPercent(edit.percent)}% from ${fmt(edit.effectiveDate)} added. Documents already made keep their VAT.`,
      );
      setEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the VAT rate.');
    }
  };
  const remove = (r: VatRate) => {
    if (
      !window.confirm(
        `Remove VAT ${fmtVatPercent(r.percent)}% from ${fmt(r.effectiveDate)}? Documents already made keep their VAT.`,
      )
    )
      return;
    void del.mutateAsync(r.id).then(() => toast('VAT rate removed.'));
  };

  return (
    <div className="card">
      <div className={h.head}>
        <div>
          <h3 className={`${h.title} ${h.titleRow}`}>
            Tax management · VAT
            <InfoTip label="About VAT rates">
              The VAT percent on tax invoices, record summaries, credit notes (the processing fee)
              and the Monthly Ledger. A new rate applies from its effective date to documents made
              from then on. Documents already made keep the VAT they were made with, so past
              invoices never change.
            </InfoTip>
          </h3>
        </div>
        {manage && (
          <div className={h.tools}>
            <button
              type="button"
              className="new-shipment-btn"
              onClick={() => {
                setError(null);
                setEdit({ effectiveDate: today, percent: '', note: '' });
              }}
            >
              + Change VAT rate
            </button>
          </div>
        )}
      </div>
      <ErrorBanner error={list.error} />

      {edit && (
        <div className={h.form}>
          <label>
            Effective from
            <input
              type="date"
              className="form-field-box"
              value={edit.effectiveDate}
              onChange={(e) => setEdit({ ...edit, effectiveDate: e.target.value })}
            />
          </label>
          <label>
            VAT %
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              className="form-field-box"
              value={edit.percent}
              placeholder={String(current)}
              onChange={(e) => setEdit({ ...edit, percent: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Note
            <input
              className="form-field-box"
              value={edit.note}
              placeholder="Optional, e.g. the Prakas or law"
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
              disabled={save.isPending || !edit.effectiveDate || !percentOk}
              onClick={() => void submit()}
            >
              Save
            </button>
          </div>
          {edit.effectiveDate < today && !edit.id && (
            <p className={h.error}>
              This date is in the past. Only documents made from now on take the new rate; documents
              already made keep theirs.
            </p>
          )}
          {error && <p className={h.error}>{error}</p>}
        </div>
      )}

      <div className={h.summary}>
        <span>
          VAT today: <b>{fmtVatPercent(current)}%</b>
          {currentRow ? ` since ${fmt(currentRow.effectiveDate)}` : ' (standard rate)'}
        </span>
        {next && (
          <span className={h.nextChip}>
            Next: <b>{fmtVatPercent(next.percent)}%</b> from {fmt(next.effectiveDate)}
          </span>
        )}
      </div>

      <div className={h.table}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Effective from</th>
              <th style={{ textAlign: 'right' }}>VAT</th>
              <th>Status</th>
              <th>Note</th>
              {manage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status =
                r.effectiveDate > today
                  ? 'Scheduled'
                  : r.id === currentRow?.id
                    ? 'Current'
                    : 'Past';
              return (
                <tr key={r.id}>
                  <td>{fmt(r.effectiveDate)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <b>{fmtVatPercent(r.percent)}%</b>
                  </td>
                  <td>{status}</td>
                  <td>{r.note ?? ''}</td>
                  {manage && (
                    <td>
                      <span className={h.actions}>
                        <button
                          type="button"
                          className={h.iconBtn}
                          title="Edit"
                          aria-label={`Edit VAT from ${fmt(r.effectiveDate)}`}
                          onClick={() => {
                            setError(null);
                            setEdit({
                              id: r.id,
                              effectiveDate: r.effectiveDate,
                              percent: fmtVatPercent(r.percent),
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
                          aria-label={`Remove VAT from ${fmt(r.effectiveDate)}`}
                          onClick={() => remove(r)}
                        >
                          {icons.trash({})}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            <tr>
              <td>
                {rows.length ? `Before ${fmt(rows[rows.length - 1]!.effectiveDate)}` : 'Always'}
              </td>
              <td style={{ textAlign: 'right' }}>
                <b>{DEFAULT_VAT_PERCENT}%</b>
              </td>
              <td>{currentRow ? 'Past' : 'Current'}</td>
              <td>Standard rate</td>
              {manage && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
