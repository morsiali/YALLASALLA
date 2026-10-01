import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, apiUrl, getToken, setToken } from '../lib/api';

export interface User {
  id: string;
  role: 'customer' | 'merchant' | 'admin' | 'support';
  name: string | null;
  locale: 'ar' | 'en';
  phone: string;
  status?: string;
}
interface AuthCtx {
  user: User | null;
  ready: boolean;
  unread: number;
  msgUnread: number;
  tick: number;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshCounts: () => void;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);
  const [tick, setTick] = useState(0); // bumps on every live event so pages can refetch
  const es = useRef<EventSource | null>(null);

  const refreshCounts = useCallback(async () => {
    if (!getToken()) return;
    try {
      const n = await api('/notifications');
      setUnread(n.unread);
      const c = await api<any[]>('/conversations');
      setMsgUnread(c.reduce((s, x) => s + (x.unread || 0), 0));
    } catch {
      /* counts are cosmetic */
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setUnread(0);
    setMsgUnread(0);
    es.current?.close();
  }, []);
  const login = useCallback((token: string, u: User) => {
    setToken(token);
    setUser(u);
  }, []);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          setUser(await api('/auth/me'));
        } catch {
          setToken(null);
        }
      }
      setReady(true);
    })();
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('yalasala:unauthorized', onUnauthorized);
    return () => window.removeEventListener('yalasala:unauthorized', onUnauthorized);
  }, []);

  // live updates (SSE). A 60-second ticket is used so the long-lived token is never put in a URL.
  useEffect(() => {
    if (!user) return;
    refreshCounts();
    let closed = false;
    (async () => {
      try {
        const { ticket } = await api('/events/ticket', { method: 'POST' });
        if (closed) return;
        const source = new EventSource(apiUrl(`/events?ticket=${encodeURIComponent(ticket)}`));
        es.current = source;
        const bump = () => {
          setTick((t) => t + 1);
          refreshCounts();
        };
        source.addEventListener('notification', bump);
      } catch {
        /* live updates are best-effort; pages still refetch on navigation */
      }
    })();
    return () => {
      closed = true;
      es.current?.close();
    };
  }, [user, refreshCounts]);

  const value = useMemo(
    () => ({ user, ready, unread, msgUnread, tick, login, logout, refreshCounts }),
    [user, ready, unread, msgUnread, tick, login, logout, refreshCounts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
