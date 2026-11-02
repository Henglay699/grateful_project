import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABEL } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { initials } from '../components/Avatar';
import s from './ProfileMenu.module.css';

/** Top-bar profile: avatar, name and email; the chevron opens My profile / Sign out. */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div className={s.wrap} ref={box}>
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.fullName}
      >
        <span className={s.avatar}>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            <span aria-hidden="true">{initials(user.fullName)}</span>
          )}
        </span>
        <span className={s.text}>
          <span className={s.name}>{user.fullName}</span>
          <span className={s.email}>{user.email}</span>
        </span>
        <svg
          className={open ? `${s.chevron} ${s.up}` : s.chevron}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>
            <span className={s.name}>{user.fullName}</span>
            <span className={s.email}>{user.jobTitle ?? ROLE_LABEL[user.role]}</span>
          </div>
          <Link
            to="/settings/profile"
            className={s.menuItem}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            My profile
          </Link>
          <button
            type="button"
            className={`${s.menuItem} ${s.danger}`}
            role="menuitem"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
