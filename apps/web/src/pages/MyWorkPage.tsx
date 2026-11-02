import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  OWNER_LABEL,
  ROLE_LABEL,
  type AlertItem,
  type WorkQueueItem,
  type WorkflowOwner,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useAlerts, useWorkQueue } from '../features/workflow';
import { SearchBox } from '../components/SearchBox';
import { StagePill } from '../components/workflow/StagePill';
import { Glyph, ownerTone } from '../components/workflow/glyphs';
import { ErrorBanner } from '../components/ui';
import { fmtDate } from '../lib/format';
import m from './MyWorkPage.module.css';

const OWNERS: WorkflowOwner[] = ['OPERATIONS', 'BROKER', 'ACCOUNTANT', 'OPERATION_MANAGER'];
/** In a stage longer than this, a job is flagged as slow. */
const SLOW_DAYS = 5;

/**
 * My Work: the jobs waiting for the signed-in person's role, oldest first, with what needs
 * attention (approvals, expiring permits and licences, arrivals, bills due) beside them.
 */
export function MyWorkPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [owner, setOwner] = useState<WorkflowOwner | ''>('');
  const [direction, setDirection] = useState<'' | 'IMPORT' | 'EXPORT'>('');
  const [q, setQ] = useState('');
  const queue = useWorkQueue(scope);
  const alerts = useAlerts();

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (queue.data?.items ?? [])
      .filter((i) => !owner || i.owner === owner)
      .filter((i) => !direction || i.direction === direction)
      .filter(
        (i) =>
          !term ||
          `${i.reference} ${i.clientName} ${i.clientCode} ${i.invoiceNos.join(' ')} ${i.stageLabel}`
            .toLowerCase()
            .includes(term),
      )
      .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
  }, [queue.data, owner, direction, q]);

  const slow = items.filter((i) => (i.daysInStage ?? 0) > SLOW_DAYS).length;
  const approvals = (alerts.data ?? []).filter((a) => a.kind === 'APPROVAL_WAITING').length;
  const urgent = (alerts.data ?? []).filter((a) => a.severity === 'ERROR').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <section className={`view active ${m.page}`}>
      <header className={m.hero}>
        <div>
          <span className={m.eyebrow}>{user ? ROLE_LABEL[user.role] : ''}</span>
          <h2 className={m.title}>
            {greeting}
            {user ? `, ${user.fullName.split(' ')[0]}` : ''}
          </h2>
          <p className={m.sub}>
            {scope === 'mine'
              ? items.length
                ? `${items.length} job${items.length > 1 ? 's are' : ' is'} waiting for you.`
                : 'Nothing is waiting for you right now.'
              : `${items.length} open job${items.length === 1 ? '' : 's'} across the team.`}
          </p>
        </div>
        <div className={m.tiles}>
          <Tile label="Waiting" value={items.length} icon="inbox" />
          <Tile
            label={`Over ${SLOW_DAYS} days`}
            value={slow}
            icon="clock"
            tone={slow ? 'warn' : undefined}
          />
          <Tile
            label="Approvals"
            value={approvals}
            icon="stamp"
            tone={approvals ? 'info' : undefined}
          />
          <Tile
            label="Urgent alerts"
            value={urgent}
            icon="alert"
            tone={urgent ? 'danger' : undefined}
          />
        </div>
      </header>

      <div className={m.layout}>
        <div className={`card ${m.queueCard}`}>
          <div className={m.toolbar}>
            <div className={m.segment} role="tablist" aria-label="Whose jobs">
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'mine'}
                onClick={() => setScope('mine')}
              >
                Waiting for me
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'all'}
                onClick={() => setScope('all')}
              >
                All open jobs
              </button>
            </div>
            <div className={m.filters}>
              <select
                className={m.select}
                value={direction}
                onChange={(e) => setDirection(e.target.value as typeof direction)}
                aria-label="Import or export"
              >
                <option value="">Import & export</option>
                <option value="IMPORT">Import</option>
                <option value="EXPORT">Export</option>
              </select>
              <SearchBox
                placeholder="Shipment, client, invoice…"
                aria-label="Search jobs"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          {scope === 'all' && queue.data && (
            <div className={m.owners}>
              <button type="button" aria-pressed={!owner} onClick={() => setOwner('')}>
                Everyone <b>{Object.values(queue.data.counts).reduce((s, n) => s + n, 0)}</b>
              </button>
              {OWNERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  data-tone={ownerTone(o)}
                  aria-pressed={owner === o}
                  onClick={() => setOwner(owner === o ? '' : o)}
                >
                  <span className={m.ownerDot} />
                  {OWNER_LABEL[o]} <b>{queue.data.counts[o] ?? 0}</b>
                </button>
              ))}
            </div>
          )}

          <ErrorBanner error={queue.error} />
          {queue.isLoading ? (
            <ul className={m.list}>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className={m.skeleton} />
              ))}
            </ul>
          ) : items.length === 0 ? (
            <div className={m.empty}>
              <span className={m.emptyIcon}>
                <Glyph name="check" size={22} />
              </span>
              <b>All caught up</b>
              <span>
                {scope === 'mine'
                  ? 'New jobs appear here when they reach a stage your role handles.'
                  : 'No open jobs match these filters.'}
              </span>
            </div>
          ) : (
            <ul className={m.list}>
              {items.map((i) => (
                <JobRow
                  key={i.shipmentId}
                  i={i}
                  onOpen={() => navigate(`/plans/${i.shipmentId}?tab=workflow`)}
                />
              ))}
            </ul>
          )}
        </div>

        <aside className={`card ${m.alertsCard}`}>
          <div className={m.alertsHead}>
            <h3>Needs attention</h3>
            <span>{alerts.data?.length ?? 0}</span>
          </div>
          <ErrorBanner error={alerts.error} />
          {alerts.data?.length === 0 && (
            <p className={m.quiet}>No alerts. Permits, licences and bills are in order.</p>
          )}
          <ul className={m.alerts}>
            {alerts.data?.slice(0, 30).map((a) => (
              <AlertRow key={a.id} a={a} />
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: Parameters<typeof Glyph>[0]['name'];
  tone?: 'warn' | 'info' | 'danger' | undefined;
}) {
  return (
    <div className={m.tile} data-tone={tone}>
      <span className={m.tileIcon}>
        <Glyph name={icon} />
      </span>
      <div>
        <b>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

function JobRow({ i, onOpen }: { i: WorkQueueItem; onOpen: () => void }) {
  const slow = (i.daysInStage ?? 0) > SLOW_DAYS;
  const date = i.direction === 'IMPORT' ? i.eta : i.etd;
  return (
    <li>
      <button type="button" className={m.job} data-tone={ownerTone(i.owner)} onClick={onOpen}>
        <span className={m.dir} data-dir={i.direction}>
          <Glyph name={i.direction === 'IMPORT' ? 'download' : 'upload'} size={15} />
        </span>
        <span className={m.jobMain}>
          <span className={m.jobTop}>
            <b>{i.clientName}</b>
            <span className={m.ref}>{i.reference}</span>
          </span>
          <span className={m.jobSub}>
            {i.invoiceNos.length ? i.invoiceNos.join(', ') : 'No invoice yet'}
            {date ? ` · ${i.direction === 'IMPORT' ? 'ETA' : 'ETD'} ${fmtDate(date)}` : ''}
          </span>
        </span>
        <span className={m.jobStage}>
          <StagePill direction={i.direction} stage={i.stage} />
          <small>{OWNER_LABEL[i.owner]}</small>
        </span>
        <span className={m.days} data-slow={slow || undefined} title="Days in this stage">
          {i.daysInStage ?? 0}d
        </span>
        <span className={m.chev}>
          <Glyph name="arrow" size={15} />
        </span>
      </button>
    </li>
  );
}

function AlertRow({ a }: { a: AlertItem }) {
  const body = (
    <>
      <span className={m.sev} data-severity={a.severity} />
      <span className={m.alertText}>
        <b>{a.title}</b>
        <span>{a.detail}</span>
      </span>
    </>
  );
  return (
    <li>
      {a.link ? (
        <Link to={a.link} className={m.alert}>
          {body}
        </Link>
      ) : (
        <div className={m.alert}>{body}</div>
      )}
    </li>
  );
}
