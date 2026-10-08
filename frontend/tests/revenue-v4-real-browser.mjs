// Real-engine integration using a copied DRC fixture and a fresh Chromium storage partition.
// Never changes server profiles, mocks responses, rebuilds, or restarts the workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const bundle = JSON.parse(readFileSync(new URL('../../profiles/DRC Mock Simulation Oct 6.json', import.meta.url), 'utf8'));
const previewResponse = await fetch(`${url}/api/development-preview`);
const preview = previewResponse.ok ? await previewResponse.json() : {};
bundle.presentation = { ...(bundle.presentation || {}), currencyDisplay: {
  mode: 'local', sourceCurrency: 'CDF', cdfPerUsd: null,
} };
const areaInputs = [bundle.inputs, bundle.altInputs.rural];
const shares = [[.5, .9, .4, .8], [.2, .7, 0, .6]];
for (let index = 0; index < areaInputs.length; index++) {
  const input = areaInputs[index];
  input.connection_revenue = { ...(input.connection_revenue || {}),
    water: { ...(input.connection_revenue?.water || {}), version: 5, method: 'aggregate_coverage_expansion',
      enabled: true, new_billed_share_basic: shares[index][0], new_billed_share_sm: shares[index][1] },
    sanitation: { version: 5, method: 'aggregate_coverage_expansion', enabled: true,
      new_billed_share_basic: shares[index][2], new_billed_share_sm: shares[index][3], shared_assumption_note: '' },
  };
  input.toggles = { ...input.toggles, ws_connections_enabled: true, san_connections_enabled: true,
    ws_collection_efficiency_enabled: true, ws_tariff_enabled: true, ws_nrw_enabled: true,
    san_collection_efficiency_enabled: true, san_tariff_enabled: true, san_nrw_link_enabled: true };
  for (const sector of ['water', 'sanitation']) {
    input.utility_debt[sector] = { enabled: true, schema_version: 2, mode: 'indicative_lump_sum',
      allocation_share: .35, annual_real_interest_rate: .05, loan_term_years: 10,
      disbursement_year: input.period.baseline_year + 5, revenue_sources: ['connections', 'nrw'] };
  }
}

async function post(path, input) {
  const response = await fetch(`${url}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), cache: 'no-store' });
  const data = await response.json();
  assert.ok(response.ok, `${path} returned ${response.status}: ${JSON.stringify(data).slice(0, 1200)}`);
  return data;
}
const sectorKey = sector => sector === 'water' ? 'water_supply' : 'sanitation';
const connectionStatus = (data, sector) => data?.[sector]?.connection ?? data?.[sector]?.connection_revenue;
const close = (actual, expected, label) => {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${label}: missing finite value (${actual})`);
  assert.ok(Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
};
const withoutDebt = input => ({ ...input, utility_debt: { ...input.utility_debt,
  water: { ...input.utility_debt.water, enabled: false }, sanitation: { ...input.utility_debt.sanitation, enabled: false } } });

// Main owns restart. Wait for its real v5 endpoint rather than starting anything here.
let resolution;
let readinessError = '';
for (let attempt = 0; attempt < Number(process.env.BACKEND_WAIT_ATTEMPTS || 80); attempt++) {
  try {
    resolution = await post('revenue-bases', areaInputs[0]);
    const status = connectionStatus(resolution, 'water');
    if (status?.configuration?.version === 5 && status?.calibration?.baseline_coverage != null && status?.effective === true) break;
  } catch (error) { readinessError = error.message; }
  await sleep(1500);
}
assert.equal(connectionStatus(resolution, 'water')?.effective, true,
  `Real backend v5 is not ready or DRC assumptions are incomplete: ${readinessError || JSON.stringify(resolution)}`);
assert.ok(connectionStatus(resolution, 'water')?.calibration?.baseline_coverage > 0);

function reconcile(result, input, sector, label) {
  const sec = result[sectorKey(sector)];
  assert.equal(sec.scenario_revenue_reconciliation.version, 4, `${label}: reconciliation version`);
  for (let i = 0; i < result.years.length; i++) {
    const connections = sec.scenario_connection_net_cash[i];
    const nrw = sector === 'water' ? sec.scenario_nrw_net[i] : sec.scenario_eligible_nrw_link_cash[i];
    const collection = sec.scenario_collection_cash[i], tariff = sec.scenario_tariff_cash[i];
    const sourceTotal = connections + nrw + collection + tariff;
    close(sec.scenario_additional_net_cash[i], sourceTotal, `${label}/${result.years[i]} source total`);
    close(sec.scenario_connection_revenue_delta[i], connections, `${label}/${result.years[i]} connection alias`);
    const avoided = sec.scenario_nrw_avoided_cost_cash?.[i] || 0;
    const cost = sec.scenario_nrw_implementation_cost?.[i] || 0;
    close(sourceTotal, sec.scenario_collected_revenue[i] - sec.scenario_reference_collected_revenue[i] + avoided - cost,
      `${label}/${result.years[i]} common cash identity`);
  }
  const loan = sec.scenario_utility_debt;
  const referenceIndex = result.years.indexOf(input.utility_debt[sector].disbursement_year);
  assert.ok(referenceIndex >= 0);
  return { sec, loan, referenceIndex };
}
const realResults = [];
for (let areaIndex = 0; areaIndex < areaInputs.length; areaIndex++) {
  const input = areaInputs[areaIndex];
  const status = await post('revenue-bases', input);
  for (const sector of ['water', 'sanitation']) {
    const connection = connectionStatus(status, sector);
    assert.equal(connection.effective, true, `Area ${areaIndex} ${sector}: feature unexpectedly incomplete`);
    assert.deepEqual(connection.errors, [], 'No historical calibration/cost/funding gates may remain');
  }
  const financed = await post('calculate', input);
  const frozen = await post('calculate', withoutDebt(input));
  realResults.push(financed);
  for (const sector of ['water', 'sanitation']) {
    const { loan, referenceIndex } = reconcile(financed, input, sector, `${areaIndex}/${sector}`);
    reconcile(frozen, input, sector, `${areaIndex}/${sector}/no-loan`);
    const unfinanced = frozen[sectorKey(sector)];
    const expectedConnections = unfinanced.scenario_connection_net_cash[referenceIndex];
    const expectedNrw = sector === 'water' ? unfinanced.scenario_nrw_net[referenceIndex]
      : unfinanced.scenario_eligible_nrw_link_cash[referenceIndex];
    close(loan.reference_source_cash.connections, expectedConnections, `${areaIndex}/${sector}: frozen connections`);
    close(loan.reference_source_cash.nrw, expectedNrw, `${areaIndex}/${sector}: frozen NRW`);
    const signedPool = expectedConnections + expectedNrw;
    close(loan.selected_signed_pool, signedPool, `${areaIndex}/${sector}: signed pool`);
    close(loan.eligible_pool, Math.max(0, signedPool), `${areaIndex}/${sector}: one floor`);
    close(loan.annual_allocation, .35 * Math.max(0, signedPool), `${areaIndex}/${sector}: allocation`);
    const annuity = (1 - Math.pow(1.05, -10)) / .05;
    close(loan.indicative_principal ?? loan.accepted_principal, loan.annual_allocation * annuity,
      `${areaIndex}/${sector}: frozen loan principal`);
  }
}

// Selecting an inactive source must not silently enable the feature or produce loan proceeds.
const inactive = structuredClone(areaInputs[0]);
inactive.connection_revenue.water.enabled = false;
inactive.toggles.ws_connections_enabled = false;
inactive.utility_debt.water.revenue_sources = ['connections'];
const inactiveStatus = connectionStatus(await post('revenue-bases', inactive), 'water');
assert.equal(inactiveStatus.requested, false);
assert.equal(inactiveStatus.effective, false);
assert.equal(inactiveStatus.state, 'off');
const inactiveResult = await post('calculate', inactive);
assert.ok(inactiveResult.water_supply.scenario_connection_net_cash.every(value => value === 0));
close(inactiveResult.water_supply.scenario_utility_debt.reference_source_cash.connections, 0, 'Disabled selected source');
close(inactiveResult.water_supply.scenario_utility_debt.accepted_principal, 0, 'Inactive-source principal');
const incomplete = structuredClone(areaInputs[0]);
incomplete.connection_revenue.water.new_billed_share_basic = null;
const incompleteStatus = connectionStatus(await post('revenue-bases', incomplete), 'water');
assert.equal(incompleteStatus.requested, true);
assert.equal(incompleteStatus.effective, false);
assert.equal(incompleteStatus.state, 'incomplete');
assert.ok(incompleteStatus.errors.some(error => /basic/i.test(error)));
console.log('Real DRC API: urban/rural water/sanitation source identities, signed pools, frozen connections loans, inactive/missing source states passed.');

const browser = await openChromium('about:blank');
const { evaluate: e, waitFor: w } = browser;
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('wss_real_revenue_fixture')) {
      localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(bundle))});
      localStorage.setItem('wss_development_preview_revision', ${JSON.stringify(preview.revision || '')});
      localStorage.setItem('wss_mock_setup_revision', ${JSON.stringify(preview.mock_setup_revision || '')});
      localStorage.setItem('wss_real_revenue_fixture', '1');
    }
    window.__realRevenueCalls = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => originalFetch(url, options).then(async response => {
      if (String(url).includes('/api/calculate') || String(url).includes('/api/revenue-bases')) {
        const data = await response.clone().json().catch(() => null);
        window.__realRevenueCalls.push({ url: String(url), input: options?.body ? JSON.parse(options.body) : null,
          status: response.status, data });
      }
      return response;
    });
  ` });
  await browser.call('Page.navigate', { url });
  const form = `document.querySelector('[data-testid="connection-revenue"]')`;
  const tab = async index => {
    await e(`document.querySelectorAll('.wb-tab')[${index}].click()`);
    await sleep(350);
  };
  const button = async text => {
    await e(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
    await sleep(300);
  };
  const formValue = () => e(`${form}.querySelector('[aria-label="Basic expansion billed (%)"]').value`);
  const waitActive = () => w(`${form}?.querySelector('[role="status"]').textContent === 'Active'`, 'Actual connection form not active');
  await w(`!!document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger')`, 'DRC Data Inputs did not load');
  await e(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  await waitActive();
  assert.equal(await formValue(), '50');
  assert.equal(await e(`${form}.querySelectorAll('input').length`), 4);
  assert.equal(await e(`/Advanced|zero-cost|operating-expenditure/.test(${form}.textContent)`), false);
  assert.equal(await e(`${form}.textContent.includes('m³/reference served-household equivalent')`), true);
  await button('rural');
  await waitActive();
  assert.equal(await formValue(), '20', 'Rural water does not share urban water values');
  await button('Sanitation');
  await waitActive();
  assert.equal(await formValue(), '0', 'Rural sanitation preserves explicit zero');
  await button('urban');
  await waitActive();
  assert.equal(await formValue(), '40', 'Urban sanitation is independently stored');
  await button('Water Supply');
  await waitActive();
  assert.equal(await formValue(), '50');

  // Choose single urban scope so rendered revenue table can be compared with one exact real response.
  await e(`(() => { const s = document.querySelector('.wb-scope-select'); s.value = 'urban';
    s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await tab(2);
  await waitActive();
  await w(`!!document.querySelector('[data-testid="revenue-source-chart"] tbody tr')`, 'Real revenue table missing');
  const lastLedger = await e(`(() => {
    const call = [...window.__realRevenueCalls].reverse().find(c => c.url.includes('/api/calculate') &&
      c.status === 200 && c.input.connection_revenue?.water?.enabled &&
      c.input.toggles?.ws_nrw_enabled && c.input.toggles?.ws_tariff_enabled &&
      c.input.toggles?.ws_collection_efficiency_enabled && !c.input.utility_debt?.water?.enabled);
    return call?.data;
  })()`);
  assert.ok(lastLedger, 'Real final-scenario ledger response was not observed');
  const displayed = await e(`[...document.querySelectorAll('[data-testid="revenue-source-chart"] tbody tr')]
    .map(tr => [...tr.children].map(td => td.textContent.trim()))`);
  for (const row of displayed) {
    const index = lastLedger.years.indexOf(Number(row[0]));
    const sec = lastLedger.water_supply;
    const expected = [sec.scenario_connection_net_cash[index], sec.scenario_nrw_net[index],
      sec.scenario_collection_cash[index], sec.scenario_tariff_cash[index]];
    expected.push(expected.reduce((sum, value) => sum + value, 0));
    expected.forEach((value, field) => {
      const rendered = Number(row[field + 1].replace(/,/g, '').replace(/−/g, '-'));
      assert.ok(Math.abs(rendered - value) <= .000051, `Table ${row[0]} source ${field} differs from final real ledger`);
    });
  }

  await tab(3);
  await w(`document.querySelector('[data-testid="indicative-principal"]')?.textContent !== '—' &&
    !!document.querySelector('[aria-label="Eligible source: Revenue from new connections"]')`, 'Real loan preview unavailable');
  assert.equal(await e(`document.querySelector('[aria-label="Eligible source: Revenue from new connections"]').checked`), true);
  assert.equal(await e(`document.body.textContent.includes('fixed annual obligations modeled')`), true);
  // Turning off the connection feature in its shared form leaves the loan source selected but inactive.
  await tab(2);
  await e(`${form}.querySelector('input[type=checkbox]').click()`);
  await w(`${form}.querySelector('[role="status"]').textContent === 'Off'`, 'Feature did not turn off');
  await tab(3);
  await w(`(() => {
    const call = [...window.__realRevenueCalls].reverse().find(c => c.url.includes('/api/calculate') && c.status === 200 &&
      c.input.connection_revenue?.water?.enabled === false && c.input.utility_debt?.water?.enabled === true);
    return call?.data?.water_supply?.scenario_utility_debt?.reference_source_cash?.connections === 0;
  })()`, 'Inactive selected connection source was not zero in real preview');
  assert.equal(await e(`document.querySelector('[aria-label="Eligible source: Revenue from new connections"]').checked`), true);
  assert.equal(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.connection_revenue.water.enabled`), false,
    'Loan selection must not re-enable underlying connections');
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  const badCalls = await e(`window.__realRevenueCalls.filter(c => c.status >= 400).map(c => ({url:c.url,status:c.status,data:c.data}))`);
  assert.deepEqual(badCalls, [], 'Real DRC browser flow returned API errors');
  console.log('Real Chromium DRC: actual four-control form, area/service switching, exact final-ledger table values, frozen loan preview and selected inactive connection source passed; no API mocks/profile writes.');
} catch (error) {
  console.error('Real browser integration diagnostic:', await e(`({
    form: document.querySelector('[data-testid="connection-revenue"]')?.textContent,
    stored: JSON.parse(localStorage.getItem('wss_working_bundle') || '{}').inputs?.connection_revenue,
    latest: window.__realRevenueCalls?.filter(c => c.url.includes('/api/revenue-bases')).slice(-2).map(c => ({
      status: c.status, connection: c.data?.water?.connection, input: c.input?.connection_revenue
    })),
    errors: window.__realRevenueCalls?.filter(c => c.status >= 400).slice(-2),
  })`));
  throw error;
} finally { browser.close(); }
