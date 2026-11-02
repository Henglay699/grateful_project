import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasPermission,
  type AuthResponse,
  type LoginInput,
  type Permission,
  type SessionUser,
} from '@gs/shared';
import { api, refreshSession, session } from '../lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: SessionUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  /** Show my updated profile (name, picture) without signing in again. */
  updateUser: (user: SessionUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const apply = useCallback((data: AuthResponse | null) => {
    session.setToken(data?.accessToken ?? null);
    setUser(data?.user ?? null);
    setStatus(data ? 'authenticated' : 'anonymous');
  }, []);

  // Restore the session from the httpOnly refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((data) => {
      if (!cancelled) apply(data);
    });
    session.onLost(() => {
      apply(null);
      queryClient.clear();
    });
    return () => {
      cancelled = true;
    };
  }, [apply, queryClient]);

  // Refresh the access token shortly before it expires while the tab is open.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const id = window.setInterval(() => {
      void refreshSession().then((data) => {
        if (data) setUser(data.user);
      });
    }, 12 * 60_000);
    return () => window.clearInterval(id);
  }, [status]);

  const login = useCallback(
    async (input: LoginInput) => {
      const data = await api<AuthResponse>('/auth/login', { method: 'POST', json: input });
      apply(data);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await api<undefined>('/auth/logout', { method: 'POST' });
    } finally {
      apply(null);
      queryClient.clear();
    }
  }, [apply, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      logout,
      can: (p) => !!user && hasPermission(user.permissions, p),
      updateUser: setUser,
    }),
    [status, user, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
