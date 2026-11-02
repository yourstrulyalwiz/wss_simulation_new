// In-memory real-browser regression. No backend or saved-project writes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { openChromium } from './chromium-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({
  configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom'),
  } },
  build: { write: false, lib: { entry: path.join(root, 'tests/intervention-funding-harness.tsx'),
    name: 'InterventionFundingHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const b = await openChromium('about:blank');
const e = b.evaluate;
const w = b.waitFor;
const drawer = '#intervention-input-drawer';
const row = '[data-testid="connection-revenue"]';
const check = `${row} input[type="checkbox"]`;
const navKey = sector => `${sector === 'water' ? 'ws' : 'san'}_connections_enabled`;
const nav = key => `[data-intervention-key="${key}"]`;
const selected = `document.querySelector('${drawer}').classList.contains('is-open')`;
const snapshot = () => e('JSON.stringify(__inputs)');
async function open(sector) {
  await e(`document.querySelector('${nav(navKey(sector))}').click()`);
  await w(`${selected} && !!document.querySelector('${check}')`, 'Connection settings did not open directly');
}
async function change(label, value) {
  const selector = `[aria-label="${label}"]`;
  await e(`{const n=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(${label.includes('settings') ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(n,${JSON.stringify(value)});
    n.dispatchEvent(new Event('${label.includes('settings') ? 'change' : 'input'}',{bubbles:true}));}`);
}
async function close(sector, escape = false) {
  if (escape) await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  else await e(`document.querySelector('[aria-label="Close intervention inputs"]').click()`);
  await w(`!${selected} && !!document.querySelector('.intervention-settings-empty')`, 'Close must restore small empty state');
  await w(`document.activeElement === document.querySelector('${nav(navKey(sector))}')`, 'Focus not restored to left navigation');
}
try {
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0'`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex} *{box-sizing:border-box}')};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await w(`!!document.querySelector('.intervention-settings-empty')`, 'Empty settings did not mount');
  const initial = JSON.parse(await snapshot());
  for (const scope of ['Urban', 'Rural', 'National']) {
    await change('Intervention settings geography', scope.toLowerCase());
    await w(`document.querySelector('${drawer} h2').textContent.includes('${scope}')`, 'Geography selector did not synchronize context');
    for (const sector of ['water', 'sanitation']) {
      await change('Intervention settings sector', sector);
      await w(`!!document.querySelector('${nav(navKey(sector))}')`, 'Sector selector did not synchronize navigation');
      assert.deepEqual(await e(`[...document.querySelectorAll('.intervention-nav-group:first-child li span:first-child')].map(n=>n.textContent)`),
        ['Increase in Public Spending', 'External Funding (Private Sector, Donor, Foreign Direct Investment)', 'Revenue from new connections']);
      const before = await snapshot();
      await open(sector);
      assert.equal(await snapshot(), before, 'Opening settings must not write model inputs');
      assert.equal(await e(`document.querySelector('${check}').checked`), sector === 'sanitation', 'Explicit funding toggle overrides saved config');
      assert.equal(await e(`document.activeElement === document.querySelector('${check}')`), true, 'Activation receives focus in settings');
      assert.equal(await e(`document.querySelector('${row}').getAttribute('aria-label')`), `Revenue from new connections — ${scope} — ${sector}`);
      assert.equal(await e(`document.querySelector('${drawer} h3').textContent`), 'Revenue from new connections');
      assert.ok(await e(`document.querySelector('${drawer} header').textContent.includes('Funding Mobilization')`), 'Lever group heading belongs in settings');
      assert.ok(await e(`document.querySelector('${row}').checkVisibility()`), 'Portalled activation and settings are visible');
      await e(`document.querySelector('${check}').click()`);
      assert.equal(await e(selected), true, 'Activation does not close settings');
      assert.equal(await e(`__inputs.toggles.${navKey(sector)} === __inputs.connection_revenue.${sector}.enabled`), true);
      assert.equal(await e(`document.querySelector('${nav(navKey(sector))} .intervention-nav-status').dataset.active === String(document.querySelector('${check}').checked)`), true);
      await e(`document.querySelector('${check}').click()`);
      const after = JSON.parse(await snapshot());
      const original = JSON.parse(before);
      for (const field of ['new_billed_share_basic', 'new_billed_share_sm', 'shared_assumption_note']) {
        assert.equal(after.connection_revenue[sector][field], original.connection_revenue[sector][field], 'Activation preserves saved calibration');
      }
      assert.deepEqual(after.custom_interventions, original.custom_interventions);
      assert.deepEqual(after.toggles, original.toggles, 'Toggle round-trip restores explicit activation state');
      await close(sector, true);
      await open(sector);
      await close(sector);
    }
  }
  assert.deepEqual(await e('__inputs.custom_interventions'), initial.custom_interventions, 'Paused custom interventions remain untouched');
  await change('Intervention settings sector', 'water');
  await open('water');
  // Inactive edits, zeros and invalid drafts survive close/reopen and sector switching.
  await change('Source / assumption note (optional)', 'District billing audit');
  await change('Basic expansion billed (%)', '0');
  assert.equal(await e('__inputs.connection_revenue.water.new_billed_share_basic'), 0);
  assert.equal(await e('__inputs.toggles.ws_connections_enabled'), false, 'Editing never enables a lever');
  await close('water');
  await open('water');
  assert.equal(await e(`document.querySelector('[aria-label="Source / assumption note (optional)"]').value`), 'District billing audit');
  await change('Basic expansion billed (%)', '123');
  assert.equal(await e('__inputs.toggles.ws_connections_enabled'), false, 'Invalid draft edits remain inactive');
  await e(`document.querySelector('${check}').click()`);
  await w(`document.querySelector('${drawer}').textContent.includes('must be between 0 and 100%')`, 'Billing validation missing');
  await close('water');
  await open('water');
  assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').value`), '123');
  await e('__setReadOnly(true)');
  assert.equal(await e(`document.querySelector('${check}').disabled`), true);
  assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').disabled`), true);
  await close('water', true);
  await open('water');
  assert.equal(await e(selected), true, 'Read-only users can inspect inactive settings');
  await e('__setReadOnly(false)');
  await change('Intervention settings geography', 'urban');
  await w(`!${selected}`, 'Scope change must close settings');
  await open('water');
  assert.equal(await e(`document.querySelector('[aria-label="Source / assumption note (optional)"]').value`), 'District billing audit');
  await change('Intervention settings sector', 'sanitation');
  await w(`!${selected}`, 'Sector change must close settings');
  await e('__verificationError=true');
  await open('sanitation');
  await w(`document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Verification retry missing');
  await e(`__verificationError=false;[...document.querySelectorAll('${drawer} button')].find(n=>n.textContent==='Retry verification').click()`);
  await w(`!document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Retry did not recover');
  assert.equal(await e(`!!document.querySelector('[aria-label="Intervention settings service level"]')`), false);
  await e(`document.querySelector('[aria-label="Intervention graph service level"] [data-service-level="basic"]').click()`);
  assert.equal(await e(`document.querySelector('[aria-label="Intervention graph service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await e(`document.querySelector('[aria-label="Intervention table service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await e(`document.querySelector('${row}').scrollWidth <= document.querySelector('${row}').clientWidth + 1`), true, 'Settings fit mobile');
  assert.equal(await e(`document.querySelector('.intervention-reading-content').contains(document.querySelector('${check}'))`), false, 'Settings never live in main graph/table body');
  assert.deepEqual(b.errors, []);
  const panel = readFileSync(path.join(root, 'src/components/InterventionPanel.tsx'), 'utf8');
  assert.match(panel, /const CUSTOM_INTERVENTIONS_ENABLED = false;/);
  console.log('PASS: funding order, direct settings for both sectors/three scopes, selection without activation, activation/dots, inactive edits and persistent invalid drafts, close/Escape/focus, shared selectors, validation/retry, read-only and mobile.');
} finally { b.close(); }
