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
    assert.equal(await e(`document.querySelector('.intervention-workspace__controls').hidden`), true, 'No visible middle control rail');
    assert.equal(await e(`document.querySelector('.intervention-reading-content').hidden`), true, 'Design devotes the right panel to settings');
    assert.equal(await e(`!!document.querySelector('.intervention-settings-empty')`), true, 'Empty selection has a prompt');
    const keys = await e(`[...document.querySelectorAll('${nav} button')].map(n=>n.dataset.interventionKey)`);
    for (const key of keys) {
      const before = await snapshot();
      await open(key);
      assert.equal(await snapshot(), before, 'Navigation must never enable or otherwise write inputs');
      const label = await e(`document.querySelector('${link(key)} > span').textContent`);
      assert.equal(await e(`document.querySelector('.intervention-settings-control h3').textContent`), label);
      assert.equal(await e(`document.querySelectorAll('#intervention-input-drawer [role="switch"]').length`), 1, 'Only the selected activation switch is rendered');
      assert.equal(await e(`document.querySelector('.intervention-input-drawer__header h3').textContent`),
        await e(`document.querySelector('${link(key)}').closest('section').querySelector('h4').textContent`), 'Settings names the selected lever group');
      const expected = await e(`document.querySelector(${JSON.stringify(controlSelector(label))}).checked`);
      assert.equal(await active(key), expected, 'Dot uses actual enabled state');
      await toggle(label);
      assert.equal(await active(key), !expected, 'Live toggle updates dot on/off');
      assert.match(await e(`document.querySelector('${link(key)}').getAttribute('aria-label')`), expected ? /Inactive$/ : /Active$/);
      if (!expected) assert.equal(await e(`getComputedStyle(document.querySelector('${link(key)} .intervention-nav-status')).backgroundColor`), 'rgb(0, 156, 167)');
      await toggle(label);
      assert.equal(await active(key), expected);
    }
    // The original producer rail remains hidden even when settings are open.
    const before = await snapshot();
    await open(`${prefix}_financial_commitment_enabled`);
    assert.equal(await e(`getComputedStyle(document.querySelector('.intervention-workspace__controls')).display`), 'none');
    assert.equal(await snapshot(), before);
    // Read-only users retain navigation and active indicators, but not mutation.
    await e('__setReadOnly(true)');
    await open(`${prefix}_connections_enabled`);
    assert.equal(await e(`document.querySelector('#intervention-input-drawer [role="switch"]').disabled`), true);
    assert.equal(await e(`document.querySelector('[aria-label="Basic expansion billed (%)"]').disabled`), true);
    assert.equal(await e(`document.querySelector('${link(`${prefix}_connections_enabled`)}').disabled`), false);
    await e('__setReadOnly(false)');
    // Existing parameter setters and field-local validation now live in settings.
    await open(`${prefix}_tariff_enabled`);
    const inputSection = sector === 'water' ? 'water_interventions' : 'sanitation_interventions';
    const fieldLabel = sector === 'water' ? 'Target tariff' : 'Target sewer tariff';
    const value = sector === 'water' ? '37.4' : '21.8';
    await e(`{
      const label=[...document.querySelectorAll('#intervention-input-drawer label')].find(n=>n.textContent.startsWith('${fieldLabel}'));
      const field=document.getElementById(label.htmlFor);
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'${value}');
      field.dispatchEvent(new Event('input',{bubbles:true}));field.blur();
    }`);
    assert.equal(await e(`__inputs.${inputSection}.tariff_target`), Number(value));
    await e(`__validationIssues=[{area:'urban',sector:'${sector}',intervention:'tariff',field:'${inputSection}.tariff_target',label:'${fieldLabel}',severity:'error',code:'fixture',message:'Fixture tariff validation'}];
      __setInputs(i=>({...i,toggles:{...i.toggles,${prefix}_tariff_enabled:true}}))`);
    await w(`document.querySelector('#intervention-input-drawer [aria-invalid="true"]') !== null`, 'Field-local validation did not follow its portal');
    assert.equal(await e(`document.querySelector('#intervention-input-drawer').textContent.includes('Fixture tariff validation')`), true);
    await toggle('Tariff reform');
    await open(`${prefix}_microfinance_enabled`);
    await open(`${prefix}_tariff_enabled`);
    assert.equal(await e(`__inputs.${inputSection}.tariff_target`), Number(value), 'Disabling and switching settings preserve parameters');
    assert.equal(await e(`document.querySelector('#intervention-input-drawer [role="switch"]').checked`), false);
    await e(`__validationIssues=[]`);
    await e(`document.querySelector('[aria-label="Close intervention inputs"]').click()`);
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
  assert.equal(await e(`document.querySelector('#intervention-input-drawer [role="switch"]').disabled`), true);
  assert.equal(await e(`document.querySelector('#intervention-input-drawer').textContent.includes('Add Water supply')`), true);
  await e(`__setSectors(['water','sanitation'])`);
  await w(`document.querySelector('${link('san_nrw_link_enabled')} .intervention-nav-status').dataset.active==='true'`, 'Restoring sector restores saved active state');
  for (const mobile of [false, true]) {
    await b.call('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    await navigate('design');
    await w(`!!document.querySelector('${nav}')`, 'Design nav missing');
    assert.equal(await e(`getComputedStyle(document.querySelector('${nav}')).display !== 'none' && document.querySelector('${nav}').getBoundingClientRect().width > 0`), true);
    if (mobile) assert.ok(await e(`document.querySelector('${nav} button').getBoundingClientRect().height >= 44`), 'Touch rows must be at least 44px');
    await open('san_microfinance_enabled');
    if (!mobile) assert.equal(await e(`(()=>{
      const nav=document.querySelector('.intervention-section-nav').getBoundingClientRect();
      const settings=document.querySelector('#intervention-input-drawer').getBoundingClientRect();
      const workspace=document.querySelector('.intervention-section-workspace').getBoundingClientRect();
      return Math.abs(settings.left-nav.right)<2 && Math.abs(settings.right-workspace.right)<2;
    })()`), true, 'Exactly two adjacent panels, with no reserved reading/middle width');
    // Escape closes and returns keyboard focus to the navigation trigger.
    await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await w(`!!document.querySelector('.intervention-settings-empty') && document.activeElement.dataset.interventionKey==='san_microfinance_enabled'`, 'Escape must restore nav focus and empty settings');
    for (const section of ['graph', 'table']) {
      await navigate(section);
      await w(`!document.querySelector('${nav}') && document.querySelector('.intervention-workspace__controls').hidden &&
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
  console.log('PASS: two-panel Design, empty settings, all ten interventions in both sectors, lever headings, live activation dots, saved connection precedence, navigation without enabling, geography, read-only/unavailable inspection, desktop/mobile focus and Graph/Table scroll.');
} finally { b.close(); }
