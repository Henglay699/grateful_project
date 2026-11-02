import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_STATUSES,
  followUpInputSchema,
  type FollowUpRow,
  type FollowUpStatus,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useFollowUps, useStaff } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, Modal, Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { Pill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { formResolver } from '../lib/zodForm';

const PRIORITY_COLOR = {
  HIGH: 'var(--accent-rose)',
  MEDIUM: 'var(--accent-amber)',
  LOW: 'var(--text-secondary)',
} as const;
const STATUS: Record<
  FollowUpStatus,
  { tone: 'pending' | 'progress' | 'completed' | 'exception'; label: string }
> = {
  OPEN: { tone: 'exception', label: 'Open' },
  AWAITING_REPLY: { tone: 'pending', label: 'Awaiting reply' },
  IN_REVIEW: { tone: 'progress', label: 'In review' },
  DONE: { tone: 'completed', label: 'Done' },
};
const PP = 'Asia/Phnom_Penh';
/** "Today, 17:00" / "Sep 01, 09:30" in Phnom Penh time, like the prototype. */
function dueLabel(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(d);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(new Date());
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: PP,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  if (day === today) return `Today, ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: PP, month: 'short', day: '2-digit' }).format(d)}, ${time}`;
}
/** ISO → value for <input type="datetime-local"> in Phnom Penh time. */
const toLocalInput = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: PP,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(' ', 'T');

export function FollowUpPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<FollowUpRow | 'new' | null>(null);
  const filter = params.get('filter') ?? 'all';
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    q: params.get('q') || undefined,
    status: filter === 'active' ? 'ACTIVE' : filter === 'done' ? 'DONE' : undefined,
    overdue: filter === 'overdue' ? 'true' : undefined,
  };
  const list = useFollowUps(q);
  const toast = useToast();
  const done = useApiMutation(
    (id: string) => api(`/follow-ups/${id}`, { method: 'PATCH', json: { status: 'DONE' } }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const overdueCount = list.data?.data.filter((r) => r.overdue).length ?? 0;
  const setFilter = (f: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('filter', f);
        n.delete('page');
        return n;
      },
      { replace: true },
    );
  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <h3>Pending Follow-Up Actions</h3>
          <div className={ui.toolbar}>
            <SearchBox
              grow
              placeholder="Search…"
              defaultValue={q.q}
              aria-label="Search follow-ups"
              onChange={(e) =>
                setParams(
                  (p) => {
                    const n = new URLSearchParams(p);
                    if (e.target.value.trim()) n.set('q', e.target.value.trim());
                    else n.delete('q');
                    return n;
                  },
                  { replace: true },
                )
              }
            />
            {overdueCount > 0 && <Pill tone="exception">{overdueCount} overdue</Pill>}
            <select
              className={ui.input}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter follow-ups"
            >
              <option value="all">All</option>
              <option value="active">Open</option>
              <option value="overdue">Overdue</option>
              <option value="done">Done</option>
            </select>
            {can('followups:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setOpen('new')}>
                + Add Follow-Up
              </button>
            )}
          </div>
        </div>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Subject</th>
              <th>Client</th>
              <th>Due</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={8}
              loading={list.isLoading}
              error={list.error}
              empty={list.data?.data.length === 0}
              emptyText={filter === 'overdue' ? 'Nothing overdue.' : 'No follow-ups here.'}
            />
            {list.data?.data.map((r) => (
              <tr
                key={r.id}
                className="plans-row-clickable"
                tabIndex={0}
                onClick={() => setOpen(r)}
                onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                style={r.overdue ? { background: 'var(--status-exception-bg)' } : undefined}
              >
                <td className="val-bold">{r.reference}</td>
                <td>
                  {r.subject}
                  {r.shipmentReference && (
                    <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                      <Link
                        to={`/plans/${r.shipmentId}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        {r.shipmentReference}
                      </Link>
                    </div>
                  )}
                </td>
                <td>{r.clientName ?? '-'}</td>
                <td
                  style={
                    r.overdue ? { color: 'var(--status-exception-fg)', fontWeight: 700 } : undefined
                  }
                >
                  {dueLabel(r.dueAt)}
                  {r.overdue ? ' · overdue' : ''}
                </td>
                <td>
                  <span style={{ color: PRIORITY_COLOR[r.priority], fontWeight: 700 }}>
                    {r.priority[0]}
                    {r.priority.slice(1).toLowerCase()}
                  </span>
                </td>
                <td>{r.assigneeName ?? '-'}</td>
                <td>
                  <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                </td>
                <td>
                  {can('followups:write') && r.status !== 'DONE' && (
                    <button
                      type="button"
                      className="filter-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void done.mutateAsync(r.id).then(() => toast(`${r.reference} done.`));
                      }}
                    >
                      Mark done
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) =>
              setParams((x) => {
                const n = new URLSearchParams(x);
                n.set('page', String(p));
                return n;
              })
            }
            onPageSize={(size) =>
              setParams((x) => {
                const n = new URLSearchParams(x);
                n.set('pageSize', String(size));
                n.delete('page');
                return n;
              })
            }
          />
        )}
      </div>
      {open && <FollowUpModal row={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function FollowUpModal({ row, onClose }: { row: FollowUpRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const staff = useStaff();
  const editable = can('followups:write');
  const save = useApiMutation(
    (v: Record<string, unknown>) =>
      row
        ? api(`/follow-ups/${row.id}`, { method: 'PATCH', json: v })
        : api('/follow-ups', { method: 'POST', json: v }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const del = useApiMutation(
    () => api(`/follow-ups/${row!.id}`, { method: 'DELETE' }),
    [['follow-ups'], queryKeys.navCounts],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: formResolver(followUpInputSchema) as never,
    defaultValues: row
      ? {
          subject: row.subject,
          notes: row.notes ?? '',
          clientId: row.clientId ?? '',
          shipmentId: row.shipmentId ?? '',
          assigneeId: row.assigneeId ?? '',
          dueAt: toLocalInput(row.dueAt),
          priority: row.priority,
          status: row.status,
        }
      : {
          priority: 'MEDIUM',
          status: 'OPEN',
          dueAt: toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '17:00',
        },
  });
  const submit = handleSubmit(async (v) => {
    await save.mutateAsync(v);
    toast(row ? 'Follow-up saved.' : 'Follow-up added.');
    onClose();
  });
  return (
    <Modal
      title={row ? `${row.reference} · ${row.subject}` : 'Add follow-up'}
      sub="Due times are Phnom Penh time."
      onClose={onClose}
      width={720}
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset disabled={!editable} style={{ border: 'none' }}>
          <div className="form-fields-grid">
            <div className="form-field-group" style={{ gridColumn: 'span 4' }}>
              <label htmlFor="fu-subject">Subject</label>
              <input
                id="fu-subject"
                className="form-field-box"
                {...register('subject')}
                aria-invalid={!!errors.subject}
              />
              <FieldError message={errors.subject?.message} />
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="fu-client">Client</label>
              <select id="fu-client" className="form-select-box" {...register('clientId')}>
                <option value="">—</option>
                {lookups.data?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="fu-assignee">Assignee</label>
              <select id="fu-assignee" className="form-select-box" {...register('assigneeId')}>
                <option value="">—</option>
                {staff.data
                  ?.filter((m) => m.isActive)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="fu-due">Due</label>
              <input
                id="fu-due"
                type="datetime-local"
                className="form-field-box"
                {...register('dueAt')}
                aria-invalid={!!errors.dueAt}
              />
              <FieldError message={errors.dueAt?.message} />
            </div>
            <div className="form-field-group">
              <label htmlFor="fu-priority">Priority</label>
              <select id="fu-priority" className="form-select-box" {...register('priority')}>
                {FOLLOW_UP_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p[0]}
                    {p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group">
              <label htmlFor="fu-status">Status</label>
              <select id="fu-status" className="form-select-box" {...register('status')}>
                {FOLLOW_UP_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 4' }}>
              <label htmlFor="fu-notes">Notes</label>
              <textarea id="fu-notes" className="form-field-box" rows={4} {...register('notes')} />
            </div>
          </div>
        </fieldset>
        {editable && (
          <div className={ui.actions}>
            {row && (
              <button
                type="button"
                className="btn-delete-shipment"
                onClick={() =>
                  window.confirm('Delete this follow-up?') &&
                  void del.mutateAsync(undefined).then(() => {
                    toast('Deleted.');
                    onClose();
                  })
                }
              >
                Delete
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {row ? 'Save' : 'Add follow-up'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
