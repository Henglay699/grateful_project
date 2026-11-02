import { useEffect, useRef, useState } from 'react';
import type { ClearFeePayment } from '@gs/shared';
import {
  useClearFeePayments,
  useDeleteClearFeePayment,
  useSaveClearFeePayment,
} from '../../features/accounting';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBanner, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { fmtDate, fmtNum } from '../../lib/format';
import c from './ClearFeePayments.module.css';

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
const m = (v: string) => `$${fmtNum(v, 2)}`;

interface Draft {
  paidOn: string;
  amount: string;
  remark: string;
}

/**
 * In the Monthly Ledger's pager row: the month's clear fee against what has been paid to Chea,
 * often in two or three parts, each with its pay date and a remark. One summary line; clicking
 * it opens the payments above it, over the rows, so the table keeps its height.
 */
export function ClearFeePayments({ month }: { month: string }) {
  const { can } = useAuth();
  const manage = can('accounting:write');
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The list floats over the rows: close it on Escape or a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const data = useClearFeePayments(month).data;
  const balance = data ? Number(data.balance) : 0;

  return (
    <div className={c.panel} ref={panel}>
      <button type="button" className={c.bar} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={c.chevron} aria-hidden="true">
          ▸
        </span>
        <span className={c.title}>Clear fee paid to Chea</span>
        {data && (
          <span className={c.figures}>
            <span>
              Clear fee <b>{m(data.clearFee)}</b>
            </span>
            <span>
              Paid <b>{m(data.paid)}</b>
              {data.payments.length > 0 &&
                ` · ${data.payments.length} payment${data.payments.length > 1 ? 's' : ''}`}
            </span>
            {Number(data.carriedIn) > 0 && (
              <span title="Overpaid in earlier months, deducted from this one">
                Carried in <b>{m(data.carriedIn)}</b>
              </span>
            )}
            <span
              className={c.balance}
              data-tone={balance > 0 ? 'due' : balance < 0 ? 'over' : 'done'}
            >
              {balance > 0
                ? `Should pay ${m(data.balance)}`
                : balance < 0
                  ? `Overpaid ${m(String(-balance))} · carried to next month`
                  : Number(data.clearFee) > 0
                    ? 'Paid in full'
                    : 'Nothing to pay'}
            </span>
          </span>
        )}
      </button>
      {open && data && (
        <div className={c.body}>
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Paid on</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Remark</th>
                <th>Entered by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <PaymentRow key={p.id} month={month} payment={p} manage={manage} />
              ))}
              {data.payments.length === 0 && !manage && (
                <tr>
                  <td colSpan={5} className={c.empty}>
                    No payments recorded for this month.
                  </td>
                </tr>
              )}
              {manage && <AddRow month={month} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DraftCells({
  draft,
  setDraft,
  onEnter,
  onEscape,
  autoFocus,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onEnter: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
}) {
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onEnter();
    if (e.key === 'Escape') onEscape?.();
  };
  return (
    <>
      <td>
        <input
          type="date"
          className={ui.input}
          value={draft.paidOn}
          onChange={(e) => setDraft({ ...draft, paidOn: e.target.value })}
          aria-label="Paid on"
        />
      </td>
      <td>
        <NumberInput
          className={`${ui.input} ${c.amount}`}
          decimals={2}
          placeholder="0.00"
          value={draft.amount}
          autoFocus={autoFocus}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          onKeyDown={keys}
          aria-label="Amount (USD)"
        />
      </td>
      <td colSpan={2}>
        <input
          className={`${ui.input} ${c.remark}`}
          placeholder="Remark, e.g. Paid for next month"
          maxLength={200}
          value={draft.remark}
          onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
          onKeyDown={keys}
          aria-label="Remark"
        />
      </td>
    </>
  );
}

function AddRow({ month }: { month: string }) {
  const toast = useToast();
  const save = useSaveClearFeePayment(month);
  const [draft, setDraft] = useState<Draft>({ paidOn: today(), amount: '', remark: '' });
  const add = () => {
    if (!draft.amount || !draft.paidOn || save.isPending) return;
    void save.mutateAsync({ body: draft }).then(() => {
      setDraft({ paidOn: draft.paidOn, amount: '', remark: '' });
      toast('Payment added.');
    });
  };
  return (
    <>
      <tr className={c.addRow}>
        <DraftCells draft={draft} setDraft={setDraft} onEnter={add} />
        <td>
          <div className={c.actions}>
            <button
              type="button"
              className="btn-create-submit"
              disabled={!draft.amount || !draft.paidOn || save.isPending}
              onClick={add}
            >
              {icons.plus({})}
              {save.isPending ? 'Adding…' : 'Add payment'}
            </button>
          </div>
        </td>
      </tr>
      {save.error ? (
        <tr>
          <td colSpan={5}>
            <ErrorBanner error={save.error} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function PaymentRow({
  month,
  payment: p,
  manage,
}: {
  month: string;
  payment: ClearFeePayment;
  manage: boolean;
}) {
  const toast = useToast();
  const save = useSaveClearFeePayment(month);
  const del = useDeleteClearFeePayment();
  const [draft, setDraft] = useState<Draft | null>(null);
  const commit = () => {
    if (!draft?.amount || !draft.paidOn || save.isPending) return;
    void save.mutateAsync({ id: p.id, body: draft }).then(() => {
      setDraft(null);
      toast('Payment updated.');
    });
  };

  if (draft)
    return (
      <>
        <tr className={c.editing}>
          <DraftCells
            draft={draft}
            setDraft={setDraft}
            onEnter={commit}
            onEscape={() => setDraft(null)}
            autoFocus
          />
          <td>
            <div className={c.actions}>
              <button
                type="button"
                className="btn-create-submit"
                disabled={!draft.amount || !draft.paidOn || save.isPending}
                onClick={commit}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-cancel-shipment" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </td>
        </tr>
        {save.error ? (
          <tr>
            <td colSpan={5}>
              <ErrorBanner error={save.error} />
            </td>
          </tr>
        ) : null}
      </>
    );

  return (
    <tr>
      <td>{fmtDate(p.paidOn)}</td>
      <td className="val-bold" style={{ textAlign: 'right' }}>
        {fmtNum(p.amount, 2)}
      </td>
      <td className={c.remarkText} title={p.remark ?? undefined}>
        {p.remark || '-'}
      </td>
      <td>{p.createdByName ?? '-'}</td>
      <td>
        {manage && (
          <div className={c.actions}>
            <button
              type="button"
              className={c.icon}
              title="Edit"
              aria-label={`Edit payment of ${fmtDate(p.paidOn)}`}
              onClick={() =>
                setDraft({
                  paidOn: p.paidOn,
                  amount: String(Number(p.amount)),
                  remark: p.remark ?? '',
                })
              }
            >
              {icons.edit({})}
            </button>
            <button
              type="button"
              className={`${c.icon} ${c.danger}`}
              title="Delete"
              aria-label={`Delete payment of ${fmtDate(p.paidOn)}`}
              disabled={del.isPending}
              onClick={() =>
                window.confirm(
                  `Delete the payment of $${fmtNum(p.amount, 2)} on ${fmtDate(p.paidOn)}?`,
                ) && void del.mutateAsync(p.id).then(() => toast('Payment deleted.'))
              }
            >
              {icons.trash({})}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
