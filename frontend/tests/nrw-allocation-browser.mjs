// Real existing InterventionPanel, isolated browser state, no API or saved-project writes.
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
    name: 'NrwAllocationHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const browser = await openChromium('about:blank');
const e = browser.evaluate;
const wait = browser.waitFor;
try {
  await browser.call('Page.setDocumentContent', { frameId: (await browser.call('Page.getFrameTree')).frameTree.frame.id,
    html: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' });
  for (const asset of output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))) {
    await e(`{ const style = document.createElement('style'); style.textContent = ${JSON.stringify(String(asset.source))}; document.head.append(style); }`);
  }
  await e(output.find(item => item.type === 'chunk').code);
  await wait('!!window.__setInputs', 'Existing panel harness did not mount');
  await e(`__setInputs(previous => ({...previous, toggles: {...previous.toggles, ws_nrw_enabled: true, san_nrw_link_enabled: true},
    water_interventions: {nrw_allocation_version: 1, revenue_integration_version: 3, nrw_value_basis: 'production',
      nrw_sales_assumption: 'all_recovered_sold', nrw_water_per_upgrade: 87, nrw_tariff: 12,
      nrw_existing_customer_sales_capacity_mld: null, nrw_unsold_production_reduction_share: null},
    sanitation_interventions: {nrw_allocation_review_required: true, nrw_link_overlap_m3_series: {2030: 0}}}))`);
  await wait(`!!document.querySelector('[data-intervention-key="ws_nrw_enabled"]')`, 'NRW navigation missing');
  await e(`document.querySelector('[data-intervention-key="ws_nrw_enabled"]').click()`);
  const field = label => `document.getElementById([...document.querySelectorAll('#intervention-input-drawer label')].find(l=>l.textContent.startsWith(${JSON.stringify(label)}))?.htmlFor)`;
  const demand = field('Additional billable demand through existing connections');
  const reduction = field('Share of remaining recovered capacity used to reduce production');
  await wait(`!!${demand}`, 'Allocation controls did not render in existing drawer');
  assert.equal(await e(`${demand}.value`), '');
  assert.equal(await e(`${demand}.getAttribute('aria-invalid')`), 'true', 'active blank has a local error');
  assert.equal(await e(`!!document.querySelector('[aria-label="NRW valuation mode"]')`), false);
  assert.equal(await e(`document.querySelector('#intervention-input-drawer').textContent.includes('Water per basic→SM upgrade')`), false);
  async function input(selector, value) {
    await e(`{ const node = ${selector}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node, ${JSON.stringify(value)}); node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); node.blur(); }`);
  }
  await input(demand, '0');
  await input(reduction, '0');
  await wait('__inputs.water_interventions.nrw_unsold_production_reduction_share === 0', 'zero share did not persist');
  assert.equal(await e('__inputs.water_interventions.nrw_existing_customer_sales_capacity_mld'), 0);
  assert.equal(await e(`!!${field('Avoidable variable production cost per m³')}`), false, 'zero share keeps production cost inactive');
  await wait(`document.querySelector('#intervention-input-drawer').textContent.includes('zero is accepted')`, 'zero review notice missing');
  await input(reduction, '50');
  await wait(`!!${field('Avoidable variable production cost per m³')}`, 'positive share must show avoidable cost');
  assert.equal(await e('__inputs.water_interventions.nrw_unsold_production_reduction_share'), .5);
  const cost = field('Avoidable variable production cost per m³');
  assert.equal(await e(`${cost}.getAttribute('aria-invalid')`), 'true');
  await input(cost, '0');
  await wait('__inputs.water_interventions.nrw_production_cost === 0', 'zero cost not preserved');
  assert.equal(await e('__inputs.water_interventions.nrw_water_per_upgrade'), 87, 'legacy input remains untouched');
  await e(`__setSector('sanitation')`);
  await wait(`!!document.querySelector('[data-intervention-key="san_nrw_link_enabled"]')`, 'sanitation navigation missing');
  await e(`document.querySelector('[data-intervention-key="san_nrw_link_enabled"]').click()`);
  await wait(`document.querySelector('#intervention-input-drawer').textContent.includes('Migrated linked scenario')`, 'linked review notice missing');
  assert.equal(await e(`document.querySelector('#intervention-input-drawer').textContent.includes('delivered physical water (E + N)')`), true);
  assert.equal(await e('__inputs.sanitation_interventions.nrw_link_overlap_m3_series[2030]'), 0);
  assert.deepEqual(browser.errors, [], 'no browser runtime errors');
  console.log('NRW allocation real-panel browser checks passed');
} finally { browser.close(); }
