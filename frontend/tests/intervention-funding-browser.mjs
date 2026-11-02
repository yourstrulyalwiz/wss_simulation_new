// Isolated, in-memory browser regression: no backend or saved-project writes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { openChromium, sleep } from './chromium-client.mjs';

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
const check = `${drawer} [role="switch"]`;
const selectedHeading = `${drawer} .intervention-settings-control h3`;
const snapshot = () => e('JSON.stringify(__inputs)');
const empty = () => w(`!!document.querySelector('.intervention-settings-empty') && !document.querySelector('${check}')`, 'Settings did not return to empty selection');
const open = async (key = 'connections_enabled') => {
  await e(`document.querySelector('[data-intervention-key="'+(__inputs && document.querySelector('[data-intervention-key^="ws_"]')?'ws':'san')+'_${key}"]').click()`);
  await w(`!!document.querySelector('${check}')`, 'Selected activation control did not mount');
};
const edit = (selector, value) => e(`{
  const input=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}`);
try {
  await b.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0'`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex} *{box-sizing:border-box}')};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await empty();
  const initial = await snapshot();
  for (const scope of ['Urban', 'Rural', 'National']) {
    await e(`__setScope(${JSON.stringify(scope)})`);
    await sleep(40);
    for (const sector of ['water', 'sanitation']) {
      await e(`__setSector(${JSON.stringify(sector)})`);
      await sleep(50);
      await empty();
      assert.equal(await e(`document.querySelector('.intervention-workspace__controls').hidden`), true);
      assert.deepEqual(await e(`[...document.querySelectorAll('.intervention-nav-group:first-child .intervention-nav-link > span:first-child')].map(n=>n.textContent)`),
        ['Increase in Public Spending', 'External Funding (Private Sector, Donor, Foreign Direct Investment)', 'Revenue from new connections']);
      assert.equal(await e(`document.querySelector('[data-testid="connection-revenue"]').getAttribute('aria-label')`),
        `Revenue from new connections — ${scope} — ${sector}`);
      const before = await snapshot();
      await open();
      assert.equal(await snapshot(), before, 'Opening settings must not write inputs');
      assert.equal(await e(`document.querySelector('${check}').checked`), sector === 'sanitation', 'Explicit funding toggle overrides saved config');
      await w(`document.activeElement === document.querySelector('${check}')`, 'Settings activation receives keyboard focus');
      assert.equal(await e(`document.querySelector('${selectedHeading}').textContent`), 'Revenue from new connections');
      await e(`document.querySelector('${check}').click()`);
      assert.equal(await e(`!!document.querySelector('${selectedHeading}')`), true, 'Activation never closes settings');
      const prefix = sector === 'water' ? 'ws' : 'san';
      assert.equal(await e(`__inputs.toggles.${prefix}_connections_enabled === __inputs.connection_revenue.${sector}.enabled`), true);
      assert.equal(await e(`__inputs.connection_revenue.${sector}.new_billed_share_basic`), sector === 'water' ? .38 : .29);
      assert.equal(await e(`__inputs.connection_revenue.${sector}.shared_assumption_note`), sector === 'water' ? 'Water source' : 'Sanitation source');
      await e(`document.querySelector('${check}').click()`);
      await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await empty();
      await w(`document.activeElement.dataset.interventionKey === '${prefix}_connections_enabled'`, 'Focus not restored to navigation opener');
      await open();
      await e(`document.querySelector('[aria-label="Close intervention inputs"]').click()`);
      await empty();
      await w(`document.activeElement.dataset.interventionKey === '${prefix}_connections_enabled'`, 'Close returns focus to navigation');
    }
  }
  assert.deepEqual(await e('__inputs.custom_interventions'), JSON.parse(initial).custom_interventions, 'Paused saved interventions must be preserved');
  // The shared activation row remains identical for public/external/connection funding.
  await e(`__setSector('water')`);
  await sleep(50);
  const structures = [];
  for (const key of ['financial_commitment_enabled', 'exogenous_injection_enabled', 'connections_enabled']) {
    await open(key);
    structures.push(await e(`document.querySelector('.intervention-settings-control').outerHTML.replace(/<h3>.*?<\\/h3>/,'').replace(/aria-label="[^"]*"/,'').replace(/ checked=""/g,'').replace(/<span>(On|Off)<\\/span>/,'')`));
    if (key === 'exogenous_injection_enabled') {
      await e(`document.querySelector('${check}').click()`);
      assert.equal(await e('__inputs.toggles.ws_exogenous_injection_enabled'), true);
      await e(`document.querySelector('${check}').click()`);
    }
  }
  assert.equal(structures[0], structures[1]);
  assert.equal(structures[1], structures[2]);
  // Specialized edits survive close/reopen, activation off/on, and sector changes.
  await edit('[aria-label="Basic expansion billed (%)"]', '47');
  await edit('[aria-label="Source / assumption note (optional)"]', 'District billing survey');
  await e(`document.querySelector('[aria-label="Close intervention inputs"]').click()`);
  await open();
  assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').value`), '47');
  await e(`document.querySelector('${check}').click();document.querySelector('${check}').click()`);
  await e(`__setSector('sanitation')`);
  await empty();
  await e(`__setSector('water')`);
  await open();
  assert.equal(await e('__inputs.connection_revenue.water.new_billed_share_basic'), .47);
  assert.equal(await e('__inputs.connection_revenue.water.shared_assumption_note'), 'District billing survey');
  assert.equal(await e('__inputs.connection_revenue.sanitation.shared_assumption_note'), 'Sanitation source');
  // Local validation, read-only inspection, and verification retry stay in settings.
  await e(`document.querySelector('${check}').click()`);
  await edit('[aria-label="Basic expansion billed (%)"]', '123');
  await w(`document.querySelector('${drawer}').textContent.includes('must be between 0 and 100%')`, 'Billing validation missing');
  await e(`__setReadOnly(true)`);
  await sleep(50);
  assert.equal(await e(`document.querySelector('${check}').disabled`), true);
  assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').disabled`), true);
  await e(`document.querySelector('[aria-label="Close intervention inputs"]').click()`);
  await open();
  assert.equal(await e(`document.querySelector('${check}').disabled`), true, 'Read-only users can inspect settings');
  // Use the real workspace controls, not only harness setters.
  await e(`document.querySelector('[aria-label="Intervention design geography"] button:nth-child(1)').click()`);
  await empty();
  assert.equal(await e(`document.querySelector('.modern-input-section-heading').textContent.includes('Urban')`), true);
  await open();
  await e(`document.querySelector('[aria-label="Intervention design sector"] button:nth-child(2)').click()`);
  await empty();
  await e(`__verificationError=true;__setReadOnly(false)`);
  await open();
  await e(`document.querySelector('${check}').click()`);
  await w(`document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Verification retry missing');
  await e(`__verificationError=false;[...document.querySelectorAll('${drawer} button')].find(n=>n.textContent==='Retry verification').click()`);
  await w(`!document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Retry did not recover');
  await e(`document.querySelector('[aria-label="Intervention design service level"] [data-service-level="basic"]').click()`);
  assert.equal(await e(`document.querySelector('.modern-input-section-heading').textContent.includes('Basic')`), true);
  assert.equal(await e(`document.querySelector('[aria-label="Intervention graph service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await e(`document.querySelector('[aria-label="Intervention table service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await e(`document.querySelector('${drawer}').scrollWidth <= document.querySelector('${drawer}').clientWidth + 1`), true, 'Settings fit mobile');
  assert.deepEqual(b.errors, []);
  const panel = readFileSync(path.join(root, 'src/components/InterventionPanel.tsx'), 'utf8');
  assert.match(panel, /const CUSTOM_INTERVENTIONS_ENABLED = false;/);
  assert.match(panel, /CUSTOM_INTERVENTIONS_ENABLED && <div/);
  console.log('PASS: two-panel funding order and shared activation, both sectors/three scopes, connection settings persistence, Close/Escape/focus, validation/retry, read-only, shared workspace selectors, mobile, and custom preservation.');
} finally { b.close(); }
