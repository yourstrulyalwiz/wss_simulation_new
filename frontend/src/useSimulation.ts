import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadRecovery, projectMutation, projectRequest, ProjectError, recoveryKey, type Draft, type Simulation } from './projectApi';
import { normalizeScope, scopedBundle } from './projectScope';

export function useSimulation(id: string, userId?: string) {
  const [project, setProject] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [change, setChange] = useState(0);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const live = useRef(true);
  const currentProject = useRef<Simulation | null>(null);
  const draft = useRef<Draft | null>(null);
  const saved = useRef('');
  const flight = useRef<Promise<Simulation> | null>(null);
  const blocked = useRef(false);
  const key = userId ? recoveryKey(userId, id) : null;
  const adopt = useCallback((value: Simulation) => {
    const scope = normalizeScope(value.scope || value.bundle?.scope);
    const next = { ...value, scope, bundle: scopedBundle(value.bundle, scope), scenarios: value.scenarios || [] };
    const working = { bundle: next.bundle, scenarios: next.scenarios, location: value.location || {}, scope, name: next.name };
    currentProject.current = next; draft.current = working; saved.current = JSON.stringify(working);
    setProject(next); setDirty(false); setSaveError(''); setConflict(false); blocked.current = false;
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const value = await projectRequest<Simulation>(`/simulations/${encodeURIComponent(id)}`);
      if (!live.current) return;
      adopt(value); setEditorEpoch(epoch => epoch + 1);
      if (key && value.is_owner && !value.read_only) {
        try { const recovered = JSON.parse(localStorage.getItem(key) || 'null'); setRecovery(recovered?.draft || null); } catch { setRecovery(null); }
      }
    } catch (err) { if (live.current) setError((err as Error).message); }
    finally { if (live.current) setLoading(false); }
  }, [id, key, adopt]);
  useEffect(() => {
    live.current = true; void load();
    return () => { live.current = false; };
  }, [load]);
  const remember = useCallback((value: Draft) => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ revision: currentProject.current?.revision, saved_at: new Date().toISOString(), draft: value })); }
    catch { setSaveError('Browser recovery storage is unavailable. Keep this page open and download a recovery copy before leaving.'); }
  }, [key]);
  const update = useCallback((value: Draft) => {
    const owner = currentProject.current;
    if (!owner?.is_owner || owner.read_only) return;
    const next = { ...value, name: value.name ?? draft.current?.name ?? owner.name };
    draft.current = next;
    const changed = JSON.stringify(next) !== saved.current;
    setDirty(changed); setChange(count => count + 1);
    if (changed) remember(next);
  }, [remember]);
  const save = useCallback(async (): Promise<Simulation> => {
    if (flight.current) return flight.current;
    const record = currentProject.current, value = draft.current;
    if (!record || !value) throw new Error('Simulation has not loaded yet.');
    if (blocked.current) throw new Error('Reload the newer revision before saving. Download your draft first.');
    if (JSON.stringify(value) === saved.current) return record;
    setSaving(true); setSaveError('');
    const signature = JSON.stringify(value);
    const promise = projectMutation<Simulation>(`/simulations/${encodeURIComponent(id)}`, { revision: record.revision, ...value }, 'PATCH');
    flight.current = promise;
    try {
      const result = await promise;
      if (!live.current) return result;
      currentProject.current = result; setProject(result); saved.current = signature;
      const pending = JSON.stringify(draft.current) !== signature;
      setDirty(pending);
      if (!pending && key) localStorage.removeItem(key);
      if (pending && draft.current) remember(draft.current);
      return result;
    } catch (err) {
      if (live.current) {
        setSaveError((err as Error).message);
        if (err instanceof ProjectError && err.status === 409) { blocked.current = true; setConflict(true); }
        if (draft.current) remember(draft.current);
      }
      throw err;
    } finally { flight.current = null; if (live.current) { setSaving(false); } }
  }, [id, key, remember]);
  useEffect(() => {
    if (!dirty || conflict || saving || saveError) return;
    const timer = setTimeout(() => { void save().catch(() => {}); }, 1100);
    return () => clearTimeout(timer);
  }, [change, dirty, conflict, saving, saveError, save]);
  useEffect(() => {
    const currentHref = window.location.href;
    const warn = (event: BeforeUnloadEvent) => {
      if (draft.current && JSON.stringify(draft.current) !== saved.current) { remember(draft.current); event.preventDefault(); event.returnValue = ''; }
    };
    const navigate = (event: MouseEvent) => {
      const target = (event.target as Element).closest?.('a[href]');
      if (!target || event.defaultPrevented || !draft.current || JSON.stringify(draft.current) === saved.current) return;
      const href = target.getAttribute('href');
      if (href?.startsWith('#')) return;
      if (!window.confirm('There are unsaved changes. A recovery draft is kept on this browser. Leave this simulation?')) { event.preventDefault(); event.stopPropagation(); }
    };
    const back = (event: PopStateEvent) => {
      if (!draft.current || JSON.stringify(draft.current) === saved.current) return;
      remember(draft.current);
      if (!window.confirm('There are unsaved changes. A recovery draft is kept on this browser. Leave this simulation?')) {
        event.stopImmediatePropagation(); window.history.pushState(null, '', currentHref);
      }
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', navigate, true);
    window.addEventListener('popstate', back, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true); window.removeEventListener('popstate', back, true); };
  }, [remember]);
  const acceptServer = (value: Simulation) => { adopt(value); setEditorEpoch(epoch => epoch + 1); if (key) localStorage.removeItem(key); setRecovery(null); };
  const restoreRecovery = () => {
    if (!recovery) return;
    update(recovery);
    setProject(previous => previous ? { ...previous, ...recovery } : previous);
    setEditorEpoch(epoch => epoch + 1); setRecovery(null);
  };
  const dismissRecovery = () => { setRecovery(null); if (key) localStorage.removeItem(key); };
  return { project, loading, error, saveError, saving, dirty, conflict, recovery, editorEpoch, update, save, reload: load, acceptServer,
    restoreRecovery, dismissRecovery, download: () => downloadRecovery({ project_id: id, revision: currentProject.current?.revision, ...draft.current }, `wss-${id}-recovery`) };
}
