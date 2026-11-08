// Synthetic in-memory API only: no production simulation is loaded, changed or saved.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'vite';
import { openChromium, sleep } from './chromium-client.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({ configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom'),
  } },
  build: { write: false, lib: { entry: path.join(root, 'tests/post-intervention-harness.tsx'), name: 'PostHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const inputs = { period: { model_start_year: 2024, baseline_year: 2025, forecast_end_year: 2028 },
  country_config: { currency: 'LCU' }, toggles: { ws_tariff_enabled: true } };
const bundle = { __wss_bundle: 1, inputs, altInputs: { rural: structuredClone(inputs), national: structuredClone(inputs) },
  scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true, sectors: ['water', 'sanitation'] } };
const coverage = { sm: [.2, .22, .27, .32, .4], basic: [.3, .3, .3, .3, .3], at_least_basic: [.5, .52, .57, .62, .7], total: [1, 1, 1, 1, 1] };
const composition = { household_expansion: 12.3, ancillary: 2.1, replacement_backlog: .9, cash_shortfall: 0, total: 15.3 };
const bucket = { solver_status: 'solved', reference_coverage: coverage, adjusted_existing_funding_coverage: coverage,
  original_target_coverage: { ...coverage, sm: [.2, .22, .4, .5, .6], at_least_basic: [.5, .52, .7, .8, .9] },
  target_coverage: { ...coverage, sm: [.2, .22, .4, .5, .6], at_least_basic: [.5, .52, .7, .8, .9] },
  sm_gap: .2, at_least_basic_gap: .2, target_year_residual_components: composition, target_year_residual_total: 15.3,
  funding_fraction: .00152, funding_available_by_year: [0, 0, 15.2, 15.2, 15.2], funding_used_by_year: [0, 0, 10.2, 13.8, 14.1], unused_by_year: [0, 0, 5, 1.4, 1.1],
  verified_funded_coverage: { ...coverage, sm: [.2, .22, .42, .54, .61], at_least_basic: [.5, .52, .72, .84, .91] },
  remaining_financial_components: { household_expansion: 0, ancillary: 0, replacement_backlog: 0, cash_shortfall: 0, total: 0 },
  convergence_diagnostics: { iterations: 17, verified: true }, warnings: [] };
const response = { method_version: 'synthetic-test-v1', input_signature: 'test', status: 'solved', selected_year: 2028,
  funding_window: { start: 2026, end: 2028 }, years: [2024, 2025, 2026, 2027, 2028], national_gdp: [10000,10000,10000,10000,10000],
  currency: 'LCU', real_price_year: 2025, units: { households: 'million', money: 'million LCU' },
  loan_inclusion: true, per_area_sector: Object.fromEntries(['urban','rural','national'].map(area => [area, { water: structuredClone(bucket), sanitation: structuredClone(bucket) }])),
  combined: { complete: true, funding_fraction: .00608, target_year_residual_total: 61.2, funding_available_by_year: [0,0,60.8,60.8,60.8],
    funding_used_by_year: [0,0,40.8,55.2,56.4], unused_by_year: [0,0,20,5.6,4.4] }, warnings: [] };
const browser = await openChromium('about:blank'), e = browser.evaluate, w = browser.waitFor;
const screenshots = path.join(root, 'screenshots/post-intervention');
mkdirSync(screenshots, { recursive: true });
const capture = async name => {
  const { data } = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(screenshots, name), Buffer.from(data, 'base64'));
};
const change = (selector, value, select = false) => e(`{
  const n=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(n,${JSON.stringify(String(value))});
  n.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));
}`);
const navigate = async index => {
  await e(`document.querySelectorAll('.modern-inputs-nav__item')[${index}].click()`);
  await sleep(150);
};
const ready = () => w(`!!document.querySelector('.recharts-surface') && !document.querySelector('[aria-busy="true"]')`, 'Expected current coverage results');
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0'`);
  await e(`window.__bundle=${JSON.stringify(bundle)};window.__response=${JSON.stringify(response)}`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex} *{box-sizing:border-box}')} ;document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await ready();
  assert.equal(await e('window.__writes'), 0, 'Opening must not dirty the analysis');
  assert.equal(await e('window.__settings'), undefined);
  assert.equal(await e('window.__requests.length'), 1);
  assert.equal(await e(`window.__requests[0].headers['x-simulation-id']`), 'synthetic-test');
  assert.equal(await e(`window.__requests[0].credentials`), 'same-origin');
  assert.equal(await e(`document.querySelectorAll('.modern-inputs-nav__item').length`), 4);
  await capture('1440-default.png');
  const requestsBeforeDisplay = await e('window.__requests.length');
  await e(`document.querySelectorAll('[aria-label="Post-intervention geography"] button')[2].click()`);
  await e(`document.querySelectorAll('[aria-label="Post-intervention sector"] button')[1].click()`);
  await e(`document.querySelectorAll('[aria-label="Post-intervention service level"] button')[1].click()`);
  await e(`document.querySelectorAll('[aria-label="Coverage KPI units"] button')[1].click()`);
  await e(`document.querySelectorAll('[aria-label="Display currency"] button')[1].click()`);
  await sleep(550);
  assert.equal(await e('window.__requests.length'), requestsBeforeDisplay, 'Geography/sector/service/currency/unit controls are display only');
  assert.match(await e(`document.querySelector('[aria-label="Coverage KPI units"] [aria-pressed="true"]').textContent`), /Households/);
  await change('.intervention-reading-content .post-field select', 'exclude', true);
  await ready();
  assert.equal(await e('window.__includeDebt'), false);
  assert.equal(await e('window.__requests.at(-1).body.includeDebt'), false);
  await e(`document.querySelectorAll('[aria-label="Post-intervention geography"] button')[0].click()`);
  await e(`document.querySelectorAll('[aria-label="Post-intervention sector"] button')[0].click()`);
  await change('.post-settings select', 2027, true);
  await ready();
  assert.deepEqual(await e('window.__settings.targetOverrides'), {}, 'Changing target year alone must not copy endpoint targets');
  assert.equal(await e('window.__requests.at(-1).body.settings.targetYear'), 2027);
  await change('#post-target-urban-water-safelyManagedShare', 0);
  await change('#post-target-urban-water-atLeastBasicShare', 0);
  await ready();
  assert.deepEqual(await e('window.__settings.targetOverrides.urban.water'), { safelyManagedShare: 0, atLeastBasicShare: 0 });
  await capture('1440-edited.png');
  const validCount = await e('window.__requests.length');
  await change('#post-target-urban-water-safelyManagedShare', '');
  await sleep(550);
  assert.equal(await e('window.__settings.targetOverrides.urban.water.safelyManagedShare'), null, 'Blank is never zero');
  assert.equal(await e('window.__requests.length'), validCount, 'Invalid targets do not run the solver');
  assert.match(await e(`document.querySelector('#post-target-urban-water-error').textContent`), /blank is missing/);
  assert.equal(await e(`document.querySelectorAll('.recharts-surface').length`), 0, 'Stale results suppressed while invalid');
  await change('#post-target-urban-water-safelyManagedShare', 80);
  await sleep(120);
  assert.match(await e(`document.querySelector('#post-target-urban-water-error').textContent`), /Require/);
  await change('#post-target-urban-water-atLeastBasicShare', 90);
  await ready();
  await e(`document.querySelector('.post-settings details').open=true;document.querySelector('.post-toggle input').click()`);
  await ready();
  assert.equal(await e(`Object.keys(window.__settings.toggleOverrides.urban).length`), 1);
  assert.equal(await e(`window.__bundle.inputs.toggles.ws_tariff_enabled`), true, 'Local comparison does not change original inputs');
  // Older, slower result deliberately ignores AbortSignal; latest edit must still win.
  await e(`window.__delay=1000;window.__setSettings({...window.__settings,targetYear:2026})`);
  await sleep(450);
  assert.equal(await e(`!!document.querySelector('[aria-busy="true"]')`), true);
  await capture('1440-calculating.png');
  await e(`window.__delay=10;window.__setSettings({...window.__settings,targetYear:2028})`);
  await ready();
  await sleep(1100);
  assert.match(await e(`document.querySelector('.post-status').textContent`), /Target year 2028/);
  await e(`window.__mode='error';window.__setSettings({...window.__settings,targetYear:2027})`);
  await w(`document.querySelector('.post-status').textContent.includes('Synthetic GDP conflict')`, 'Structured request error not visible');
  assert.equal(await e(`document.querySelectorAll('.recharts-surface').length`), 0);
  await capture('1440-error.png');
  await e(`window.__mode='ok';[...document.querySelectorAll('button')].find(n=>n.textContent==='Retry analysis').click()`);
  await ready();
  await e(`window.__mode='busy';window.__setSettings({...window.__settings,targetYear:2026})`);
  await w(`document.querySelector('.post-status').textContent.includes('Retry after 3 seconds')`, '503 retry timing not displayed');
  await e(`window.__mode='ok';[...document.querySelectorAll('button')].find(n=>n.textContent==='Retry analysis').click()`);
  await ready();
  await e(`window.__mode='invalid';window.__setSettings({...window.__settings,targetYear:2028})`);
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('Synthetic missing unit cost')`, 'Bucket error not shown inline');
  assert.equal(await e(`document.querySelectorAll('.recharts-surface').length`), 0);
  assert.match(await e(`document.querySelector('[data-testid="post-annual-full"]').textContent`), /unavailable/);
  await e(`window.__mode='partial';window.__setSettings({...window.__settings,targetYear:2027})`);
  await ready();
  assert.equal(await e(`document.querySelectorAll('[data-testid="post-annual-view"] tbody tr').length`), 2);
  assert.equal(await e(`document.querySelectorAll('[data-testid="post-annual-full"] tbody tr').length`), 0, 'Partial solution is not a full-project result');
  await navigate(3);
  assert.equal(await e(`document.activeElement.tagName`), 'H2', 'Section navigation focuses numbered heading');
  await capture('1440-partial-gdp.png');
  await navigate(0);
  await e(`window.__mode='ok';[...document.querySelectorAll('button')].find(n=>n.textContent==='Reset analysis').click()`);
  await ready();
  assert.equal(await e('window.__settings'), undefined);
  assert.equal(await e(`'settings' in window.__requests.at(-1).body`), false, 'Reset inherits exact full original schedule');
  assert.equal(await e('window.__includeDebt'), false, 'Reset retains the effective inherited shared loan choice');
  await e(`window.__setReadOnly(true)`);
  await sleep(120);
  assert.equal(await e(`!!document.querySelector('.post-settings input:not([disabled])')`), false);
  assert.equal(await e(`!!document.querySelector('.post-settings select:not([disabled])')`), false);
  assert.equal(await e(`document.querySelector('.intervention-reading-content .post-field select').disabled`), true, 'Read-only cannot change shared loan inclusion');
  assert.equal(await e(`document.querySelector('[aria-label="Post-intervention geography"] button').disabled`), false);
  await capture('1440-readonly.png');
  for (const width of [1024, 390]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate(0);
    await sleep(100);
    assert.ok(await e(`document.documentElement.scrollWidth<=${width}`), `No page overflow at ${width}px`);
    assert.ok(await e(`(()=>{
      const a=document.querySelector('.post-settings').getBoundingClientRect();
      const b=document.querySelector('.intervention-reading-content').getBoundingClientRect();
      const last=[...document.querySelectorAll('.post-settings-body > *')].at(-1).getBoundingClientRect();
      return a.bottom <= b.top + 2 && last.bottom <= a.bottom + 2;
    })()`), `Settings stack above the reading pane without overlap at ${width}px`);
    await capture(`${width}-settings.png`);
    await navigate(1);
    assert.equal(await e(`document.querySelector('.post-settings').hidden`), true);
    assert.ok(await e(`document.querySelector('.loan-chart').getBoundingClientRect().width>240`), 'Readable chart width');
    await capture(`${width}-coverage.png`);
    await navigate(3);
    const frame = await e(`(()=>{const n=document.querySelector('[data-testid="post-annual-view"] .post-table-frame');return {client:n.clientWidth,scroll:n.scrollWidth}})()`);
    if (width === 390) assert.ok(frame.scroll > frame.client, 'Annual table scroll is contained locally');
    assert.ok(await e(`document.documentElement.scrollWidth<=${width}`));
    await capture(`${width}-gdp.png`);
  }
  // National-entry projects use the sole national dataset, not urban plus rural copies.
  await e(`window.__setReadOnly(false);window.__setBundle({...window.__bundle,scope:{...window.__bundle.scope,scopeMode:'national',areaUrban:false,areaRural:false}})`);
  await ready();
  assert.deepEqual(await e(`[...document.querySelectorAll('[aria-label="Post-intervention geography"] button')].map(n=>n.textContent)`), ['National']);
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log('PASS: Section 6 browser states, scope, readonly, units/currency display isolation, zero/blank/hierarchy, debounce/stale responses, reset, errors, partial results, focus and 1440/1024/390 layouts.');
} finally {
  browser.close();
}
