// Uses isolated browser storage; does not create or modify server profiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL is required');
const inputs = JSON.parse(execFileSync('python', ['-c', `
import json
from test_utility_revenue import example
d=example()
d['toggles'].update(ws_collection_efficiency_enabled=True, ws_tariff_enabled=True,
                   san_collection_efficiency_enabled=True, san_tariff_enabled=True)
cfg=dict(enabled=True, allocation_share=.5, annual_real_interest_rate=.05,
         disbursement_year=d['period']['baseline_year']+5,
         maturity_year=d['period']['forecast_end_year']+3,
         principal_grace_years=0, repayment_structure='annuity', loan_ceiling=.01)
d['utility_debt']={'water':dict(cfg),'sanitation':dict(cfg)}
print(json.dumps(d))
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }));
const bundle = { __wss_bundle: 1, inputs, altInputs: { rural: structuredClone(inputs) },
  scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true } };
const c = await openChromium(url);
const { evaluate: e, waitFor: w } = c;
const selector = 'input[aria-label^="Debt source:"]';
async function interventionTab() {
  await e(`document.querySelector('.wb-onboarding-overlay')?.click()`);
  await e(`([...document.querySelectorAll('.wb-tab')].find(b=>b.textContent.replace(/\\s/g,'').toLowerCase().includes('interventiondesign'))).click()`);
}
async function ready() {
  await w(`!!document.querySelector('[data-debt-metric="Supportable borrowing"]') &&
    !document.querySelector('[data-debt-metric="Supportable borrowing"]').textContent.includes('—')`,
    'Debt preview did not finish updating');
}
async function verify(sector = 'water_supply') {
  await ready();
  const year = await e(`+document.querySelector('select[aria-label="Utility debt detail year"]').value`);
  const response = await e(`(async()=>{
    const body=JSON.parse(localStorage.getItem('wss_working_bundle')).inputs;
    const r=await fetch('/api/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());
    return (await r.json())[${JSON.stringify(sector)}].scenario_utility_debt;
  })()`);
  const row = response.annual_revenue.find(r => r.year === year);
  assert.ok(row);
  for (const [label, expected] of [
    ['Additional annual net revenue', row.eligible_additional_revenue],
    ['Annual service capacity', row.annual_service_capacity],
    ['Supportable borrowing', response.accepted_principal],
  ]) {
    const text = await e(`document.querySelector('[data-debt-metric=${JSON.stringify(label)}]').lastElementChild.textContent`);
    assert.equal(Number(text.split(' ')[0].replaceAll(',', '')), Number(expected.toFixed(2)), `${label}: ${text}`);
  }
  return response;
}
try {
  await w(`!!document.querySelector('.wb-app')`, 'App did not load');
  await sleep(1600);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`!!document.querySelector('.wb-tab')`, 'Reload failed');
  await interventionTab();
  await w(`document.querySelectorAll(${JSON.stringify(selector)}).length===3`, 'Expected exactly three debt sources');
  assert.deepEqual(await e(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(x=>x.checked)`), [true, true, true]);
  let debt = await verify();
  assert.ok(debt.accepted_principal > 0);
  await e(`(()=>{const s=document.querySelector('select[aria-label="Utility debt detail year"]');
    s.value=${JSON.stringify(String(inputs.period.forecast_end_year + 3))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await verify();
  assert.ok((await e(`document.querySelector('[data-testid="utility-debt-preview"]').textContent`)).includes('Post-target repayment assumption'));
  await e(`document.querySelector('input[aria-label="Debt source: NRW reductions"]').click()`);
  debt = await verify();
  assert.deepEqual(debt.revenue_sources, ['collection', 'tariff']);
  await e(`document.querySelector('input[aria-label="Debt source: Collection efficiency"]').click()`);
  debt = await verify();
  assert.deepEqual(debt.revenue_sources, ['tariff']);
  await e(`document.querySelector('input[aria-label="Debt source: Tariff reforms"]').click()`);
  debt = await verify();
  assert.deepEqual(debt.revenue_sources, []);
  assert.equal(debt.accepted_principal, 0);
  await c.call('Page.reload');
  await w(`!!document.querySelector('.wb-tab')`, 'Reload failed');
  await interventionTab();
  await ready();
  assert.deepEqual(await e(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(x=>x.checked)`), [false, false, false]);
  // Disabling financing must preserve explicit source choices.
  await e(`([...document.querySelectorAll('h3')].find(h=>h.textContent==='Utility debt financing')).closest('section').querySelector('input[type=checkbox]').click()`);
  assert.deepEqual(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt.water.revenue_sources`), []);
  await e(`([...document.querySelectorAll('h3')].find(h=>h.textContent==='Utility debt financing')).closest('section').querySelector('input[type=checkbox]').click()`);
  await verify();
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sanitation')).click()`);
  await verify('sanitation');
  assert.deepEqual(await e(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(x=>x.checked)`), [true, true, true]);
  assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  await e(`(()=>{const s=document.querySelector('select[aria-label="Utility debt detail year"]');
    s.value=${JSON.stringify(String(inputs.period.baseline_year + 5))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(300);
  await e(`([...document.querySelectorAll('h3')].find(h=>h.textContent==='Utility debt financing')).closest('section').scrollIntoView({block:'start'})`);
  await sleep(300);
  const clip = await e(`(()=>{const r=([...document.querySelectorAll('h3')].find(h=>h.textContent==='Utility debt financing')).closest('section').getBoundingClientRect();
    return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:Math.min(r.height,innerHeight-r.top),scale:1};})()`);
  const shot = await c.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  writeFileSync('/tmp/utility-debt-panel.png', Buffer.from(shot.data, 'base64'));
  console.log('Utility debt browser passed: three sources, legacy defaults, live backend-matched net revenue/capacity/principal, tail years, empty selection, persistence, enable/disable and both sectors.');
} finally { c.close(); }
