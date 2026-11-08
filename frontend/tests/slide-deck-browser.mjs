import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { openChromium, sleep } from './chromium-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({ configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom'),
  } },
  build: { write: false, lib: { entry: path.join(root, 'tests/slide-deck-harness.tsx'), name: 'DeckHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const browser = await openChromium('about:blank'), e = browser.evaluate, w = browser.waitFor;
const binary = [80, 75, 3, 4, 0, 255, 128, 17, 231, 64];
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII=';
const preview = { filename: 'snapshot-categories.pptx', pptx_base64: Buffer.from(binary).toString('base64'), rendered_with: 'LibreOffice',
  slides: ['Strategic scenarios', 'National overview', 'Urban — Water Supply', 'Rural — Sanitation'].map((title, index) => ({
    number: index + 1, title, image, width: 1280, height: 720,
  })) };
const area = name => ({ country_config: { country: 'Test Republic', currency: 'NPR', area: name },
  period: { model_start_year: 2020, baseline_year: 2025, forecast_end_year: 2035 },
  water_service: {}, sanitation_service: {}, toggles: {}, calculation_scope: ['water', 'sanitation'],
  utility_debt: { water: { enabled: true, loan_term_years: 13, revenue_sources: ['tariff'] },
    sanitation: { enabled: false, loan_term_years: null } } });
const areas = { urban: area('Urban'), rural: area('Rural'), national: area('National') };
const click = text => e(`[...document.querySelectorAll('.slide-deck-workspace button')].find(n=>n.textContent===${JSON.stringify(text)}).click()`);
const select = (label, value) => e(`{
 const n=document.querySelector('[aria-label="${label}"]');
 Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,${JSON.stringify(value)});
 n.dispatchEvent(new Event('change',{bubbles:true}));
}`);
const generate = async () => { await click('Generate preview'); await w(`!!document.querySelector('.slide-deck-frame img')`, 'Preview missing'); };
const requests = () => e(`__requests.filter(r=>r.url==='/api/export/deck/preview')`);
const stale = async () => {
  await w(`document.querySelector('.slide-deck-state')?.textContent.includes('Inputs changed')`, 'Stale state missing');
  assert.equal(await e(`document.querySelector('.slide-deck-button--primary').disabled`), true);
  assert.equal(await e(`!!document.querySelector('.slide-deck-frame img')`), false);
};
try {
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0';
    const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);
    window.__preview=${JSON.stringify(preview)};window.__areas=${JSON.stringify(areas)};
    window.__currency={mode:'local',sourceCurrency:'NPR',localPerUsd:132.7,rateReferenceYear:2025,sourceNote:'Reference'};`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n*{box-sizing:border-box} #root{height:100dvh}')};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await w(`!!document.querySelector('.slide-deck-state')`, 'Initial state missing');
  assert.equal((await requests()).length, 0, 'No expensive generation on mount');
  assert.equal(await e(`document.querySelector('.slide-deck-button--primary').disabled`), true);
  await generate();
  let request = (await requests()).at(-1);
  assert.deepEqual(Object.keys(request.body.areas), ['urban', 'rural']);
  assert.equal(request.credentials, 'include');
  assert.equal(request.headers['x-simulation-id'], 'public-preview-project');
  assert.equal(request.body.areas.urban.utility_debt.water.enabled, true);
  assert.equal(request.body.areas.rural.utility_debt.sanitation.enabled, false);
  assert.equal(request.body.areas.rural.country_config.area, 'Urban', 'Shared identity follows current Results export');
  assert.equal(await e(`document.querySelector('.slide-deck-frame img').naturalWidth > 0`), true);
  assert.equal(await e(`document.querySelector('.slide-deck-frame').getBoundingClientRect().width/document.querySelector('.slide-deck-frame').getBoundingClientRect().height > 1.7`), true);
  assert.equal(await e(`document.querySelector('.slide-deck-pagination button').disabled`), true);
  await click('Next');
  assert.equal(await e(`document.querySelector('.slide-deck-pagination span').textContent`), 'Slide 2 of 4');
  await e(`document.querySelector('.slide-deck-viewer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
  assert.equal(await e(`document.querySelector('.slide-deck-pagination span').textContent`), 'Slide 3 of 4');
  await e(`document.querySelectorAll('[aria-label="Slide contents"] .modern-inputs-nav__item')[3].click()`);
  assert.equal(await e(`document.querySelector('.slide-deck-pagination button:last-child').disabled`), true);
  await e(`__setActive(false)`); await sleep(30); await e(`__setActive(true)`); await sleep(30);
  assert.equal(await e(`document.querySelector('.slide-deck-pagination span').textContent`), 'Slide 4 of 4');
  await click('Download PowerPoint');
  assert.deepEqual(await e(`__blobs.at(-1).arrayBuffer().then(b=>Array.from(new Uint8Array(b)))`), binary);
  assert.equal(await e(`__downloads.at(-1).filename`), preview.filename);
  assert.equal((await requests()).length, 1, 'Download must not regenerate');

  await select('Slide deck debt mode', 'without_debt'); await stale();
  assert.equal(await e(`__revoked.length`), 1);
  await generate();
  request = (await requests()).at(-1);
  for (const data of Object.values(request.body.areas)) assert.equal(data.utility_debt.water.enabled, false);
  assert.equal(await e(`__areas.urban.utility_debt.water.enabled`), true, 'Saved inputs never mutated');
  await click('Categories'); await stale(); await generate();
  assert.equal((await requests()).at(-1).body.contribution_view, 'category');
  await e(`__setCurrency(c=>({...c,mode:'usd'}))`); await stale(); await generate();
  assert.equal((await requests()).at(-1).body.currency_display.mode, 'usd');
  await e(`__setAreas(a=>({...a,urban:{...a.urban,toggles:{ws_collection_enabled:true}}}))`); await stale();
  // An in-flight response from an old configuration cannot restore artifacts.
  await e(`__hold=true`); await click('Generate preview');
  await w(`!!document.querySelector('[aria-label="Loading slide preview"]')`, 'Loading state missing');
  await e(`__setSectors(['water'])`); await stale(); await e(`__release();__hold=false`); await sleep(100);
  assert.equal(await e(`!!document.querySelector('.slide-deck-frame')`), false);
  await generate();
  assert.deepEqual((await requests()).at(-1).body.areas.urban.calculation_scope, ['water']);
  await e(`__setGeoScope('national')`); await stale(); await generate();
  assert.deepEqual(Object.keys((await requests()).at(-1).body.areas), ['national']);
  await e(`__setGeoScope('rural');__setSectors(['sanitation'])`); await stale(); await generate();
  request = (await requests()).at(-1);
  assert.deepEqual(Object.keys(request.body.areas), ['rural']);
  assert.deepEqual(request.body.areas.rural.calculation_scope, ['sanitation']);
  await e(`__setGeoScope('urban_rural');__setAreas(a=>({...a,rural:null}))`);
  await w(`document.querySelector('.slide-deck-state')?.textContent.includes('Area inputs are missing')`, 'Missing geography not blocked');
  assert.equal(await e(`document.querySelector('.slide-deck-actions button').disabled`), true);
  await e(`__setAreas(${JSON.stringify(areas)})`); await stale();
  for (const [status, body, text] of [
    [422, { detail: 'Complete active sector targets', intervention_issues: [{ area: 'rural', sector: 'water', message: 'Target incomplete' }] }, 'Target incomplete'],
    [503, {}, 'rendering is unavailable'], [429, {}, 'renderer is busy'],
    [200, { ...preview, slides: [] }, 'incomplete preview'],
  ]) {
    await e(`__response=${JSON.stringify({ status, body })}`);
    await click('Generate preview');
    await w(`document.querySelector('[role="alert"]')?.textContent.includes(${JSON.stringify(text)})`, `Missing error ${status}`);
    assert.equal(await e(`document.querySelector('.slide-deck-button--primary').disabled`), true);
  }
  await e(`__response={status:200,body:__preview}`);
  await click('Retry preview'); await w(`!!document.querySelector('.slide-deck-frame')`, 'Retry failed');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(50);
  assert.equal(await e(`getComputedStyle(document.querySelector('[aria-label="Select slide"]')).display`), 'block');
  await select('Select slide', '2');
  assert.equal(await e(`document.querySelector('.slide-deck-pagination span').textContent`), 'Slide 3 of 4');
  assert.equal(await e(`document.documentElement.scrollWidth <= 390`), true, 'Mobile overflow');
  // Real App integration: tab IDs, shared debt setting and read-only safety.
  await e(`__setSectors(['water','sanitation']);__setApp(true)`); await w(`document.querySelectorAll('.wb-tab').length===8`, 'Workflow tab missing');
  assert.equal(await e(`document.querySelector('.wb-tab-active').textContent.includes('Slide')`), true);
  await generate();
  await select('Slide deck debt mode', 'without_debt'); await stale();
  await e(`document.querySelectorAll('.wb-tab')[5].click()`);
  await w(`!!document.querySelector('[aria-label="Results debt mode"]')`, 'Results not mounted');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt');
  await select('Results debt mode', 'with_debt');
  await e(`document.querySelectorAll('.wb-tab')[7].click()`);
  assert.equal(await e(`document.querySelector('[aria-label="Slide deck debt mode"]').value`), 'with_debt');
  await generate(); await click('Next');
  await e(`document.querySelectorAll('.wb-tab')[5].click()`); await sleep(30);
  await e(`document.querySelectorAll('.wb-tab')[7].click()`); await sleep(30);
  assert.equal(await e(`document.querySelector('.slide-deck-pagination span').textContent`), 'Slide 2 of 4');
  assert.equal(await e(`window.__writes || 0`), 0);
  assert.equal(await e(`__requests.some(r=>/save|draft|simulations/.test(r.url))`), false);
  assert.deepEqual(browser.errors, []);
  console.log('Slide deck browser contracts passed: snapshot bytes, navigation, stale/in-flight invalidation, errors/retry, area/sector/currency/debt settings, mobile and real read-only App integration.');
} finally { browser.close(); }
