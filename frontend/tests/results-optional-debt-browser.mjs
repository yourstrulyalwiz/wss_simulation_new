// Isolated storage and network interception; never changes server profiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL is required');
const base = JSON.parse(execFileSync('python', ['-c',
  'import json; from test_utility_revenue import example; print(json.dumps(example()))'],
  { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }));
base.utility_debt = { water: { enabled: false, annual_real_interest_rate: null, maturity_year: null, revenue_sources: [] },
  sanitation: { enabled: false, annual_real_interest_rate: null, maturity_year: null } };
const c = await openChromium(url);
const { evaluate: e, waitFor: w } = c;
await c.call('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__resultCalls=[];window.__resultExports=[];window.__resultAlerts=[];window.__failResults=false;window.__failBreakdown=false;
  window.alert=message=>window.__resultAlerts.push(String(message));
  const realFetch=window.fetch.bind(window);
  window.fetch=(url,options)=>{
    if(String(url)==='/api/calculate'){
      const body=JSON.parse(options.body);window.__resultCalls.push(body);
      if(window.__failResults || (window.__failBreakdown &&
          body.toggles.ws_collection_efficiency_enabled && !body.toggles.ws_tariff_enabled))
        return Promise.resolve(new Response(JSON.stringify({detail:'Controlled calculation failure'}),{status:422,
          headers:{'Content-Type':'application/json'}}));
    }
    if(String(url).startsWith('/api/export/') && options?.body){
      const exported={url,body:JSON.parse(options.body),status:null};window.__resultExports.push(exported);
      return realFetch(url,options).then(response=>{exported.status=response.status;return response});
    }
    return realFetch(url,options);
  };` });

async function load(inputs, rural = structuredClone(inputs)) {
  const bundle = { __wss_bundle: 1, inputs, altInputs: { rural, national: structuredClone(inputs) },
    scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true } };
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App not ready');
  // Directly open Results: neither Intervention Design nor Debt servicing is visited.
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[4].click()`);
}
async function graphs() {
  await w(`document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper').length===6 &&
    [...document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper')].every(n=>
      n.querySelectorAll('.recharts-cartesian-axis-tick-value').length>0 &&
      n.querySelectorAll('.recharts-line-curve,.recharts-area-area').length>0 &&
      n.getBoundingClientRect().width>200)`, 'Six populated Results charts did not appear');
  await w(`!document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Computing')`, 'Results stuck loading');
}
async function mode(value) {
  await e(`(()=>{const s=document.querySelector('[aria-label="Results debt mode"]');s.value=${JSON.stringify(value)};
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(450); await graphs();
}
try {
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App failed');
  await sleep(1800);
  await load(base);
  await graphs();
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt');
  assert.ok(await e(`document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Executive summary')`));
  assert.ok(await e(`document.querySelectorAll('[data-results-sector] table').length>=4`));
  assert.ok(await e(`window.__resultCalls.every(d=>!d.utility_debt?.water?.enabled && !d.utility_debt?.sanitation?.enabled)`));
  for (const scope of ['urban', 'rural', 'national']) {
    await e(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>['urban','rural','national']
      .every(v=>[...s.options].some(o=>o.value===v)));s.value=${JSON.stringify(scope)};
      s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await sleep(450); await graphs();
  }
  // Controls and all summaries remain available, but plots are no longer below long input panels.
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  assert.ok(await e(`document.querySelector('.recharts-wrapper').getBoundingClientRect().top<innerHeight`));
  writeFileSync('/tmp/results-no-debt-desktop.png', Buffer.from((await c.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await c.call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: false });
  await sleep(250); await graphs();
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent==='Sanitation graphs')).click()`);
  assert.ok(await e(`(()=>{const r=document.querySelector('[data-results-sector="sanitation"]').getBoundingClientRect();
    return r.top>=0 && r.top<innerHeight;})()`));
  writeFileSync('/tmp/results-no-debt-mobile.png', Buffer.from((await c.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  const borrowing = structuredClone(base);
  borrowing.toggles.ws_collection_efficiency_enabled = true;
  borrowing.toggles.ws_tariff_enabled = true;
  borrowing.utility_debt.water = { enabled: true, allocation_share: .5, annual_real_interest_rate: .05,
    disbursement_year: base.period.baseline_year + 5, principal_grace_years: 0,
    maturity_year: base.period.forecast_end_year + 3, repayment_structure: 'annuity', loan_ceiling: .01 };
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await load(borrowing); await graphs();
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt',
    'Results must default to excluding debt even when saved borrowing is enabled');
  assert.ok(await e(`!document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Utility debt financing —')`));
  await mode('with_debt');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'with_debt');
  await e(`window.__resultCalls=[]`);
  await mode('without_debt');
  assert.ok(await e(`window.__resultCalls.every(d=>
    !d.utility_debt.water.enabled && !d.utility_debt.sanitation.enabled)`));
  assert.equal(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt.water.enabled`), true);
  assert.ok(await e(`!document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Utility debt financing —')`));
  for (const [label, endpoint] of [['CSV', '/api/export/csv'], ['Excel', '/api/export/xlsx'], ['PowerPoint', '/api/export/deck']]) {
    await e(`([...document.querySelector('[data-testid="results-dashboard"]').querySelectorAll('button')]
      .find(b=>b.textContent===${JSON.stringify(label)})).click()`);
    await w(`window.__resultExports.some(r=>r.url===${JSON.stringify(endpoint)} && r.status===200)`,
      `${label} export failed`);
    await w(`([...document.querySelector('[data-testid="results-dashboard"]').querySelectorAll('button')]
      .find(b=>b.textContent===${JSON.stringify(label)}))?.disabled===false`, `${label} download did not finish`);
    assert.ok(await e(`(()=>{const r=window.__resultExports.find(r=>r.url===${JSON.stringify(endpoint)});
      const areas=r.body.areas?Object.values(r.body.areas):[r.body];
      return areas.every(d=>!d.utility_debt.water.enabled && !d.utility_debt.sanitation.enabled);})()`),
      `${label} exported different borrowing settings from the dashboard`);
  }
  await e(`([...document.querySelector('[data-results-chart="water_coverage"]').querySelectorAll('button')]
    .find(b=>b.textContent.includes('Excel'))).click()`);
  await w(`window.__resultExports.some(r=>r.url==='/api/export/chart' && r.status===200)`, 'Native chart Excel export failed');
  assert.ok(await e(`window.__resultExports.find(r=>r.url==='/api/export/chart').body.sheets[0].rows.length>0`));
  assert.deepEqual(await e(`window.__resultAlerts`), [], 'Export produced an error alert');
  // Main scenario charts remain populated even when a marginal contribution pass fails.
  await e(`window.__failBreakdown=true`);
  await mode('with_debt');
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('Intervention breakdown unavailable')`,
    'Breakdown error was silently hidden');
  await graphs();
  await e(`window.__failBreakdown=false;([...document.querySelectorAll('button')].find(b=>b.textContent==='Retry breakdown')).click()`);
  await graphs();
  await w(`!document.querySelector('[role="alert"]')`, 'Retry did not clear error');
  // An invalid enabled loan can be excluded without changing saved loan terms.
  const incomplete = structuredClone(borrowing);
  incomplete.utility_debt.water.annual_real_interest_rate = null;
  await load(incomplete);
  await graphs();
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt');
  assert.ok(await e(`!document.querySelector('[role="alert"]')`),
    'Incomplete saved loan terms must not block default standard results');
  await e(`(()=>{const s=document.querySelector('[aria-label="Results debt mode"]');s.value='with_debt';
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('Results unavailable')`, 'Expected loan validation error');
  await mode('without_debt');
  assert.ok(await e(`!document.querySelector('[role="alert"]')`));
  assert.equal(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt.water.annual_real_interest_rate`), null);
  const urbanNoDebt = structuredClone(borrowing);
  urbanNoDebt.utility_debt.water.enabled = false;
  await load(urbanNoDebt, borrowing); await graphs();
  await e(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>['urban','rural','national']
    .every(v=>[...s.options].some(o=>o.value===v)));s.value='urban';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(450); await graphs();
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'without_debt',
    'Loans in other areas must not change the default debt choice');
  await mode('with_debt');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'with_debt',
    'Explicit debt inclusion must remain available for loans in other exported areas');
  await e(`window.__resultCalls=[]`);
  await mode('without_debt');
  assert.ok(await e(`window.__resultCalls.every(d=>!d.utility_debt.water.enabled)`));
  assert.equal(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).altInputs.rural.utility_debt.water.enabled`), true);
  assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
  console.log('Results optional debt passed: direct navigation, six populated charts, unused blank loan settings, no interventions, all scopes, desktop/mobile, mixed-sector/area borrowing, exclusion without mutation, matching CSV/Excel/PowerPoint/native-chart exports, validation recovery and visible contribution failure with complete graphs.');
} finally { c.close(); }
