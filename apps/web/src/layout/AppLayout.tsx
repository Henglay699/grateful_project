import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RememberedOutlet } from './RememberedOutlet';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { titleFor } from './nav';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { applyTheme } from './theme';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** True when Escape belongs to something else: a text field, or a visible popup. */
function escapeIsTaken(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('input, textarea, select'))
  )
    return true;
  const popups = document.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"]',
  );
  // Some panels (team chat) stay mounted and are only hidden with visibility.
  return Array.from(popups).some(
    (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  );
}

/** Shared shell: sidebar + top bar (page title, search, chat, live clock) + routed page. */
export function AppLayout() {
  const location = useLocation();
  const title = titleFor(location.pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = `${title} | Grateful Solutions`;
  }, [title]);

  useEffect(() => applyTheme(), []);

  useEffect(() => {
    if (readPref('gs:sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');
    return () => document.body.classList.remove('sidebar-collapsed');
  }, []);

  const toggleCollapse = useCallback(() => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    writePref('gs:sidebar', collapsed ? 'collapsed' : 'expanded');
  }, []);

  // Escape closes the mobile drawer, or else collapses/expands the sidebar, but only when
  // nothing else wants the key: a field being typed in, or an open modal, menu or picker.
  // Capture phase, so the check runs before those popups close themselves on the same key.
  const mobileOpenRef = useRef(mobileOpen);
  mobileOpenRef.current = mobileOpen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (mobileOpenRef.current) {
        setMobileOpen(false);
        return;
      }
      if (escapeIsTaken(e.target)) return;
      toggleCollapse();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleCollapse]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        open={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        onToggleCollapse={toggleCollapse}
      />
      <div className="main">
        <TopBar title={title} onToggleMenu={() => setMobileOpen((o) => !o)} />
        <main className="content" id="main-content" tabIndex={-1}>
          <ErrorBoundary resetKey={location.pathname}>
            <RememberedOutlet />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}
