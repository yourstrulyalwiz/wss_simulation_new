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
const drawer = '.intervention-input-drawer';
const row = '[data-testid="connection-revenue"]';
const check = `${row} input[type="checkbox"]`;
const name = `${row} .intervention-toggle__name`;
const open = async () => {
  await e(`document.querySelector('${name}').click()`);
  await w(`!document.querySelector('${drawer}').hidden`, 'Drawer did not open');
};
const snapshot = async () => JSON.stringify(await e('__inputs'));
try {
  await e(`document.body.innerHTML='<div id="root"></div>'`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await w(`!!document.querySelector('${row}')`, 'Panel did not mount');
  await b.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const initial = await snapshot();
  for (const scope of ['Urban', 'Rural', 'National']) {
    await e(`__setScope(${JSON.stringify(scope)})`);
    await sleep(40);
    for (const sector of ['water', 'sanitation']) {
      await e(`__setSector(${JSON.stringify(sector)})`);
      await sleep(50);
      assert.equal(await e(`document.querySelector('.intervention-workspace__controls').textContent.includes('Custom Interventions')`), false);
      assert.equal(await e(`document.querySelector('.intervention-workspace__controls').textContent.includes('temporarily disabled')`), false);
      assert.deepEqual(await e(`[...document.querySelectorAll('#${sector}-funding-content .intervention-toggle__name > span:first-child')].map(n=>n.textContent)`),
        ['Increase in Public Spending', 'External Funding (Private Sector, Donor, Foreign Direct Investment)', 'Include revenue from new connections']);
      assert.equal(await e(`document.querySelector('${row}').getAttribute('aria-label')`), `Revenue from new connections — ${scope} — ${sector}`);
      // Exact shared structure and spacing, with only checked-state colors varying.
      assert.equal(await e(`document.querySelector('${row} > div').style.cssText.replace(/background:.*?;/,'') === document.querySelector('#${sector}-funding-content > div > div').style.cssText.replace(/background:.*?;/,'')`), true);
      assert.equal(await e(`document.querySelector('${check}').checked`), sector === 'sanitation', 'Explicit funding toggle overrides saved config');
      const before = await snapshot();
      await open();
      assert.equal(await snapshot(), before, 'Opening settings must not write inputs');
      await w(`document.activeElement.getAttribute('aria-label') === 'Basic expansion billed (%)'`, 'Drawer receives input focus');
      assert.equal(await e(`document.querySelector('${name}').getAttribute('aria-expanded')`), 'true');
      assert.equal(await e(`!!document.getElementById(document.querySelector('${name}').getAttribute('aria-controls'))`), true);
      await e(`document.querySelector('${check}').click()`);
      assert.equal(await e(`document.querySelector('${drawer}').hidden`), false, 'Disabling/enabling must not close drawer');
      const prefix = sector === 'water' ? 'ws' : 'san';
      assert.equal(await e(`__inputs.toggles.${prefix}_connections_enabled === __inputs.connection_revenue.${sector}.enabled`), true);
      assert.equal(await e(`__inputs.connection_revenue.${sector}.new_billed_share_basic`), sector === 'water' ? .38 : .29);
      assert.equal(await e(`__inputs.connection_revenue.${sector}.shared_assumption_note`), sector === 'water' ? 'Water source' : 'Sanitation source');
      await e(`document.querySelector('${check}').click()`);
      await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await w(`document.querySelector('${drawer}').hidden`, 'Escape did not close drawer');
      await w(`document.activeElement === document.querySelector('${name}')`, 'Focus not restored to opener');
      await e(`document.querySelector('${row} button:last-child').click()`);
      await w(`!document.querySelector('${drawer}').hidden`, 'Show button did not open drawer');
      await e(`document.querySelector('${row} button:last-child').click()`);
      await w(`document.querySelector('${drawer}').hidden`, 'Hide button did not close drawer');
    }
  }
  assert.deepEqual(await e('__inputs.custom_interventions'), JSON.parse(initial).custom_interventions, 'Paused saved interventions must be preserved');
  await e(`__setSector('water')`);
  await sleep(50);
  // The standard funding injection is not part of the custom-intervention pause.
  await e(`document.querySelector('[aria-label="Enable External Funding (Private Sector, Donor, Foreign Direct Investment)"]').click()`);
  assert.equal(await e('__inputs.toggles.ws_exogenous_injection_enabled'), true);
  await e(`document.querySelector('[aria-label="Enable External Funding (Private Sector, Donor, Foreign Direct Investment)"]').click()`);
  await e(`document.querySelector('#water-funding-content .intervention-toggle__name').click()`);
  await w(`document.querySelector('${drawer} h3')?.textContent === 'Increase in Public Spending'`, 'Public spending drawer did not open');
  await e(`document.querySelector('${check}').click()`);
  assert.equal(await e(`document.querySelector('${drawer} h3').textContent`), 'Increase in Public Spending', 'Enable controls do not switch the active drawer');
  await e(`document.querySelector('${check}').click()`);
  await open();
  assert.equal(await e(`document.querySelector('${drawer} h3').textContent`), 'Revenue from new connections', 'Name opener switches the active drawer');
  await e(`document.querySelector('${drawer} [aria-label="Close intervention inputs"]').click()`);
  await w(`document.querySelector('${drawer}').hidden`, 'Close button did not close drawer');
  await open();
  // Invalid billing inputs continue to show validation inside the active drawer.
  await e(`document.querySelector('${check}').click(); {const input=document.querySelector('[aria-label="Basic expansion billed (%)"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'123');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await w(`document.querySelector('${drawer}').textContent.includes('must be between 0 and 100%')`, 'Billing validation missing');
  await e(`__setReadOnly(true)`);
  await sleep(50);
  assert.equal(await e(`document.querySelector('${check}').disabled`), true);
  assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').disabled`), true);
  assert.equal(await e(`document.querySelector('${name}').disabled`), false, 'Read-only users can inspect settings');
  await e(`__setScope('Urban')`);
  await w(`document.querySelector('${drawer}').hidden`, 'Scope changes must close drawer');
  await open();
  await e(`__setSector('sanitation')`);
  await w(`document.querySelector('${drawer}').hidden`, 'Sector changes must close drawer');
  // Verification errors and retry remain inside settings.
  await e(`__verificationError=true;__setReadOnly(false);document.querySelector('${check}').click()`);
  await open();
  await w(`document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Verification retry missing');
  await e(`__verificationError=false;[...document.querySelectorAll('${drawer} button')].find(n=>n.textContent==='Retry verification').click()`);
  await w(`!document.querySelector('${drawer}').textContent.includes('Retry verification')`, 'Retry did not recover');
  await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await e(`document.querySelector('${row}').scrollWidth <= document.querySelector('${row}').clientWidth + 1`), true, 'Compact row must fit on mobile');
  assert.deepEqual(b.errors, []);
  const panel = readFileSync(path.join(root, 'src/components/InterventionPanel.tsx'), 'utf8');
  assert.match(panel, /const CUSTOM_INTERVENTIONS_ENABLED = false;/, 'Custom interventions remain paused');
  assert.match(panel, /CUSTOM_INTERVENTIONS_ENABLED && <div/, 'Hide the whole custom box, not only its controls');
  console.log('PASS: funding order/row parity for both sectors in three scopes; toggle/settings preservation, drawer controls/focus, validation/retry, read-only, mobile, custom pause.');
} finally { b.close(); }
