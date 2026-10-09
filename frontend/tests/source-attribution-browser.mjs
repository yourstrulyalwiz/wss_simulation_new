import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const bundle = JSON.parse(readFileSync(new URL('../../profiles/DRC OCT 8.json', import.meta.url), 'utf8'));
const response = await fetch(`${url}/api/development-preview`);
const preview = response.ok ? await response.json() : {};
const dir = new URL('../screenshots/source-attribution/', import.meta.url);
mkdirSync(dir, { recursive: true });
const c = await openChromium('about:blank');
const { evaluate: e, waitFor: w } = c;
try {
  await c.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('wss_source_attribution_fixture')) {
      localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(bundle))});
      localStorage.setItem('wss_development_preview_revision', ${JSON.stringify(preview.revision || '')});
      localStorage.setItem('wss_mock_setup_revision', ${JSON.stringify(preview.mock_setup_revision || '')});
      localStorage.setItem('wss_source_attribution_fixture', '1');
    }
    window.__attributionCalls=[];
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>originalFetch(url,options).then(async response=>{
      if(String(url)==='/api/calculate') window.__attributionCalls.push({
        input:JSON.parse(options.body), status:response.status, data:await response.clone().json()});
      return response;
    });` });
  await c.call('Page.navigate', { url });
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App did not load');
  const tab = async index => {
    await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[${index}].click()`);
    await sleep(450);
  };
  const capture = async (selector, filename, width) => {
    await c.call('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 1050 : 1050, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    await e(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await sleep(350);
    const shot = await c.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL(filename, dir), Buffer.from(shot.data, 'base64'));
    const dimensions = await e(`({width:document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width,
      documentWidth:document.documentElement.scrollWidth,viewport:innerWidth})`);
    assert.ok(dimensions.width > 200, `${filename}: chart column too narrow ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.documentWidth <= dimensions.viewport + 2, `${filename}: document horizontal overflow ${JSON.stringify(dimensions)}`);
  };
  await tab(2);
  await w(`[...document.querySelectorAll('h3')].some(h=>h.textContent.includes('safely-managed impact (live)')) &&
    window.__attributionCalls.some(c=>c.status===200 && c.data.water_supply?.scenario_coverage_attribution?.version===1)`,
    'Live source coverage did not calculate');
  await w(`[...document.querySelectorAll('.recharts-legend-wrapper')].some(n=>n.textContent.includes('Opening and baseline-funded coverage') && n.textContent.includes('Pure BAU'))`,
    'Live baseline-funded stack/pure BAU legend missing');
  await e(`window.__liveChartRoot=[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('safely-managed impact (live)')).parentElement.parentElement;
    window.__liveChartRoot.querySelector('.recharts-responsive-container').parentElement.setAttribute('data-source-live-check','true')`);
  await capture('[data-source-live-check]', 'live-water-desktop.png', 1440);
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await tab(4);
  await w(`document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper').length>=6 &&
    [...document.querySelectorAll('[data-results-chart$="_coverage"] .recharts-legend-wrapper')]
      .filter(n=>n.textContent.includes('Opening and baseline-funded coverage') && n.textContent.includes('Pure BAU')).length===2`,
    'Results source coverage charts did not render');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt');
  assert.ok(await e(`document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Baseline-funded difference from pure BAU')`));
  const calls = await e(`window.__attributionCalls`);
  assert.ok(calls.every(call => call.status === 200), 'Calculation API failed');
  const resultsCalls = calls.filter(call => !call.input.utility_debt?.water?.enabled && !call.input.utility_debt?.sanitation?.enabled);
  assert.ok(resultsCalls.length, 'Default excluded-debt results were not calculated');
  for (const call of resultsCalls) for (const sector of ['water_supply','sanitation']) {
    const a = call.data[sector].scenario_without_utility_debt_coverage_attribution;
    assert.equal(a.method,'actual_source_funding');
    for (const rung of ['sm','basic']) for (let i=0;i<call.data.years.length;i++) {
      const stock = a.source_keys.reduce((sum,key)=>sum+a[`${rung}_stock`][key][i],0);
      assert.ok(Math.abs(stock-a.combined_stock[rung][i]) < 1e-8 + Math.abs(stock)*1e-10);
    }
  }
  await capture('[data-results-chart="water_coverage"]', 'results-water-desktop.png', 1440);
  await capture('[data-results-chart="water_coverage"]', 'results-water-narrow.png', 402);
  await capture('[data-results-chart="san_coverage"]', 'results-sanitation-narrow.png', 402);
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await e(`(()=>{const s=document.querySelector('[aria-label="Results debt mode"]');s.value='with_debt';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`document.querySelector('[data-testid="results-repayment-schedule"]')?.textContent.includes('Debt service unfunded') &&
    document.querySelector('[data-results-chart="water_coverage"] .recharts-legend-wrapper')?.textContent.includes('Indicative loan funding')`,
    'Included-debt source layers and due/funded/unfunded loan tables missing');
  await capture('[data-results-chart="water_coverage"]', 'results-water-with-debt-desktop.png', 1440);
  await capture('[data-results-chart="san_coverage"]', 'results-sanitation-desktop.png', 1440);
  await tab(2);
  await w(`[...document.querySelectorAll('.recharts-legend-wrapper')].some(n=>n.textContent.includes('Opening and baseline-funded coverage') && n.textContent.includes('Pure BAU'))`,
    'Live chart did not reload');
  await e(`window.__liveChartRoot=[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('safely-managed impact (live)')).parentElement.parentElement;
    window.__liveChartRoot.querySelector('.recharts-responsive-container').parentElement.setAttribute('data-source-live-check','true')`);
  await capture('[data-source-live-check]', 'live-water-narrow.png', 402);
  assert.deepEqual(c.errors, [], 'Browser runtime exception');
  console.log(`Real source coverage browser checks passed: live/results, default no-debt and included debt, stock reconciliation, pure BAU, baseline difference, desktop/narrow rendering. Screenshots: ${dir.pathname}`);
} finally { c.close(); }
