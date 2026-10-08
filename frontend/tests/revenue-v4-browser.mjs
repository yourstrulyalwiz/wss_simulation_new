// Isolated Chromium frontend contract test. No server profiles or user's browser storage are changed.
// Model equations are tested separately by the backend suite; responses here exercise the v4/v3 UI contract.
import assert from 'node:assert/strict';
import { openChromium, sleep } from './chromium-client.mjs';
const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const get = async path => (await fetch(`${url}${path}`)).json();
const defaults = await get('/api/defaults');
const post = async (path, inputs) => (await fetch(`${url}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs),
})).json();
const bases = await post('/api/revenue-bases', defaults);
const model = await post('/api/calculate', defaults);
assert.ok(model.years, 'Default backend fixture must calculate before testing the UI contract');
const input = structuredClone(defaults);
input.country_config.area = 'Urban contract test';
input.profile_metadata = { status: 'mock_simulation' };
input.connection_revenue = {
  water: { version: 3, enabled: false, new_billed_share_basic: 0, new_billed_share_sm: .9, marginal_cost: .5 },
  sanitation: { version: 4, method: 'aggregate_coverage_expansion', enabled: false,
    new_billed_share_basic: .3, new_billed_share_sm: .6, shared_assumption_note: '' },
};
input.revenue_bases = { water: bases.water.base, sanitation: bases.sanitation.base };
input.utility_debt = { water: { enabled: false, schema_version: 2, mode: 'indicative_lump_sum',
  revenue_sources: ['collection', 'nrw'], allocation_share: .35, annual_real_interest_rate: .04,
  disbursement_year: input.period.baseline_year + 2, loan_term_years: 12 }, sanitation: { enabled: false } };
const rural = structuredClone(input);
rural.country_config.area = 'Rural contract test';
rural.connection_revenue.water.new_billed_share_basic = .2;
const bundle = { __wss_bundle: 1, inputs: input, altInputs: { rural }, scope: {
  scopeMode: 'urban_rural', areaUrban: true, areaRural: true,
} };
const browser = await openChromium('about:blank');
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(bundle))});
    window.__revenueRequests = [];
    const originalFetch = window.fetch.bind(window);
    const baseFixture = ${JSON.stringify(bases)};
    const modelFixture = ${JSON.stringify(model)};
    window.fetch = async (url, options = {}) => {
      if (String(url).includes('/api/development-preview')) return new Response('{}', {status: 200});
      if (String(url).includes('/api/revenue-bases')) {
        const inputs = JSON.parse(options.body);
        window.__revenueRequests.push(inputs);
        const data = structuredClone(baseFixture);
        for (const sector of ['water', 'sanitation']) {
          const config = inputs.connection_revenue?.[sector] || {};
          const errors = config.enabled && config.new_billed_share_basic == null ? ['Basic expansion billed is required.'] : [];
          data[sector].connection = { configuration: config, version: 4,
            requested: !!config.enabled, effective: !!config.enabled && !errors.length,
            state: errors.length ? 'incomplete' : config.enabled ? 'effective' : 'off', errors,
            calibration: { baseline_coverage: .6, baseline_basic_share: .4, baseline_sm_share: .2,
              baseline_volume_million_m3: 1.2, baseline_tariff: 2, baseline_collection_ratio: .8,
              aggregate_volume_proxy_m3: 200, original_volume_mld: 3.28767, reference_year: 2025 } };
        }
        return new Response(JSON.stringify(data), {status: 200});
      }
      if (String(url).includes('/api/calculate')) {
        const inputs = JSON.parse(options.body), data = structuredClone(modelFixture);
        for (const [sector, key, prefix] of [['water', 'water_supply', 'ws'], ['sanitation', 'sanitation', 'san']]) {
          const sec = data[key];
          sec.scenario_revenue_reconciliation = {version: 3};
          sec.connection_revenue = {version: 4, requested: !!inputs.connection_revenue?.[sector]?.enabled,
            effective: !!inputs.connection_revenue?.[sector]?.enabled};
          for (const [field, value] of [['connection_net_cash', inputs.connection_revenue?.[sector]?.enabled ? .1184 : 0],
            ['collection_cash', inputs.toggles?.[prefix + '_collection_efficiency_enabled'] ? .026 : 0],
            ['tariff_cash', inputs.toggles?.[prefix + '_tariff_enabled'] ? .117 : 0],
            ['nrw_net', inputs.toggles?.ws_nrw_enabled ? -.03 : 0], ['eligible_nrw_link_cash', 0]]) {
            sec['scenario_' + field] = data.years.map(() => value);
          }
        }
        return new Response(JSON.stringify(data), {status: 200});
      }
      return originalFetch(url, options);
    };
  ` });
  await browser.call('Page.navigate', { url });
  await browser.waitFor(`!!document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger')`, 'Data Inputs did not load');
  await browser.evaluate(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  const section = `document.querySelector('[data-testid="connection-revenue"]')`;
  await browser.waitFor(`!!${section}`, 'Connection form did not load');
  assert.equal(await browser.evaluate(`${section}.querySelector('[aria-label="Basic expansion billed (%)"]').value`), '0');
  assert.equal(await browser.evaluate(`${section}.querySelectorAll('input').length`), 4, 'Only toggle, 2 shares, and optional note');
  assert.equal(await browser.evaluate(`/Advanced|zero-cost|operating-expenditure/.test(${section}.textContent)`), false);
  const enter = async (label, value) => {
    await browser.evaluate(`(() => {
      const el = ${section}.querySelector('[aria-label="${label}"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(150);
  };
  await enter('Basic expansion billed (%)', '50');
  await browser.evaluate(`${section}.querySelector('input[type="checkbox"]').click()`);
  await browser.waitFor(`${section}.querySelector('[role="status"]').textContent === 'Active'`, 'Feature was not confirmed active');
  await browser.waitFor(`window.__revenueRequests.at(-1)?.connection_revenue?.water?.new_billed_share_basic === .5`, '50% did not store .50');
  assert.equal(await browser.evaluate(`window.__revenueRequests.at(-1).connection_revenue.water.version`), 4);
  assert.equal(await browser.evaluate(`window.__revenueRequests.at(-1).connection_revenue.water.marginal_cost`), undefined);
  await enter('Basic expansion billed (%)', '');
  await browser.waitFor(`${section}.textContent.includes('Incomplete')`, 'Cleared shares should be incomplete');
  await enter('Basic expansion billed (%)', '0');
  await browser.waitFor(`${section}.querySelector('[role="status"]').textContent === 'Active'`, 'Explicit zero did not reactivate');
  const tab = async name => {
    await browser.evaluate(`[...document.querySelectorAll('.wb-tab-nav button')].find(b =>
      b.textContent.replace(/\\s/g, '').endsWith(${JSON.stringify(name.replace(/\s/g, ''))})).click()`);
    await sleep(350);
  };
  await tab('Intervention Design');
  await browser.waitFor(`!!${section}`, 'Shared form missing in Intervention Design');
  assert.equal(await browser.evaluate(`${section}.querySelector('[aria-label="Basic expansion billed (%)"]').value`), '0');
  await browser.waitFor(`!!document.querySelector('[data-testid="revenue-source-chart"] table')`, 'Revenue source table missing');
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid="revenue-source-chart"]').textContent.includes('Revenue from new connections')`), true);
  // Shared per-service form retains independent values while changing sector.
  await browser.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sanitation').click()`);
  await browser.waitFor(`${section}.querySelector('[aria-label="Basic expansion billed (%)"]').value === '30'`, 'Sanitation assumptions were not retained');
  await browser.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Water Supply').click()`);
  await browser.waitFor(`${section}.querySelector('[aria-label="Basic expansion billed (%)"]').value === '0'`, 'Water assumptions were overwritten');
  // NRW sales scope is hidden (not merely disabled) when production costs value recovery.
  await browser.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(el => el.textContent.trim() === 'NRW reduction');
    label?.querySelector('input')?.click();
    const row = label?.parentElement;
    if (row) [...row.querySelectorAll('button')].find(b => b.textContent.includes('Show'))?.click();
  })()`);
  await browser.waitFor(`!![...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'production'))`, 'NRW details did not open');
  await browser.evaluate(`(() => {
    const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'production'));
    select.value = 'production'; select.dispatchEvent(new Event('change', {bubbles: true}));
  })()`);
  assert.equal(await browser.evaluate(`!![...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'all_recovered_sold'))`), false,
    'Sales-only scope must be hidden in avoided-production-cost mode');
  assert.equal(await browser.evaluate(`document.body.textContent.includes('Legacy NRW-only tariff (retained)')`), false);
  await browser.waitFor(`document.querySelector('[data-testid="revenue-source-chart"]').textContent.includes('-0.03')`, 'Signed negative NRW cash was not rendered');
  await tab('Loan funding');
  await browser.waitFor(`!!document.querySelector('[aria-label="Eligible source: Revenue from new connections"]')`, 'Connection loan source missing');
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Eligible source: Revenue from new connections"]').checked`), false, 'Legacy loan selection cannot acquire new source');
  await browser.evaluate(`document.querySelector('[aria-label="Eligible source: Revenue from new connections"]').click()`);
  await sleep(500);
  assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Eligible source: Revenue from new connections"]').checked`), true);
  assert.equal(await browser.evaluate(`document.body.textContent.includes('repayment accounting deferred')`), true);
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log('Isolated browser v4/v3 contract: Data Inputs → Intervention Design → Loan Funding, migration, percentage conversion/zeros, incomplete status, shared form, final-source table and preserved loan selection passed.');
} finally { browser.close(); }
