// Isolated real-Chromium regression: no backend calls or saved-project mutations.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    name: 'InterventionNavigationHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const b = await openChromium('about:blank');
const e = b.evaluate;
const w = b.waitFor;
const nav = '.intervention-nav-groups';
const link = key => `[data-intervention-key="${key}"]`;
const snapshot = () => e('JSON.stringify(__inputs)');
const active = key => e(`document.querySelector('${link(key)} .intervention-nav-status').dataset.active === 'true'`);
const navigate = key => e(`{const s=document.querySelector('[aria-label="Go to Intervention section"]');s.value='${key}';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
async function open(key) {
  await e(`document.querySelector('${link(key)}').click()`);
  await w(`document.querySelector('${link(key)}')?.getAttribute('aria-expanded') === 'true' &&
    !document.querySelector('#intervention-input-drawer').hidden`, `Drawer failed for ${key}`);
}
async function toggle(label) {
  await e(`document.querySelector(${JSON.stringify(controlSelector(label))}).click()`);
}
const controlSelector = label => `[aria-label="Enable ${label === 'Revenue from new connections' ? 'Include revenue from new connections' : label}"]`;
try {
  await b.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0'`);
  await e(`{const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta)}`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex;--modern-teal:#009ca7} *{box-sizing:border-box}')};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await w(`document.querySelectorAll('${nav} button').length === 10`, 'Grouped nav did not mount');
  assert.equal(await e(`document.querySelectorAll('.intervention-workspace__controls, .intervention-category, .intervention-toggle__name').length`), 0, 'No middle list or duplicate openers');
  assert.equal(await e(`document.querySelectorAll('.intervention-settings-mount input, .intervention-settings-mount button').length`), 0, 'Mounting plumbing contains no controls');
  assert.ok(await e(`!!document.querySelector('.intervention-settings-empty')`), 'Design starts with small empty settings state');
  assert.equal(await e(`getComputedStyle(document.querySelector('.intervention-section-workspace')).gridTemplateColumns.split(' ').length`), 3, 'Only nav, reading content and settings reserve width');
  assert.ok(await e(`document.querySelector('#intervention-input-drawer').getBoundingClientRect().left >= document.querySelector('.intervention-reading-content').getBoundingClientRect().right - 1`), 'Settings are separate and rightmost');
  for (const sector of ['water', 'sanitation']) {
    await e(`__setSector('${sector}')`);
    const prefix = sector === 'water' ? 'ws' : 'san';
    await w(`!!document.querySelector('${link(`${prefix}_connections_enabled`)}')`, 'Sector nav stale');
    assert.deepEqual(await e(`[...document.querySelectorAll('${nav} h4')].map(n=>n.textContent)`), [
      '1. Funding Mobilization', '2. Operational Efficiency Improvements',
      '3. Investment Planning and Delivery Improvements', '4. Tariff Reform', '5. Household Financing and Affordability',
    ]);
    assert.deepEqual(await e(`[...document.querySelectorAll('${nav} ul')].map(n=>n.children.length)`), [3, 2, 3, 1, 1]);
    assert.equal(await e(`document.querySelector('${nav} ul li:last-child button').textContent.trim()`), 'Revenue from new connections');
    assert.equal(await e(`document.querySelector('${nav}').textContent.includes('Coming soon') || document.querySelector('${nav}').textContent.includes('Custom')`), false);
    const keys = await e(`[...document.querySelectorAll('${nav} button')].map(n=>n.dataset.interventionKey)`);
    for (const key of keys) {
      const before = await snapshot();
      await open(key);
      assert.equal(await snapshot(), before, 'Navigation must never enable or otherwise write inputs');
      const label = await e(`document.querySelector('${link(key)} > span').textContent`);
      const expected = await e(`document.querySelector(${JSON.stringify(controlSelector(label))}).checked`);
      assert.equal(await e(`document.querySelectorAll('[aria-label^="Enable "]').length`), 1, 'Only selected activation control is mounted');
      assert.equal(await e(`document.querySelector('#intervention-input-drawer h3').textContent`), label);
      assert.equal(await e(`document.querySelectorAll('.intervention-reading-content [aria-label^="Enable "]').length`), 0, 'Settings must not leak into graph/table');
      assert.equal(await e(`document.querySelector(${JSON.stringify(controlSelector(label))}).checkVisibility()`), true, 'Portal stays visible despite hidden source');
      assert.equal(await active(key), expected, 'Dot uses actual enabled state');
      await toggle(label);
      assert.equal(await active(key), !expected, 'Live toggle updates dot on/off');
      assert.match(await e(`document.querySelector('${link(key)}').getAttribute('aria-label')`), expected ? /Inactive$/ : /Active$/);
      if (!expected) assert.equal(await e(`getComputedStyle(document.querySelector('${link(key)} .intervention-nav-status')).backgroundColor`), 'rgb(0, 156, 167)');
      await toggle(label);
      assert.equal(await active(key), expected);
      // Read-only inspection works for every lever, including nested editors.
      await e('__setReadOnly(true)');
      assert.equal(await e(`[...document.querySelectorAll('#intervention-input-drawer input')].every(n=>n.matches(':disabled') || n.readOnly)`), true);
      await e('__setReadOnly(false)');
    }
    // Read-only users retain navigation and active indicators, but not mutation.
    await e('__setReadOnly(true)');
    await open(`${prefix}_connections_enabled`);
    assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').disabled`), true);
    assert.equal(await e(`document.querySelector('${link(`${prefix}_connections_enabled`)}').disabled`), false);
    await e('__setReadOnly(false)');
  }
  // Missing toggle falls back to specialized connection config; explicit false wins.
  for (const sector of ['water', 'sanitation']) {
    const key = sector === 'water' ? 'ws_connections_enabled' : 'san_connections_enabled';
    await e(`__setSector('${sector}');__setInputs(i=>{const n=structuredClone(i);delete n.toggles.${key};n.connection_revenue.${sector}.enabled=true;return n;})`);
    await w(`document.querySelector('${link(key)} .intervention-nav-status')?.dataset.active === 'true'`, 'Specialized saved connection state missing');
    await e(`__setInputs(i=>({...i,toggles:{...i.toggles,${key}:false}}))`);
    await w(`document.querySelector('${link(key)} .intervention-nav-status').dataset.active === 'false'`, 'Explicit toggle must override specialized config');
  }
  // Feed different saved/current inputs as the parent switches geography.
  for (const [scope, enabled] of [['Rural', true], ['National', false], ['Urban', true]]) {
    await e(`__setScope('${scope}');__setInputs(i=>({...i,toggles:{...i.toggles,san_tariff_enabled:${enabled}}}))`);
    await w(`document.querySelector('${link('san_tariff_enabled')} .intervention-nav-status').dataset.active === '${enabled}'`, 'Scope inputs not reflected');
    await open('san_tariff_enabled');
    assert.equal(await active('san_tariff_enabled'), enabled);
  }
  await e(`__setInputs(i=>({...i,toggles:{...i.toggles,san_nrw_link_enabled:true}}));__setSectors(['sanitation'])`);
  await w(`document.querySelector('${link('san_nrw_link_enabled')}').getAttribute('aria-label').includes('Unavailable')`, 'Unavailable linkage needs accessible status');
  assert.equal(await active('san_nrw_link_enabled'), false, 'Dormant unavailable linkage must not be teal');
  await open('san_nrw_link_enabled');
  assert.equal(await e(`document.querySelector('[aria-label="Enable NRW-linked sanitation revenue"]').disabled`), true);
  assert.ok(await e(`document.querySelector('#intervention-input-drawer').textContent.includes('Saved settings are retained')`));
  await e(`__setSectors(['water','sanitation'])`);
  await w(`document.querySelector('${link('san_nrw_link_enabled')} .intervention-nav-status').dataset.active==='true'`, 'Restoring sector restores saved active state');
  for (const mobile of [false, true]) {
    await b.call('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    await navigate('design');
    await w(`!!document.querySelector('${nav}')`, 'Design nav missing');
    assert.equal(await e(`getComputedStyle(document.querySelector('${nav}')).display !== 'none' && document.querySelector('${nav}').getBoundingClientRect().width > 0`), true);
    if (mobile) assert.ok(await e(`document.querySelector('${nav} button').getBoundingClientRect().height >= 44`), 'Touch rows must be at least 44px');
    await open('san_microfinance_enabled');
    // Escape closes and returns keyboard focus to the navigation trigger.
    await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await w(`!document.querySelector('#intervention-input-drawer').classList.contains('is-open') && !!document.querySelector('.intervention-settings-empty') && document.activeElement.dataset.interventionKey==='san_microfinance_enabled'`, 'Escape must restore nav focus and empty settings');
    for (const section of ['graph', 'table']) {
      await navigate(section);
      await w(`!document.querySelector('${nav}') &&
        document.querySelector('#intervention-input-drawer').hidden`, 'Graph/Table must hide grouped nav, controls and drawer');
      await w(`document.activeElement.closest('[data-section-key="${section}"]') !== null`, 'Section heading must receive focus');
      await w(`(()=>{
        const host=document.querySelector('${mobile ? '.intervention-section-workspace' : '.intervention-reading-content'}');
        const top=document.querySelector('[data-section-key="${section}"]').getBoundingClientRect().top;
        const bounds=host.getBoundingClientRect();
        return Math.abs(top-bounds.top)<65 || (host.scrollTop>=host.scrollHeight-host.clientHeight-2 && top>=bounds.top && top<bounds.bottom);
      })()`, 'Graph/Table scroll anchor must survive rail collapse');
    }
    assert.ok(await e('document.documentElement.scrollWidth <= innerWidth'), 'No horizontal mobile overflow');
  }
  assert.deepEqual(b.errors, []);
  console.log('PASS: two-rail navigation/settings, no middle list or duplicate controls, all levers/both sectors, live on/off dots, saved connection precedence, no activation on selection, read-only/unavailable inspection, desktop/mobile focus, separate rightmost settings and persistent Graph/Table scroll.');
} finally { b.close(); }
