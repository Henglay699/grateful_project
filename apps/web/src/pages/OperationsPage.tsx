import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CLEARANCE_STATUS_LABEL,
  type ClearanceStatus,
  type DeclarationRegisterRow,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useDeclarationRegister, useDocuments } from '../features/admin';
import { useLookups } from '../features/hooks';
import { Modal, Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { DocumentUploadModal } from '../components/DocumentUpload';
import { fmtDate } from '../lib/format';
import { DocumentTable } from './DocumentsPage';

export function OperationsPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<DeclarationRegisterRow | null>(null);
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    month: params.get('month') || undefined,
    clientId: params.get('clientId') || undefined,
    direction: params.get('direction') || undefined,
    ledger: params.get('ledger') || undefined,
  };
  const list = useDeclarationRegister(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <section className="view active" id="view-operations">
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>Logistics Compliance &amp; Bill of Lading Documents</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              Every customs declaration with its shipment, ledger entry and attached documents.
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Declare no., shipment, HBL…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <input
              type="month"
              className={ui.input}
              value={q.month ?? ''}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            />
            <select
              className={ui.input}
              value={q.clientId ?? ''}
              onChange={(e) => set('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={q.direction ?? ''}
              onChange={(e) => set('direction', e.target.value)}
              aria-label="Direction"
            >
              <option value="">Import &amp; export</option>
              <option value="IMPORT">Import</option>
              <option value="EXPORT">Export</option>
            </select>
            <select
              className={ui.input}
              value={q.ledger ?? ''}
              onChange={(e) => set('ledger', e.target.value)}
              aria-label="Ledger"
            >
              <option value="">Any ledger status</option>
              <option value="without">Not yet in ledger</option>
              <option value="with">In ledger</option>
            </select>
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Declare No.</th>
                <th>Date</th>
                <th>Port</th>
                <th>Shipment</th>
                <th>HBL</th>
                <th>Client</th>
                <th>Type</th>
                <th>Clearance</th>
                <th>Ledger</th>
                <th style={{ textAlign: 'center' }}>CDC</th>
                <th style={{ textAlign: 'center' }}>Docs</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={11}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText="No declarations match these filters."
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td className="val-bold">{r.declareNo ?? 'Pending'}</td>
                  <td>{fmtDate(r.declareDate)}</td>
                  <td>{r.portCode ?? '-'}</td>
                  <td>
                    <Link
                      to={`/plans/${r.shipmentId}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
                    >
                      {r.shipmentReference}
                    </Link>
                  </td>
                  <td>{r.hblNo ?? '-'}</td>
                  <td>{r.clientCode}</td>
                  <td>{r.direction}</td>
                  <td>
                    {CLEARANCE_STATUS_LABEL[r.clearanceStatus as ClearanceStatus] ??
                      r.clearanceStatus}
                  </td>
                  <td>
                    {r.ledgerId ? (
                      (r.invNo ?? 'Entered')
                    ) : (
                      <span style={{ color: 'var(--status-pending-fg)', fontWeight: 700 }}>
                        Not yet
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{r.cdcLines || '-'}</td>
                  <td
                    style={{
                      textAlign: 'center',
                      fontWeight: 700,
                      color: r.documents ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    {r.documents}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          />
        )}
      </div>
      {open && (
        <DeclarationDocs
          row={open}
          canUpload={can('documents:write')}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

function DeclarationDocs({
  row,
  canUpload,
  onClose,
}: {
  row: DeclarationRegisterRow;
  canUpload: boolean;
  onClose: () => void;
}) {
  const docs = useDocuments({ shipmentId: row.shipmentId, pageSize: 100 });
  const [uploading, setUploading] = useState(false);
  return (
    <Modal
      title={`${row.declareNo ?? 'Pending'} · ${row.shipmentReference}`}
      sub={`${row.clientCode} · ${row.direction} · declared ${fmtDate(row.declareDate)}`}
      width={900}
      onClose={onClose}
    >
      <div className={ui.toolbar} style={{ marginBottom: 12, justifyContent: 'flex-end' }}>
        <Link to={`/plans/${row.shipmentId}`} className="filter-btn" onClick={onClose}>
          Open shipment
        </Link>
        {canUpload && (
          <button type="button" className="new-shipment-btn" onClick={() => setUploading(true)}>
            + Upload BL / document
          </button>
        )}
      </div>
      <DocumentTable rows={docs.data?.data} loading={docs.isLoading} error={docs.error} />
      {uploading && (
        <DocumentUploadModal
          shipmentId={row.shipmentId}
          defaultCategory="BILL_OF_LADING"
          onClose={() => setUploading(false)}
        />
      )}
    </Modal>
  );
}
