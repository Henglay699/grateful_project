import { useMemo, useState } from 'react';
import { mihExportTotal } from '@gs/shared';
import { FilePicker } from '../../components/FilePicker';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useLookups } from '../../features/hooks';
import { useMihYear, useSaveMihMonth } from '../../features/reports';
import { fmtMoney, fmtNum } from '../../lib/format';
import { loadWorkbook, matchClient, periodLabel } from './payroll';
import { readMihWorkbook, type MihWorkbook } from './mihExcel';
import s from './Mih.module.css';

/**
 * Reports → MIH → Import Excel: brings the months of the factory's own MIH workbook into the
 * app. Each month's figures are kept; its year-to-date isn't (the app adds the months up), and
 * whatever didn't add up in the copy is noted on the month.
 */
export function MihImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (clientId: string, year: number) => void;
}) {
  const toast = useToast();
  const lookups = useLookups();
  const clients = useMemo(() => lookups.data?.clients ?? [], [lookups.data]);
  const save = useSaveMihMonth();
  const [file, setFile] = useState<File | null>(null);
  const [book, setBook] = useState<(MihWorkbook & { fileName: string }) | null>(null);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState('');
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState('');

  const year = book?.months[0] ? Number(book.months[0].period.slice(0, 4)) : 0;
  const existing = useMihYear(clientId || undefined, year);
  const saved = new Set((existing.data?.months ?? []).map((m) => m.period));

  const open = async (f: File | null) => {
    setFile(f);
    setError('');
    setBook(null);
    if (!f) return;
    try {
      const read = readMihWorkbook(await loadWorkbook(f));
      if (!read.months.length)
        throw new Error(
          'No month sheets found. Each month needs its own sheet named like "9-SEP", with the Domestic / Export header row.',
        );
      setBook({ ...read, fileName: f.name });
      setClientId((c) => c || matchClient(read.company, clients) || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setFile(null);
    }
  };

  const toSave = (book?.months ?? []).filter((m) => replace || !saved.has(m.period));
  const run = async () => {
    if (!book || !clientId) return;
    let done = 0;
    try {
      for (const m of toSave) {
        setProgress(`Saving ${periodLabel(m.period)}…`);
        await save.mutateAsync({
          period: m.period,
          clientId,
          data: m.data,
          source: 'excel',
          fileName: book.fileName,
          issues: m.issues,
          replace: saved.has(m.period),
        });
        done++;
      }
      toast(`${done} month${done === 1 ? '' : 's'} imported.`);
      onDone(clientId, year);
    } catch {
      setProgress(`${done} saved; stopped at the next month.`);
      return;
    }
  };

  return (
    <Modal
      title="Import MIH workbook"
      sub="One sheet per month, as sent to the Ministry"
      onClose={onClose}
      width={760}
    >
      <FilePicker
        id="mih-file"
        accept=".xlsx"
        hint="Excel workbook (.xlsx) with sheets like 1-JAN … 9-SEP"
        file={file}
        onChange={(f) => void open(f)}
      />
      {error && (
        <div className={ui.notice} style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {book && (
        <>
          <label className={s.dialogField} style={{ marginTop: 12 }}>
            <span>Factory (client)</span>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className={s.sub}>
            {book.company || 'The workbook'}: {book.months.length} month
            {book.months.length === 1 ? '' : 's'}. Each month’s own figures are imported. The
            year-to-date columns aren’t: the app adds the months up itself, and notes on each month
            where the workbook’s figures didn’t add up.
          </p>
          <div className={s.scrollX} style={{ marginTop: 10 }}>
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Month</th>
                  <th className={s.num}>Staff</th>
                  <th className={s.num}>Export pcs</th>
                  <th className={s.num}>Export value</th>
                  <th className={s.num}>Notes</th>
                  <th>In the app</th>
                </tr>
              </thead>
              <tbody>
                {book.months.map((m) => {
                  const t = mihExportTotal(m.data);
                  const there = clientId && saved.has(m.period);
                  return (
                    <tr key={m.period}>
                      <td>{m.sheet}</td>
                      <td className="val-bold">{periodLabel(m.period)}</td>
                      <td className={s.num}>{fmtNum(m.data.employees)}</td>
                      <td className={s.num}>{fmtNum(t.qty)}</td>
                      <td className={s.num}>{fmtMoney(t.value)}</td>
                      <td className={s.num}>
                        {m.issues.length ? (
                          <span className={s.warn} title={m.issues.join('\n')}>
                            {m.issues.length}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        {!clientId ? (
                          '-'
                        ) : there ? (
                          <span className={replace ? s.warn : s.plain}>
                            {replace ? 'Will replace' : 'Saved · skipped'}
                          </span>
                        ) : (
                          <span className={s.ok}>New</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {saved.size > 0 && (
            <label className={s.check}>
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Replace the months already saved in the app with the workbook’s
            </label>
          )}
        </>
      )}
      {save.error ? <ErrorBanner error={save.error} /> : null}
      <div className={ui.actions}>
        {progress && <span className={s.muted}>{progress}</span>}
        <button type="button" className={ui.ghostBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="new-shipment-btn"
          disabled={!book || !clientId || !toSave.length || save.isPending || existing.isLoading}
          onClick={() => void run()}
        >
          {save.isPending
            ? 'Importing…'
            : book
              ? `Import ${toSave.length} month${toSave.length === 1 ? '' : 's'}`
              : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
