import { useState } from 'react';
import type { BillingDoc } from '@gs/shared';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDocAction } from '../../features/accounting';

/**
 * Authorised correction of an ISSUED tax invoice, DIS or debit note: a new number and/or issue
 * date, with a reason that is kept in the audit history. (Drafts are changed in the editor.)
 */
export function CorrectDocDialog({
  doc,
  title,
  onClose,
}: {
  doc: BillingDoc;
  title: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const action = useDocAction(doc.type);
  const [number, setNumber] = useState(doc.number ?? '');
  const [date, setDate] = useState(doc.date);
  const [reason, setReason] = useState('');
  const changed = number.trim().toUpperCase() !== (doc.number ?? '') || date !== doc.date;
  const canSave = changed && reason.trim().length >= 3 && !action.isPending;

  const save = async () => {
    await action.mutateAsync({
      action: 'correct',
      id: doc.id,
      body: { number: number.trim(), date, reason: reason.trim() },
    });
    toast(`${title} corrected. The change is in the audit history.`);
    onClose();
  };

  return (
    <Modal
      title={`Correct ${title.toLowerCase()} ${doc.number ?? ''}`}
      sub="For a number or date issued in error. The old and new values and your reason are kept in the audit history."
      onClose={onClose}
      width={520}
    >
      <ErrorBanner error={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save().catch(() => undefined);
        }}
        noValidate
      >
        <div
          className="form-fields-grid"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
        >
          <div className="form-field-group">
            <label htmlFor="cx-number">Number</label>
            <input
              id="cx-number"
              className="form-field-box"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="form-field-group">
            <label htmlFor="cx-date">Issue date</label>
            <input
              id="cx-date"
              type="date"
              className="form-field-box"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="cx-reason">Reason (required)</label>
            <input
              id="cx-reason"
              className="form-field-box"
              placeholder="e.g. Number typed twice; the clearance date was wrong"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <p className={ui.dialogSub} style={{ marginTop: 10 }}>
          The Monthly Ledger shows the new number too. Numbers stay unique: one already used is
          refused.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="filter-btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn-create-submit" disabled={!canSave}>
            Save correction
          </button>
        </div>
      </form>
    </Modal>
  );
}
