import { useEffect, useRef, useState } from 'react';
import { useAppAccess } from './accessMode';
import { Link, useLocation } from 'wouter';
import App from './App';
import { ErrorMessage, PortalLayout, ScopeFields, Skeletons } from './Portal';
import { projectMutation, projectRequest, type Identity, type SavedVersion, type Simulation } from './projectApi';
import { geography, normalizeScope, scopedBundle, type ProjectScope } from './projectScope';
import { useSimulation } from './useSimulation';
import { useSessionStatus } from './sessionStatus';

export default function ProjectWorkspace({ id, identity }: { id: string; identity?: Identity | null }) {
  const { user, publicReadOnly } = useAppAccess();
  const state = useSimulation(id, identity?.id);
  const { project, loading, error, saving, dirty, conflict, saveError, editorEpoch, update, save, reload, acceptServer } = state;
  const session = useSessionStatus();
  const [dialog, setDialog] = useState<'version' | 'history' | 'duplicate' | 'archive' | 'unpublish' | null>(new URLSearchParams(window.location.search).has('history') ? 'history' : null);
  const [name, setName] = useState('');
  const [setupName, setSetupName] = useState('');
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
    if (project) { setSetupName(state.recoveredSetup?.name ?? project.name); setScope(normalizeScope(state.recoveredSetup?.scope ?? project.scope)); }
  }, [project?.id, editorEpoch]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled]),select:not([disabled])');
      (first || dialogRef.current)?.focus();
    }, 0);
    return () => { clearTimeout(timer); previous?.focus(); };
  }, [dialog]);
  const open = (value: typeof dialog | 'setup') => {
    setActionError(''); setDialog(value === 'setup' ? null : value); setLabel('');
    if (project && value !== 'setup') setName(value === 'duplicate' ? `${project.name} — copy` : project.name);
    if (value === 'setup') window.dispatchEvent(new Event('simulation-setup-navigation'));
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
  const settled = state.saveAll;
  const saveSetup = async () => {
    if (!setupName.trim()) return;
    const latest = await settled();
    const nextBundle = scopedBundle(latest.bundle, scope);
    const missing = scope.scopeMode === 'national' ? ['national'] : scope.areaRural ? ['rural'] : [];
    for (const key of missing) if (!nextBundle.altInputs[key]) {
      const blank = await projectRequest<any>('/defaults/blank');
      nextBundle.altInputs[key] = { ...(blank.inputs || blank), country_config: nextBundle.inputs.country_config, period: nextBundle.inputs.period, calculation_scope: scope.sectors };
    }
    update({ name: setupName.trim(), scope, bundle: nextBundle, scenarios: latest.scenarios, location: { ...latest.location, activeTab: -1 } });
    const value = await save();
    state.setPendingSetup(undefined);
    acceptServer(value); setDialog(null);
  };
  if (loading) return <PortalLayout identity={identity}><main className="portal-wrap portal-section"><span className="portal-eyebrow">Opening your simulation</span><h2>Loading the planning record…</h2><Skeletons /></main></PortalLayout>;
  if (error || !project) return <PortalLayout identity={identity}><main className="portal-wrap portal-section"><h1 style={{ fontSize: 35 }}>This simulation is not available.</h1><ErrorMessage message={error || 'The project could not be loaded.'} retry={() => void reload()} /><p>Private simulations are visible only to their owner and authorized administrators. Public viewers see only the selected published version.</p><Link href={user || publicReadOnly ? '/user-portal' : '/sign-in'} className="portal-btn">{user || publicReadOnly ? 'Back to simulations' : 'Sign in with your World Bank account'}</Link></main></PortalLayout>;
  return <div className="project-shell">
    {state.storageError && <div className="project-alert" role="alert">{state.storageError}{state.phase !== 'account' && <button onClick={() => state.download()}>Download recoverable draft</button>}</div>}
    {state.phase === 'account' ? <div className="project-alert" role="alert">A different account is signed in. This draft is hidden and will not be uploaded. Sign in with the account that opened it.<a href="/api/login?next=%2Fauth%2Fcomplete" target="_blank" rel="opener" onClick={event => { event.preventDefault(); session.signIn(); }}>Sign in again</a></div>
      : state.phase === 'auth' ? <div className="project-alert" role="alert">Session expired. {state.locallyStored ? 'Your changes are stored on this browser.' : 'Keep this page open; unsaved changes remain in this editor.'} Sign in again to save your changes.
        {session.enabled ? <a href="/api/login?next=%2Fauth%2Fcomplete" target="_blank" rel="opener" onClick={event => { event.preventDefault(); session.signIn(); }}>Sign in again</a> : <a href="/sign-in" target="_blank">Sign in again</a>}
        <button onClick={() => state.download()}>Download recoverable draft</button><button onClick={() => { if (session.enabled) void session.recheck(); else void save().catch(() => {}); }}>Check sign-in</button></div>
      : saveError && <div className="project-alert" role={state.phase === 'retry' ? 'status' : 'alert'}>{state.phase === 'retry'
        ? `Connection interrupted. ${state.locallyStored ? 'Your changes are stored on this browser.' : 'Keep this page open to retain your changes.'} Retrying…` : saveError}
        <button onClick={() => state.download()}>Download recoverable draft</button>{conflict ? <button onClick={() => { if (window.confirm('Reload the newer server revision? Download your local draft first. Its browser recovery copy is retained.')) void reload(); }}>Reload newer revision</button>
          : !['permission', 'account'].includes(state.phase) && <button onClick={() => void save().catch(() => {})}>Retry save</button>}</div>}
    {session.warning && state.phase !== 'account' && <div className="project-alert" role="status">Your session will expire soon.<button onClick={session.staySignedIn}>Stay signed in</button></div>}
    {actionError && !dialog && <div className="project-alert" role="alert">{actionError}</div>}
    {state.recoveries.length > 0 && owner && state.phase !== 'account' && <div className="project-alert" role="alert"><div>Pending browser drafts were found. Recover or explicitly discard each copy before saving. Other tabs' copies are kept separate.
      {state.recoveries.map(entry => <div key={entry.key}>Draft from {new Date(entry.envelope.saved_at).toLocaleString()} · Base revision {entry.envelope.revision ?? 'unknown'}
        <button onClick={() => state.restoreRecovery(entry)}>Recover draft</button><button onClick={() => state.download(entry)}>Download draft</button><button onClick={() => { if (window.confirm('Discard this browser recovery copy? Download it first if needed. The server record is unchanged.')) state.dismissRecovery(entry); }}>Discard recovery</button></div>)}</div></div>}
    <div className="project-workspace" hidden={state.phase === 'account'} inert={state.phase === 'account'} style={state.phase === 'account' ? { display: 'none' } : undefined}><App key={`${id}:${editorEpoch}`} projectId={id} initialBundle={project.bundle} initialScenarios={project.scenarios} initialLocation={project.location} readOnly={!owner} onDraftChange={update} onSetup={() => open('setup')}
      countryCode={project.country_code} countryMetadata={project.country_metadata}
      setupNameControls={<div className="project-setup-name">
        <div className="project-setup-name__heading"><label htmlFor="setup-simulation-name">Simulation name</label><span id="setup-name-count">{setupName.length} / 160 characters</span></div>
        <input id="setup-simulation-name" value={setupName} maxLength={160} disabled={!owner || busy} aria-required="true" aria-invalid={!setupName.trim()} aria-describedby={`setup-name-help setup-name-count${!setupName.trim() ? ' setup-name-error' : ''}`} onChange={event => { const name = event.target.value; setSetupName(name); state.setPendingSetup(name !== project.name || JSON.stringify(scope) !== JSON.stringify(project.scope) ? { name, scope } : undefined); session.activity(); }} />
        <p id="setup-name-help">{owner ? 'Use a name you can recognize in your workspace and version history. Apply it with Save setup in Simulation Coverage below.' : 'The name identifies this planning record. Only the owner can change the setup.'}</p>
        {!setupName.trim() && <p className="project-setup-validation" id="setup-name-error">Enter a simulation name before saving setup.</p>}
      </div>}
      setupControls={<div className="project-setup-coverage" aria-busy={busy}>
        <ScopeFields scope={scope} onChange={value => { setScope(value); state.setPendingSetup({ name: setupName, scope: value }); session.activity(); }} variant="setup" disabled={!owner || busy} />
        <p className="project-setup-note">Excluded sector and area data are retained, not deleted. Include them again to resume working with those inputs.</p>
        <div className="project-setup-save">
          <div className="project-setup-save__copy"><strong>{owner ? 'Save the name and coverage together' : 'Read-only simulation setup'}</strong>
            <p id="setup-save-help">{owner ? 'Save setup applies both choices above and the simulation name. Country Profile, currency and analysis-period edits use normal progress saving.' : 'Only the owner can change these choices. Excluded data remains part of the saved planning record.'}</p>
            {owner && conflict && <p>Resolve the save conflict before applying setup changes.</p>}
          </div>
          {owner && <button className="portal-btn" aria-describedby="setup-save-help" disabled={busy || saving || conflict || !setupName.trim()} onClick={() => void act(saveSetup)}>{busy ? 'Saving setup…' : 'Save setup'}</button>}
        </div>
      </div>}
      headerSlot={(toolOverview, saveComparison) => (
      <header className="wb-header project-combined-header">
        <div className="wb-brand-lockup project-brand-lockup">
          <span className="wb-brand-mark" aria-hidden="true">WSS</span>
          <span className="wb-brand-divider" aria-hidden="true" />
          <div className="wb-brand-copy">
            <h1 className="wb-brand-title"><span className="wb-heading-strong">WSS STRATEGIC SCENARIOS</span><span className="wb-heading-light">SIMULATION TOOL</span></h1>
            <span className="wb-brand-meta"><strong>{project.name}</strong> · {project.country_name || project.country_code}{project.area_label ? ` / ${project.area_label}` : ''} · {geography(normalizeScope(project.scope))} · {project.scope.sectors.map(value => value === 'water' ? 'Water' : 'Sanitation').join(' + ')}</span>
          </div>
        </div>
        <div className="wb-header-actions project-header-actions">
          <small className="project-save-status" role="status" aria-live="polite">{owner ? saving ? 'Saving progress…' : conflict ? 'Conflict · Draft retained' : state.phase === 'auth' ? 'Sign in again to save' : saveError ? 'Server save pending' : dirty ? state.locallyStored ? 'Changes stored on this browser; server save pending.' : 'Unsaved changes · keep this page open' : `Saved to server at ${new Date(project.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Read-only view'}</small>
          <Link href="/" className="wb-header-action">Return</Link>
          {user || publicReadOnly ? <Link href="/user-portal" className="wb-header-action">{publicReadOnly ? 'Browse simulations' : 'My simulations'}</Link> : <Link href="/sign-in" className="wb-header-action">Sign in</Link>}
          {owner && <><button className="wb-header-action" onClick={() => open('setup')}>Edit setup</button><button disabled={saving || conflict} className="wb-header-action" onClick={() => void act(async () => { await settled(); })}>Save progress</button><button disabled={saving || conflict} className="wb-header-action" onClick={() => open('version')}>Save as</button></>}
          {identity ? <button className="wb-header-action" onClick={() => open('duplicate')}>{project.is_seed ? 'Use as starting point' : 'Duplicate'}</button> : !publicReadOnly && <Link href="/sign-in" className="wb-header-action">Private copy</Link>}
          {saveComparison}
          {historyAllowed && <button className="wb-header-action" onClick={() => open('history')}>{owner ? 'History & sharing' : 'Version history'}</button>}
          {owner && project.visibility === 'public' && <button className="wb-header-action" onClick={() => open('unpublish')}>Make private</button>}
          {toolOverview}
        </div>
      </header>
    )} /></div>
    {dialog && state.phase !== 'account' && <div className="project-modal" role="presentation" onClick={() => { if (!busy) setDialog(null); }}><section ref={dialogRef} tabIndex={-1} className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { setDialog(null); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="project-dialog-title">{dialog === 'version' ? 'Save a meaningful checkpoint' : dialog === 'history' ? 'History & publication' : dialog === 'duplicate' ? 'Create a private copy' : dialog === 'unpublish' ? 'Make this simulation private?' : project.archived_at ? 'Return to your active workspace?' : 'Archive this simulation?'}</h2>
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
        {dialog === 'version' && owner && <button className="primary" disabled={busy || !label.trim() || conflict} onClick={() => void act(async () => { const latest = await settled(); await projectMutation(`/simulations/${id}/versions`, { revision: latest.revision, label: label.trim() }); setDialog(null); })}>{busy ? 'Saving…' : 'Save as'}</button>}
        {dialog === 'duplicate' && identity && <button className="primary" disabled={busy || !name.trim() || conflict} onClick={() => void act(async () => { if (owner) await settled(); const copy = await projectMutation<Simulation>(`/simulations/${id}/duplicate`, { name: name.trim() }); if (live.current) navigate(`/simulations/${copy.id}`); })}>{busy ? 'Creating copy…' : 'Create private copy'}</button>}
        {dialog === 'unpublish' && owner && <button className="primary" disabled={busy || conflict} onClick={() => void act(async () => { const latest = await settled(); const value = await projectMutation<Simulation>(`/simulations/${id}/unpublish`, { revision: latest.revision }); acceptServer(value); setDialog(null); })}>Make private</button>}
        {dialog === 'archive' && owner && <button className="primary" disabled={busy || conflict} onClick={() => void act(async () => { const latest = await settled(); const value = await projectMutation<Simulation>(`/simulations/${id}`, { revision: latest.revision, archived: !project.archived_at }, 'PATCH'); acceptServer(value); setDialog(null); })}>{project.archived_at ? 'Unarchive simulation' : 'Archive simulation'}</button>}
      </div>
    </section></div>}
  </div>;
}
