import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CreditNoteReviewStatus, RecordSummaryReviewRow } from '@gs/shared';
import { useRecordSummaryReview, useSetRecordSummaryReview } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Modal, Pager, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { DirectionToggle } from '../../components/DirectionToggle';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { MODE, MONTHS, REVIEW, alertIcon, checkIcon, eyeIcon } from './CreditNotesReview';
import s from './CreditNotesReview.module.css';

/**
 * Accounting → Expense to Clients: Operations' submitted Record Summaries, for accounting to
 * check, as Chea Payments does for the broker's credit notes. Checking one fills the
 * shipment's Monthly Ledger row (INV, THC, REIM, DN); summaries are made in the sidebar's
 * Record Summary, not here. The five stat cards double as the status filter. Opening an
 * Unchecked summary marks it Reviewed; Approve and Revise are inside the summary.
 */
export function ExpenseToClients() {
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
  const list = useRecordSummaryReview(q);
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
  const open = (id: string) => navigate(`/accounting/record-summaries/${id}`);
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
      icon: icons.recordsummary({ width: 17, height: 17 }),
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
                <th>Invoice No.</th>
                <th>Quantity</th>
                <th>Port</th>
                <th>Shipment by</th>
                <th className={s.num}>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={11} className={s.empty}>
                    Loading…
                  </td>
                </tr>
              )}
              {list.data?.data.length === 0 && (
                <tr>
                  <td colSpan={11} className={s.empty}>
                    <span className={s.emptyIcon}>
                      {icons.recordsummary({ width: 22, height: 22 })}
                    </span>
                    <b>
                      {filtered ? 'Nothing matches these filters' : 'No expenses to clients yet'}
                    </b>
                    <span>
                      {filtered
                        ? 'Try another client, month or status.'
                        : 'Record summaries appear here once Operations submit them to the Monthly Ledger.'}
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
                    <span className={s.type}>
                      <i className={r.direction === 'IMPORT' ? s.imp : s.exp} />
                      {r.direction === 'IMPORT' ? 'Import' : 'Export'}
                    </span>
                  </td>
                  <td className={s.mono}>{r.declareNo ?? '-'}</td>
                  <td>{r.date}</td>
                  <td className={s.mono}>{r.invNo ?? '-'}</td>
                  <td>{r.quantityText ?? '-'}</td>
                  <td>{r.port ?? '-'}</td>
                  <td>{MODE[r.transportMode] ?? '-'}</td>
                  <td className={`${s.num} ${s.fee}`}>{fmtMoney(r.total)}</td>
                  <td>
                    {/* Approve and Revise are inside the record summary, as in Chea Payments. */}
                    {r.status === 'DRAFT' ? (
                      // Sent back; it returns as Unchecked when Operations submit it again.
                      <span
                        className={`${s.statusPill} ${s.revised}`}
                        title="Returned to Operations for revision"
                      >
                        Revised · with Operations
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

/** "Revised": send the summary back to Operations with what to change. */
export function SummaryReviseModal({
  row,
  onClose,
}: {
  row: Pick<RecordSummaryReviewRow, 'id' | 'declareNo' | 'clientName' | 'total'>;
  onClose: () => void;
}) {
  const toast = useToast();
  const setReview = useSetRecordSummaryReview();
  const [message, setMessage] = useState('');
  const send = () =>
    setReview.mutate(
      { id: row.id, reviewStatus: 'REVISED', message: message.trim() },
      {
        onSuccess: () => {
          toast(`${row.declareNo ?? 'Record summary'} sent back to Operations.`);
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
        <span>What should Operations change?</span>
        <textarea
          className="form-field-box"
          rows={4}
          maxLength={1000}
          placeholder="e.g. THC should be 35.00, and add the LOLO empty container line."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <p className={s.reviseNote}>
        The record summary goes back to Operations as a draft with this note, and its amounts leave
        the Monthly Ledger until they submit it again and you approve it.
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
