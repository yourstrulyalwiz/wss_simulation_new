// Test-only entrypoint, bundled in memory by project-management-browser.mjs.
// It is never imported by the application router and never grants production access.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import { useSimulation } from '../src/useSimulation';
import { ProjectScopeContext } from '../src/projectScope';
import TableExport from '../src/components/TableExport';
import ChartExport from '../src/components/ChartExport';
import ExportButtons from '../src/components/ExportButtons';
import '../src/theme.css';
import '../src/modern.css';
import '../src/management.css';

const testWindow = window as any;
const fixture = testWindow.__wssFixture;
const requests: any[] = [];
testWindow.__wssRequests = requests;
let revision = 2;
testWindow.fetch = async (url: string, options: any = {}) => {
  const body = options.body ? JSON.parse(options.body) : undefined;
  requests.push({ url, method: options.method || 'GET', headers: options.headers, body });
  if (url.startsWith('/api/export/')) return { ok: true, blob: async () => new Blob(['test export']) };
  if (options.method === 'PATCH') {
    if (testWindow.__delayPatch) await new Promise(resolve => { testWindow.__releasePatch = resolve; });
    if (testWindow.__conflict) return { ok: false, status: 409, json: async () => ({ detail: 'A newer revision exists.' }) };
    return { ok: true, json: async () => ({ ...fixture.project, ...body, revision: ++revision, updated_at: new Date().toISOString() }) };
  }
  if (url.startsWith('/api/simulations/')) {
    if (testWindow.__delayGet) await new Promise(resolve => { testWindow.__releaseGet = resolve; });
    return { ok: true, json: async () => ({ ...fixture.project, id: url.split('/')[3] }) };
  }
  if (url === '/api/defaults/blank') return { ok: true, json: async () => fixture.blank };
  if (url === '/api/countries') return { ok: true, json: async () => [] };
  if (url === '/api/cost-mix/templates') return { ok: true, json: async () => ({}) };
  return { ok: false, status: 422, json: async () => ({ detail: 'Test fixture: calibration is intentionally incomplete.' }) };
};
function HookHarness() {
  const state = useSimulation(fixture.project.id, 'verified-user');
  testWindow.__wssHook = state;
  testWindow.__update = (name: string) => state.update({ bundle: { ...state.project!.bundle, futureField: name }, scenarios: [], scope: state.project!.scope, location: {} });
  return <main><h1>{state.project?.name || 'Loading'}</h1><span id="dirty">{String(state.dirty)}</span><span id="conflict">{String(state.conflict)}</span><span id="save-error">{state.saveError}</span></main>;
}
function EditorHarness() {
  const [readOnly, setReadOnly] = useState(fixture.readOnly);
  const [epoch, setEpoch] = useState(0);
  testWindow.__setReadOnly = (value: boolean) => { setReadOnly(value); setEpoch(previous => previous + 1); };
  return <div style={{ height: '100dvh' }}><App key={epoch} projectId={fixture.project.id} initialBundle={fixture.project.bundle} initialScenarios={[]} readOnly={readOnly}
    onDraftChange={value => { testWindow.__wssDrafts = [...(testWindow.__wssDrafts || []), value]; }} onSetup={() => { testWindow.__setupOpened = true; }} /></div>;
}
function ExportHarness() {
  const [projectId, setProjectId] = useState<string | undefined>('seed-first');
  testWindow.__setExportProject = setProjectId;
  return <ProjectScopeContext.Provider value={{ projectId, sectors: ['water'], readOnly: true, projectMode: true }}>
    <div id="table-export"><TableExport filename="table" headers={['Year', 'Value']} rows={[[2031, .37]]} /></div>
    <div id="chart-export"><ChartExport filename="chart" chartRef={{ current: null }} sheets={[{ name: 'Chart', headers: ['Year', 'Value'], rows: [[2031, .37]] }]} /></div>
    <div id="model-export"><ExportButtons inputs={fixture.project.bundle.inputs} areas={{ urban: fixture.project.bundle.inputs }} /></div>
  </ProjectScopeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(fixture.mode === 'hook' ? <HookHarness /> : fixture.mode === 'exports' ? <ExportHarness /> : <EditorHarness />);
