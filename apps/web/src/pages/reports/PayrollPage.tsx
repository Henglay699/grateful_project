import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Workbook } from 'exceljs';
import type { PayrollMonthDetail } from '@gs/shared';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { FilePicker } from '../../components/FilePicker';
import { SearchBox } from '../../components/SearchBox';
import { StatTile, StatTiles } from '../../components/StatTiles';
import { ErrorBanner, ui } from '../../components/ui';
import { usePayrollMonth } from '../../features/reports';
import { icons } from '../../layout/icons';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import {
  CATEGORIES,
  DEPARTMENTS,
  loadWorkbook,
  payrollFromSaved,
  payrollSheets,
  periodLabel,
  readPayroll,
  type PayrollGroup,
  type PayrollReport,
} from './payroll';
import { exportPayrollExcel } from './payrollExport';
import { CapacityReport } from './CapacityReport';
// Bklit's charts (visx, motion) load only when the Charts view is opened.
const PayrollCharts = lazy(() =>
  import('./PayrollCharts').then((m) => ({ default: m.PayrollCharts })),
);
import { SavedMonths, SaveMonthDialog } from './PayrollMonths';
import s from './Payroll.module.css';

interface Loaded {
  fileName: string;
  /** Read from a file: the workbook and its payroll sheets (none when reopened from the list). */
  wb?: Workbook;
  sheets: string[];
  report: PayrollReport;
  /** Saved on the server: opened from the list, or saved after importing. */
  saved?: { id: string; savedByName: string | null; savedAt: string };
}

const savedInfo = (m: PayrollMonthDetail): Loaded['saved'] => ({
  id: m.id,
  savedByName: m.savedByName,
  savedAt: m.savedAt,
});

/** The Payroll views, by ?view= (Analysis is the default, with no param). */
const VIEWS: [key: string, label: string][] = [
  ['charts', 'Charts'],
  ['', 'Analysis'],
  ['capacity', 'Capacity report'],
];

/** The payroll on screen, kept for this session so switching tabs doesn't lose it. */
let lastLoaded: Loaded | null = null;

interface Filter {
  q: string;
  category: string;
  department: string;
  gender: string;
}
const NO_FILTER: Filter = { q: '', category: '', department: '', gender: '' };

/**
 * Reports → Payroll: import the month's salary sheet (.xlsx) and get back what the accountant's
 * formulas worked out: head counts by category and gender, salary totals, departments, how
 * gross pay is made up, pay bands, rows that don't add up, and the staff list.
 */
export function PayrollPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(lastLoaded);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const listRef = useRef<HTMLDivElement>(null);
  // Analysis (default) or the monthly capacity report built from it.
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const setView = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set('view', v);
    else next.delete('view');
    setParams(next, { replace: true });
  };

  const { can } = useAuth();
  const [saving, setSaving] = useState(false);

  const keep = (next: Loaded | null) => {
    lastLoaded = next;
    setLoaded(next);
  };
  /** ?payroll=<id>: the saved month on screen (so a reload or a link reopens it). */
  const setSavedParam = (id: string | null, extra: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries({ payroll: id, ...extra }))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: true });
  };

  const savedId = params.get('payroll') ?? undefined;
  const wanted = savedId && loaded?.saved?.id !== savedId ? savedId : undefined;
  const savedMonth = usePayrollMonth(wanted);
  useEffect(() => {
    const m = savedMonth.data;
    if (!m || m.id !== wanted) return;
    keep({ fileName: m.fileName, sheets: [], report: payrollFromSaved(m), saved: savedInfo(m) });
    setFilter(NO_FILTER);
  }, [savedMonth.data, wanted]);

  const close = () => {
    keep(null);
    setSavedParam(null, { view: null });
  };

  const open = async (f: File | null) => {
    setFile(f);
    setError('');
    if (!f) return;
    setBusy(true);
    try {
      const wb = await loadWorkbook(f);
      const sheets = payrollSheets(wb);
      if (!sheets.length)
        throw new Error(
          'No payroll sheet found. The sheet needs the staff header row with the 工號 (card no.) column.',
        );
      keep({ fileName: f.name, wb, sheets, report: readPayroll(wb.getWorksheet(sheets[0])!) });
      setFilter(NO_FILTER);
      setSavedParam(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setBusy(false);
      setFile(null);
    }
  };

  const pickSheet = (name: string) => {
    if (!loaded?.wb) return;
    // Another sheet is another payroll: it isn't the saved one any more.
    keep({ ...loaded, report: readPayroll(loaded.wb.getWorksheet(name)!), saved: undefined });
    setFilter(NO_FILTER);
    setSavedParam(null);
  };

  /** Clicking a category or department row narrows the staff list to it. */
  const showStaff = (next: Partial<Filter>) => {
    setFilter({ ...NO_FILTER, ...next });
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const r = loaded?.report;
  const capacity = view === 'capacity';
  const charts = view === 'charts';
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header-row" style={{ marginBottom: r ? 0 : 18 }}>
          <div style={{ minWidth: 0 }}>
            <h3>
              {r
                ? `${r.company || 'Payroll'} — ${periodLabel(r.period) || r.sheetName}`
                : 'Payroll analysis'}
            </h3>
            <p className={s.sub}>
              {r
                ? `${loaded.fileName} · sheet “${r.sheetName}” · ${r.totals.count} staff${
                    r.sections.length ? ` · section ${r.sections.join(', ')}` : ''
                  }`
                : 'Import the month’s salary sheet (薪资明细表) to get head counts, categories and salary totals.'}
              {loaded?.saved && (
                <>
                  {' · '}
                  <span className={s.savedNote}>
                    Saved {fmtDate(loaded.saved.savedAt.slice(0, 10))}
                    {loaded.saved.savedByName ? ` by ${loaded.saved.savedByName}` : ''}
                  </span>
                </>
              )}
            </p>
          </div>
          {r && (
            <div className={ui.toolbar}>
              <div className={s.views} role="group" aria-label="View">
                {VIEWS.map(([key, label]) => {
                  const on = (view ?? '') === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`filter-btn${on ? ' active' : ''}`}
                      aria-pressed={on}
                      onClick={() => setView(key)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {loaded.sheets.length > 1 && (
                <select
                  className={ui.input}
                  aria-label="Sheet"
                  value={r.sheetName}
                  onChange={(e) => pickSheet(e.target.value)}
                >
                  {loaded.sheets.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              )}
              {!loaded.saved && can('reports:write') && (
                <button type="button" className={ui.ghostBtn} onClick={() => setSaving(true)}>
                  Save month
                </button>
              )}
              <button type="button" className={ui.ghostBtn} onClick={close}>
                {loaded.saved ? 'All months' : 'Import another'}
              </button>
              {!capacity && (
                <button
                  type="button"
                  className="new-shipment-btn"
                  onClick={() => void exportPayrollExcel(r)}
                >
                  {icons.download({ width: 15, height: 15 })} Export Excel
                </button>
              )}
            </div>
          )}
        </div>
        {!r && (
          <>
            <FilePicker
              id="payroll-file"
              accept=".xlsx"
              hint={
                busy
                  ? 'Reading…'
                  : 'Excel .xlsx · read in your browser; nothing is stored until you press Save month'
              }
              file={file}
              onChange={(f) => void open(f)}
            />
            {error && (
              <div className={ui.alert} role="alert" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {!r &&
        (wanted && !savedMonth.error ? (
          <div className="card">Opening the saved month…</div>
        ) : (
          <>
            {savedMonth.error ? <ErrorBanner error={savedMonth.error} /> : null}
            <SavedMonths onOpen={(id) => setSavedParam(id, { view: null })} />
          </>
        ))}
      {saving && r && loaded && (
        <SaveMonthDialog
          report={r}
          fileName={loaded.fileName}
          onClose={() => setSaving(false)}
          onSaved={(m) => {
            setSaving(false);
            keep({ ...loaded, report: payrollFromSaved(m), saved: savedInfo(m) });
            setSavedParam(m.id);
          }}
        />
      )}

      {r && capacity && <CapacityReport payroll={r} />}
      {r && charts && (
        <Suspense fallback={<div className="card">Loading charts…</div>}>
          <PayrollCharts r={r} />
        </Suspense>
      )}
      {r && !capacity && !charts && (
        <Report
          r={r}
          filter={filter}
          setFilter={setFilter}
          showStaff={showStaff}
          listRef={listRef}
        />
      )}
    </>
  );
}

function Report({
  r,
  filter,
  setFilter,
  showStaff,
  listRef,
}: {
  r: PayrollReport;
  filter: Filter;
  setFilter: (f: Filter) => void;
  showStaff: (f: Partial<Filter>) => void;
  listRef: React.RefObject<HTMLDivElement>;
}) {
  const t = r.totals;
  const deductions = t.advance + t.pension + t.tax;
  const pct = (n: number) => (t.count ? `${Math.round((n / t.count) * 100)}%` : '-');
  return (
    <>
      <StatTiles columns={6}>
        <StatTile label="Total staff" value={fmtNum(t.count)} />
        <StatTile label="Female" value={`${fmtNum(t.female)} · ${pct(t.female)}`} />
        <StatTile label="Male" value={`${fmtNum(t.male)} · ${pct(t.male)}`} />
        <StatTile label="Gross salary" value={fmtMoney(t.gross)} tone="info" />
        <StatTile
          label="Deductions"
          value={fmtMoney(deductions)}
          tooltip={`Half-month advance ${fmtMoney(t.advance)} · Pension 2% ${fmtMoney(t.pension)} · Salary tax ${fmtMoney(t.tax)}`}
        />
        <StatTile label="Net pay" value={fmtMoney(t.net)} tone="success" />
      </StatTiles>
      <StatTiles columns={4}>
        <StatTile label="Average gross" value={fmtMoney(t.count ? t.gross / t.count : 0)} />
        <StatTile label="Average net" value={fmtMoney(t.count ? t.net / t.count : 0)} />
        <StatTile label="Overtime hours" value={fmtNum(t.otHours, 1)} />
        <StatTile
          label={`Joined in ${periodLabel(r.period) || 'the month'}`}
          value={r.period ? fmtNum(t.newJoiners) : '-'}
        />
      </StatTiles>

      <div className={s.grid2}>
        <GroupCard
          title="Staff by category"
          note="From the card no.: OFF = office staff (foreign when the Khmer name repeats the English one), SW = sewing, others = production."
          head="Category"
          groups={r.byCategory}
          totals={t}
          label={(g) => (
            <>
              <span className={s.kh}>{g.labelKh}</span>
              <span className={s.muted}>{g.label}</span>
            </>
          )}
          onPick={(g) => showStaff({ category: g.key })}
        />
        <GroupCard
          title="Staff by department"
          note="Grouped by the letters of the card no."
          head="Department"
          groups={r.byDepartment}
          totals={t}
          label={(g) => (
            <>
              <span className="val-bold">{g.key}</span>
              {g.label !== g.key && <span className={s.muted}>{g.label}</span>}
            </>
          )}
          onPick={(g) => showStaff({ department: g.key })}
        />
      </div>

      <div className={s.grid2}>
        <div className="card">
          <div className="card-header-row">
            <h3>Gross salary make-up</h3>
          </div>
          <table className="data-table-clean">
            <tbody>
              {r.components.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className={s.num}>{share(c.amount, t.gross)}</td>
                  <td className={s.num}>{fmtMoney(c.amount)}</td>
                </tr>
              ))}
              <tr className={s.total}>
                <td>Gross salary</td>
                <td />
                <td className={s.num}>{fmtMoney(t.gross)}</td>
              </tr>
              <tr>
                <td>− Half-month advance (25th)</td>
                <td />
                <td className={s.num}>{fmtMoney(t.advance)}</td>
              </tr>
              <tr>
                <td>− Pension 2%</td>
                <td />
                <td className={s.num}>{fmtMoney(t.pension)}</td>
              </tr>
              <tr>
                <td>− Salary tax</td>
                <td />
                <td className={s.num}>{fmtMoney(t.tax)}</td>
              </tr>
              <tr className={s.total}>
                <td>Net pay (salary balance)</td>
                <td />
                <td className={s.num}>{fmtMoney(t.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header-row">
            <h3>Staff by gross pay</h3>
          </div>
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Gross pay</th>
                <th className={s.num}>F</th>
                <th className={s.num}>M</th>
                <th className={s.num}>Total</th>
                <th style={{ width: '40%' }} />
              </tr>
            </thead>
            <tbody>
              {r.bands.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className={s.num}>{b.female}</td>
                  <td className={s.num}>{b.male}</td>
                  <td className={`${s.num} val-bold`}>{b.total}</td>
                  <td>
                    <span
                      className={s.bar}
                      style={{ width: `${t.count ? (b.total / t.count) * 100 : 0}%` }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.issues.length > 0 && (
            <div className={s.issues}>
              <h4>
                {r.issues.length} {r.issues.length === 1 ? 'row needs' : 'rows need'} a look
              </h4>
              <ul>
                {r.issues.map((i, n) => (
                  <li key={n}>
                    <span className="val-bold">{i.card}</span>{' '}
                    <span className={s.muted}>(row {i.row})</span> — {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <StaffList r={r} filter={filter} setFilter={setFilter} listRef={listRef} />
    </>
  );
}

const share = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(1)}%` : '');

function GroupCard({
  title,
  note,
  head,
  groups,
  totals,
  label,
  onPick,
}: {
  title: string;
  note: string;
  head: string;
  groups: PayrollGroup[];
  totals: PayrollReport['totals'];
  label: (g: PayrollGroup) => React.ReactNode;
  onPick: (g: PayrollGroup) => void;
}) {
  return (
    <div className="card">
      <div className="card-header-row" style={{ marginBottom: 6 }}>
        <h3>{title}</h3>
      </div>
      <p className={s.sub} style={{ marginBottom: 10 }}>
        {note}
      </p>
      <div className={s.scrollX}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>{head}</th>
              <th className={s.num}>F</th>
              <th className={s.num}>M</th>
              <th className={s.num}>Total</th>
              <th className={s.num}>Gross salary</th>
              <th className={s.num}>Net pay</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.key}
                className={s.pick}
                title="Show these staff below"
                onClick={() => onPick(g)}
              >
                <td>
                  <span className={s.stack}>{label(g)}</span>
                </td>
                <td className={s.num}>{g.female}</td>
                <td className={s.num}>{g.male}</td>
                <td className={`${s.num} val-bold`}>{g.total}</td>
                <td className={s.num}>{fmtMoney(g.gross)}</td>
                <td className={s.num}>{fmtMoney(g.net)}</td>
              </tr>
            ))}
            <tr className={s.total}>
              <td>Total</td>
              <td className={s.num}>{totals.female}</td>
              <td className={s.num}>{totals.male}</td>
              <td className={s.num}>{totals.count}</td>
              <td className={s.num}>{fmtMoney(totals.gross)}</td>
              <td className={s.num}>{fmtMoney(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CATEGORY_KH = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.labelKh]));

function StaffList({
  r,
  filter,
  setFilter,
  listRef,
}: {
  r: PayrollReport;
  filter: Filter;
  setFilter: (f: Filter) => void;
  listRef: React.RefObject<HTMLDivElement>;
}) {
  const set = (k: keyof Filter, v: string) => setFilter({ ...filter, [k]: v });
  const rows = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return r.staff.filter(
      (x) =>
        (!filter.category || x.category === filter.category) &&
        (!filter.department || x.department === filter.department) &&
        (!filter.gender || x.gender === filter.gender) &&
        (!q || `${x.card} ${x.nameEn} ${x.nameKh}`.toLowerCase().includes(q)),
    );
  }, [r.staff, filter]);
  const total = (f: (x: PayrollReport['staff'][number]) => number) =>
    rows.reduce((t, x) => t + f(x), 0);
  const filtered = Object.values(filter).some(Boolean);

  return (
    <div className="card" ref={listRef} style={{ scrollMarginTop: 16 }}>
      <div className="card-header-row">
        <h3>
          Staff list{' '}
          <span className={s.muted}>
            {filtered ? `${rows.length} of ${r.staff.length}` : r.staff.length}
          </span>
        </h3>
        <div className={ui.toolbar}>
          <SearchBox
            placeholder="Card no. or name"
            value={filter.q}
            onChange={(e) => set('q', e.target.value)}
            aria-label="Search staff"
          />
          <select
            className={ui.input}
            aria-label="Category"
            value={filter.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className={ui.input}
            aria-label="Department"
            value={filter.department}
            onChange={(e) => set('department', e.target.value)}
          >
            <option value="">All departments</option>
            {r.byDepartment.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label === d.key ? d.key : `${d.key} — ${d.label}`}
              </option>
            ))}
          </select>
          <select
            className={ui.input}
            aria-label="Gender"
            value={filter.gender}
            onChange={(e) => set('gender', e.target.value)}
          >
            <option value="">F and M</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
          {filtered && (
            <button type="button" className={ui.ghostBtn} onClick={() => setFilter(NO_FILTER)}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className={s.scroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>No.</th>
              <th>Card no.</th>
              <th>Name</th>
              <th>Gender</th>
              <th>Category</th>
              <th>Joined</th>
              <th className={s.num}>Days</th>
              <th className={s.num}>Base</th>
              <th className={s.num}>OT hrs</th>
              <th className={s.num}>Gross</th>
              <th className={s.num}>Deductions</th>
              <th className={s.num}>Net pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.row}>
                <td>{x.no}</td>
                <td className="val-bold">{x.card}</td>
                <td>
                  <span className={s.stack}>
                    <span>{x.nameEn}</span>
                    {x.nameKh && x.nameKh !== x.nameEn && (
                      <span className={`${s.kh} ${s.muted}`}>{x.nameKh}</span>
                    )}
                  </span>
                </td>
                <td>{x.gender}</td>
                <td>
                  <span className={s.stack}>
                    <span className={s.kh}>{CATEGORY_KH[x.category]}</span>
                    <span className={s.muted}>{DEPARTMENTS[x.department] ?? x.department}</span>
                  </span>
                </td>
                <td>{fmtDate(x.joinDate)}</td>
                <td className={s.num}>{fmtNum(x.daysWorked, 2)}</td>
                <td className={s.num}>{fmtMoney(x.baseSalary)}</td>
                <td className={s.num}>{fmtNum(x.otHours, 1)}</td>
                <td className={s.num}>{fmtMoney(x.gross)}</td>
                <td className={s.num}>{fmtMoney(x.advance + x.pension + x.tax)}</td>
                <td className={`${s.num} val-bold`}>{fmtMoney(x.net)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className={ui.empty}>
                  No staff match these filters.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className={s.total}>
                <td colSpan={8}>Total ({rows.length} staff)</td>
                <td className={s.num}>
                  {fmtNum(
                    total((x) => x.otHours),
                    1,
                  )}
                </td>
                <td className={s.num}>{fmtMoney(total((x) => x.gross))}</td>
                <td className={s.num}>{fmtMoney(total((x) => x.advance + x.pension + x.tax))}</td>
                <td className={s.num}>{fmtMoney(total((x) => x.net))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
