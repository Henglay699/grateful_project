import { useState } from 'react';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDeleteInvoice } from '../../features/accounting';

/**
 * Confirms deleting a shipment's invoice set (tax invoice, DIS, debit note). Its numbers are
 * released to the next approved shipment, it goes back to "not invoiced" and its Chea payment
 * back to Unchecked. A reason is required and kept in the audit history.
 */
export function DeleteInvoiceDialog({
  recordId,
  declareNo,
  numbers,
  onClose,
  onDeleted,
}: {
  recordId: string;
  declareNo: string;
  /** The numbers on the shipment now, e.g. ['GS26-394', 'DIS437', 'JR2610001']. */
  numbers: string[];
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const del = useDeleteInvoice();
  const [reason, setReason] = useState('');
  const canDelete = reason.trim().length >= 3 && !del.isPending;

  const run = async () => {
    const res = await del.mutateAsync({ recordId, reason: reason.trim() });
    const kept = res.released.filter((r) => r.kept).map((r) => r.number);
    const passed = res.reassigned.map(
      (r) => `${r.numbers.map((n) => n.number).join(' · ')} → ${r.declareNo}`,
    );
    toast(
      [
        `Invoice deleted for ${declareNo}.`,
        passed.length
          ? `Given to: ${passed.join('; ')}.`
          : kept.length
            ? `${kept.join(', ')} will go to the next approved shipment.`
            : 'The next approved shipment continues from these numbers.',
      ].join(' '),
    );
    onDeleted?.();
    onClose();
  };

  return (
    <Modal
      title={`Delete the invoice for ${declareNo}?`}
      sub="This can't be undone. The documents are deleted and the shipment is not invoiced any more."
      onClose={onClose}
      width={540}
    >
      <ErrorBanner error={del.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canDelete) void run().catch(() => undefined);
        }}
        noValidate
      >
        <ul
          className={ui.dialogSub}
          style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}
        >
          <li>
            Deletes its tax invoice, disbursement and debit note
            {numbers.length ? ` (${numbers.join(', ')})` : ''}.
          </li>
          <li>
            Releases the numbers: the next approved shipment takes them, so there are no gaps.
          </li>
          <li>Its Chea payment goes back to Unchecked. Check it again to give it new numbers.</li>
        </ul>
        <div className="form-field-group">
          <label htmlFor="del-inv-reason">Reason (required)</label>
          <input
            id="del-inv-reason"
            className="form-field-box"
            placeholder="e.g. Billed to the wrong client; clearance date was wrong"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" className="filter-btn" onClick={onClose}>
            Keep invoice
          </button>
          <button type="submit" className="btn-delete-shipment" disabled={!canDelete}>
            {del.isPending ? 'Deleting…' : 'Delete invoice'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
