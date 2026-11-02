import { useState } from 'react';
import type { CutStockImportResult } from '@gs/shared';
import { useImportMasterList } from '../../features/hooks';
import { FilePicker } from '../../components/FilePicker';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';

/** Upload a master list workbook: preview the changes first, then apply. */
export function ImportModal({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [updateOpening, setUpdateOpening] = useState(false);
  const [preview, setPreview] = useState<CutStockImportResult | null>(null);
  const imp = useImportMasterList();
  const toast = useToast();

  const run = async (dryRun: boolean) => {
    if (!file) return;
    const r = await imp.mutateAsync({ clientId, file, dryRun, updateOpening });
    if (dryRun) setPreview(r);
    else {
      toast(`Master list updated: ${r.created} added, ${r.updated} changed.`);
      onClose();
    }
  };

  return (
    <Modal
      title={`Import CDC master list for ${clientName}`}
      width={620}
      onClose={onClose}
      sub="Use the same layout as JR CDC MASTER LIST.xlsx. Items are matched on the Declare column (I-1, III-195…)."
    >
      <ErrorBanner error={imp.error} />
      <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field-group">
          <label htmlFor="imp-file">Workbook (.xlsx)</label>
          <FilePicker
            id="imp-file"
            accept=".xlsx"
            hint="Excel workbook (.xlsx)"
            file={file}
            onChange={(f) => {
              setFile(f);
              setPreview(null);
            }}
          />
        </div>
        <label
          className="filter-check-item"
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={updateOpening}
            onChange={(e) => {
              setUpdateOpening(e.target.checked);
              setPreview(null);
            }}
          />
          <span>
            Also replace the “imported before this system” figures of existing items with the
            sheet’s IMPORTED column. Leave unticked to keep the balances recorded here.
          </span>
        </label>
      </div>
      {preview && (
        <div style={{ marginTop: 16, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          Preview: {preview.created} new, {preview.updated} changed, {preview.unchanged} unchanged.
          {preview.errors.length > 0 && (
            <ul
              style={{
                margin: '8px 0 0 18px',
                color: 'var(--status-exception-fg)',
                fontWeight: 600,
              }}
            >
              {preview.errors.slice(0, 10).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        {!preview ? (
          <button
            type="button"
            className="btn-create-submit"
            disabled={!file || imp.isPending}
            onClick={() => void run(true)}
          >
            {imp.isPending ? 'Reading…' : 'Preview changes'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-create-submit"
            disabled={imp.isPending || preview.created + preview.updated === 0}
            onClick={() => void run(false)}
          >
            {imp.isPending ? 'Importing…' : `Apply ${preview.created + preview.updated} changes`}
          </button>
        )}
      </div>
    </Modal>
  );
}
