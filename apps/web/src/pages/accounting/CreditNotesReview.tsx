import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CreditNoteReviewRow, CreditNoteReviewStatus } from '@gs/shared';
import { useCreditNoteReview, useSetCreditNoteReview } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Modal, Pager, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { DirectionToggle } from '../../components/DirectionToggle';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import s from './CreditNotesReview.module.css';

/** CHECKED is stored as before and shown as "Approved". */
export const REVIEW: Record<CreditNoteReviewStatus, { label: string; cls: string }> = {
  CHECKED: { label: 'Approved', cls: s.checked! },
  UNCHECKED: { label: 'Unchecked', cls: s.unchecked! },
  REVIEWED: { label: 'Reviewed', cls: s.reviewed! },
  REVISED: { label: 'Revised', cls: s.revised! },
  REVISION_REQUESTED: { label: 'Request Revise', cls: s.requested! },
};
/** The same statuses as header pills (inside a credit note or record summary). */
export const REVIEW_PILL = {
  UNCHECKED: 'pending',
  REVIEWED: 'progress',
  CHECKED: 'completed',
  REVISED: 'exception',
  REVISION_REQUESTED: 'pending',
} as const;
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'LAND', RAIL: 'RAIL' };

const svg = (children: ReactNode) => (
  <svg
    width="17"
    height="17"
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
export const checkIcon = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
);
export const alertIcon = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>,
);
export const eyeIcon = svg(
  <>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
);

/**
 * Accounting → Chea Payments: the broker's submitted Credit Noted vouchers, for accounting
 * to check off. Drafts stay with the broker (sidebar → Credit Noted) until submitted.
 * The four stat cards double as the status filter.
 */
export function CreditNotesReview() {
  const navigate = useNavigate();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) || undefined;
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    clientId: get('clientId'),
    direction: get('direction'),
    q: get('q'),
    month: get('month'),
    year: get('year'),
    review: get('review'),
  };
  const list = useCreditNoteReview(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const counts = list.data?.counts;
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const open = (id: string) => navigate(`/accounting/credit-notes/${id}`);
  const filtered = !!(q.clientId || q.direction || q.q || q.month || q.year || q.review);

  const stats: {
    review: '' | CreditNoteReviewStatus;
    label: string;
    value?: number;
    icon: ReactNode;
    cls: string;
  }[] = [
    {
      review: '',
      label: 'All records',
      value: counts?.total,
      icon: icons.creditnote({ width: 17, height: 17 }),
      cls: s.neutral!,
    },
    {
      review: 'UNCHECKED',
      label: 'Unchecked',
      value: counts?.unchecked,
      icon: alertIcon,
      cls: s.unchecked!,
    },
    {
      review: 'REVIEWED',
      label: 'Reviewed',
      value: counts?.reviewed,
      icon: eyeIcon,
      cls: s.reviewed!,
    },
    {
      review: 'CHECKED',
      label: 'Approved',
      value: counts?.checked,
      icon: checkIcon,
      cls: s.checked!,
    },
    {
      review: 'REVISED',
      label: 'Revised',
      value: counts?.revised,
      icon: icons.edit({ width: 17, height: 17 }),
      cls: s.revised!,
    },
    // Revised by its maker after submitting, waiting for approval.
    {
      review: 'REVISION_REQUESTED',
      label: 'Request Revise',
      value: counts?.revisionRequested,
      icon: icons.send({ width: 17, height: 17 }),
      cls: s.requested!,
    },
  ];

  return (
    <section className={`view active ${s.page} ${s.fill}`}>
      <div className={`${s.stats} ${s.six}`} role="group" aria-label="Filter by status">
        {stats.map((k) => {
          const on = (q.review ?? '') === k.review;
          return (
            <button
              key={k.label}
              type="button"
              className={`${s.stat} ${k.cls} ${on ? s.statOn : ''}`}
              aria-pressed={on}
              onClick={() => set('review', k.review)}
            >
              <span className={s.statIcon}>{k.icon}</span>
              <span className={s.statText}>
                <span className={s.statLabel}>{k.label}</span>
                <span className={s.statValue}>{k.value ?? '–'}</span>
              </span>
            </button>
          );
        })}
      </div>

      <ErrorBanner error={list.error} />
      <div className={s.card}>
        <div className={s.toolbar}>
          <SearchBox
            className={s.search}
            placeholder="Search declare no., e.g. I 122050"
            defaultValue={q.q}
            onChange={(e) => set('q', e.target.value.trim())}
            aria-label="Search by declare no."
          />
          <select
            className={s.select}
            value={q.clientId ?? ''}
            onChange={(e) => set('clientId', e.target.value)}
            aria-label="Client"
          >
            <option value="">All clients</option>
            {lookups.data?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <DirectionToggle value={q.direction} onChange={(d) => set('direction', d)} />
          <select
            className={s.select}
            value={q.month ?? ''}
            onChange={(e) => set('month', e.target.value)}
            aria-label="Month"
          >
            <option value="">All months</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            className={s.select}
            value={q.year ?? ''}
            onChange={(e) => set('year', e.target.value)}
            aria-label="Year"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              className={s.clear}
              onClick={() => setParams({}, { replace: true })}
            >
              Clear
            </button>
          )}
        </div>

        <div className={s.scroll}>
          <table className={s.table}>
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
                <th className={s.num}>Clear fee</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={10} className={s.empty}>
                    Loading…
                  </td>
                </tr>
              )}
              {list.data?.data.length === 0 && (
                <tr>
                  <td colSpan={10} className={s.empty}>
                    <span className={s.emptyIcon}>
                      {icons.creditnote({ width: 22, height: 22 })}
                    </span>
                    <b>{filtered ? 'Nothing matches these filters' : 'No Chea payments yet'}</b>
                    <span>
                      {filtered
                        ? 'Try another client, month or status.'
                        : 'Credit notes appear here once the customs broker submits them to the Monthly Ledger.'}
                    </span>
                  </td>
                </tr>
              )}
              {list.data?.data.map((r, i) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(r.id)}
                >
                  <td className={s.muted}>{(q.page - 1) * q.pageSize + i + 1}</td>
                  <td>
                    <span className={s.client}>{r.clientName.toUpperCase()}</span>
                  </td>
                  <td>
                    {r.direction && (
                      <span className={s.type}>
                        <i className={r.direction === 'IMPORT' ? s.imp : s.exp} />
                        {r.direction === 'IMPORT' ? 'Import' : 'Export'}
                      </span>
                    )}
                  </td>
                  <td className={s.mono}>{r.declareNo ?? '-'}</td>
                  <td>{r.date}</td>
                  <td>{r.quantityText ?? '-'}</td>
                  <td>{r.port ?? '-'}</td>
                  <td>{r.transportMode ? MODE[r.transportMode] : '-'}</td>
                  <td className={`${s.num} ${s.fee}`}>{fmtMoney(r.total)}</td>
                  <td>
                    {/* Approve and Revise are inside the credit note, next to Discard. */}
                    {r.status === 'DRAFT' ? (
                      // Sent back; it returns as Unchecked when the broker submits it again.
                      <span
                        className={`${s.statusPill} ${s.revised}`}
                        title="Returned to the broker for revision"
                      >
                        Revised · with broker
                      </span>
                    ) : (
                      <span className={`${s.statusPill} ${REVIEW[r.reviewStatus].cls}`}>
                        {REVIEW[r.reviewStatus].label}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {list.data && list.data.meta.total > 0 && (
          <div className={s.foot}>
            <Pager
              {...list.data.meta}
              onPage={(p) => set('page', String(p))}
              onPageSize={(n) => set('pageSize', String(n))}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** "Revised": send the note back to the broker with what to change. */
export function ReviseModal({
  row,
  onClose,
}: {
  row: Pick<CreditNoteReviewRow, 'id' | 'declareNo' | 'clientName' | 'total'>;
  onClose: () => void;
}) {
  const toast = useToast();
  const setReview = useSetCreditNoteReview();
  const [message, setMessage] = useState('');
  const send = () =>
    setReview.mutate(
      { id: row.id, reviewStatus: 'REVISED', message: message.trim() },
      {
        onSuccess: () => {
          toast(`${row.declareNo ?? 'Credit note'} sent back to the broker.`);
          onClose();
        },
      },
    );
  return (
    <Modal
      title="Send back for revision"
      sub={`${row.declareNo ?? '-'} · ${row.clientName} · ${fmtMoney(row.total)}`}
      onClose={onClose}
      width={500}
    >
      <ErrorBanner error={setReview.error} />
      <label className={s.reviseField}>
        <span>What should the broker change?</span>
        <textarea
          className="form-field-box"
          rows={4}
          maxLength={1000}
          placeholder="e.g. LOLO should be 62.70, and add the generator line."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <p className={s.reviseNote}>
        The broker gets this in their Credit Noted inbox. The credit note goes back to them as a
        draft and its Clear Fee leaves the Monthly Ledger until they submit it again.
      </p>
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={message.trim().length < 3 || setReview.isPending}
          onClick={send}
        >
          Send back
        </button>
      </div>
    </Modal>
  );
}
