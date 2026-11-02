import { Link } from 'react-router-dom';
import type { AccountRow } from '@gs/shared';
import { ChartState } from '../dashboard/parts';
import s from './AccountsBreakdown.module.css';

type Totals = {
  total: number;
  imports: number;
  exports: number;
  cy: number;
  lcl: number;
  air: number;
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/**
 * Analytics → Key Logistics Accounts: each client's shipments for the period, with its share,
 * the import / export split and the CY/CY, LCL and AIR counts; totals in the last row.
 */
export function AccountsBreakdown({
  rows,
  loading,
  error,
}: {
  rows: AccountRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const list = rows ?? [];
  const sum: Totals = list.reduce(
    (t, a) => ({
      total: t.total + a.all.total,
      imports: t.imports + a.import.total,
      exports: t.exports + a.export.total,
      cy: t.cy + a.all.cy,
      lcl: t.lcl + a.all.lcl,
      air: t.air + a.all.air,
    }),
    { total: 0, imports: 0, exports: 0, cy: 0, lcl: 0, air: 0 },
  );
  const busiest = Math.max(1, ...list.map((a) => a.all.total));

  return (
    <div className="card">
      <div className={s.head}>
        <div>
          <h3 className={s.title}>Key Logistics Accounts — Full Breakdown</h3>
          <div className={s.sub}>
            Every account, every flow and every shipment type in one view.
          </div>
        </div>
        {list.length > 0 && (
          <div className={s.kpis}>
            <Kpi label="Shipments" value={sum.total} />
            <Kpi label="Import" value={sum.imports} dot="import" />
            <Kpi label="Export" value={sum.exports} dot="export" />
            <Kpi label="Accounts" value={list.length} />
          </div>
        )}
      </div>

      <ChartState loading={loading} error={error} empty={!list.length} height={120}>
        <div className={s.table} role="table" aria-label="Shipments by client">
          <div className={`${s.row} ${s.headRow}`} role="row">
            <span role="columnheader">Client</span>
            <span role="columnheader">Shipments</span>
            <span role="columnheader">Import · Export</span>
            <span role="columnheader" className={s.modesHead}>
              <span>CY / CY</span>
              <span>LCL</span>
              <span>AIR</span>
            </span>
          </div>

          {list.map((a) => (
            <div className={s.row} role="row" key={a.clientId}>
              <span className={s.client} role="cell">
                <span className={s.badge}>{a.code}</span>
                <span className={s.who}>
                  <Link to={`/clients/${a.clientId}`} className={s.name}>
                    {a.name}
                  </Link>
                  <span className={s.meta}>{pct(a.all.total, sum.total)}% of all shipments</span>
                </span>
              </span>
              <span className={s.volume} role="cell">
                <b>{a.all.total}</b>
                <span className={s.track}>
                  <span style={{ width: `${(a.all.total / busiest) * 100}%` }} />
                </span>
              </span>
              <span role="cell">
                <Split imports={a.import.total} exports={a.export.total} />
              </span>
              <span className={s.modes} role="cell">
                <Mode label="CY / CY" value={a.all.cy} />
                <Mode label="LCL" value={a.all.lcl} />
                <Mode label="AIR" value={a.all.air} />
              </span>
            </div>
          ))}

          {list.length > 1 && (
            <div className={`${s.row} ${s.totalRow}`} role="row">
              <span className={s.client} role="cell">
                <span className={`${s.badge} ${s.badgeAll}`}>Σ</span>
                <span className={s.who}>
                  <span className={s.name}>All clients</span>
                  <span className={s.meta}>{list.length} accounts</span>
                </span>
              </span>
              <span className={s.volume} role="cell">
                <b>{sum.total}</b>
              </span>
              <span role="cell">
                <Split imports={sum.imports} exports={sum.exports} />
              </span>
              <span className={s.modes} role="cell">
                <Mode label="CY / CY" value={sum.cy} />
                <Mode label="LCL" value={sum.lcl} />
                <Mode label="AIR" value={sum.air} />
              </span>
            </div>
          )}
        </div>
      </ChartState>
    </div>
  );
}

function Kpi({ label, value, dot }: { label: string; value: number; dot?: 'import' | 'export' }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>
        {dot && <i className={dot === 'import' ? s.dotImport : s.dotExport} />}
        {label}
      </span>
      <b>{value}</b>
    </div>
  );
}

/** Import / export as one thin two-tone bar with both counts under it. */
function Split({ imports, exports }: { imports: number; exports: number }) {
  const total = imports + exports;
  return (
    <span className={s.split}>
      <span className={s.splitBar} aria-hidden>
        {total > 0 ? (
          <>
            <span className={s.barImport} style={{ flexGrow: imports }} />
            <span className={s.barExport} style={{ flexGrow: exports }} />
          </>
        ) : null}
      </span>
      <span className={s.splitText}>
        <span>
          <i className={s.dotImport} />
          {imports} import
        </span>
        <span>
          <i className={s.dotExport} />
          {exports} export
        </span>
      </span>
    </span>
  );
}

/** One shipment-type count; zero is shown muted. */
const Mode = ({ label, value }: { label: string; value: number }) => (
  <span className={s.mode} data-zero={value === 0 || undefined} title={`${label}: ${value}`}>
    {value}
  </span>
);
