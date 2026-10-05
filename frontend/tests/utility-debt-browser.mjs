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
  await e(`([...document.querySelectorAll('.wb-tab')].find(b=>b.textContent.replace(/\\s/g,'').toLowerCase().includes('debtservicing'))).click()`);
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
    ['Additional annual net revenue', row.total_additional_net_revenue],
    ['Annual service capacity', row.annual_service_capacity],
    ['Supportable borrowing', response.accepted_principal],
  ]) {
    const text = await e(`document.querySelector('[data-debt-metric=${JSON.stringify(label)}]').lastElementChild.textContent`);
    assert.equal(Number(text.split(' ')[0].replaceAll(',', '')), Number(expected.toFixed(2)), `${label}: ${text}`);
  }
  for (const [label, key] of [
    ['Start-year protected revenue base', 'start_year_protected_revenue'],
    ['Start-year servicing limit', 'start_year_capacity'],
    ['Start-year principal bound', 'start_year_principal_bound'],
  ]) {
    const text = await e(`([...document.querySelectorAll('.debt-diagnostics div')]
      .find(d=>d.querySelector('span')?.textContent===${JSON.stringify(label)})).querySelector('b').textContent`);
    assert.equal(Number(text.split(' ')[0].replaceAll(',', '')), Number(response[key].toFixed(2)), label);
  }
  const table = await e(`(()=>{
    const t=document.querySelector('[data-testid="debt-annual-table"]');
    return {headers:[...t.querySelectorAll('thead th')].map(c=>c.textContent),
      cells:[...t.querySelector('tr[data-year="${year}"]').children].map(c=>c.textContent)};
  })()`);
  for (const [label, key] of [
    ['Debt service', 'total_debt_service'],
    ['Cash after replacement', 'available_after_replacement'],
    ['Reference collected revenue · no debt', 'reference_collected_revenue'],
  ]) {
    assert.equal(Number(table.cells[table.headers.indexOf(label)].replaceAll(',', '')),
      Number(row[key].toFixed(2)), `${year} ${label}`);
  }
  return response;
}
try {
  await w(`!!document.querySelector('.wb-app')`, 'App did not load');
  await sleep(1600);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`!!document.querySelector('.wb-tab')`, 'Reload failed');
  assert.equal(await e(`document.querySelectorAll('.wb-tab').length`), 5);
  await e(`document.querySelector('.wb-onboarding-overlay')?.click()`);
  await e(`document.querySelectorAll('.wb-tab')[2].click()`);
  await w(`document.querySelectorAll('.recharts-wrapper svg.recharts-surface').length>=2`, 'Intervention charts missing');
  assert.equal(await e(`document.querySelectorAll(${JSON.stringify(selector)}).length`), 0);
  assert.ok(!await e(`document.querySelector('input[aria-label="Enable utility borrowing"]')`));
  await interventionTab();
  await w(`document.querySelectorAll(${JSON.stringify(selector)}).length===3`, 'Expected exactly three debt sources');
  assert.deepEqual(await e(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(x=>x.checked)`), [true, true, true]);
  let debt = await verify();
  assert.ok(debt.accepted_principal > 0);
  await w(`document.querySelectorAll('.debt-gap-grid .debt-gap-card').length===4`, 'Coverage/access-gap comparison missing');
  assert.equal(await e(`document.querySelector('[data-testid="debt-annual-table"] tr.is-start-year').dataset.year`),
    String(inputs.period.baseline_year+5));
  const priorBound = debt.start_year_principal_bound;
  await e(`(()=>{const s=document.querySelector('select[aria-label="Loan start year"]');
    s.value=${JSON.stringify(String(inputs.period.baseline_year+6))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  debt = await verify();
  assert.equal(debt.disbursement_year, inputs.period.baseline_year+6);
  assert.notEqual(debt.start_year_principal_bound, priorBound);
  assert.equal(await e(`document.querySelector('[data-testid="debt-annual-table"] tr.is-start-year').dataset.year`),
    String(debt.disbursement_year));
  assert.equal(debt.annual_revenue.filter(r=>r.loan_disbursement>0).length, 1);
  await e(`(()=>{const s=document.querySelector('select[aria-label="Utility debt detail year"]');
    s.value=${JSON.stringify(String(inputs.period.forecast_end_year + 3))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await verify();
  assert.ok((await e(`document.querySelector('[data-testid="utility-debt-preview"]').textContent`)).includes('Post-target assumption'));
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
  await e(`document.querySelector('input[aria-label="Enable utility borrowing"]').click()`);
  assert.deepEqual(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt.water.revenue_sources`), []);
  await verify();
  assert.ok(await e(`!!document.querySelector('[data-testid="debt-annual-table"]')`));
  await e(`document.querySelector('input[aria-label="Enable utility borrowing"]').click()`);
  await verify();
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sanitation')).click()`);
  await verify('sanitation');
  assert.deepEqual(await e(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(x=>x.checked)`), [true, true, true]);
  assert.equal(c.errors.length, 0, JSON.stringify(c.errors));
  await c.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  await w(`document.querySelectorAll('.debt-chart-stack .recharts-wrapper').length===2 &&
    [...document.querySelectorAll('.debt-chart-stack .recharts-wrapper')]
      .every(chart=>chart.querySelectorAll('.recharts-cartesian-axis-tick-value').length>0)`,
    'Debt graph data did not finish loading');
  await e(`document.querySelector('.debt-results-pane').scrollTop=0;
    if(document.querySelector('.wb-data-guide'))document.querySelector('.wb-guide-toggle')?.click()`);
  await sleep(300);
  const overview = await c.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('/tmp/debt-servicing-overview.png', Buffer.from(overview.data, 'base64'));
  await e(`(()=>{const s=document.querySelector('select[aria-label="Utility debt detail year"]');
    s.value=${JSON.stringify(String(inputs.period.baseline_year + 5))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(300);
  await e(`document.querySelector('.debt-ledger-section').scrollIntoView({block:'start'})`);
  await sleep(300);
  const clip = await e(`(()=>{const r=document.querySelector('.debt-ledger-section').getBoundingClientRect();
    return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:Math.min(r.height,innerHeight-r.top),scale:1};})()`);
  const shot = await c.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  writeFileSync('/tmp/utility-debt-panel.png', Buffer.from(shot.data, 'base64'));
  console.log('Debt servicing browser passed: five tabs, intervention-only stage, graphs, annual ledger, start-year sizing/highlight, backend-matched diagnostics, coverage/gaps, source choices, tail years, persistence, disabled table and both sectors.');
} finally { c.close(); }
