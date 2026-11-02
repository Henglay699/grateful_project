import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreditNoteMessage } from '@gs/shared';
import { useCreditNoteInbox, useMarkInboxRead } from '../../features/accounting';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { cnSeq } from './seq';
import t from '../accounting/CreditNotesReview.module.css';
import s from './Inbox.module.css';

const svg = (children: ReactNode, size = 17) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
export const inboxIcon = (size?: number) =>
  svg(
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>,
    size,
  );
const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'LAND', RAIL: 'RAIL' };

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Toolbar button that switches the Credit Noted table to the inbox (with the unread count). */
export function InboxToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  const inbox = useCreditNoteInbox();
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
 * The inbox as table rows: the credit note's details, accounting's remark, and Accept.
 * Accepting a "Revised" remark opens the note so the broker can update it.
 */
export function InboxTable({ search }: { search?: string | undefined }) {
  const navigate = useNavigate();
  const toast = useToast();
  const inbox = useCreditNoteInbox();
  const markRead = useMarkInboxRead();
  const needle = (search ?? '').replace(/\s+/g, '').toLowerCase();
  const rows = (inbox.data?.data ?? []).filter(
    (m) => !needle || (m.declareNo ?? '').replace(/\s+/g, '').toLowerCase().includes(needle),
  );
  const open = (m: CreditNoteMessage) => navigate(`/credit-noted/${m.creditNoteId}`);
  const accept = (m: CreditNoteMessage) =>
    markRead.mutate(m.id, {
      onSuccess: () => {
        if (m.kind === 'REVISED') open(m);
        else toast(`Accepted: No. ${cnSeq(m.number)} was approved by accounting.`);
      },
    });

  return (
    <table className={t.table}>
      <thead>
        <tr>
          <th>No.</th>
          <th>Client</th>
          <th>Type</th>
          <th>Declare No.</th>
          <th>Date</th>
          <th>Quantity</th>
          <th>Port</th>
          <th>Shipment by</th>
          <th className={t.num}>Clear fee</th>
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
              <span>When accounting checks or returns a credit note, it shows up here.</span>
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
              <td className={t.cn}>
                {isNew && <i className={s.newDot} aria-label="New" />}
                {cnSeq(m.number)}
              </td>
              <td>
                <span className={t.client}>{m.clientName.toUpperCase()}</span>
              </td>
              <td>
                {m.direction && (
                  <span className={t.type}>
                    <i className={m.direction === 'IMPORT' ? t.imp : t.exp} />
                    {m.direction === 'IMPORT' ? 'Import' : 'Export'}
                  </span>
                )}
              </td>
              <td className={t.mono}>{m.declareNo ?? '-'}</td>
              <td>{m.date}</td>
              <td>{m.quantityText ?? '-'}</td>
              <td>{m.port ?? '-'}</td>
              <td>{m.transportMode ? MODE[m.transportMode] : '-'}</td>
              <td className={`${t.num} ${t.fee}`}>{fmtMoney(m.total)}</td>
              <td className={s.remarkCell}>
                <span className={`${s.tag} ${revise ? t.revised : t.checked}`}>
                  {revise ? 'Revise' : 'Approved'}
                </span>
                <span className={s.remark} title={m.body || undefined}>
                  {m.body || (revise ? 'Please revise this credit note.' : 'All correct.')}
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
                    title={revise ? 'Accept and open the credit note to update it' : 'Accept'}
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
