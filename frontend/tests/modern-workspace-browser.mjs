// Isolated browser storage and controlled inputs; no saved server profiles are changed.
import assert from 'node:assert/strict';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const inputs = await (await fetch(`${url}/api/defaults`)).json();
const count = inputs.period.forecast_end_year - inputs.period.model_start_year + 1;
inputs.toggles = Object.fromEntries(Object.keys(inputs.toggles).map(key => [key, false]));
for (const prefix of ['ws', 'san']) {
  inputs.bau[`${prefix}_expend_ts`] = Array(count).fill(100);
  inputs.bau[`${prefix}_alloc_ts`] = Array(count).fill(200);
}
const rural = structuredClone(inputs);
for (const [area, water, sanitation] of [[inputs, [.3,.3,.2,.1,.1], [.2,.4,.2,.1,.1]],
  [rural, [.15,.45,.2,.1,.1], [.1,.5,.2,.1,.1]]]) {
  for (let rung = 1; rung <= 5; rung++) {
    area.water_service[`serv${rung}_ts`] = Array(count).fill(water[rung - 1]);
    area.sanitation_service[`sserv${rung}_ts`] = Array(count).fill(sanitation[rung - 1]);
  }
}
const bundle = { __wss_bundle:1, inputs, altInputs:{rural},
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true} };
const preview = await (await fetch(`${url}/api/development-preview`)).json();
const b = await openChromium('about:blank');
const {evaluate:e, waitFor:w} = b;
const nav = '.modern-inputs-nav';
const navigate = async index => {
  await e(`document.querySelectorAll('${nav} button')[${index}].click()`);
  await sleep(450);
  assert.ok(await e(`['H2','H3'].includes(document.activeElement.tagName)`), 'Section heading receives keyboard focus');
};
try {
  await b.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await b.call('Page.addScriptToEvaluateOnNewDocument', {source:`
    localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))});
    localStorage.setItem('wss_development_preview_revision',${JSON.stringify(preview.revision || '')});
    localStorage.setItem('wss_mock_setup_revision',${JSON.stringify(preview.mock_setup_revision || '')});
    localStorage.setItem('wss_scope_hint_seen','1');
  `});
  await b.call('Page.navigate', {url});
  await w(`document.querySelectorAll('${nav} button').length===7`, 'Seven input sections missing');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click()`);
  await sleep(600);
  assert.ok(await e(`!!document.querySelector('.modern-inputs-content .modern-page-intro + .modern-geographical-scope')`), 'Scope controls belong below the main heading/subtitle');
  assert.equal(await e(`document.querySelectorAll('.wb-scope-bar, .wb-scope-card').length`), 0, 'Tab 1 must have no bounding scope banner');
  await e(`document.querySelectorAll('.modern-geographical-scope button')[1].click()`);
  await w(`document.querySelector('.modern-geographical-scope button[aria-pressed="true"]')?.textContent==='rural'`, 'Rural switch failed');
  await e(`document.querySelectorAll('.modern-geographical-scope button')[0].click()`);
  assert.equal(await e(`document.querySelectorAll('.modern-input-panel .wb-panel-section').length`), 7);
  assert.equal(await e(`document.querySelectorAll('.modern-input-panel .wb-section-trigger').length`), 0);
  for (let index=0; index<7; index++) {
    await navigate(index);
    assert.equal(await e(`document.querySelectorAll('${nav} button')[${index}].getAttribute('aria-current')`), 'location');
  }
  assert.ok(await e(`document.querySelector('.modern-inputs-content').scrollTop > 100`));
  await e(`document.querySelectorAll('.wb-tab')[1].click()`);
  await w(`document.querySelectorAll('${nav} button').length===2`, 'Exactly two BAU sections required');
  assert.deepEqual(await e(`[...document.querySelectorAll('${nav} button')].map(n=>n.textContent.replace(/^\\d+/,''))`),
    ['BAU Graph','BAU Table']);
  await w(`document.querySelector('[data-bau-kpi="baseline"] strong')?.textContent==='30.0%'`, 'Urban water baseline KPI must come from the engine');
  for (let index=0; index<2; index++) await navigate(index);
  assert.equal(await e(`document.querySelectorAll('[data-section-key="table"] table').length`), 1);
  assert.equal(await e(`document.querySelectorAll('[data-section-key="graph"] [data-bau-ledger]').length`), 0);
  await e(`document.querySelectorAll('[aria-label="BAU sector"] button')[1].click()`);
  await w(`document.querySelector('[data-bau-kpi="baseline"] strong')?.textContent==='20.0%'`, 'Sanitation KPI did not update');
  await e(`document.querySelectorAll('[aria-label="BAU graph area"] button')[1].click()`);
  await w(`document.querySelector('[data-bau-kpi="baseline"] strong')?.textContent==='10.0%'`, 'Rural KPI did not update');
  await sleep(950);
  const result = await e(`fetch('/api/calculate',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(JSON.parse(localStorage.getItem('wss_working_bundle')).altInputs.rural)}).then(r=>r.json())`);
  const last = result.years.indexOf(inputs.period.forecast_end_year);
  const expected = series => `${(Math.min(result.total_hh[last], series[0][last]) / result.total_hh[last] * 100).toFixed(1)}%`;
  assert.equal(await e(`document.querySelector('[data-bau-kpi="bau"] strong').textContent`), expected(result.sanitation.bau_hh));
  assert.equal(await e(`document.querySelector('[data-bau-kpi="target"] strong').textContent`), expected(result.sanitation.target_hh));
  await e(`document.querySelector('[aria-label="BAU table service level"] [data-service-level="at_least_basic"]').click()`);
  await w(`document.querySelector('[data-bau-ledger="at_least_basic"]') && document.querySelector('[data-bau-kpi="bau"] strong').textContent.endsWith('%')`, 'Combined table and KPIs must update');
  assert.equal(await e(`document.querySelector('[aria-label="BAU graph service level"] [aria-pressed="true"]').dataset.serviceLevel`), 'at_least_basic');
  const combined = result.sanitation.bau_hh[0].map((value, i) => value + result.sanitation.bau_hh[1][i]);
  assert.equal(await e(`document.querySelector('[data-bau-kpi="bau"] strong').textContent`), expected([combined]));
  assert.equal(await e(`document.querySelectorAll('[data-section-key="baseline"]').length`), 0);
  assert.ok(await e(`(()=>{const frame=document.querySelector('.bau-ledger-frame'); return frame.scrollWidth<=frame.clientWidth+1;})()`), 'BAU table fits without horizontal scrolling');
  for (const [tab, selector] of [[2,'.modern-page-intro--intervention'],[3,'.debt-overview-strip'],[4,'.modern-results-intro']]) {
    await e(`document.querySelectorAll('.wb-tab')[${tab}].click()`);
    await w(`!!document.querySelector(${JSON.stringify(selector)})`, `Workflow ${tab + 1} presentation missing`);
  }
  await w(`document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper').length>=6 &&
    [...document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper')].every(node=>
      node.getBoundingClientRect().width>200 && node.querySelectorAll('.recharts-cartesian-axis-tick-value').length>0)`,
    'Results charts must retain populated, usable layouts');
  console.log(`Results chart layouts verified: ${await e(`document.querySelectorAll('[data-testid="results-dashboard"] .recharts-wrapper').length`)} populated charts`);
  await b.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for (const tab of [0,1]) {
    await e(`document.querySelectorAll('.wb-tab')[${tab}].click()`);
    await sleep(200);
    assert.equal(await e(`getComputedStyle(document.querySelector('${nav} .modern-inputs-nav__items')).display`), 'none');
    assert.notEqual(await e(`getComputedStyle(document.querySelector('${nav} select')).display`), 'none');
    await e(`(()=>{const select=document.querySelector('${nav} select');select.value=select.options[select.options.length-1].value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await sleep(400);
    assert.ok(await e(`['H2','H3'].includes(document.activeElement.tagName)`));
    assert.ok(await e(`document.querySelector('.modern-inputs-content').scrollTop>100`));
    assert.ok(await e(`document.documentElement.scrollWidth<=innerWidth+1`), 'Mobile page must not overflow horizontally');
  }
  assert.equal(b.errors.length, 0, 'No browser runtime exceptions');
  console.log('PASS: seven expanded input sections, two BAU sections, focused scrolling, real sector/area KPIs and mobile selectors');
} finally { b.close(); }
