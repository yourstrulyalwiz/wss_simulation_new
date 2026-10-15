import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { openChromium, sleep } from './chromium-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({
  configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: { react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom') } },
  build: { write: false, lib: { entry: path.join(root, 'tests/project-browser-harness.tsx'), name: 'ProjectHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const script = output.find(asset => asset.type === 'chunk').code;
const styles = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
const base = process.env.WSS_TEST_URL || 'http://127.0.0.1:5000';
const blankResponse = await fetch(`${base}/api/defaults`);
assert.equal(blankResponse.ok, true, 'A running backend with the public legacy shape fixture is required.');
const response = await blankResponse.json();
const blank = response.inputs || response;
const scope = { sectors: ['sanitation'], scopeMode: 'urban_rural', areaUrban: true, areaRural: false };
const project = { id: 'test-owned-project', name: 'Fixture planning record', country_code: 'TST', country_name: 'Test country', revision: 2, is_owner: true, read_only: false, updated_at: '2026-10-15T09:41:00Z', scope, bundle: { __wss_bundle: 1, inputs: { ...blank, calculation_scope: ['sanitation'] }, altInputs: {}, scope }, scenarios: [], location: {} };
async function browser(fixture) {
  // A JSON-only same-origin page provides a browser storage origin without loading the app
  // or introducing an auth bypass. All harness requests are isolated in-memory fixtures.
  const instance = await openChromium(`${base}/api/__wss_frontend_test_page_not_found`);
  await instance.evaluate(`document.open();document.write('<html><head></head><body><div id="root"></div></body></html>');document.close();localStorage.clear();window.__wssFixture=${JSON.stringify({ blank, project, ...fixture })}`);
  await instance.evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style)})()`);
  await instance.evaluate(script);
  return instance;
}
let b = await browser({ mode: 'hook' });
try {
  await b.waitFor('!!window.__wssHook?.project', 'Project did not load');
  await sleep(1500);
  assert.equal(await b.evaluate('__wssRequests.filter(r=>r.method==="PATCH").length'), 0, 'No autosave on initial load');
  await b.evaluate('__update("first-edit");');
  assert.equal(await b.evaluate('!!localStorage.getItem("wss:recovery:verified-user:test-owned-project")'), true, 'Pending edits immediately recoverable');
  await b.waitFor('__wssRequests.some(r=>r.method==="PATCH") && !__wssHook.dirty', 'Autosave did not settle');
  assert.equal(await b.evaluate('__wssHook.project.revision'), 3);
  assert.equal(await b.evaluate('localStorage.getItem("wss:recovery:verified-user:test-owned-project")'), null);
  await b.evaluate('__delayPatch=true;__update("pending-edit");');
  await b.waitFor('__wssHook.saving && typeof __releasePatch==="function"', 'Delayed save did not begin');
  await b.evaluate('__update("newer-edit-during-save");__delayPatch=false;__releasePatch();');
  await b.waitFor('__wssHook.project.bundle.futureField==="newer-edit-during-save" && !__wssHook.dirty', 'Edits made during an in-flight save were lost');
  assert.deepEqual(await b.evaluate('__wssRequests.filter(r=>r.method==="PATCH").map(r=>r.body.revision)'), [2, 3, 4], 'Queued changes use the newly acknowledged revision');
  await b.evaluate('__conflict=true;__update("conflicting-edit");');
  await b.waitFor('__wssHook.conflict', 'Conflict not surfaced');
  const count = await b.evaluate('__wssRequests.filter(r=>r.method==="PATCH").length');
  await sleep(1500);
  assert.equal(await b.evaluate('__wssRequests.filter(r=>r.method==="PATCH").length'), count, 'Conflict must stop autosave retries');
  assert.equal(await b.evaluate('JSON.parse(localStorage.getItem("wss:recovery:verified-user:test-owned-project")).draft.bundle.futureField'), 'conflicting-edit');
  assert.deepEqual(b.errors, []);
} finally { b.close(); }
b = await browser({ mode: 'editor', readOnly: true });
try {
  await b.waitFor('!!document.querySelector(".modern-input-panel")', 'Editor did not mount');
  await sleep(1400);
  assert.equal(await b.evaluate('(window.__wssDrafts||[]).length'), 0, 'Opening read-only inputs cannot emit a draft');
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(\'[data-section-key="service_levels"] input\')).every(e=>e.matches(":disabled"))'), true);
  assert.equal(await b.evaluate('document.querySelector(\'[data-section-key="service_levels"]\').innerText.includes("Water supply")'), false, 'Inactive water rows hidden');
  assert.equal(await b.evaluate('document.querySelectorAll(".wb-profile-select").length'), 0);
  const clickTab = index => b.evaluate(`document.querySelectorAll(".wb-tab")[${index}].click()`);
  await clickTab(1);
  await b.waitFor('!!document.querySelector(".modern-bau-toggles")', 'BAU unavailable');
  assert.equal(await b.evaluate('document.querySelector(\'[aria-label="BAU sector"]\').innerText.trim()'), 'Sanitation');
  await clickTab(2);
  await b.waitFor('!!document.querySelector(".intervention-workspace")', 'Interventions unavailable');
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".intervention-workspace label")).find(e=>e.textContent.includes("NRW-linked sanitation revenue"))?.querySelector("input").disabled'), true);
  await clickTab(3);
  await b.waitFor('!!document.querySelector(".debt-controls")', 'Loan funding unavailable');
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".debt-controls input")).every(e=>e.matches(":disabled"))'), true);
  await clickTab(4);
  await b.waitFor('!!document.querySelector(".modern-results-intro")', 'Results unavailable');
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".modern-results-sector")).some(e=>e.innerText.includes("Water Supply"))'), false);
  assert.equal(await b.evaluate('__wssRequests.filter(r=>r.url==="/api/calculate").every(r=>JSON.stringify(r.body.calculation_scope)===\'["sanitation"]\' && r.body.toggles?.san_nrw_link_enabled===false)'), true);
  assert.equal(await b.evaluate('__wssRequests.filter(r=>["/api/calculate","/api/projections","/api/revenue-bases"].includes(r.url)).every(r=>r.headers["x-simulation-id"]==="test-owned-project" && !("__wss_simulation_id" in r.body))'), true, 'Legacy calculation requests carry only their current project header');
  assert.equal(await b.evaluate('__wssRequests.some(r=>r.url.includes("/profiles")||r.url.includes("development-preview"))'), false);
  assert.equal(await b.evaluate('localStorage.getItem("wss_working_bundle")'), null);
  assert.deepEqual(b.errors, []);
} finally { b.close(); }
b = await browser({ mode: 'editor', readOnly: false });
try {
  await b.waitFor('!!document.querySelector(".modern-input-panel")', 'Editable editor did not mount');
  await sleep(1500);
  assert.equal(await b.evaluate('(window.__wssDrafts||[]).length'), 0, 'Loading editable inputs, projections and reconciliation cannot autosave');
  await b.evaluate('document.querySelector("#input-geographical-scope").value="both";document.querySelector("#input-geographical-scope").dispatchEvent(new Event("change",{bubbles:true}));');
  await b.waitFor('(window.__wssDrafts||[]).some(d=>d.bundle.altInputs.rural)', 'New Rural area was not materialized');
  assert.equal(await b.evaluate('__wssDrafts.at(-1).scope.areaRural'), true);
  assert.equal(await b.evaluate('__wssRequests.some(r=>r.url==="/api/defaults/blank")'), true, 'New area must use blank initializer rather than cloning Urban');
  assert.equal(await b.evaluate('__wssDrafts.every(d=>!("__wss_simulation_id" in d.bundle.inputs) && Object.values(d.bundle.altInputs).every(a=>!("__wss_simulation_id" in a)))'), true, 'Transport identity must not be persisted in project drafts');
  assert.equal(await b.evaluate('localStorage.getItem("wss_working_bundle")'), null);
  assert.deepEqual(b.errors, []);
} finally { b.close(); }
b = await browser({ mode: 'exports' });
try {
  await b.waitFor('!!document.querySelector("#table-export button")', 'Export harness did not mount');
  await b.evaluate('document.querySelector("#table-export button[title*=Excel]").click();document.querySelector("#chart-export button[title*=Excel]").click();document.querySelector("#model-export button").click();');
  await b.waitFor('__wssRequests.filter(r=>r.url.startsWith("/api/export/")).length===3', 'Export requests missing');
  assert.equal(await b.evaluate('__wssRequests.every(r=>r.headers["x-simulation-id"]==="seed-first")'), true, 'Table, chart and whole-model exports require project headers');
  await b.evaluate('__setExportProject("owned-second");');
  await sleep(50);
  await b.evaluate('Array.from(document.querySelectorAll("#model-export button")).find(b=>b.textContent.includes("PowerPoint")).click();');
  await b.waitFor('__wssRequests.some(r=>r.url==="/api/export/deck")', 'Deck export missing');
  assert.equal(await b.evaluate('__wssRequests.at(-1).headers["x-simulation-id"]'), 'owned-second');
  await b.evaluate('__setExportProject(undefined);');
  await sleep(50);
  await b.evaluate('document.querySelector("#table-export button[title*=Excel]").click();');
  await b.waitFor('__wssRequests.length===5', 'Standalone export missing');
  assert.equal(await b.evaluate('__wssRequests.at(-1).headers["x-simulation-id"] || null'), null, 'Unmounted project identity must not leak into standalone exports');
  assert.deepEqual(b.errors, []);
} finally { b.close(); }
console.log('Project browser checks passed: scoped project calculation/export headers, no transport leakage, no autosave-on-load, read-only workflow, recovery and revision conflicts.');
