import { useState } from 'react';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  type DocumentCategory,
  type DocumentRow,
} from '@gs/shared';
import { useApiMutation } from '../features/admin';
import { useLookups } from '../features/hooks';
import { api, ApiError } from '../lib/api';
import { fmtFileSize } from '../lib/format';
import { FilePicker } from './FilePicker';
import { ErrorBanner, Modal, ui } from './ui';
import { useToast } from './Toast';

/**
 * Upload one file with its metadata. Pass shipmentId / creditNoteId / recordSummaryId and
 * clientId to link it.
 * Pass `doc` instead to edit an existing document's details (the file itself stays).
 */
export function DocumentUploadModal({
  shipmentId,
  creditNoteId,
  recordSummaryId,
  clientId,
  defaultCategory = 'OTHER',
  doc,
  maxMb = 20,
  onClose,
}: {
  shipmentId?: string;
  creditNoteId?: string;
  recordSummaryId?: string;
  clientId?: string;
  defaultCategory?: DocumentCategory;
  doc?: DocumentRow;
  /** The largest file allowed (a shipment's support documents: 10 MB). */
  maxMb?: number;
  onClose: () => void;
}) {
  const lookups = useLookups();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(doc?.title ?? '');
  const [category, setCategory] = useState<DocumentCategory>(doc?.category ?? defaultCategory);
  const [statusLabel, setStatusLabel] = useState(doc?.statusLabel ?? '');
  const [client, setClient] = useState(doc ? (doc.clientId ?? '') : (clientId ?? ''));
  const upload = useApiMutation((allowDuplicate?: boolean) => {
    if (doc)
      return api(`/documents/${doc.id}`, {
        method: 'PATCH',
        json: { title, category, statusLabel, ...(clientId ? {} : { clientId: client }) },
      });
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('title', title || file!.name);
    fd.append('category', category);
    if (statusLabel) fd.append('statusLabel', statusLabel);
    if (shipmentId) fd.append('shipmentId', shipmentId);
    if (creditNoteId) fd.append('creditNoteId', creditNoteId);
    if (recordSummaryId) fd.append('recordSummaryId', recordSummaryId);
    if (client) fd.append('clientId', client);
    if (allowDuplicate) fd.append('allowDuplicate', 'true');
    return api('/documents', { method: 'POST', body: fd });
  }, [['documents'], ['operations']]);
  const tooBig = !!file && file.size > maxMb * 1024 * 1024;
  // The server refuses a file already attached here (same content); offer to keep both.
  const duplicate =
    upload.error instanceof ApiError &&
    upload.error.status === 409 &&
    (upload.error.details as { duplicate?: boolean } | undefined)?.duplicate === true;
  const send = (allowDuplicate?: boolean) =>
    void upload.mutateAsync(allowDuplicate).then(() => {
      toast(doc ? 'Document updated.' : 'Document uploaded.');
      onClose();
    });
  return (
    <Modal
      title={doc ? 'Edit document' : 'Upload document'}
      sub={
        doc
          ? `${doc.originalName} · ${fmtFileSize(doc.sizeBytes)}`
          : shipmentId || creditNoteId || recordSummaryId
            ? `Kept with this ${shipmentId ? 'shipment' : creditNoteId ? 'credit note' : 'record summary'}; it also shows in the Document Library.`
            : 'Add a file to the document library and link it to a client.'
      }
      onClose={onClose}
      width={560}
    >
      {duplicate ? (
        <div className={ui.warnBox} role="alert">
          <b>Already attached.</b> {upload.error!.message} Uploading it again usually means the
          same scan is filed twice.
          <button type="button" className={ui.linkBtn} onClick={() => send(true)}>
            Upload anyway
          </button>
        </div>
      ) : (
        <ErrorBanner error={upload.error} />
      )}
      <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div
          className="form-field-group"
          style={{ gridColumn: 'span 2', display: doc ? 'none' : undefined }}
        >
          <label htmlFor="up-file">File</label>
          <FilePicker
            id="up-file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.txt"
            hint={`PDF, images, Excel, CSV, Word or text · up to ${maxMb} MB`}
            file={file}
            onChange={(f) => {
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          {tooBig && <span className={ui.fieldError}>This file is larger than {maxMb} MB.</span>}
        </div>
        <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="up-title">Title</label>
          <input
            id="up-title"
            className="form-field-box"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Original BL — SHP-26-0012"
          />
        </div>
        <div className="form-field-group">
          <label htmlFor="up-cat">Category</label>
          <select
            id="up-cat"
            className="form-select-box"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field-group">
          <label htmlFor="up-status">Status</label>
          <input
            id="up-status"
            className="form-field-box"
            value={statusLabel}
            onChange={(e) => setStatusLabel(e.target.value)}
            placeholder="e.g. Signed, Verified"
          />
        </div>
        {!clientId && (
          <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="up-client">Client</label>
            <select
              id="up-client"
              className="form-select-box"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="">— none —</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={(doc ? title.trim().length < 2 : !file || tooBig) || upload.isPending}
          onClick={() => send()}
        >
          {doc
            ? upload.isPending
              ? 'Saving…'
              : 'Save changes'
            : upload.isPending
              ? 'Uploading…'
              : 'Upload'}
        </button>
      </div>
    </Modal>
  );
}
