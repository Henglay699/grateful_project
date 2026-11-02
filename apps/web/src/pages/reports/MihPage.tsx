import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  materialKeyOf,
  mihChecks,
  mihExportTotal,
  mihTotals,
  type MihMonth,
  type MihQV,
  type MihYear,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { StatTile, StatTiles } from '../../components/StatTiles';
import { ErrorBanner, ui } from '../../components/ui';
import { useLookups } from '../../features/hooks';
import { useMihMonths, useMihYear } from '../../features/reports';
import { icons } from '../../layout/icons';
import { fmtMoney, fmtNum } from '../../lib/format';
import { periodLabel } from './payroll';
import { MihImportDialog } from './MihImport';
import { MihMonthEditor } from './MihMonthEditor';
import s from './Mih.module.css';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Reports → MIH: the monthly report to the Ministry of Industry, Science, Technology &
 * Innovation. A factory's year is listed month by month with the running totals; opening a
 * month shows the report to fill in (?month=2026-09). Factory and year sit in the URL too.
 */
export function MihPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const clients = useMemo(() => lookups.data?.clients ?? [], [lookups.data]);
  const list = useMihMonths();
  const [importing, setImporting] = useState(false);
  const [pickMonth, setPickMonth] = useState(thisMonth());

  // Default: the factory and year of the newest saved month.
  const newest = list.data?.[0];
  const clientId = params.get('client') ?? newest?.clientId ?? '';
  const year = Number(params.get('year') ?? newest?.period.slice(0, 4) ?? new Date().getFullYear());
  const month = params.get('month');
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ client: clientId, year: String(year), ...patch }))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: !('month' in patch) });
  };
  const yearData = useMihYear(clientId || undefined, year);
  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear + 1, thisYear, thisYear - 1, thisYear - 2, year])].sort(
    (a, b) => b - a,
  );

  return (
    <>
      {!month && (
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
            <label className={s.field} style={{ minWidth: 110 }}>
              <span>Year</span>
              <select
                className={ui.input}
                value={year}
                onChange={(e) => set({ year: e.target.value })}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span>Open a month</span>
              <div className={s.btnRow}>
                <input
                  className={ui.input}
                  type="month"
                  value={pickMonth}
                  onChange={(e) => setPickMonth(e.target.value)}
                />
                <button
                  type="button"
                  className={ui.ghostBtn}
                  disabled={!clientId || !pickMonth}
                  onClick={() => set({ year: pickMonth.slice(0, 4), month: pickMonth })}
                >
                  Open
                </button>
              </div>
            </label>
            <span className={s.spacer} />
            {can('reports:write') && (
              <button
                type="button"
                className={ui.ghostBtn}
                onClick={() => setImporting(true)}
                style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
              >
                {icons.upload({ width: 14, height: 14 })} Import Excel
              </button>
            )}
          </div>
          <p className={s.sub} style={{ marginTop: 10 }}>
            Each month keeps its own figures. “Year so far” is always the saved months added up by
            product, so a month fixed later corrects every month after it.
          </p>
        </div>
      )}

      {!clientId ? (
        <div className="card">
          Choose the factory{can('reports:write') ? ', or import its MIH workbook' : ''}.
        </div>
      ) : yearData.error ? (
        <ErrorBanner error={yearData.error} />
      ) : !yearData.data ? (
        <div className="card">Loading {year}…</div>
      ) : month ? (
        <MihMonthEditor
          key={`${clientId}${month}`}
          clientId={clientId}
          month={month}
          year={yearData.data}
          onBack={() => set({ month: null })}
        />
      ) : (
        <YearOverview
          data={yearData.data}
          canCreate={can('reports:write')}
          onOpen={(m) => set({ month: m })}
        />
      )}

      {importing && (
        <MihImportDialog
          onClose={() => setImporting(false)}
          onDone={(c, y) => {
            setImporting(false);
            set({ client: c, year: String(y), month: null });
          }}
        />
      )}
    </>
  );
}

const add = (a: MihQV | undefined, b: MihQV): MihQV => ({
  qty: (a?.qty ?? 0) + b.qty,
  value: (a?.value ?? 0) + b.value,
});
const utility = (m: MihMonth, section: 'energy' | 'water') =>
  m.data[section].reduce((t, u) => t + u.qty, 0);
const rawMaterial = (m: MihMonth) =>
  mihTotals([m.data]).get(materialKeyOf({ name: 'RAW MATERIAL' }, 'TOTAL'))?.value ?? 0;

/** The year month by month: staff, exports, the running total, materials, power and water. */
function YearOverview({
  data,
  canCreate,
  onOpen,
}: {
  data: MihYear;
  canCreate: boolean;
  onOpen: (month: string) => void;
}) {
  const now = thisMonth();
  const rows = useMemo(() => {
    let running: MihQV = { qty: 0, value: 0 };
    const last = data.months.at(-1)?.period ?? '';
    return MONTHS.map((label, i) => {
      const period = `${data.year}-${String(i + 1).padStart(2, '0')}`;
      const m = data.months.find((x) => x.period === period);
      if (m) running = add(running, mihExportTotal(m.data));
      const payroll = data.payroll.find((p) => p.period === period) ?? null;
      const toCheck = m ? mihChecks(period, m.data, data.months, payroll).length : 0;
      return { label, period, m, running, toCheck, show: !!m || period <= now || period <= last };
    }).filter((r) => r.show);
  }, [data, now]);

  const saved = data.months;
  const ytd = rows.at(-1)?.running ?? { qty: 0, value: 0 };
  const staffAvg = saved.length
    ? saved.reduce((t, m) => t + m.data.employees, 0) / saved.length
    : 0;
  const salary = saved.reduce((t, m) => t + m.data.salary, 0);
  const material = saved.reduce((t, m) => t + rawMaterial(m), 0);

  return (
    <>
      <StatTiles columns={5}>
        <StatTile label={`Exported ${data.year}`} value={`${fmtNum(ytd.qty)} pcs`} tone="info" />
        <StatTile label="Export value" value={fmtMoney(ytd.value)} tone="success" />
        <StatTile label="Salaries paid" value={fmtMoney(salary)} />
        <StatTile label="Average staff" value={fmtNum(Math.round(staffAvg))} />
        <StatTile label="Raw material bought" value={fmtMoney(material)} />
      </StatTiles>
      <div className="card">
        <div className="card-header-row" style={{ marginBottom: 6 }}>
          <h3>
            {data.year} month by month <span className={s.muted}>{saved.length} saved</span>
          </h3>
        </div>
        <div className={s.scrollX}>
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Month</th>
                <th className={s.num}>Staff · women</th>
                <th className={s.num}>Salary</th>
                <th className={s.num}>Export pcs</th>
                <th className={s.num}>Export value</th>
                <th className={s.num}>YTD pcs</th>
                <th className={s.num}>YTD value</th>
                <th className={s.num}>Raw material</th>
                <th className={s.num}>kW · m³</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, period, m, running, toCheck }) => {
                if (!m)
                  return (
                    <tr key={period} className={s.missing}>
                      <td className="val-bold">{label}</td>
                      <td colSpan={8}>Not saved: the year to date leaves this month out.</td>
                      <td className={s.num}>
                        {canCreate ? (
                          <button
                            type="button"
                            className={ui.ghostBtn}
                            onClick={() => onOpen(period)}
                          >
                            Create
                          </button>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  );
                const t = mihExportTotal(m.data);
                return (
                  <tr
                    key={period}
                    className={s.pick}
                    onClick={() => onOpen(period)}
                    title={`Open ${periodLabel(period)}`}
                  >
                    <td className="val-bold">{label}</td>
                    <td className={s.num}>
                      {fmtNum(m.data.employees)} · {fmtNum(m.data.female)}
                    </td>
                    <td className={s.num}>{fmtMoney(m.data.salary)}</td>
                    <td className={`${s.num} val-bold`}>{fmtNum(t.qty)}</td>
                    <td className={s.num}>{fmtMoney(t.value)}</td>
                    <td className={s.num}>{fmtNum(running.qty)}</td>
                    <td className={s.num}>{fmtMoney(running.value)}</td>
                    <td className={s.num}>{fmtMoney(rawMaterial(m))}</td>
                    <td className={s.num}>
                      {fmtNum(utility(m, 'energy'))} · {fmtNum(utility(m, 'water'))}
                    </td>
                    <td title={m.source === 'excel' ? `Imported from ${m.fileName}` : undefined}>
                      {toCheck ? (
                        <span className={s.warn}>{toCheck} to check</span>
                      ) : (
                        <span className={s.ok}>OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className={s.total}>
                <td>Total</td>
                <td />
                <td className={s.num}>{fmtMoney(salary)}</td>
                <td className={s.num}>{fmtNum(ytd.qty)}</td>
                <td className={s.num}>{fmtMoney(ytd.value)}</td>
                <td colSpan={2} />
                <td className={s.num}>{fmtMoney(material)}</td>
                <td className={s.num}>
                  {fmtNum(saved.reduce((x, m) => x + utility(m, 'energy'), 0))} ·{' '}
                  {fmtNum(saved.reduce((x, m) => x + utility(m, 'water'), 0))}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
