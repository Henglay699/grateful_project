import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'gs:theme';
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let current: Theme = read();

/** Put the theme on <html> (light is the data-theme attribute; dark is the default). */
export function applyTheme(theme: Theme = current) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

/** The app's light/dark theme, chosen in Settings → My profile and kept in this browser. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return [theme, setTheme];
}
