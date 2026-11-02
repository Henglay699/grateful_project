import { useState } from 'react';
import type { PayrollMonthDetail } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBanner, Modal, TableState, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useLookups } from '../../features/hooks';
import {
  useDeletePayrollMonth,
  usePayrollMonths,
  useSavePayrollMonth,
} from '../../features/reports';
import { icons } from '../../layout/icons';
import { ApiError } from '../../lib/api';
import { fmtMoney, fmtNum } from '../../lib/format';
import { matchClient, payrollToSave, periodLabel, type PayrollReport } from './payroll';
import s from './Payroll.module.css';

/** "2026-10-23T08:15:00.000Z" → "23 Oct 2026". */
const savedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Reports → Payroll → Saved months: one row per company and month saved from an imported
 * payroll, newest first. Clicking a row reopens it (analysis, staff list, capacity report).
 */
export function SavedMonths({ onOpen }: { onOpen: (id: string) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = usePayrollMonths();
  const del = useDeletePayrollMonth();
  const rows = list.data ?? [];

  const remove = (id: string, label: string) => {
    if (!window.confirm(`Delete the saved payroll for ${label}? The file itself isn't affected.`))
      return;
    del.mutate(id, { onSuccess: () => toast(`${label} deleted.`) });
  };

  return (
    <div className="card">
      <div className="card-header-row" style={{ marginBottom: 6 }}>
        <h3>
          Saved months <span className={s.muted}>{rows.length || ''}</span>
        </h3>
      </div>
      <p className={s.sub} style={{ marginBottom: 10 }}>
        Each payroll saved with “Save month”. Click a month to open it again without the file.
      </p>
      {del.error ? <ErrorBanner error={del.error} /> : null}
      <div className={s.scrollX}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Month</th>
              <th>Company</th>
              <th>File · sheet</th>
              <th className={s.num}>Staff</th>
              <th className={s.num}>F</th>
              <th className={s.num}>M</th>
              <th className={s.num}>Gross salary</th>
              <th className={s.num}>Net pay</th>
              <th>Saved</th>
              {can('reports:write') && <th />}
            </tr>
          </thead>
          <tbody>
            <TableState
              loading={list.isLoading}
              error={list.error}
              empty={rows.length === 0}
              cols={can('reports:write') ? 10 : 9}
              emptyText="No months saved yet. Import a payroll and press “Save month”."
            />
            {rows.map((m) => {
              const label = `${m.company} ${periodLabel(m.period)}`;
              return (
                <tr key={m.id} className={s.pick} onClick={() => onOpen(m.id)} title="Open">
                  <td className="val-bold">{periodLabel(m.period)}</td>
                  <td>{m.company}</td>
                  <td>
                    <span className={s.stack}>
                      <span>{m.fileName || '-'}</span>
                      {m.sheetName && <span className={s.muted}>{m.sheetName}</span>}
                    </span>
                  </td>
                  <td className={`${s.num} val-bold`}>{fmtNum(m.staffCount)}</td>
                  <td className={s.num}>{fmtNum(m.female)}</td>
                  <td className={s.num}>{fmtNum(m.male)}</td>
                  <td className={s.num}>{fmtMoney(m.gross)}</td>
                  <td className={s.num}>{fmtMoney(m.net)}</td>
                  <td>
                    <span className={s.stack}>
                      <span>{savedOn(m.savedAt)}</span>
                      {m.savedByName && <span className={s.muted}>{m.savedByName}</span>}
                    </span>
                  </td>
                  {can('reports:write') && (
                    <td>
                      <button
                        type="button"
                        className={s.iconBtn}
                        aria-label={`Delete ${label}`}
                        title="Delete"
                        disabled={del.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(m.id, label);
                        }}
                      >
                        {icons.trash({ width: 15, height: 15 })}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Payroll → Save month: the month comes from the sheet's title (asked for when the title has
 * none). Saving a month that is already saved asks before replacing it.
 */
export function SaveMonthDialog({
  report,
  fileName,
  onClose,
  onSaved,
}: {
  report: PayrollReport;
  fileName: string;
  onClose: () => void;
  onSaved: (m: PayrollMonthDetail) => void;
}) {
  const toast = useToast();
  const lookups = useLookups();
  const save = useSavePayrollMonth();
  const [period, setPeriod] = useState(report.period ?? '');
  const [exists, setExists] = useState(false);

  const submit = (replace: boolean) => {
    const clientId = matchClient(report.company, lookups.data?.clients ?? []) ?? null;
    save.mutate(payrollToSave(report, { fileName, clientId, period, replace }), {
      onSuccess: (m) => {
        toast(`${m.company} ${periodLabel(m.period)} ${replace ? 'replaced' : 'saved'}.`);
        onSaved(m);
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) setExists(true);
      },
    });
  };
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  return (
    <Modal
      title="Save payroll month"
      sub={`${report.company || 'Payroll'} · ${report.totals.count} staff`}
      onClose={onClose}
      width={460}
    >
      <label className={s.dialogField}>
        <span>Month</span>
        <input
          className={ui.input}
          type="month"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setExists(false);
            save.reset();
          }}
        />
      </label>
      {exists ? (
        <div className={ui.notice}>
          {periodLabel(period)} is already saved for {report.company}. Replace it with this file?
        </div>
      ) : (
        <p className={s.sub}>
          Saves every staff row and the totals, so the month can be opened again from the list. Only
          people with Reports access can see it.
        </p>
      )}
      {save.error && !conflict ? <ErrorBanner error={save.error} /> : null}
      <div className={ui.actions}>
        <button type="button" className={ui.ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="new-shipment-btn"
          disabled={!period || !report.company || save.isPending}
          onClick={() => submit(exists)}
        >
          {save.isPending ? 'Saving…' : exists ? 'Replace' : 'Save month'}
        </button>
      </div>
    </Modal>
  );
}
