// Focused browser regression for v1/v2 -> v3 migration and the simplified controls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL is required');
const fixture = JSON.parse(readFileSync('/tmp/connection-revenue-browser-bundle.json', 'utf8'));
const input = fixture.inputs;
input.connection_revenue.water.enabled = true;
input.country_config = {
  ...(input.country_config || {}),
  area: input.country_config?.area || 'River District',
  currency: input.country_config?.currency || 'lcu',
};
input.water_interventions = {
  ...(input.water_interventions || {}),
  tariff_op_expenditure: 84_000,
  tariff_op_expenditure_reference_year: Number(input.period?.baseline_year),
  tariff_op_expenditure_currency_basis: 'real_raw',
};
const expectedArea = String(input.country_config.area).trim().toLowerCase();
const expectedCurrency = String(input.country_config.currency).trim().toUpperCase();
const expectedYear = Number(input.period?.baseline_year);
const browser = await openChromium(url);
async function enterInput(selector, value) {
  await browser.evaluate(`(()=>{
    const el=${selector};
    const prototype=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(40);
}
try {
  await browser.waitFor(`!!document.querySelector('.wb-app')`, 'Application did not load');
  // First-visit profile rollout is asynchronous; let it settle before importing the fixture.
  await sleep(1000);
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__revenueBodies=[];
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,init={})=>{
      if(String(input).includes('/api/revenue-bases')&&init.body) {
        try { window.__revenueBodies.push(JSON.parse(init.body)); } catch {}
      }
      return originalFetch(input,init);
    };
  ` });
  await browser.evaluate(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(fixture))})`);
  await browser.call('Page.reload');
  const section = `document.querySelector('section[aria-label^="Connection-based revenue"]')`;
  await browser.waitFor(`!!document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger')`, 'Revenue section missing');
  await browser.evaluate(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  await browser.waitFor(`!!${section}`, 'Connection revenue panel missing');

  const legacy = fixture.inputs?.connection_revenue?.water ?? fixture.inputs?.connection_revenue?.sanitation;
  assert.ok(legacy && legacy.version < 3, 'Fixture must exercise a legacy connection-revenue migration');
  await browser.waitFor(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]').value===${JSON.stringify(String(legacy.billed_share_basic * 100))}`,
    'Imported legacy billing settings did not finish loading');
  assert.equal(await browser.evaluate(`${section}.querySelector('[aria-label="Cost source"]').value`), 'per_m3');
  assert.ok(await browser.evaluate(`${section}.querySelector('[aria-label="Annual operating cost per billed household"]') == null`),
    'Per-m³ migration should show a converted read-only annual cost, not an independent manual amount');
  const basicPercent = await browser.evaluate(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]').value`);
  assert.equal(Number(basicPercent), Number(legacy.billed_share_basic) * 100,
    'Legacy zero/nonzero baseline Basic share should seed future Basic billing');

  await enterInput(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]')`, '42.5');
  await enterInput(`${section}.querySelector('[aria-label="Source / assumption note"]')`, 'Explicit browser-test future billing assumption');
  await browser.waitFor(`(()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle')||'{}');
    return [b.inputs,...Object.values(b.altInputs||{})].some(i=>i?.connection_revenue?.water?.version===3&&i.connection_revenue.water.new_billed_share_basic===0.425);
  })()`, 'Edited percentage was not saved as a v3 fraction');
  const sm = section + `.querySelector('[aria-label="New Safely Managed connections billed (%)"]')`;
  const oldSm = await browser.evaluate(`${sm}.value`);
  await enterInput(sm, '');
  await browser.waitFor(`${section}.querySelector('[role="alert"]')?.textContent.includes('New Safely Managed connections billed is required')`,
    'Blank new-connection percentage must be disclosed as missing, not interpreted as zero');
  await enterInput(sm, oldSm);

  await browser.evaluate(`${section}.querySelector('[aria-label="Cost source"]').value='annual_household';${section}.querySelector('[aria-label="Cost source"]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await browser.waitFor(`${section}.querySelector('[aria-label="Annual operating cost per billed household"]')?.type==='number'`,
    'Manual annual cost field did not render');
  await enterInput(`${section}.querySelector('[aria-label="Annual operating cost per billed household"]')`, '0');
  await browser.waitFor(`${section}.textContent.includes('confirm zero cost')`, 'Zero confirmation should be shown only for selected zero cost');
  await browser.waitFor(`(()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle')||'{}');
    return [b.inputs,...Object.values(b.altInputs||{})].some(i=>i?.connection_revenue?.water?.version===3&&i.connection_revenue.water.cost_basis==='annual_household'&&i.connection_revenue.water.annual_cost_per_household===0);
  })()`, 'Cost-basis change and explicit zero must persist');
  await browser.evaluate(`${section}.querySelector('[aria-label="Cost source"]').value='expenditure_proxy';${section}.querySelector('[aria-label="Cost source"]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await browser.waitFor(`${section}.querySelector('button') && [...${section}.querySelectorAll('button')].some(b=>b.textContent.includes('Estimate from existing operating expenditure'))`,
    'Operating expenditure proxy controls did not render');
  await browser.evaluate(`(()=>{
    const button=[...${section}.querySelectorAll('button')].find(b=>b.textContent.includes('Estimate from existing operating expenditure'));
    if(button.disabled)throw Error('Compatible expenditure source was not accepted');
    button.click();
  })()`);
  await browser.waitFor(`!!${section}.querySelector('[aria-label="Household cost allocation percent"]')`, 'Explicit proxy allocation field missing');
  await enterInput(`${section}.querySelector('[aria-label="Household cost allocation percent"]')`, '40');
  await browser.waitFor(`(()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle')||'{}');
    return [b.inputs,...Object.values(b.altInputs||{})].some(i=>{
      const p=i?.connection_revenue?.water?.cost_proxy;
      return i?.connection_revenue?.water?.version===3&&p?.expenditure===84000&&p?.household_allocation===0.4&&p?.baseline_year===${expectedYear}&&p?.area===${JSON.stringify(expectedArea)}&&p?.currency===${JSON.stringify(expectedCurrency)}&&p?.currency_basis==='real_raw'&&p?.allocation_confirmed===true;
    });
  })()`, 'Proxy snapshot did not persist the normalized adapter scope');
  await sleep(700);
  assert.equal(await browser.evaluate(`(()=>{
    const body=window.__revenueBodies.at(-1);
    const proxy=body?.connection_revenue?.water?.cost_proxy;
    return proxy?.expenditure===84000&&proxy?.household_allocation===0.4&&proxy?.baseline_year===${expectedYear}&&proxy?.area===${JSON.stringify(expectedArea)}&&proxy?.currency===${JSON.stringify(expectedCurrency)}&&proxy?.currency_basis==='real_raw'&&proxy?.allocation_confirmed===true;
  })()`), true, 'POST /api/revenue-bases did not carry the exact validated source snapshot');
  assert.ok(browser.errors.length === 0, JSON.stringify(browser.errors));
  console.log('Connection revenue v3: migration, percentage conversion, blank disclosure, cost basis, zero confirmation and saved state passed.');
} finally {
  browser.close();
}
