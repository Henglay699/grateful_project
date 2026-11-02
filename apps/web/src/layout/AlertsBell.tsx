import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useAlerts } from '../features/workflow';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';
import s from './AlertsBell.module.css';

/**
 * The top bar's bell: alerts from the job workflow (approvals, expiring permits and licences,
 * arrivals, bills due) plus overdue follow-ups, in a drop-down.
 */
export function AlertsBell() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const alerts = useAlerts();
  const counts = useNavCounts();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const overdue = can('followups:read') ? (counts.data?.overdueFollowUps ?? 0) : 0;
  const list = alerts.data ?? [];
  const important = list.filter((a) => a.severity !== 'INFO').length;
  const badge = important + overdue;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={s.wrap} ref={box}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={badge ? `${badge} alerts` : 'Alerts'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {icons.bell({})}
        {badge > 0 && (
          <span key={badge} className="badge" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {open && (
        <div className={s.pop} role="dialog" aria-label="Alerts">
          <div className={s.head}>
            <b>Alerts</b>
            {can('shipments:read') && (
              <Link to="/my-work" onClick={() => setOpen(false)}>
                Open My Work →
              </Link>
            )}
          </div>
          {overdue > 0 && (
            <button
              type="button"
              className={s.item}
              onClick={() => {
                setOpen(false);
                navigate('/followup?filter=overdue');
              }}
            >
              <span className={s.sev} data-severity="ERROR" />
              <span className={s.text}>
                <b>
                  {overdue} overdue follow-up{overdue > 1 ? 's' : ''}
                </b>
                <span>Past their due time and not done.</span>
              </span>
            </button>
          )}
          {list.length === 0 && overdue === 0 && <p className={s.empty}>You're all caught up.</p>}
          <div className={s.scroll}>
            {list.slice(0, 20).map((a) => (
              <button
                key={a.id}
                type="button"
                className={s.item}
                onClick={() => {
                  setOpen(false);
                  if (a.link) navigate(a.link);
                }}
              >
                <span className={s.sev} data-severity={a.severity} />
                <span className={s.text}>
                  <b>{a.title}</b>
                  <span>{a.detail}</span>
                </span>
              </button>
            ))}
          </div>
          {list.length > 20 && (
            <div className={s.more}>
              {list.length - 20} more on{' '}
              <Link to="/my-work" onClick={() => setOpen(false)}>
                My Work
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
