// Disposable browser and uniquely named synthetic profile; no country calibration is modified.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const name = `schedule-regression-${Date.now()}`;
const inputs = JSON.parse(execFileSync('python', ['-c', `
import json
from test_support import frontend_defaults
d=frontend_defaults()
n=d['period']['forecast_end_year']-d['period']['model_start_year']+1
d['macro']['gdp_real_local']=[100.]*n
d['toggles']={k:False for k in d['toggles']}
for prefix,sector in [('ws','water'),('san','sanitation')]:
    d['bau'][prefix+'_expend_ts']=[1.]*n
    d['bau'][prefix+'_alloc_ts']=[5.]*n
    d['toggles'][prefix+'_financial_commitment_enabled']=True
    d[sector+'_interventions'].update(fin_gdp_enabled=True,fin_gdp_start_year=2026,
        fin_gdp_target_share=.005,fin_growth_enabled=False)
print(json.dumps(d))
`], { encoding: 'utf8' }));
const bundle = { __wss_bundle: 1, inputs, altInputs: { rural: structuredClone(inputs) },
  scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true } };
const preview = await (await fetch(`${url}/api/development-preview`)).json();
const b = await openChromium('about:blank');
const e = b.evaluate, w = b.waitFor;
const root = '[data-public-spending-schedule="water_interventions"]';
const session = `JSON.parse(localStorage.getItem('wss_working_bundle'))`;
const field = (n, what) => `${root} input[aria-label="Target ${n} ${what}"]`;
const share = n => field(n, 'executed spending share (% of GDP)');
const year = n => field(n, 'effective year');
const clickText = async (text, selector='button') => {
  await e(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});
    if(!node)throw new Error('Missing control: '+${JSON.stringify(text)});node.click();})()`);
};
const set = async (selector, value) => {
  await e(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});
    node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(70);
};
const stored = async () => { await sleep(950); return e(`${session}.inputs.water_interventions`); };
const openSpending = async () => {
  await w(`[...document.querySelectorAll('label')].some(n=>n.textContent.trim()==='Increase in Public Spending')`, 'Spending toggle missing');
  await e(`(()=>{const label=[...document.querySelectorAll('label')].find(n=>n.textContent.trim()==='Increase in Public Spending');
    const button=label.parentElement.querySelector('button');if(button?.textContent.includes('Show'))button.click();})()`);
};
const apiResult = async () => e(`fetch('/api/calculate',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(${session}.inputs)}).then(r=>r.json())`);
try {
  const seed = await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))});
    localStorage.setItem('wss_development_preview_revision',${JSON.stringify(preview.revision || '')});
    localStorage.setItem('wss_mock_setup_revision',${JSON.stringify(preview.mock_setup_revision || '')});` });
  await b.call('Page.navigate', { url });
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App did not start');
  await b.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: seed.identifier });
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[2].click()`);
  await openSpending();
  await w(`!!document.querySelector('${root}')`, 'Spending editor missing');
  assert.equal((await stored()).fin_gdp_targets, undefined, 'Loading must retain legacy contract');
  assert.equal((await apiResult()).water_supply.scenario_financial_commitment_cash.reduce((a,b)=>a+b,0), 0);
  await set(share(1), '0.50');
  assert.deepEqual((await stored()).fin_gdp_targets, [{ year: 2026, target_share: .005 }]);
  const result = await apiResult();
  assert.equal(result.water_supply.scenario_financial_commitment_cash[result.years.indexOf(2026)], -.5);
  await clickText('Add target and year');
  await w(`document.querySelectorAll('${root} [data-spending-target-row]').length===2`, 'Add failed');
  assert.equal(await e(`document.querySelector('${year(2)}').value`), '2027');
  await set(share(2), '0');
  await set(year(2), '2031');
  let valid = (await stored()).fin_gdp_targets;
  assert.deepEqual(valid, [{ year: 2026, target_share: .005 }, { year: 2031, target_share: 0 }]);
  await set(year(2), '2026');
  assert.ok(await e(`document.querySelector('${root} [role=alert]').textContent.includes('duplicated')`));
  assert.deepEqual((await stored()).fin_gdp_targets, valid, 'Invalid draft must preserve last valid schedule');
  assert.ok((await apiResult()).sector_errors.water_supply, 'Invalid draft must not calculate stale targets');
  await set(year(2), '');
  assert.ok(await e(`!!document.querySelector('${root} [role=alert]')`));
  // Turning off only the GDP option must suppress the error without discarding the draft.
  const gdpToggle = `[...document.querySelectorAll('label')].find(n=>n.textContent.trim()==='Target executed spending as a share of GDP').querySelector('input')`;
  await e(`${gdpToggle}.click()`);
  await sleep(950);
  assert.equal((await apiResult()).sector_errors?.water_supply, undefined);
  await e(`${gdpToggle}.click()`);
  await w(`!!document.querySelector('${root} [role=alert]')`, 'Draft was lost across toggle');
  await set(year(2), '2031');
  await set(share(2), '-1');
  assert.ok(await e(`!!document.querySelector('${root} [role=alert]')`));
  await set(share(2), '0');
  // Area and sector changes do not adopt or overwrite the other area's legacy settings.
  await clickText('rural', '.wb-scope-option');
  await w(`!!document.querySelector('${root}') && !document.querySelector('${root} [role=alert]')`, 'Rural editor missing');
  assert.equal(await e(`document.querySelectorAll('${root} [data-spending-target-row]').length`), 1);
  await clickText('urban', '.wb-scope-option');
  await w(`document.querySelectorAll('${root} [data-spending-target-row]').length===2`, 'Urban rows lost');
  await clickText('Sanitation');
  await openSpending();
  await w(`!!document.querySelector('[data-public-spending-schedule="sanitation_interventions"]')`, 'Sanitation editor missing');
  await clickText('Water Supply');
  await openSpending();
  await w(`document.querySelectorAll('${root} [data-spending-target-row]').length===2`, 'Water rows lost');
  // Save using the real UI/API and reload this disposable profile.
  await e(`window.prompt=()=>${JSON.stringify(name)};window.alert=()=>{}`);
  await clickText('Save Profile');
  await w(`[...document.querySelector('.wb-profile-select').options].some(o=>o.value===${JSON.stringify(name)})`, 'Profile save failed');
  const saved = await (await fetch(`${url}/api/profiles/${name}`)).json();
  assert.deepEqual(saved.inputs.water_interventions.fin_gdp_targets, valid);
  assert.equal(saved.altInputs.rural.water_interventions.fin_gdp_targets, undefined);
  await e(`document.querySelector('${root} button[aria-label="Remove target 2"]').click()`);
  assert.deepEqual((await stored()).fin_gdp_targets, [valid[0]], 'Removing extra rows must retain signed semantics');
  await e(`(()=>{const select=document.querySelector('.wb-profile-select');select.value=${JSON.stringify(name)};
    select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`document.querySelectorAll('${root} [data-spending-target-row]').length===2`, 'Profile reload lost rows');
  assert.deepEqual((await stored()).fin_gdp_targets, valid, 'Wait for the debounced session save before reload');
  await b.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'Session reload failed');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[2].click()`);
  await openSpending();
  await w(`document.querySelectorAll('${root} [data-spending-target-row]').length===2`, 'Working session lost rows');
  await e(`document.querySelector('${root}').scrollIntoView({block:'center'})`);
  writeFileSync('/tmp/public-spending-desktop.png', Buffer.from((await b.call('Page.captureScreenshot', {format:'png'})).data,'base64'));
  await b.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await e(`(()=>{const guide=document.querySelector('.wb-guide-toggle');if(guide?.textContent.includes('Close'))guide.click();})()`);
  await e(`document.querySelector('${root}').scrollIntoView({block:'center'})`);
  await sleep(250);
  writeFileSync('/tmp/public-spending-mobile.png', Buffer.from((await b.call('Page.captureScreenshot', {format:'png'})).data,'base64'));
  console.log('Mobile editor dimensions:', await e(`(()=>{const n=document.querySelector('${root}'),r=n.getBoundingClientRect();return {width:r.width,scroll:n.scrollWidth,viewport:innerWidth};})()`));
  assert.ok(await e(`(()=>{const r=document.querySelector('${root}').getBoundingClientRect();
    return r.width>0 && r.width<=390 && document.querySelector('${root}').scrollWidth<=r.width+1;})()`), 'Editor overflows on mobile');
  writeFileSync('/tmp/public-spending-mobile.png', Buffer.from((await b.call('Page.captureScreenshot', {format:'png'})).data,'base64'));
  assert.deepEqual(b.errors, []);
  console.log('PASS: legacy adoption, signed cash, add/edit/remove, duplicate/blank/negative validation, disabled drafts, sector/area isolation, real profile and session round trips, desktop/mobile layout.');
} finally {
  b.close();
  await fetch(`${url}/api/profiles/${name}`, {method:'DELETE'});
}
