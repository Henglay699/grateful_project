import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

const KEY = 'gs:view:';

// List pages keep their filters in the URL; detail/editor pages (…/:id) are left alone.
function remembers(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  return parts.length === 1 || (parts.length === 2 && parts[0] === 'accounting');
}

function read(pathname: string): string | null {
  try {
    return sessionStorage.getItem(KEY + pathname);
  } catch {
    return null;
  }
}
function write(pathname: string, search: string) {
  try {
    sessionStorage.setItem(KEY + pathname, search);
  } catch {
    /* private mode */
  }
}

/**
 * Outlet that remembers each list page's filters (its query string) for this tab, and
 * puts them back when the page is reopened by a bare link (Back, sidebar, breadcrumbs).
 */
export function RememberedOutlet() {
  const { pathname, search } = useLocation();
  const last = useRef<string | null>(null);
  const entering = last.current !== pathname;
  const restore = entering && !search && remembers(pathname) ? read(pathname) : null;

  useEffect(() => {
    last.current = pathname;
    if (!restore && remembers(pathname)) write(pathname, search);
  });

  if (restore) return <Navigate to={pathname + restore} replace />;
  return <Outlet />;
}
