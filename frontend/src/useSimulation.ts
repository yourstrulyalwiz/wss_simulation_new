import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadRecovery, projectMutation, projectRequest, ProjectError, recoveryKey, type Draft, type Simulation } from './projectApi';
import { normalizeScope, scopedBundle } from './projectScope';
import { canonical, draftOf, readRecoveries, removeMatching, type PendingSetup, type RecoveryEntry } from './draftRecovery';
import { useSessionStatus } from './sessionStatus';

type SavePhase = 'idle' | 'saving' | 'retry' | 'auth' | 'account' | 'conflict' | 'permission' | 'validation';
type Attempt = { revision: number; draft: Draft; signature: string };
export function useSimulation(id: string, userId?: string) {
  const session = useSessionStatus();
  const [project, setProject] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [saveError, setSaveError] = useState(''), [storageError, setStorageError] = useState('');
  const [locallyStored, setLocallyStored] = useState(false);
  const [phase, setPhaseState] = useState<SavePhase>('idle');
  const [dirty, setDirty] = useState(false), [retryAt, setRetryAt] = useState(0);
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([]);
  const [recoveredSetup, setRecoveredSetup] = useState<PendingSetup | null>(null);
  const [change, setChange] = useState(0), [editorEpoch, setEditorEpoch] = useState(0);
  const live = useRef(true), currentProject = useRef<Simulation | null>(null), draft = useRef<Draft | null>(null);
  const saved = useRef(''), baseRevision = useRef<number | null>(null);
  const phaseRef = useRef<SavePhase>('idle'), recoveryPending = useRef(false);
  const flight = useRef<Promise<Simulation> | null>(null), uncertain = useRef<Attempt | null>(null);
  const needsRecheck = useRef(false), retries = useRef(0), pendingSetup = useRef<PendingSetup | undefined>(undefined);
  const lastFreshEditAt = useRef(0);
  const selectedRecovery = useRef<RecoveryEntry | null>(null);
  const editorId = useRef(crypto.randomUUID()), ownCopy = useRef<RecoveryEntry | null>(null);
  const sessionRef = useRef(session); sessionRef.current = session;
  const key = userId ? `${recoveryKey(userId, id)}:tab:${editorId.current}` : null;
  const setPhase = useCallback((value: SavePhase) => { phaseRef.current = value; if (live.current) setPhaseState(value); }, []);
  const remember = useCallback((value = draft.current) => {
    if (!key || !value || !userId) return false;
    const entry: RecoveryEntry = { key, envelope: { ownerId: userId, projectId: id, editorId: editorId.current,
      revision: baseRevision.current, saved_at: new Date().toISOString(), draft: value, setup: pendingSetup.current } };
    try {
      localStorage.setItem(key, JSON.stringify(entry.envelope)); ownCopy.current = entry;
      if (live.current) { setLocallyStored(true); setStorageError(''); } return true;
    } catch {
      if (live.current) { setLocallyStored(false); setStorageError('Browser recovery is unavailable. Keep this page open and download a recovery copy.'); }
      return false;
    }
  }, [id, key, userId]);
  const normalize = (value: Simulation) => {
    const scope = normalizeScope(value.scope || value.bundle?.scope);
    return { ...value, scope, bundle: scopedBundle(value.bundle, scope), scenarios: value.scenarios || [] };
  };
  const adopt = useCallback((value: Simulation) => {
    const next = normalize(value), working = draftOf(next);
    currentProject.current = next; draft.current = working; saved.current = canonical(working); baseRevision.current = next.revision;
    uncertain.current = null; needsRecheck.current = false;
    setProject(next); setDirty(false); setSaveError(''); setPhase('idle');
  }, [setPhase]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const value = await projectRequest<Simulation>(`/simulations/${encodeURIComponent(id)}`);
      if (!live.current) return;
      adopt(value);
      if (key && userId && value.is_owner && !value.read_only) {
        try {
          const entries = readRecoveries(localStorage, userId, id);
          recoveryPending.current = entries.length > 0; setRecoveries(entries);
        } catch { setStorageError('Browser recovery is unavailable. Keep this page open and download a recovery copy.'); }
      }
      setEditorEpoch(epoch => epoch + 1);
    } catch (err) { if (live.current) setError((err as Error).message); }
    finally { if (live.current) setLoading(false); }
  }, [id, key, userId, adopt]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, [load]);

  const update = useCallback((value: Draft) => {
    const owner = currentProject.current;
    if (!owner?.is_owner || owner.read_only || recoveryPending.current || phaseRef.current === 'account') return;
    const next = { ...value, name: value.name ?? draft.current?.name ?? owner.name };
    const changedFromLastEdit = canonical(next) !== canonical(draft.current);
    draft.current = next;
    const changed = canonical(next) !== saved.current;
    setDirty(changed); setChange(count => count + 1);
    if (changed || pendingSetup.current) remember(next);
    if (changedFromLastEdit) {
      lastFreshEditAt.current = Date.now();
      sessionRef.current.activity();
      if (phaseRef.current === 'validation') { setPhase('idle'); setSaveError(''); }
    }
  }, [remember, setPhase]);
  const clearAcknowledged = useCallback(() => {
    if (pendingSetup.current) { remember(); return; }
    for (const copy of [ownCopy.current, selectedRecovery.current]) {
      if (copy) try { removeMatching(localStorage, copy); } catch { /* Keep copies on storage failure. */ }
    }
    ownCopy.current = null; selectedRecovery.current = null; setLocallyStored(false);
  }, [remember]);
  const acknowledge = useCallback((result: Simulation, signature: string, qualifyingSave = false) => {
    currentProject.current = normalize(result); baseRevision.current = result.revision;
    setProject(currentProject.current); saved.current = signature; uncertain.current = null;
    const pending = canonical(draft.current) !== signature;
    setDirty(pending); retries.current = 0; setRetryAt(0); setSaveError(''); setPhase('idle');
    if (pending) remember(); else clearAcknowledged();
    if (qualifyingSave) sessionRef.current.activity();
  }, [clearAcknowledged, remember, setPhase]);
  const checkServer = useCallback(async (): Promise<Simulation | null> => {
    const server = normalize(await projectRequest<Simulation>(`/simulations/${encodeURIComponent(id)}`));
    if (!server.is_owner || server.read_only) throw new ProjectError('Your permission to save this simulation has changed.', 403);
    const attempt = uncertain.current;
    if (attempt && server.revision === attempt.revision + 1 && canonical(draftOf(server)) === attempt.signature) {
      acknowledge(server, attempt.signature); needsRecheck.current = false; return server;
    }
    if (server.revision !== baseRevision.current) {
      throw new ProjectError('This simulation changed in another session. Your draft has been retained.', 409);
    }
    needsRecheck.current = false; return null;
  }, [id, acknowledge]);
  const save = useCallback(async (freshAction = true): Promise<Simulation> => {
    if (freshAction) { sessionRef.current.activity(); retries.current = 0; }
    if (flight.current) return flight.current;
    const task = (async () => {
      let record = currentProject.current;
      if (!record || !draft.current) throw new Error('Simulation has not loaded yet.');
      if (recoveryPending.current) throw new Error('Recover or explicitly discard the pending browser draft before saving.');
      if (['conflict', 'permission', 'account'].includes(phaseRef.current)) throw new Error('Resolve the account, access or revision conflict before saving.');
      const auth = sessionRef.current;
      if (auth.enabled && (auth.status?.status === 'reauthentication_required' || auth.status?.status === 'anonymous')) {
        setPhase('auth'); remember(); throw new ProjectError('Session expired. Sign in again to save your changes.', 401);
      }
      if (auth.enabled && auth.status?.user && auth.status.user.id !== userId) {
        setPhase('account'); remember(); throw new ProjectError('Sign in with the account that owns this open draft.', 403);
      }
      try {
        const qualifyingSave = freshAction || phaseRef.current !== 'retry' && Date.now() - lastFreshEditAt.current < 60_000;
        setPhase('saving'); setSaveError('');
        if (uncertain.current || needsRecheck.current) { await checkServer(); record = currentProject.current!; }
        if (!live.current) throw new ProjectError('This editor has closed. Its recovery draft is retained.', 499, 'CANCELLED');
        if (sessionRef.current.enabled && sessionRef.current.status?.user?.id !== userId) {
          throw new ProjectError('Sign in with the account that owns this open draft.', 401);
        }
        const value = draft.current!, signature = canonical(value);
        if (signature === saved.current) { setPhase('idle'); return record; }
        const attempt: Attempt = { revision: baseRevision.current!, draft: value, signature };
        uncertain.current = attempt;
        const result = await projectMutation<Simulation>(`/simulations/${encodeURIComponent(id)}`, { revision: attempt.revision, ...value }, 'PATCH');
        if (live.current) acknowledge(result, signature, qualifyingSave);
        return result;
      } catch (error) {
        if (!live.current) throw error;
        const err = error instanceof ProjectError ? error : new ProjectError((error as Error).message, 0);
        // A rejected retry can also mean the earlier request committed after its response was lost.
        if (err.status === 409 && uncertain.current) {
          try { const found = await checkServer(); if (found) return found; } catch { /* Genuine conflict below. */ }
        }
        remember(); setSaveError(err.message);
        if (err.status === 401) { needsRecheck.current = true; setPhase('auth'); }
        else if (err.status === 409) setPhase('conflict');
        else if (err.status === 403) setPhase('permission');
        else if (err.retryable) {
          const schedule = [2000, 5000, 10_000, 20_000, 60_000];
          const delay = Math.max(err.retryAfterMs, schedule[Math.min(retries.current++, schedule.length - 1)] * (0.9 + Math.random() * 0.2));
          setRetryAt(Date.now() + delay); setPhase('retry');
        } else { uncertain.current = null; setPhase('validation'); }
        throw err;
      }
    })();
    flight.current = task;
    try { return await task; } finally { if (flight.current === task) flight.current = null; }
  }, [id, userId, remember, checkServer, acknowledge, setPhase]);
  const saveAll = useCallback(async () => {
    sessionRef.current.activity();
    let result = await save(false);
    for (let i = 0; canonical(draft.current) !== saved.current; i++) {
      if (i >= 10) throw new Error('Editing is still in progress. Finish your changes and save again.');
      result = await save(false);
    }
    return result;
  }, [save]);
  useEffect(() => {
    if (!dirty || recoveryPending.current || !['idle', 'retry'].includes(phase) ||
        session.enabled && session.status?.status !== 'authenticated') return;
    const delay = phase === 'retry' ? Math.max(0, retryAt - Date.now()) : 1100;
    const timer = setTimeout(() => { if (navigator.onLine) void save(false).catch(() => {}); else { setPhase('retry'); setRetryAt(Date.now() + 5000); } }, delay);
    return () => clearTimeout(timer);
  }, [change, dirty, phase, retryAt, save, session.enabled, session.status?.status, setPhase]);
  useEffect(() => {
    if (!session.enabled || !userId || !project) return;
    const status = session.status;
    if (status?.user && status.user.id !== userId) { remember(); setPhase('account'); }
    else if (status?.status === 'authenticated' && ['auth', 'account'].includes(phaseRef.current)) {
      needsRecheck.current = true; setPhase('idle'); setSaveError(''); setChange(n => n + 1);
    } else if (status?.status === 'anonymous' || status?.status === 'reauthentication_required') {
      if (dirty || pendingSetup.current) remember(); needsRecheck.current = true; setPhase('auth');
    }
  }, [session.enabled, session.status, userId, project?.id, dirty, remember, setPhase]);
  useEffect(() => {
    const retry = () => {
      if (!document.hidden && phaseRef.current === 'retry') { setRetryAt(Date.now()); setChange(n => n + 1); }
    };
    window.addEventListener('online', retry); window.addEventListener('focus', retry);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry); };
  }, []);
  useEffect(() => {
    if (!userId || !key) return;
    const base = recoveryKey(userId, id);
    const compete = (event: StorageEvent) => {
      if (!event.key?.startsWith(base) || event.key === key || !event.newValue) return;
      try {
        const entries = readRecoveries(localStorage, userId, id).filter(entry => entry.key !== key);
        if (entries.length) { setRecoveries(entries); recoveryPending.current = true; }
      } catch { /* Never discard an unreadable recovery entry. */ }
    };
    window.addEventListener('storage', compete);
    return () => window.removeEventListener('storage', compete);
  }, [id, userId, key]);
  useEffect(() => {
    const unsaved = () => !!pendingSetup.current || !!draft.current && canonical(draft.current) !== saved.current;
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved()) { remember(); event.preventDefault(); event.returnValue = ''; }
    };
    const navigate = (event: MouseEvent) => {
      const target = (event.target as Element).closest?.('a[href]');
      if (!target || target.getAttribute('target') === '_blank' || event.defaultPrevented || !unsaved()) return;
      if (target.getAttribute('href')?.startsWith('#')) return;
      remember();
      if (!window.confirm('There are unsaved changes. Download a recovery copy before leaving if needed. Leave this simulation?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', navigate, true);
    const back = (event: PopStateEvent) => {
      if (!unsaved()) return;
      remember();
      if (!window.confirm('There are unsaved changes. Download a recovery copy before leaving if needed. Leave this simulation?')) {
        event.stopImmediatePropagation(); window.history.pushState(null, '', `/simulations/${id}`);
      }
    };
    window.addEventListener('popstate', back, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true); window.removeEventListener('popstate', back, true); };
  }, [remember, id]);
  const restoreRecovery = (entry = recoveries[0]) => {
    if (!entry) return;
    selectedRecovery.current = entry; recoveryPending.current = false; setRecoveries([]);
    const envelope = entry.envelope;
    draft.current = envelope.draft; baseRevision.current = envelope.revision;
    pendingSetup.current = envelope.setup; setRecoveredSetup(envelope.setup || null);
    setDirty(canonical(envelope.draft) !== saved.current); remember();
    if (envelope.revision !== currentProject.current?.revision) {
      setPhase('conflict'); setSaveError('This simulation changed since the browser draft was saved. Download your draft before resolving the conflict.');
    } else { needsRecheck.current = true; setPhase('idle'); }
    setProject(previous => previous ? { ...previous, ...envelope.draft } : previous);
    setEditorEpoch(epoch => epoch + 1);
  };
  const dismissRecovery = (entry = recoveries[0]) => {
    if (!entry) return;
    try { removeMatching(localStorage, entry); } catch {}
    setRecoveries(previous => { const next = previous.filter(item => item !== entry); recoveryPending.current = next.length > 0; return next; });
  };
  const setPendingSetup = (setup: PendingSetup | undefined) => {
    pendingSetup.current = setup;
    if (setup || dirty) remember();
    else if (canonical(draft.current) === saved.current) clearAcknowledged();
  };
  return { project, loading, error, saveError, storageError, locallyStored, phase, retryAt,
    saving: phase === 'saving', dirty, conflict: phase === 'conflict', recoveries, recoveredSetup,
    editorEpoch, update, save, saveAll, reload: load, setPendingSetup, restoreRecovery, dismissRecovery,
    acceptServer: (value: Simulation) => { setRecoveredSetup(null); adopt(value); setEditorEpoch(n => n + 1); },
    download: (entry?: RecoveryEntry) => downloadRecovery(entry?.envelope || {
      ownerId: userId, projectId: id, revision: baseRevision.current, draft: draft.current, setup: pendingSetup.current }, `wss-${id}-recovery`) };
}
