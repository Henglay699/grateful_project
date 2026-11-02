import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBanner, ui } from '../../components/ui';
import { useLookups } from '../../features/hooks';
import { useCustomsReport } from '../../features/reports';
import { icons } from '../../layout/icons';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { CustomsSheet } from './CustomsSheet';
import { exportCustomsExcel } from './customsExport';
import { printCustoms } from './customsPrint';
import { buildCustomsModel, DEFAULT_SIGNER_TITLE, lastDay } from './importExport';
import s from './Capacity.module.css';

const thisMonth = () => new Date().toISOString().slice(0, 7);
type Direction = 'IMPORT' | 'EXPORT';

/** The signer's name, remembered per factory in this browser. */
const signerKey = (clientId: string) => `gs:customs-signer:${clientId}`;
function readSigner(clientId: string): string {
  try {
    return localStorage.getItem(signerKey(clientId)) ?? '';
  } catch {
    return '';
  }
}

/**
 * Reports → Import & Export: the factory's report of raw materials imported (or goods
 * exported) by customs declaration, one row per commercial invoice line, from the shipments'
 * "I …" / "E …" declarations. Imports default to the year so far, exports to the month.
 * Factory, report and months sit in the URL.
 */
export function ImportExportPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const clients = useMemo(() => lookups.data?.clients ?? [], [lookups.data]);
  const clientId = params.get('client') ?? (clients.length === 1 ? clients[0]!.id : '');
  const direction: Direction = params.get('report') === 'export' ? 'EXPORT' : 'IMPORT';
  const to = params.get('to') ?? thisMonth();
  const from = params.get('from') ?? (direction === 'IMPORT' ? `${to.slice(0, 4)}-01` : to);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: true });
  };

  const [signerName, setSignerName] = useState('');
  const [signTitle, setSignTitle] = useState(DEFAULT_SIGNER_TITLE);
  const [signDate, setSignDate] = useState('');
  useEffect(() => setSignerName(clientId ? readSigner(clientId) : ''), [clientId]);
  useEffect(() => setSignDate(lastDay(to)), [to]);
  const onSigner = (v: string) => {
    setSignerName(v);
    try {
      localStorage.setItem(signerKey(clientId), v);
    } catch {
      /* private mode: kept for this visit only */
    }
  };

  const report = useCustomsReport({ clientId: clientId || undefined, direction, from, to });
  const m = useMemo(
    () =>
      report.data &&
      buildCustomsModel(report.data, { date: signDate, title: signTitle, name: signerName }),
    [report.data, signDate, signTitle, signerName],
  );
  const declarations = new Set(m?.rows.map((r) => r.declareNo)).size;

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className={s.controls}>
          <label className={s.field}>
            <span>Factory (client)</span>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => set({ client: e.target.value })}
            >
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className={s.field} style={{ minWidth: 0 }}>
            <span>Report</span>
            <div className="an-seg-control" role="tablist" aria-label="Report">
              {(['IMPORT', 'EXPORT'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={direction === d}
                  className={`an-seg-btn${direction === d ? ' active' : ''}`}
                  // Each report keeps its own default period.
                  onClick={() => set({ report: d.toLowerCase(), from: null })}
                >
                  {d === 'IMPORT' ? 'Imports (raw materials)' : 'Exports'}
                </button>
              ))}
            </div>
          </div>
          <label className={s.field} style={{ minWidth: 150 }}>
            <span>From month</span>
            <input
              className={ui.input}
              type="month"
              value={from}
              max={to}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label className={s.field} style={{ minWidth: 150 }}>
            <span>To month</span>
            <input
              className={ui.input}
              type="month"
              value={to}
              onChange={(e) =>
                set(
                  e.target.value && e.target.value < from
                    ? { to: e.target.value, from: e.target.value }
                    : { to: e.target.value },
                )
              }
            />
          </label>
        </div>
        <div className={s.controls} style={{ marginTop: 12 }}>
          <label className={s.field} style={{ minWidth: 150 }}>
            <span>Signed on</span>
            <input
              className={ui.input}
              type="date"
              value={signDate}
              onChange={(e) => setSignDate(e.target.value)}
            />
          </label>
          <label className={s.field}>
            <span>Signer’s position</span>
            <input
              className={ui.input}
              value={signTitle}
              onChange={(e) => setSignTitle(e.target.value)}
            />
          </label>
          <label className={s.field}>
            <span>Signer’s name</span>
            <input
              className={ui.input}
              value={signerName}
              placeholder="e.g. the company director"
              onChange={(e) => onSigner(e.target.value)}
            />
          </label>
          <span className={s.spacer} />
          <button
            type="button"
            className={ui.ghostBtn}
            disabled={!m}
            onClick={() => m && printCustoms(m)}
          >
            Print / PDF
          </button>
          <button
            type="button"
            className={ui.ghostBtn}
            disabled={!m}
            onClick={() => m && void exportCustomsExcel(m)}
          >
            {icons.download({ width: 14, height: 14 })} Excel
          </button>
        </div>
        {m && (
          <p className={s.hint} style={{ marginTop: 10 }}>
            {m.rows.length
              ? `${m.rows.length} invoice lines on ${declarations} customs declaration${declarations === 1 ? '' : 's'} dated in the period: ${fmtNum(m.totals.netWeightKg, 2)} kg net, ${fmtMoney(m.totals.value)} customs value (the invoices’ FOB).`
              : `No ${direction === 'IMPORT' ? 'import' : 'export'} declarations dated in the period.`}
          </p>
        )}
        {!!report.data?.undeclared.length && (
          <div className={ui.notice} style={{ marginTop: 10 }}>
            Not on the report — no {direction === 'IMPORT' ? '“I …”' : '“E …”'} customs declaration
            yet:{' '}
            {report.data.undeclared.map((u, i) => (
              <span key={u.shipmentId}>
                {i > 0 && ', '}
                <Link to={`/plans/${u.shipmentId}`}>{u.reference}</Link> ({fmtDate(u.date)},{' '}
                {u.lines} line{u.lines === 1 ? '' : 's'})
              </span>
            ))}
            .
          </div>
        )}
      </div>
      {!clientId ? (
        <div className="card">Choose the factory to build its report.</div>
      ) : from > to ? (
        <div className="card">The From month is after the To month.</div>
      ) : report.error ? (
        <ErrorBanner error={report.error} />
      ) : !m ? (
        <div className="card">Loading the declarations…</div>
      ) : (
        <div className={s.preview}>
          <CustomsSheet m={m} />
        </div>
      )}
    </>
  );
}
