import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useShipments } from '../features/hooks';
import { ShipmentStatusPill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { useToast } from '../components/Toast';
import { downloadFile } from '../lib/files';
import { ImportPlanDialog } from './plans/ImportPlanDialog';
import { fmtDate } from '../lib/format';
import { BASE_COLUMNS, EXPANDED_COLUMNS } from './plans/columns';
import { PlansFilter, type PlansFilterValue } from './plans/PlansFilter';
import { PlansMoreMenu } from './plans/PlansMoreMenu';
import { CardToggle } from './dashboard/parts';
import { CLOSED_STAGE, OWNER_LABEL, stagesFor } from '@gs/shared';

const PREFS = 'gs:plans-view';
const columnsFor = (expand: boolean, direction: 'IMPORT' | 'EXPORT') =>
  [...BASE_COLUMNS, ...(expand ? EXPANDED_COLUMNS : [])].filter((c) =>
    direction === 'EXPORT' ? !c.importOnly : !c.exportOnly,
  );

function readPrefs(): { expandAll: boolean; frozen: string[] } {
  try {
    return {
      expandAll: false,
      frozen: [],
      ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as object),
    };
  } catch {
    return { expandAll: false, frozen: [] };
  }
}

export function ShippingPlansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const [prefs, setPrefs] = useState(readPrefs);
  const [exporting, setExporting] = useState(false);

  const filters = {
    clientId: params.getAll('clientId'),
    // Always Import or Export (Import unless the link asks for Export).
    direction: (params.get('direction') === 'EXPORT' ? 'EXPORT' : 'IMPORT') as 'IMPORT' | 'EXPORT',
    status: (params.get('status') ?? '') as PlansFilterValue['status'],
    // Declaration month (YYYY-MM), or the month added while undeclared; empty = every month.
    month: params.get('month') ?? '',
    // Workflow stage: '' = all, OPEN = every stage but Closed, or one stage key.
    stage: params.get('stage') ?? '',
    q: params.get('q') ?? '',
    page: Number(params.get('page') ?? 1),
    // Newest customs clearance (declaration) date first, unless another order is picked.
    sort: params.get('sort') ?? '-clearanceDate',
  };
  const query = {
    page: filters.page,
    pageSize: Number(params.get('pageSize') ?? 50),
    sort: filters.sort,
    q: filters.q || undefined,
    clientId: filters.clientId,
    direction: filters.direction,
    status: filters.status || undefined,
    month: filters.month || undefined,
    stage: filters.stage || undefined,
  };
  const list = useShipments(query);
  const cols = useMemo(
    () => columnsFor(prefs.expandAll, filters.direction),
    [prefs.expandAll, filters.direction],
  );
  // Export rows end on ETD / ATD (leaving Cambodia) instead of Arrive FTY.
  const isExport = filters.direction === 'EXPORT';

  const apply = (v: PlansFilterValue) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (v.status) next.set('status', v.status);
    else next.delete('status');
    setParams(next);
    const p = { expandAll: v.expandAll, frozen: v.frozen };
    setPrefs(p);
    localStorage.setItem(PREFS, JSON.stringify(p));
  };
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: k === 'q' });
  };

  // Freeze panes: pin chosen columns with sticky `left` offsets measured from the header.
  const headRef = useRef<HTMLTableRowElement>(null);
  const [lefts, setLefts] = useState<Record<string, number>>({});
  const frozenKeys = cols.filter((c) => prefs.frozen.includes(c.key)).map((c) => c.key);
  useLayoutEffect(() => {
    const ths = Array.from(headRef.current?.children ?? []) as HTMLElement[];
    let acc = 0;
    const next: Record<string, number> = {};
    cols.forEach((c, i) => {
      if (frozenKeys.includes(c.key)) {
        next[c.key] = acc;
        acc += ths[i]?.offsetWidth ?? 0;
      }
    });
    setLefts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, prefs.frozen.join(','), list.data]);
  const frozenProps = (key: string) => {
    if (!(key in lefts)) return {};
    const edge = frozenKeys[frozenKeys.length - 1] === key;
    return {
      className: `frozen-col${edge ? ' frozen-col-edge' : ''}`,
      style: { left: lefts[key] },
    };
  };

  const [importing, setImporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/shipments/export.xlsx', {
        clientId: filters.clientId,
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        month: filters.month || undefined,
        stage: filters.stage || undefined,
        q: filters.q || undefined,
        sort: filters.sort,
      });
    } catch {
      toast('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const filterValue: PlansFilterValue = {
    status: filters.status,
    ...prefs,
  };
  return (
    <section className="view active" id="view-plans">
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>Live Consignments Tracking</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              Real-time status of cargo clearance and delivery checkpoints.
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              grow
              placeholder="Invoice, HBL, container, declare no…"
              defaultValue={filters.q}
              aria-label="Search shipments"
              key={filters.q}
              onKeyDown={(e) =>
                e.key === 'Enter' && setParam('q', (e.target as HTMLInputElement).value.trim())
              }
              onBlur={(e) =>
                e.target.value.trim() !== filters.q && setParam('q', e.target.value.trim())
              }
            />
            <select
              className={ui.input}
              value={filters.stage}
              onChange={(e) => setParam('stage', e.target.value)}
              aria-label="Workflow stage"
              title="Workflow stage"
            >
              <option value="">All stages</option>
              <option value="OPEN">Open jobs</option>
              {stagesFor(filters.direction).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} — {OWNER_LABEL[s.owner]}
                </option>
              ))}
              <option value={CLOSED_STAGE}>Closed</option>
            </select>
            <input
              type="month"
              className={ui.input}
              value={filters.month}
              onChange={(e) => setParam('month', e.target.value)}
              aria-label="Declaration month"
              title="Declaration month"
            />
            <select
              className={ui.input}
              value={filters.clientId.length === 1 ? filters.clientId[0] : ''}
              onChange={(e) => setParam('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            {/* Always Import or Export; the URL only carries Export. One click flips it,
                like the Overview's Forwarder Statistics toggle. */}
            <CardToggle
              label="Import or Export"
              value={filters.direction}
              onChange={(d) => setParam('direction', d === 'EXPORT' ? 'EXPORT' : '')}
              options={[
                { value: 'IMPORT', label: 'Import' },
                { value: 'EXPORT', label: 'Export' },
              ]}
            />
            <PlansFilter
              value={filterValue}
              onApply={apply}
              columnsFor={(expand) => columnsFor(expand, filters.direction)}
            />
            <PlansMoreMenu
              exporting={exporting}
              onExport={() => void doExport()}
              onImport={can('shipments:write') ? () => setImporting(true) : undefined}
            />
          </div>
        </div>
        {filters.q && (
          <div className="create-header-desc" style={{ marginBottom: 10 }}>
            Showing results for “{filters.q}”.{' '}
            <button type="button" className="filter-mini-link" onClick={() => setParam('q', '')}>
              Clear search
            </button>
          </div>
        )}
        <div className={`plans-table-scroll${prefs.expandAll ? ' expanded' : ''}`}>
          <table className="data-table-clean">
            <thead>
              <tr ref={headRef}>
                {cols.map((c) => (
                  <th key={c.key} {...frozenProps(c.key)}>
                    {c.label}
                  </th>
                ))}
                {isExport ? (
                  <>
                    <th>ETD</th>
                    <th>ATD</th>
                  </>
                ) : (
                  <th>Arrive FTY</th>
                )}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols.length + (isExport ? 3 : 2)}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  filters.q ||
                  filters.clientId.length ||
                  filters.month ||
                  filters.direction === 'EXPORT' ||
                  filters.stage ||
                  filters.status
                    ? 'No shipments match the selected filters.'
                    : 'No shipments yet. Create one with “New Shipment”.'
                }
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => navigate(`/plans/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${r.id}`)}
                >
                  {cols.map((c) => {
                    const fp = frozenProps(c.key);
                    return (
                      <td
                        key={c.key}
                        {...fp}
                        className={
                          [fp.className, c.bold ? 'val-bold' : ''].filter(Boolean).join(' ') ||
                          undefined
                        }
                      >
                        {c.render(r)}
                      </td>
                    );
                  })}
                  {isExport ? (
                    <>
                      <td>{fmtDate(r.etd)}</td>
                      <td>{fmtDate(r.atd)}</td>
                    </>
                  ) : (
                    <td>{fmtDate(r.arriveFty)}</td>
                  )}
                  <td>
                    <ShipmentStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(n) => setParam('pageSize', String(n))}
          />
        )}
      </div>
      {importing && <ImportPlanDialog onClose={() => setImporting(false)} />}
    </section>
  );
}
