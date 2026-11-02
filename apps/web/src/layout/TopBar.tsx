import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { icons } from './icons';
import { AlertsBell } from './AlertsBell';
import { AskAi } from './AskAi';
import { GlobalSearch } from './GlobalSearch';
import { CustomizeOverviewButton, LiveMonthPill } from './LiveMonthPill';
import { ProfileMenu } from './ProfileMenu';
import { TeamChat } from './chat/TeamChat';

interface Props {
  title: string;
  onToggleMenu: () => void;
}

export function TopBar({ title, onToggleMenu }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);

  // Phone search: focus the field on open; close on Escape, a tap outside, or a new page.
  useEffect(() => {
    if (!searchOpen) return;
    searchBox.current?.querySelector('input')?.focus();
    const away = (e: Event) => {
      const t = e.target as Element;
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !searchBox.current?.contains(t) && !t.closest?.('.search-toggle')
      )
        setSearchOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', away);
    };
  }, [searchOpen]);
  useEffect(() => setSearchOpen(false), [pathname]);

  return (
    <header className={`topbar${searchOpen ? ' search-open' : ''}`}>
      <div className="topbar-left">
        <button
          type="button"
          className="menu-toggle"
          onClick={onToggleMenu}
          aria-label="Toggle menu"
          aria-controls="sidebar"
        >
          {icons.menu({})}
        </button>
        <h1 className="page-title" id="pageTitle">
          {title}
        </h1>
        {pathname.startsWith('/overview') && (
          <>
            <LiveMonthPill />
            <CustomizeOverviewButton />
          </>
        )}
      </div>

      <div className="topbar-right">
        {/* Phones: search is an icon that opens the field across the top bar. */}
        <button
          type="button"
          className="icon-btn search-toggle"
          onClick={() => setSearchOpen((o) => !o)}
          aria-label="Search"
          aria-expanded={searchOpen}
        >
          {icons.search({})}
        </button>
        <div className="topbar-search" ref={searchBox}>
          <GlobalSearch />
        </div>

        <AskAi />

        <TeamChat />

        <AlertsBell />

        {can('shipments:write') && (
          <button
            type="button"
            className="new-shipment-btn"
            onClick={() => navigate('/plans/new')}
            aria-label="New Shipment"
            title="New Shipment"
          >
            {icons.plus({})}
            <span className="topbar-btn-label">New Shipment</span>
          </button>
        )}

        <ProfileMenu />
      </div>
    </header>
  );
}
