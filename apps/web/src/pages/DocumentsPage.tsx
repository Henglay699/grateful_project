import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentRow } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useDocuments } from '../features/admin';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { useToast } from '../components/Toast';
import { DocumentUploadModal } from '../components/DocumentUpload';
import { DocumentPreview } from '../components/DocumentPreview';
import { api } from '../lib/api';
import { downloadFile } from '../lib/files';
import { fmtDate, fmtFileSize } from '../lib/format';
import { icons } from '../layout/icons';
import t from './DocumentTable.module.css';

export function DocumentTable({
  rows,
  loading,
  error,
  onChanged,
}: {
  rows: DocumentRow[] | undefined;
  loading: boolean;
  error: unknown;
  onChanged?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const remove = useApiMutation(
    (id: string) => api(`/documents/${id}`, { method: 'DELETE' }),
    [['documents'], ['operations']],
  );
  const [previewing, setPreviewing] = useState<DocumentRow | null>(null);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  return (
    <div className="plans-table-scroll">
      {previewing && <DocumentPreview doc={previewing} onClose={() => setPreviewing(null)} />}
      {editing && <DocumentUploadModal doc={editing} onClose={() => setEditing(null)} />}
      <table className="data-table-clean">
        <thead>
          <tr>
            <th>Document</th>
            <th>Category</th>
            <th>Linked to</th>
            <th>Uploaded</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <TableState
            cols={6}
            loading={loading}
            error={error}
            empty={rows?.length === 0}
            emptyText="No documents yet."
          />
          {rows?.map((d) => (
            <tr key={d.id} className={t.row} onClick={() => setPreviewing(d)}>
              <td>
                {/* The row is the click target; this button makes it reachable by keyboard. */}
                <button type="button" className={t.title}>
                  {d.title}
                </button>
                <div className={t.file}>
                  {d.originalName} · {fmtFileSize(d.sizeBytes)}
                </div>
              </td>
              <td>{DOCUMENT_CATEGORY_LABEL[d.category]}</td>
              <td>
                {d.shipmentId ? (
                  <Link
                    to={`/plans/${d.shipmentId}`}
                    style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {d.shipmentReference}
                  </Link>
                ) : null}
                {d.shipmentId && d.clientName ? ' · ' : ''}
                {d.clientName ?? (d.shipmentId ? '' : '-')}
              </td>
              <td>
                {fmtDate(d.createdAt)}
                {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
              </td>
              <td>{d.statusLabel ?? '-'}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <div className={t.actions}>
                  {can('documents:write') && (
                    <button
                      type="button"
                      className={t.action}
                      onClick={() => setEditing(d)}
                      title="Edit details"
                      aria-label={`Edit ${d.title}`}
                    >
                      {icons.edit({})}
                    </button>
                  )}
                  <button
                    type="button"
                    className={t.action}
                    onClick={() =>
                      downloadFile(`/documents/${d.id}/download`).catch(() =>
                        toast('Download failed.'),
                      )
                    }
                    title="Download"
                    aria-label={`Download ${d.title}`}
                  >
                    {icons.download({})}
                  </button>
                  {can('documents:write') && (
                    <button
                      type="button"
                      className={`${t.action} ${t.danger}`}
                      onClick={() =>
                        window.confirm(`Delete “${d.title}”?`) &&
                        void remove.mutateAsync(d.id).then(() => {
                          toast('Document deleted.');
                          onChanged?.();
                        })
                      }
                      title="Delete"
                      aria-label={`Delete ${d.title}`}
                    >
                      {icons.trash({})}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocumentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [uploading, setUploading] = useState(false);
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
  };
  const list = useDocuments(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <h3>Document Library</h3>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Title, file, shipment, client…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search documents"
            />
            <select
              className={ui.input}
              value={q.category ?? ''}
              onChange={(e) => set('category', e.target.value)}
              aria-label="Category"
            >
              <option value="">All categories</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            {can('documents:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setUploading(true)}>
                + Upload
              </button>
            )}
          </div>
        </div>
        <DocumentTable rows={list.data?.data} loading={list.isLoading} error={list.error} />
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          />
        )}
      </div>
      {uploading && <DocumentUploadModal onClose={() => setUploading(false)} />}
    </section>
  );
}
