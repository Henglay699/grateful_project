import { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { DocumentUploadModal } from '../../components/DocumentUpload';
import { Modal, ui } from '../../components/ui';
import { useDocuments } from '../../features/admin';
import { DocumentTable } from '../DocumentsPage';

/** What the support documents belong to: a shipment, a credit note or a record summary. */
export type SupportLink =
  { shipmentId: string } | { creditNoteId: string } | { recordSummaryId: string };

/**
 * Support documents (Shipping Plans → ⋯ → Support Documents; a credit note's or record
 * summary's ⋯ → Upload support documents): the files, each up to 10 MB, to preview, download,
 * edit or delete, and + Upload for another. They are ordinary Document Library entries linked
 * to what they support.
 */
export function SupportDocumentsModal({
  title,
  link,
  clientId,
  onClose,
}: {
  /** e.g. "SHP-26-0155" or "Credit Noted No. 28". */
  title: string;
  link: SupportLink;
  clientId: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const list = useDocuments({ ...link, pageSize: 200 });
  const [uploading, setUploading] = useState(false);
  const what =
    'shipmentId' in link ? 'shipment' : 'creditNoteId' in link ? 'credit note' : 'record summary';
  return (
    <Modal
      title={`Support documents · ${title}`}
      sub={`Files kept with this ${what}: PDF, images, Excel, CSV, Word or text, up to 10 MB each.`}
      onClose={onClose}
      // Near the full page width, so the file list reads like the Document Library.
      width={1400}
    >
      {can('documents:write') && (
        <div className={ui.toolbar} style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
          <button type="button" className="new-shipment-btn" onClick={() => setUploading(true)}>
            + Upload
          </button>
        </div>
      )}
      {/* Tall even when empty; scrolls with the dialog once the list outgrows the screen. */}
      <div style={{ minHeight: 'min(460px, 60vh)' }}>
        <DocumentTable rows={list.data?.data} loading={list.isLoading} error={list.error} />
      </div>
      {uploading && (
        <DocumentUploadModal
          {...link}
          clientId={clientId}
          maxMb={10}
          onClose={() => setUploading(false)}
        />
      )}
    </Modal>
  );
}
