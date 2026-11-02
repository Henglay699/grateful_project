import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CUT_STOCK_CATEGORIES, CUT_STOCK_CATEGORY_LABEL } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useCutStock, useLookups } from '../features/hooks';
import { TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { StatTile, StatTiles } from '../components/StatTiles';
import { useToast } from '../components/Toast';
import { downloadFile } from '../lib/files';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format';
import { CutStockItemModal } from './cutstock/CutStockItemModal';
import { ImportModal } from './cutstock/ImportModal';
import { PlansMoreMenu } from './plans/PlansMoreMenu';

const COND_STYLE = {
  OK: { color: 'var(--status-completed-fg)' },
  CHECK: { color: 'var(--status-exception-fg)' },
} as const;

export function CutStockPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [openItem, setOpenItem] = useState<string | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const clients = useMemo(() => lookups.data?.clients ?? [], [lookups.data]);
  const clientId = params.get('clientId') ?? '';
  // Default to the first client (JR in the seed) once lookups arrive.
  useEffect(() => {
    if (!clientId && clients.length) setParams({ clientId: clients[0]!.id }, { replace: true });
  }, [clientId, clients, setParams]);
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const condition = params.get('condition') ?? '';
  const list = useCutStock({
    clientId,
    q: q || undefined,
    category: category || undefined,
    condition: condition || undefined,
    pageSize: 500,
    sort: 'lineNo',
  });
  const client = clients.find((c) => c.id === clientId);
  const s = list.data?.summary;

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <section className="view active" id="view-cutstock">
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>Cut Stock Master List{client ? ` — ${client.name}` : ''}</h3>
          <div className={ui.toolbar}>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => setParams({ clientId: e.target.value })}
              aria-label="Client"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <SearchBox
              placeholder="Search item, declare no…"
              defaultValue={q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search items"
            />
            <select
              className={ui.input}
              value={category}
              onChange={(e) => set('category', e.target.value)}
              aria-label="Category"
            >
              <option value="">All Categories</option>
              {CUT_STOCK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CUT_STOCK_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={condition}
              onChange={(e) => set('condition', e.target.value)}
              aria-label="Condition"
            >
              <option value="">All conditions</option>
              <option value="OK">OK</option>
              <option value="CHECK">CHECK (balance under 50%)</option>
              <option value="OVER">Over-imported (below zero)</option>
            </select>
            {user?.role === 'ADMIN' && clientId && (
              <button
                type="button"
                className="new-shipment-btn"
                onClick={() => setOpenItem('new')}
              >
                + Add Item
              </button>
            )}
            <PlansMoreMenu
              exporting={exporting || !clientId}
              onExport={() => {
                setExporting(true);
                downloadFile('/cut-stock/export.xlsx', { clientId })
                  .catch(() => toast('Export failed. Try again.'))
                  .finally(() => setExporting(false));
              }}
              onImport={
                can('cutstock:write') && clientId ? () => setImporting(true) : undefined
              }
              exportHint={`${client?.name ?? 'This client'}'s master list · .xlsx`}
              importHint="CDC master list workbook · .xlsx"
            />
          </div>
        </div>
        <div id="cutstockSummary">
          {s && (
            <StatTiles columns={5}>
              <StatTile label="Items" value={fmtNum(s.items)} />
              <StatTile
                label="To check (under 50%)"
                value={s.checkCount}
                tone={s.checkCount > 0 ? 'warning' : undefined}
                pressed={condition === 'CHECK'}
                onClick={() => set('condition', condition === 'CHECK' ? '' : 'CHECK')}
                tooltip={condition === 'CHECK' ? 'Show all' : 'Show items to check only'}
              />
              <StatTile
                label="Over-imported"
                value={s.overImported}
                tone={s.overImported > 0 ? 'danger' : undefined}
                pressed={condition === 'OVER'}
                onClick={() => set('condition', condition === 'OVER' ? '' : 'OVER')}
                tooltip={condition === 'OVER' ? 'Show all' : 'Show over-imported only'}
              />
              <StatTile label="Licensed value" value={fmtMoney(s.totalValue)} />
              <StatTile label="Imported value" value={fmtMoney(s.importedValue)} />
            </StatTiles>
          )}
        </div>
        <div className="plans-table-scroll cutstock-table-wrap">
          <table className="data-table-clean cutstock-table">
            <thead>
              <tr>
                <th>No</th>
                <th>Item</th>
                <th>Type</th>
                <th>Unit</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Total Price</th>
                <th>Imported Qty</th>
                <th>Imported Price</th>
                <th>N.W</th>
                <th>Balance</th>
                <th>Balance %</th>
                <th>Condition</th>
                <th>Declare No</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={14}
                loading={list.isLoading || (!clientId && lookups.isLoading)}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  q || category || condition
                    ? 'No items match these filters.'
                    : 'No master list for this client yet. Use “Import Excel” to load it.'
                }
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpenItem(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpenItem(r.id)}
                >
                  <td>{r.lineNo}</td>
                  <td className="val-bold">{r.name}</td>
                  <td>{r.newOrUsed ?? '-'}</td>
                  <td>{r.unit}</td>
                  <td>{fmtNum(r.qty)}</td>
                  <td>{fmtNum(r.unitPrice, 2)}</td>
                  <td>{fmtNum(r.totalPrice, 2)}</td>
                  <td>{fmtNum(r.importedQty)}</td>
                  <td>{fmtNum(r.importedValue, 2)}</td>
                  <td>{fmtNum(r.importedNw, 2)}</td>
                  <td
                    style={{
                      fontWeight: 700,
                      color:
                        Number(r.balance) < 0
                          ? 'var(--status-exception-fg)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {fmtNum(r.balance)}
                  </td>
                  <td>{fmtPct(r.balancePct)}</td>
                  <td style={{ fontWeight: 700, ...COND_STYLE[r.condition] }}>{r.condition}</td>
                  <td>{r.declareRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {openItem && clientId && (
        <CutStockItemModal
          itemId={openItem === 'new' ? null : openItem}
          clientId={clientId}
          onClose={() => setOpenItem(null)}
        />
      )}
      {importing && client && (
        <ImportModal
          clientId={client.id}
          clientName={client.name}
          onClose={() => setImporting(false)}
        />
      )}
    </section>
  );
}
