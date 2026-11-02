import { useNavigate } from 'react-router-dom';
import type { RecordSummaryMessage } from '@gs/shared';
import { useMarkRecordSummaryInboxRead, useRecordSummaryInbox } from '../../features/accounting';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { inboxIcon, timeAgo } from '../creditnoted/Inbox';
import t from './CreditNotesReview.module.css';
import s from '../creditnoted/Inbox.module.css';

// As in the Record Summary list.
const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'TRUCK', RAIL: 'RAIL' };

/** Toolbar button that switches the Record Summary table to the inbox (with the unread count). */
export function RecordSummaryInboxToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const inbox = useRecordSummaryInbox();
  const unread = inbox.data?.unread ?? 0;
  return (
    <button
      type="button"
      className={`${s.button} ${active ? s.buttonOn : ''}`}
      aria-pressed={active}
      aria-label={unread ? `Inbox, ${unread} new` : 'Inbox'}
      onClick={onClick}
    >
      {inboxIcon()}
      <span>Inbox</span>
      {unread > 0 && <b className={s.count}>{unread}</b>}
    </button>
  );
}

/**
 * Accounting's Expense to Clients "Revise" messages as table rows, as in the Credit Noted
 * inbox (approvals need no action, so they are not sent). Accepting one opens the summary so
 * Operations can update it.
 */
export function RecordSummaryInboxTable({
  base,
  search,
}: {
  base: string;
  search?: string | undefined;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const inbox = useRecordSummaryInbox();
  const markRead = useMarkRecordSummaryInboxRead();
  const needle = (search ?? '').replace(/\s+/g, '').toLowerCase();
  const rows = (inbox.data?.data ?? []).filter(
    (m) => !needle || (m.declareNo ?? '').replace(/\s+/g, '').toLowerCase().includes(needle),
  );
  const open = (m: RecordSummaryMessage) => navigate(`${base}/${m.recordSummaryId}`);
  const accept = (m: RecordSummaryMessage) =>
    markRead.mutate(m.id, {
      onSuccess: () => {
        if (m.kind === 'REVISED') open(m);
        else toast(`Accepted: ${m.declareNo ?? 'the record summary'} was approved by accounting.`);
      },
    });

  return (
    <table className={t.table}>
      <thead>
        <tr>
          <th>Client</th>
          <th>Type</th>
          <th>Declare No.</th>
          <th>Date</th>
          <th>Invoice No.</th>
          <th>Quantity</th>
          <th>Port</th>
          <th>Shipment by</th>
          <th className={t.num}>Total</th>
          <th>Remark from accounting</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {inbox.isLoading && (
          <tr>
            <td colSpan={11} className={t.empty}>
              Loading…
            </td>
          </tr>
        )}
        {inbox.data && rows.length === 0 && (
          <tr>
            <td colSpan={11} className={t.empty}>
              <span className={t.emptyIcon}>{inboxIcon(22)}</span>
              <b>{needle ? 'No messages for that declare no.' : 'Your inbox is empty'}</b>
              <span>When accounting returns a record summary to revise, it shows up here.</span>
            </td>
          </tr>
        )}
        {rows.map((m) => {
          const revise = m.kind === 'REVISED';
          const isNew = !m.readAt;
          return (
            <tr
              key={m.id}
              className={isNew ? s.newRow : undefined}
              tabIndex={0}
              onClick={() => open(m)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(m)}
            >
              <td>
                {isNew && <i className={s.newDot} aria-label="New" />}
                <span className={t.client}>{m.clientName.toUpperCase()}</span>
              </td>
              <td>
                <span className={t.type}>
                  <i className={m.direction === 'IMPORT' ? t.imp : t.exp} />
                  {m.direction === 'IMPORT' ? 'Import' : 'Export'}
                </span>
              </td>
              <td className={t.mono}>{m.declareNo ?? '-'}</td>
              <td>{m.date}</td>
              <td className={t.mono}>{m.invNo ?? '-'}</td>
              <td>{m.quantityText ?? '-'}</td>
              <td>{m.port?.toUpperCase() ?? '-'}</td>
              <td>{MODE[m.transportMode] ?? '-'}</td>
              <td className={`${t.num} ${t.fee}`}>{fmtMoney(m.total)}</td>
              <td className={s.remarkCell}>
                <span className={`${s.tag} ${revise ? t.revised : t.checked}`}>
                  {revise ? 'Revise' : 'Approved'}
                </span>
                <span className={s.remark} title={m.body || undefined}>
                  {m.body || (revise ? 'Please revise this record summary.' : 'All correct.')}
                </span>
                <span className={s.from}>
                  {m.senderName ?? 'Accounting'} · {timeAgo(m.createdAt)}
                </span>
              </td>
              <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {isNew ? (
                  <button
                    type="button"
                    className={s.accept}
                    disabled={markRead.isPending}
                    onClick={() => accept(m)}
                    title={revise ? 'Accept and open the record summary to update it' : 'Accept'}
                  >
                    Accept
                  </button>
                ) : revise && m.status === 'DRAFT' ? (
                  <button type="button" className={s.update} onClick={() => open(m)}>
                    Update
                  </button>
                ) : (
                  <span className={s.accepted}>✓ Accepted</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
