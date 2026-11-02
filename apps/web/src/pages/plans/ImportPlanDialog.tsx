import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlanImportResult } from '@gs/shared';
import { Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ApiError } from '../../lib/api';
import { downloadFile, uploadFile } from '../../lib/files';
import { fmtDate } from '../../lib/format';
import m from './ImportPlanDialog.module.css';

const TRANSPORT: Record<string, string> = {
  'SEA FCL': 'Sea · CY/CY',
  'SEA LCL': 'Sea · LCL',
  'SEA NONE': 'Sea · Loose',
  'AIR NONE': 'Air',
  'ROAD NONE': 'Truck',
  'ROAD FCL': 'Truck · CY/CY',
  'RAIL NONE': 'Rail',
};

/**
 * Shipping Plans → Import Excel: download the template, choose the filled file, see what it
 * would create and every problem by sheet and row, then import it all at once.
 */
export function ImportPlanDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<PlanImportResult | null>(null);
  const [busy, setBusy] = useState<'template' | 'check' | 'save' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (f: File, save: boolean) => {
    setBusy(save ? 'save' : 'check');
    setFailure(null);
    try {
      const res = await uploadFile<PlanImportResult>('/shipments/import', f, {
        save: save ? '1' : undefined,
      });
      setCheck(res);
      if (res.saved) {
        await qc.invalidateQueries({ queryKey: ['shipments'] });
        await qc.invalidateQueries({ queryKey: ['overview'] });
        toast(`${res.shipments.length} shipment${res.shipments.length === 1 ? '' : 's'} imported.`);
      }
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'The file could not be read. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setCheck(null);
    void run(f, false);
  };
  const template = async () => {
    setBusy('template');
    try {
      await downloadFile('/shipments/import-template.xlsx');
    } catch {
      toast('The template could not be downloaded. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const ok = check && !check.errors.length && check.shipments.length > 0;
  return (
    <Modal
      title="Import shipping plan from Excel"
      sub="Fill in the template, then upload it here. It is checked first; nothing is saved until it has no problems."
      onClose={onClose}
      width={860}
    >
      <ol className={m.steps}>
        <li>
          <b>1. Get the template</b>
          <span>
            An Imports sheet laid out like the import schedule (one row per item), and Export sheets
            for shipments, containers, invoices and declarations.
          </span>
          <button
            type="button"
            className="filter-btn"
            onClick={() => void template()}
            disabled={busy === 'template'}
          >
            {busy === 'template' ? 'Downloading…' : '⤓ Download template'}
          </button>
        </li>
        <li>
          <b>2. Upload the filled file</b>
          <span>{file ? file.name : 'An .xlsx file made from the template.'}</span>
          <button
            type="button"
            className="filter-btn"
            onClick={() => input.current?.click()}
            disabled={!!busy}
          >
            {busy === 'check' ? 'Checking…' : file ? 'Choose another file' : 'Choose file'}
          </button>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </li>
      </ol>

      {failure && <p className={m.failure}>{failure}</p>}

      {check && (
        <div className={m.result}>
          {check.saved ? (
            <p className={m.done}>
              ✓ Imported {check.shipments.length} shipment
              {check.shipments.length === 1 ? '' : 's'}.
            </p>
          ) : check.errors.length ? (
            <div className={m.errors}>
              <b>
                {check.errors.length} problem{check.errors.length === 1 ? '' : 's'} to fix in the
                file, then upload it again. Nothing was saved.
              </b>
              <ul>
                {check.errors.map((e, i) => (
                  <li key={i}>
                    <span className={m.where}>
                      {e.sheet}
                      {e.row ? ` · row ${e.row}` : ''}
                    </span>
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={m.ready}>
              ✓ No problems found. {check.shipments.length} shipment
              {check.shipments.length === 1 ? '' : 's'} ready to import.
            </p>
          )}

          {(check.newForwarders.length > 0 || check.newConsignees.length > 0) && (
            <p className={ui.dialogSub}>
              {check.saved ? 'Added' : 'Will be added'}:{' '}
              {[
                ...check.newForwarders.map((f) => `forwarder ${f}`),
                ...check.newConsignees.map((c) => `consignee ${c.name} (${c.clientCode})`),
              ].join(' · ')}
            </p>
          )}

          {check.shipments.length > 0 && (
            <div className={m.tableWrap}>
              <table className={m.table}>
                <thead>
                  <tr>
                    <th>Ref</th>
                    {check.saved && <th>Shipment</th>}
                    <th>Client</th>
                    <th>Type</th>
                    <th>Freight</th>
                    <th>HBL No.</th>
                    <th>ETD / ETA</th>
                    <th className={m.num}>Ctnrs</th>
                    <th className={m.num}>Invoices</th>
                    <th className={m.num}>Declarations</th>
                  </tr>
                </thead>
                <tbody>
                  {check.shipments.map((s) => (
                    <tr key={s.ref}>
                      <td>{s.ref}</td>
                      {check.saved && <td className={m.ref}>{s.reference}</td>}
                      <td>{s.clientCode}</td>
                      <td>{s.direction === 'IMPORT' ? 'Import' : 'Export'}</td>
                      <td>{TRANSPORT[s.transport] ?? s.transport}</td>
                      <td>{s.hblNo ?? '—'}</td>
                      <td>{s.date ? fmtDate(s.date) : '—'}</td>
                      <td className={m.num}>{s.containers}</td>
                      <td className={m.num}>{s.invoices}</td>
                      <td className={m.num}>{s.declarations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className={m.actions}>
        <button type="button" className="filter-btn" onClick={onClose}>
          {check?.saved ? 'Close' : 'Cancel'}
        </button>
        {!check?.saved && (
          <button
            type="button"
            className="new-shipment-btn"
            disabled={!ok || !file || !!busy}
            onClick={() => file && void run(file, true)}
          >
            {busy === 'save'
              ? 'Importing…'
              : `Import ${check?.shipments.length ?? ''} shipment${check?.shipments.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
