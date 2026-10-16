import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import App from './App';
import { ErrorMessage, PortalLayout, ScopeFields, Skeletons } from './Portal';
import { projectMutation, projectRequest, type Identity, type SavedVersion, type Simulation } from './projectApi';
import { geography, normalizeScope, scopedBundle, type ProjectScope } from './projectScope';
import { useSimulation } from './useSimulation';

export default function ProjectWorkspace({ id, identity }: { id: string; identity?: Identity | null }) {
  const { user } = useUser();
  const state = useSimulation(id, identity?.id);
  const { project, loading, error, saving, dirty, conflict, saveError, recovery, editorEpoch, update, save, reload, acceptServer } = state;
  const [dialog, setDialog] = useState<'setup' | 'version' | 'history' | 'duplicate' | 'archive' | 'unpublish' | null>(new URLSearchParams(window.location.search).has('history') ? 'history' : null);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<ProjectScope>(normalizeScope());
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [, navigate] = useLocation();
  const owner = !!project?.is_owner && !project.read_only && !!identity;
  const historyAllowed = !!identity && (!!project?.is_owner || identity.is_admin) && !project?.is_seed;
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled]),select:not([disabled])');
      (first || dialogRef.current)?.focus();
    }, 0);
    return () => { clearTimeout(timer); previous?.focus(); };
  }, [dialog]);
  const open = (value: typeof dialog) => {
    setActionError(''); setDialog(value); setLabel('');
    if (project) { setName(value === 'duplicate' ? `${project.name} — copy` : project.name); setArea(project.area_label || ''); setScope(normalizeScope(project.scope)); }
  };
  useEffect(() => {
    if (dialog !== 'history' || !historyAllowed) return;
    let live = true; setHistoryLoading(true); setActionError('');
    projectRequest<SavedVersion[]>(`/simulations/${id}/versions`).then(value => { if (live) setVersions(Array.isArray(value) ? value : (value as any).items || (value as any).versions || []); })
      .catch(err => { if (live) setActionError(err.message); }).finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [dialog, id, historyAllowed]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setActionError('');
    try { await action(); } catch (err) { setActionError((err as Error).message); } finally { setBusy(false); }
  };
  // Explicit actions must save ALL edits, including edits made while a prior request was pending.
  const settled = async () => { let record = await save(); if (dirty) record = await save(); return record; };
  const saveSetup = async () => {
    const latest = await settled();
    const nextBundle = scopedBundle(latest.bundle, scope);
    const missing = scope.scopeMode === 'national' ? ['national'] : scope.areaRural ? ['rural'] : [];
    for (const key of missing) if (!nextBundle.altInputs[key]) {
      const blank = await projectRequest<any>('/defaults/blank');
      nextBundle.altInputs[key] = { ...(blank.inputs || blank), country_config: nextBundle.inputs.country_config, period: nextBundle.inputs.period, calculation_scope: scope.sectors };
    }
    update({ name: name.trim(), scope, bundle: nextBundle, scenarios: latest.scenarios, location: latest.location || {} });
    const value = await save();
    acceptServer(value); setDialog(null);
  };
  if (loading) return <PortalLayout identity={identity}><main className="portal-wrap portal-section"><span className="portal-eyebrow">Opening your simulation</span><h2>Loading the planning record…</h2><Skeletons /></main></PortalLayout>;
  if (error || !project) return <PortalLayout identity={identity}><main className="portal-wrap portal-section"><h1 style={{ fontSize: 35 }}>This simulation is not available.</h1><ErrorMessage message={error || 'The project could not be loaded.'} retry={() => void reload()} /><p>Private simulations are visible only to their owner and authorized administrators. Public viewers see only the selected published version.</p><Link href={user ? '/user-portal' : '/sign-in'} className="portal-btn">{user ? 'Back to simulations' : 'Sign in with your World Bank account'}</Link></main></PortalLayout>;
  return <div className="project-shell">
    <header className="project-toolbar"><div><Link href={user ? '/user-portal' : '/'}>← {user ? 'All simulations' : 'Explore WSS'}</Link><h1>{project.name}</h1><small>{project.country_name || project.country_code}{project.area_label ? ` / ${project.area_label}` : ''} · {geography(normalizeScope(project.scope))} · {project.scope.sectors.map(value => value === 'water' ? 'Water' : 'Sanitation').join(' + ')}</small></div>
      <div className="project-toolbar-actions"><small role="status" aria-live="polite">{owner ? saving ? 'Saving progress…' : conflict ? 'Conflict · Draft retained' : saveError ? 'Could not save' : dirty ? 'Unsaved changes' : `Saved ${new Date(project.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Read-only view'}</small>
        {owner && <><button disabled={saving || conflict} className="primary" onClick={() => void act(async () => { await settled(); })}>Save progress</button><button disabled={saving || conflict} onClick={() => open('version')}>Save version</button><button onClick={() => open('setup')}>Edit setup</button></>}
        {historyAllowed && <button onClick={() => open('history')}>{owner ? 'History & sharing' : 'Version history'}</button>}
        {identity ? <button onClick={() => open('duplicate')}>{project.is_seed ? 'Use as starting point' : 'Duplicate'}</button> : <Link href="/sign-in">Sign in to make a private copy ↗</Link>}
        {owner && project.visibility === 'public' && <button onClick={() => open('unpublish')}>Make private</button>}
        {owner && <button onClick={() => open('archive')}>{project.archived_at ? 'Unarchive' : 'Archive'}</button>}
      </div></header>
    {saveError && <div className="project-alert" role="alert">{saveError}<button onClick={state.download}>Download recoverable draft</button>{conflict ? <button onClick={() => { if (window.confirm('Reload the newer server revision? Your local draft will remain available for recovery. Download it first if needed.')) void reload(); }}>Reload newer revision</button> : <button onClick={() => void save().catch(() => {})}>Retry save</button>}</div>}
    {actionError && !dialog && <div className="project-alert" role="alert">{actionError}</div>}
    {recovery && owner && <div className="project-alert">This browser has a pending or failed save for this account and simulation.<button onClick={state.restoreRecovery}>Recover draft</button><button onClick={() => { if (window.confirm('Discard the browser recovery draft? The server record is unchanged.')) state.dismissRecovery(); }}>Discard recovery</button></div>}
    <div className="project-workspace"><App key={`${id}:${editorEpoch}`} projectId={id} initialBundle={project.bundle} initialScenarios={project.scenarios} initialLocation={project.location} readOnly={!owner} onDraftChange={update} onSetup={() => open('setup')} /></div>
    {dialog && <div className="project-modal" role="presentation" onClick={() => { if (!busy) setDialog(null); }}><section ref={dialogRef} tabIndex={-1} className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { setDialog(null); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="project-dialog-title">{dialog === 'setup' ? 'Edit simulation setup' : dialog === 'version' ? 'Save a meaningful checkpoint' : dialog === 'history' ? 'History & publication' : dialog === 'duplicate' ? 'Create a private copy' : dialog === 'unpublish' ? 'Make this simulation private?' : project.archived_at ? 'Return to your active workspace?' : 'Archive this simulation?'}</h2>
      {dialog === 'setup' && <><p>Changing scope preserves dormant data. Newly included areas start blank. To change country, <Link href="/simulations/new">create a new simulation</Link>—do not relabel existing observations.</p><label className="setup-field">Simulation name<input autoFocus required value={name} maxLength={160} onChange={event => setName(event.target.value)} /></label><div className="setup-meta">{project.country_name} · {area || 'No area label'} · Country identity retained</div><ScopeFields scope={scope} onChange={setScope} /></>}
      {dialog === 'version' && <><p>Progress saves your current working draft. A named version keeps an immutable input checkpoint for future reference or publication. Calculation success is not required.</p><label className="setup-field">Version label<input autoFocus value={label} maxLength={160} onChange={event => setLabel(event.target.value)} placeholder="e.g. Baseline reviewed with country team" /></label></>}
      {dialog === 'duplicate' && <><p>This creates an owned, private project with a new ID. The source simulation is unchanged.</p><label className="setup-field">Name for your copy<input autoFocus value={name} maxLength={160} onChange={event => setName(event.target.value)} /></label></>}
      {dialog === 'unpublish' && <p>The published version will no longer be available to other viewers. Your working draft and version history remain saved. Copies already made by permitted users are independent projects.</p>}
      {dialog === 'archive' && <p>{project.archived_at ? 'The simulation will return to My simulations with all its inputs and versions.' : 'Move this project out of your active collection. Nothing is deleted. Archiving is separate from publication; make it private first if you want to withdraw public access.'}</p>}
      {dialog === 'history' && <><p>{owner ? 'Publish one selected saved version. Later draft edits stay private until you explicitly update the publication. Restore creates a new working revision without deleting history.' : 'Administrator read access. Only the owner can restore or publish.'}</p><div className="portal-message">Visibility: <b>{project.visibility === 'public' ? 'Public · selected version only' : 'Private'}</b>{project.published_version_id && <><br />Published version: {project.published_version_id}</>}</div>{historyLoading ? <div className="portal-skeleton" style={{ height: 140 }} /> : versions.length ? versions.map(version => <div className="version-row" key={version.id}><div><b>{version.label}</b><small>{new Date(version.created_at).toLocaleString()}<br />Model {version.model_version || 'not recorded'} · {version.input_hash ? `Input hash ${version.input_hash.slice(0, 14)}` : 'Input hash unavailable'}</small></div>{owner && <div className="version-actions"><button disabled={busy || conflict} onClick={() => {
        if (!window.confirm('Restore this saved version as your working draft? Save a checkpoint of your current work first if needed.')) return;
        void act(async () => { const latest = await settled(); const result = await projectMutation<Simulation>(`/simulations/${id}/restore`, { revision: latest.revision, version_id: version.id }); acceptServer(result); setDialog(null); });
      }}>Restore</button><button className="primary" disabled={busy || conflict || project.published_version_id === version.id} onClick={() => {
        if (!window.confirm('Publish this selected saved version for the configured public audience? Your unpublished draft is not shared.')) return;
        void act(async () => { const latest = await settled(); const result = await projectMutation<Simulation>(`/simulations/${id}/publish`, { revision: latest.revision, version_id: version.id }); acceptServer(result); setDialog(null); });
      }}>{project.published_version_id === version.id ? 'Published' : project.visibility === 'public' ? 'Update public version' : 'Publish version'}</button></div>}</div>) : <div className="portal-message">No saved versions yet. Save your first checkpoint before publishing.</div>}</>}
      {actionError && <ErrorMessage message={actionError} />}
      <div className="project-dialog-actions"><button disabled={busy} onClick={() => setDialog(null)}>{dialog === 'history' ? 'Close' : 'Cancel'}</button>
        {dialog === 'setup' && owner && <button className="primary" disabled={busy || !name.trim() || conflict} onClick={() => void act(saveSetup)}>{busy ? 'Saving setup…' : 'Save setup'}</button>}
        {dialog === 'version' && owner && <button className="primary" disabled={busy || !label.trim() || conflict} onClick={() => void act(async () => { const latest = await settled(); await projectMutation(`/simulations/${id}/versions`, { revision: latest.revision, label: label.trim() }); setDialog(null); })}>{busy ? 'Saving version…' : 'Save version'}</button>}
        {dialog === 'duplicate' && identity && <button className="primary" disabled={busy || !name.trim() || conflict} onClick={() => void act(async () => { if (owner) await settled(); const copy = await projectMutation<Simulation>(`/simulations/${id}/duplicate`, { name: name.trim() }); if (live.current) navigate(`/simulations/${copy.id}`); })}>{busy ? 'Creating copy…' : 'Create private copy'}</button>}
        {dialog === 'unpublish' && owner && <button className="primary" disabled={busy || conflict} onClick={() => void act(async () => { const latest = await settled(); const value = await projectMutation<Simulation>(`/simulations/${id}/unpublish`, { revision: latest.revision }); acceptServer(value); setDialog(null); })}>Make private</button>}
        {dialog === 'archive' && owner && <button className="primary" disabled={busy || conflict} onClick={() => void act(async () => { const latest = await settled(); const value = await projectMutation<Simulation>(`/simulations/${id}`, { revision: latest.revision, archived: !project.archived_at }, 'PATCH'); acceptServer(value); setDialog(null); })}>{project.archived_at ? 'Unarchive simulation' : 'Archive simulation'}</button>}
      </div>
    </section></div>}
  </div>;
}
