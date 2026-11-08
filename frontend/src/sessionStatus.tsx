import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { projectRequest, type Identity } from './projectApi';

export type SessionStatus = { status: 'authenticated' | 'anonymous' | 'reauthentication_required' | 'temporary_error';
  user: Identity | null; serverTime: number; idleExpiresAt: number | null; absoluteExpiresAt: number | null;
  activityIntervalMs?: number; warningMs?: number };
type SessionControls = { enabled: boolean; status: SessionStatus | null; warning: boolean; recheck: () => Promise<void>;
  activity: () => void; staySignedIn: () => void; signIn: () => void };
const SessionContext = createContext<SessionControls>({ enabled: false, status: null, warning: false,
  recheck: async () => {}, activity: () => {}, staySignedIn: () => {}, signIn: () => {} });
export const useSessionStatus = () => useContext(SessionContext);

export function SessionStatusProvider({ initial, children }: { initial: SessionStatus; children: ReactNode }) {
  const [status, setStatus] = useState(initial);
  const [warning, setWarning] = useState(false);
  const statusRef = useRef(status), offset = useRef(initial.serverTime - Date.now());
  const lastActivity = useRef(0), pendingActivity = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popup = useRef<Window | null>(null), live = useRef(true), checking = useRef(false), activityFlight = useRef(false);
  const adopt = useCallback((value: SessionStatus) => {
    if (!live.current) return;
    offset.current = value.serverTime - Date.now(); statusRef.current = value; setStatus(value);
  }, []);
  const recheck = useCallback(async () => {
    if (document.hidden || checking.current) return;
    checking.current = true;
    try { adopt(await projectRequest<SessionStatus>('/session')); }
    catch { if (live.current) setStatus(value => ({ ...value, status: 'temporary_error' })); }
    finally { checking.current = false; }
  }, [adopt]);
  const sendActivity = useCallback(async () => {
    pendingActivity.current = null;
    if (document.hidden || activityFlight.current || statusRef.current.status !== 'authenticated') return;
    activityFlight.current = true; lastActivity.current = Date.now();
    try { adopt(await projectRequest<SessionStatus>('/session/activity', { method: 'POST' })); }
    catch { void recheck(); }
    finally { activityFlight.current = false; }
  }, [adopt, recheck]);
  const activity = useCallback(() => {
    if (document.hidden || statusRef.current.status !== 'authenticated' || pendingActivity.current) return;
    const wait = Math.max(0, (statusRef.current.activityIntervalMs || 60_000) - (Date.now() - lastActivity.current));
    if (wait === 0) void sendActivity();
    else pendingActivity.current = setTimeout(() => { void sendActivity(); }, wait);
  }, [sendActivity]);
  useEffect(() => {
    live.current = true;
    const refresh = () => { void recheck(); };
    const expired = () => { adopt({ ...statusRef.current, status: 'reauthentication_required', serverTime: Date.now() + offset.current }); };
    const message = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === popup.current && event.data?.type === 'wss-auth-complete') refresh();
    };
    const timer = setInterval(() => {
      const current = statusRef.current, now = Date.now() + offset.current;
      const end = Math.min(current.idleExpiresAt || Infinity, current.absoluteExpiresAt || Infinity);
      setWarning(current.status === 'authenticated' && end > now && end - now <= (current.warningMs || 300_000));
      if (current.status === 'authenticated' && end <= now) expired();
      if (!document.hidden) refresh();
    }, 30_000);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('message', message);
    window.addEventListener('wss-auth-required', expired);
    return () => { live.current = false; clearInterval(timer); if (pendingActivity.current) clearTimeout(pendingActivity.current);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('message', message);
      window.removeEventListener('wss-auth-required', expired); };
  }, [adopt, recheck]);
  return <SessionContext.Provider value={{ enabled: true, status, warning, recheck, activity,
    staySignedIn: () => { void sendActivity(); },
    signIn: () => { popup.current = window.open('/api/login?next=%2Fauth%2Fcomplete', 'wss-reauthentication', 'popup,width=580,height=740');
      if (!popup.current) window.alert('Allow a sign-in window, or open the Sign in again link in a new tab. Keep this editor open.'); } }}>
    {children}
  </SessionContext.Provider>;
}
