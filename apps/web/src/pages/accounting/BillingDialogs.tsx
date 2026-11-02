import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  amountInWords,
  BILLING_PACK_TYPES,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  receiptInputSchema,
  type BillingPackType,
  type BillingStatement,
  type ReceiptInput,
} from '@gs/shared';
import { useCreateDrafts, useCreateReceipt } from '../../features/billing';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import { monthName, PACK_LABEL, periodCode, STATEMENT_TITLE } from './billingUi';
import b from './Billing.module.css';

/** Drafts for the month's shipments that are missing a document, in one go. */
export function DraftsModal({
  clientId,
  clientCode,
  month,
  missing,
  onClose,
}: {
  clientId: string;
  clientCode: string;
  month: string;
  missing: Record<BillingPackType, number>;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateDrafts(clientId);
  const [types, setTypes] = useState<BillingPackType[]>(
    BILLING_PACK_TYPES.filter((t) => missing[t] > 0),
  );
  const [lines, setLines] = useState<'previous' | 'ledger'>('previous');
  const count = types.reduce((n, t) => n + missing[t], 0);
  const toggle = (t: BillingPackType) =>
    setTypes((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  const submit = async () => {
    const r = await create.mutateAsync({ month, types, lines });
    const sources = [...new Set(r.created.map((c) => c.copiedFrom).filter(Boolean))];
    toast(
      `${r.created.length} draft${r.created.length === 1 ? '' : 's'} created` +
        (sources.length ? ` (lines from ${sources.join(', ')})` : '') +
        '. Check them, then issue.',
    );
    onClose();
  };

  return (
    <Modal
      title="Create missing drafts"
      sub={`${clientCode} · ${monthName(month)}: for each shipment without the document, filled from the shipment (customer, HBL, container, weights, POL/POD).`}
      onClose={onClose}
      width={620}
    >
      <ErrorBanner error={create.error} />
      <div className="form-section-title" style={{ marginBottom: 10 }}>
        Documents
      </div>
      <div className={b.methods} style={{ marginBottom: 16 }}>
        {BILLING_PACK_TYPES.map((t) => (
          <label key={t} className={b.choice} style={{ marginTop: 0, flex: '1 1 160px' }}>
            <input
              type="checkbox"
              checked={types.includes(t)}
              disabled={missing[t] === 0}
              onChange={() => toggle(t)}
            />
            <span>
              <b>{PACK_LABEL[t]}s</b>
              {missing[t]} missing
            </span>
          </label>
        ))}
      </div>
      <div className="form-section-title" style={{ marginBottom: 10 }}>
        Line items
      </div>
      <label className={b.choice}>
        <input
          type="radio"
          name="lines"
          checked={lines === 'previous'}
          onChange={() => setLines('previous')}
        />
        <span>
          <b>Copy from {clientCode}&apos;s last issued document (recommended)</b>
          Same import/export, the same container size when there is one. Change quantities or prices
          where this shipment differs.
        </span>
      </label>
      <label className={b.choice}>
        <input
          type="radio"
          name="lines"
          checked={lines === 'ledger'}
          onChange={() => setLines('ledger')}
        />
        <span>
          <b>One line with the Monthly Ledger amount</b>
          Used anyway when the client has no earlier document to copy.
        </span>
      </label>
      <p className={ui.dialogSub} style={{ marginTop: 14 }}>
        Drafts change nothing in the Monthly Ledger until they are issued.
      </p>
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={!count || create.isPending}
          onClick={() => void submit()}
        >
          {create.isPending ? 'Creating…' : `Create ${count} draft${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
const plain = (v: string) => String(Number(v));

/** A payment against one statement; saving issues the official receipt (OR26-001…). */
export function ReceiptModal({
  clientId,
  clientName,
  month,
  statement,
  onClose,
}: {
  clientId: string;
  clientName: string;
  month: string;
  statement: BillingStatement;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateReceipt();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ReceiptInput>({
    resolver: formResolver(receiptInputSchema),
    defaultValues: {
      clientId,
      month,
      kind: statement.kind,
      receiptDate: today(),
      amount: plain(statement.balance),
      paymentMethod: 'BANK_TRANSFER',
      paymentRef: '',
      note: '',
    },
  });
  const amount = useWatch({ control, name: 'amount' });
  const method = useWatch({ control, name: 'paymentMethod' });
  const valid = /^\d+(\.\d{1,2})?$/.test(
    String(amount ?? '')
      .replace(/,/g, '')
      .trim(),
  );

  const onSubmit = handleSubmit(async (values) => {
    const r = await create.mutateAsync(values);
    toast(`Receipt ${r.receiptNo} issued for ${fmtMoney(r.amount)}.`);
    onClose();
  });

  return (
    <Modal
      title="Record payment"
      sub={
        <>
          {clientName} · {STATEMENT_TITLE[statement.kind]} statement {periodCode(month)} · balance
          due <b>{fmtMoney(statement.balance)}</b>
        </>
      }
      onClose={onClose}
      width={620}
    >
      <ErrorBanner error={create.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div
          className="form-fields-grid"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
        >
          <div className="form-field-group">
            <label htmlFor="rc-date">Date received</label>
            <input
              id="rc-date"
              type="date"
              className="form-field-box"
              {...register('receiptDate')}
              aria-invalid={!!errors.receiptDate}
            />
            <FieldError message={errors.receiptDate?.message} />
          </div>
          <div className="form-field-group">
            <label htmlFor="rc-amount">Amount (USD)</label>
            <NumberInput
              id="rc-amount"
              className="form-field-box"
              decimals={2}
              {...register('amount')}
              aria-invalid={!!errors.amount}
            />
            <FieldError message={errors.amount?.message} />
          </div>
          <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
            <span className={b.fieldLabel}>Payment method</span>
            <div className={b.methods} role="radiogroup" aria-label="Payment method">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm}
                  type="button"
                  role="radio"
                  aria-checked={method === pm}
                  className={`filter-btn${method === pm ? ' active' : ''}`}
                  onClick={() => setValue('paymentMethod', pm)}
                >
                  {PAYMENT_METHOD_LABEL[pm]}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field-group">
            <label htmlFor="rc-ref">
              {method === 'CHEQUE'
                ? 'Cheque no.'
                : method === 'CASH'
                  ? 'Reference'
                  : 'Transfer reference'}
            </label>
            <input
              id="rc-ref"
              className="form-field-box"
              placeholder={method === 'CHEQUE' ? 'e.g. CHQ 004512' : 'optional'}
              {...register('paymentRef')}
            />
          </div>
          <div className="form-field-group">
            <label htmlFor="rc-note">Note</label>
            <input
              id="rc-note"
              className="form-field-box"
              placeholder="optional"
              {...register('note')}
            />
          </div>
        </div>
        <div className={b.words}>
          <b>Amount in words (printed on the receipt)</b>
          {valid ? amountInWords(String(amount).replace(/,/g, '')) : '—'}
        </div>
        <div className={ui.actions}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save & issue receipt'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
