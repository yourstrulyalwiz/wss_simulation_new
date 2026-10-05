// Real Chromium checks via its built-in DevTools pipe; no browser-test packages.
// Run: APP_URL=https://<development-host> node frontend/tests/workbook-preview-browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.env.APP_URL;
const mockMode = process.env.CHECK_MOCK_SCENARIO === '1';
assert.ok(url, 'APP_URL must identify the development app.');
const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
const pending = new Map();
const browserErrors = [];
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
});
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
  const previous = { __wss_bundle: 1, inputs: { retainedOriginalSession: true },
    altInputs: { rural: { retainedOriginalArea: true } }, scope: { areaRural: true } };
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    `${mockMode ? '' : "localStorage.setItem('wss_mock_setup_revision', 'drc-mock-inputs-2309.58-v1');"}
    if (!localStorage.getItem('wss_development_preview_revision')) {
      localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(previous))});
    }` }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.body?.textContent?.includes(${JSON.stringify(mockMode ? 'DRC mock simulation' : 'DRC spreadsheet data preview')}) || false`)) break;
    await sleep(200);
  }
  if (!mockMode) {
  let state = await evaluate(`({
    working: JSON.parse(localStorage.getItem('wss_working_bundle')),
    saved: JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]'),
    revision: localStorage.getItem('wss_development_preview_revision')
  })`);
  assert.equal(state.working.inputs.profile_metadata.imported_cells, 265);
  assert.equal(state.working.altInputs.rural.profile_metadata.imported_cells, 273);
  assert.deepEqual(state.saved.find(s => s.name.startsWith('Previous working session')).inputs, previous);
  assert.ok(state.revision);
  // Open the actual data sections, then inspect the inputs populated from each file.
  await evaluate(`Array.from(document.querySelectorAll('button')).filter(
    b => /SERVICE LEVELS|ECONOMIC.*DEMOGRAPHIC/i.test(b.textContent) && b.textContent.includes('▾')).forEach(b => b.click())`);
  await sleep(350);
  const urbanValues = await evaluate(`Array.from(document.querySelectorAll('input')).map(i => i.value)`);
  // Independent economic projections must populate even with missing country costs.
  await sleep(600);
  const economics = await evaluate(`(() => {
    const section = document.querySelector('[data-section-key=econ_demo]');
    const row = [...section.querySelectorAll('tr')].find(r => /GDP.*used/i.test(r.textContent));
    return {used: row?.textContent, optional: section.textContent.includes('Optional forecast assumptions')};
  })()`);
  assert.ok(economics.optional, 'Existing forecast assumptions must have editable controls.');
  assert.ok(economics.used && /\d/.test(economics.used), 'Automatic GDP used row must contain numbers without unit costs.');
  for (const [name, value] of [['GDP growth fallback', '0'], ['Ongoing local inflation', '7.5']]) {
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('[data-section-key=econ_demo] label')]
        .find(l => l.textContent.includes(${JSON.stringify(name)}));
      const input = label.parentElement.querySelector('input');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.blur();
    })()`);
    await sleep(250);
  }
  await sleep(1000); // Working-session autosave is debounced.
  const editedMacro = await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.macro`);
  assert.equal(editedMacro.gdp_growth_forecast, 0, 'Zero fallback is a valid, persistent override.');
  assert.equal(editedMacro.inflation_local_ongoing, .075);
  const enteredCosts = [];
  async function enterMixValue(section, mix, column, value) {
    await evaluate(`(() => {
      const input = document.querySelector('[data-cost-section="${section}"][data-cost-mix="${mix}"] tbody tr').querySelectorAll('input')[${column}];
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.blur();
    })()`);
    await sleep(120);
  }
  for (const area of ['urban', 'rural']) {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase() === '${area}').click()`);
    for (const [sector, section, key, fields] of [
      ['Water Supply', 'water_costs', 'ws_unit_costs', ['network_cost_per_hh_serv1', 'network_cost_per_hh_serv2']],
      ['Sanitation', 'sanitation_costs', 'san_unit_costs', ['sewer_cost_per_hh_sserv1', 'sewer_cost_per_hh_sserv2']],
    ]) {
      await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '${sector}').click()`);
      await sleep(150);
      await evaluate(`(() => {
        const section = document.querySelector('[data-section-key="${key}"]');
        if (!section.querySelector('[data-cost-mix]')) section.querySelector('.wb-section-trigger').click();
        section.scrollIntoView({block:'start'});
      })()`);
      await sleep(200);
      const emptyMixes = await evaluate(`({
        groups: document.querySelectorAll('[data-cost-section="${section}"]').length,
        rows: [...document.querySelectorAll('[data-cost-section="${section}"] tbody')].map(t => t.rows.length),
        blank: [...document.querySelectorAll('[data-cost-section="${section}"] tbody tr')].every(
          r => [...r.querySelectorAll('input')].slice(1).every(i => i.value === '')),
        realBlank: document.querySelector('[data-section-key="${key}"]').textContent.includes('= —'),
      })`);
      assert.equal(emptyMixes.groups, 2, `${area} ${sector}: safely-managed and basic tables must be visible.`);
      assert.ok(emptyMixes.rows.every(n => n > 1), 'The original catalogue must be restored, not just an empty table.');
      assert.equal(emptyMixes.blank, true, `${area} ${sector}: no Nepal shares or prices may be inserted.`);
      assert.equal(emptyMixes.realBlank, true, 'Unknown real unit costs must not display as zero.');
      await evaluate(`document.querySelector('[data-section-key="${key}"]').scrollIntoView({block:'start'})`);
      const screenshot = await send('Page.captureScreenshot', {format:'png'}, sessionId);
      writeFileSync(`/tmp/wss-unit-costs-${area}-${sector.replaceAll(' ', '-').toLowerCase()}.png`,
        Buffer.from(screenshot.data, 'base64'));
      const amount = (area === 'urban' ? 1000 : 3000) + (sector === 'Sanitation' ? 1000 : 0);
      for (const [index, mix] of ['sm_tech_mix', 'basic_tech_mix'].entries()) {
        const price = amount / (index + 1);
        await enterMixValue(section, mix, 1, '100');
        await enterMixValue(section, mix, 2, String(price));
        enteredCosts.push({area, section, mix, field: fields[index], price});
      }
      // Original add/remove functionality must remain usable with blank numeric drafts.
      const originalCount = emptyMixes.rows[0];
      await evaluate(`document.querySelector('[data-cost-section="${section}"][data-cost-mix="sm_tech_mix"] > button').click()`);
      await sleep(150);
      assert.equal(await evaluate(`document.querySelector('[data-cost-section="${section}"][data-cost-mix="sm_tech_mix"] tbody').rows.length`),
        originalCount + 1);
      assert.equal(await evaluate(`(() => {
        const rows = document.querySelector('[data-cost-section="${section}"][data-cost-mix="sm_tech_mix"] tbody').rows;
        return [...rows[rows.length-1].querySelectorAll('input')].slice(1).every(i => i.value === '');
      })()`), true);
      await evaluate(`(() => {
        const rows = document.querySelector('[data-cost-section="${section}"][data-cost-mix="sm_tech_mix"] tbody').rows;
        rows[rows.length-1].querySelector('button').click();
      })()`);
      await sleep(150);
      await enterMixValue(section, 'sm_tech_mix', 0, `${area} ${sector} custom technology`);
    }
  }
  // Clearing an active cost must stay missing, rather than silently becoming zero.
  await enterMixValue('sanitation_costs', 'sm_tech_mix', 2, '');
  await sleep(1000);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle')).altInputs.rural.sanitation_costs.sewer_cost_per_hh_sserv1`), null);
  await enterMixValue('sanitation_costs', 'sm_tech_mix', 2, '0');
  await sleep(1000);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle')).altInputs.rural.sanitation_costs.sewer_cost_per_hh_sserv1`), 0,
    'Explicit zero must remain distinct from an unfilled cost.');
  await enterMixValue('sanitation_costs', 'sm_tech_mix', 2, '4000');
  await sleep(1000);
  const costBundle = await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle'))`);
  for (const entry of enteredCosts) {
    const area = entry.area === 'urban' ? costBundle.inputs : costBundle.altInputs.rural;
    assert.equal(area[entry.section][entry.field], entry.price);
    assert.equal(area[entry.section][entry.mix][0].cost, entry.price);
    assert.equal(area[entry.section][entry.mix][0].share, 1);
  }
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Water Supply').click()`);
  await sleep(150);
  console.log('Unit-cost fields: both rungs/sectors/areas restored blank; editing, add/remove, clearing and area-specific weighted costs verified.');
  assert.ok(urbanValues.includes((28.187377).toFixed(2)),
    'The Urban population must render with the table’s two-decimal display formatting.');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'rural').click()`);
  await sleep(400);
  await evaluate(`Array.from(document.querySelectorAll('button')).filter(
    b => /SERVICE LEVELS|ECONOMIC.*DEMOGRAPHIC/i.test(b.textContent) && b.textContent.includes('▾')).forEach(b => b.click())`);
  await sleep(200);
  const ruralValues = await evaluate(`Array.from(document.querySelectorAll('input')).map(i => i.value)`);
  assert.ok(ruralValues.includes((42.661934).toFixed(2)),
    'The Rural population must differ from Urban and match its workbook.');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Revenue input errors"]')`), false,
    'The old revenue message must not appear at the top.');
  assert.equal(await evaluate(`(() => {
    const keys = Array.from(document.querySelectorAll('[data-section-key]')).map(e => e.dataset.sectionKey);
    return keys.indexOf('revenue_inputs') === keys.indexOf('budget') + 1;
  })()`), true, 'Revenue Inputs must be immediately after Budget.');
  await evaluate(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  await sleep(200);
  async function enterRevenue(sector, values) {
    assert.equal(await evaluate(`document.querySelector('[data-section-key="revenue_inputs"] [data-revenue-sector]')?.dataset.revenueSector`),
      sector, 'Revenue form must follow the sector toggle.');
    for (const [field, value] of Object.entries(values)) {
      await evaluate(`(() => {
        const input = document.querySelector('[data-section-key="revenue_inputs"] [data-revenue-field="${field}"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(60);
    }
  }
  await enterRevenue('water', { volume_mld: 33.3, tariff: 600, collection_ratio: 0.72, growth_rate: 0.013 });
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Sanitation').click()`);
  await sleep(200);
  await enterRevenue('sanitation', { volume_mld: 12.3, tariff: 400, collection_ratio: 0.8 });
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'urban').click()`);
  await sleep(200);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Water Supply').click()`);
  await sleep(200);
  assert.equal(await evaluate(`document.querySelector('[data-section-key="revenue_inputs"] [data-revenue-field="volume_mld"]').value`), '',
    'Urban revenue must not inherit Rural values.');
  await enterRevenue('water', { volume_mld: 80.25, tariff: 700, collection_ratio: 0.85 });
  await sleep(1000);
  const revenueBundle = await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle'))`);
  assert.equal(revenueBundle.inputs.revenue_bases.water.volume_mld, 80.25);
  assert.equal(revenueBundle.altInputs.rural.revenue_bases.water.volume_mld, 33.3);
  assert.equal(revenueBundle.altInputs.rural.revenue_bases.water.growth_rate, 0.013);
  assert.equal(revenueBundle.altInputs.rural.revenue_bases.sanitation.volume_mld, 12.3);
  assert.equal(revenueBundle.altInputs.rural.revenue_bases.sanitation.collection_ratio, 0.8);
  for (const label of ['BAU Scenario', 'Intervention Design', 'Results Dashboard']) {
    const opened = await evaluate(`(() => {
      const tab = Array.from(document.querySelectorAll('.wb-tab')).find(
        b => b.textContent.replace(/\\s/g, '').includes(${JSON.stringify(label.replace(/\s/g, ''))}));
      if (!tab || tab.disabled) return false;
      tab.click(); return true;
    })()`);
    assert.equal(opened, true, `${label} must be accessible for the DRC preview.`);
    await sleep(400);
    assert.ok(await evaluate(`document.querySelector('.wb-tab-active')?.textContent.replace(/\\s/g, '').includes(${JSON.stringify(label.replace(/\s/g, ''))})`),
      `${label} must actually open.`);
    assert.ok(await evaluate(`!!document.querySelector('.wb-app')`), 'Page must remain rendered.');
    if (label === 'BAU Scenario') {
      await sleep(1200);
      assert.ok(await evaluate(`document.body.textContent.includes('Missing country-specific inputs')`),
        'BAU must report genuinely missing calibration, not legacy automatic settings.');
      assert.equal(await evaluate(`document.body.textContent.includes('as_is_forecast_length')`), false);
      assert.equal(await evaluate(`document.body.textContent.includes('calc failed (422)')`), false,
        'Do not replace actionable validation details with a generic status code.');
    }
  }
  await send('Page.reload', {}, sessionId);
  await sleep(1000);
  state = await evaluate(`JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]')`);
  assert.equal(state.filter(s => s.name.startsWith('Previous working session')).length, 1,
    'Reload must not archive or reset the session again.');
  const reloaded = await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle'))`);
  assert.equal(reloaded.inputs.revenue_bases.water.volume_mld, 80.25);
  assert.equal(reloaded.altInputs.rural.revenue_bases.water.volume_mld, 33.3);
  assert.equal(reloaded.altInputs.rural.revenue_bases.sanitation.volume_mld, 12.3);
  assert.equal(reloaded.inputs.macro.gdp_growth_forecast, 0);
  assert.equal(reloaded.inputs.macro.inflation_local_ongoing, .075);
  for (const entry of enteredCosts) {
    const area = entry.area === 'urban' ? reloaded.inputs : reloaded.altInputs.rural;
    assert.equal(area[entry.section][entry.field], entry.price, 'Unit costs must survive reload.');
    if (entry.mix === 'sm_tech_mix') assert.ok(area[entry.section][entry.mix][0].name.includes('custom technology'));
  }
  assert.equal(reloaded.altInputs.rural.macro.inflation_local_ongoing, null,
    'Editing Urban assumptions must not overwrite Rural assumptions.');
  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  // A fully configured fixture must render both BAU graphs in every scope and sector.
  // Only the isolated test browser is changed; no saved server profile is written.
  await evaluate(`(() => {
    const bundle = JSON.parse(localStorage.getItem('wss_working_bundle'));
    for (const input of [bundle.inputs, bundle.altInputs.rural]) {
      Object.assign(input.water_costs, {network_cost_per_hh_serv1:1000, network_cost_per_hh_serv2:500});
      Object.assign(input.sanitation_costs, {sewer_cost_per_hh_sserv1:900, sewer_cost_per_hh_sserv2:400});
      Object.assign(input.technical, {ws_asset_life:30, san_asset_life:30, ws_non_hh_pct:0, san_non_hh_pct:0});
      input.revenue_bases = Object.fromEntries(['water','sanitation'].map(sector => [sector,
        {version:1, volume_mld:1, reference_year:2025, tariff:1, collection_ratio:1, growth_rate:null}]));
    }
    localStorage.setItem('wss_working_bundle', JSON.stringify(bundle));
  })()`);
  await send('Page.reload', {}, sessionId);
  await sleep(1200);
  } else {
    await sleep(1000);
    const startup = await evaluate(`({
      working:JSON.parse(localStorage.getItem('wss_working_bundle')),
      saved:JSON.parse(localStorage.getItem('wss_demo_scenarios')),
      revision:localStorage.getItem('wss_mock_setup_revision'),
      warning:document.body.textContent.includes('not validated DRC estimates'),
    })`);
    assert.ok(startup.warning);
    assert.ok(startup.revision);
    assert.equal(startup.working.inputs.water_costs.network_cost_per_hh_serv1, 2771496);
    assert.equal(startup.working.altInputs.rural.sanitation_costs.sewer_cost_per_hh_sserv2, 577395);
    assert.equal(startup.working.presentation.currencyDisplay.localPerUsd, 2309.58);
    assert.equal(startup.saved.find(s => s.name === 'Original DRC inputs before mock setup').inputs.inputs.water_costs.network_cost_per_hh_serv1, null);
    assert.ok(startup.saved.find(s => s.name.includes('DRC mock simulation')));
    await evaluate(`document.querySelector('[data-section-key="ws_unit_costs"] .wb-section-trigger').click()`);
    await sleep(200);
    assert.equal(await evaluate(`document.querySelector('[data-cost-section=water_costs][data-cost-mix=sm_tech_mix] tbody tr input[aria-label*="share"]').value`), '75');
    assert.equal(await evaluate(`document.querySelector('[data-cost-section=water_costs][data-cost-mix=sm_tech_mix] tbody tr input[aria-label*="cost per household"]').value`), '3,233,412');
    await evaluate(`document.querySelector('[data-section-key=ws_unit_costs]').scrollIntoView({block:'start'})`);
    const screenshot = await send('Page.captureScreenshot',{format:'png'},sessionId);
    writeFileSync('/tmp/wss-mock-cost-fields.png',Buffer.from(screenshot.data,'base64'));
    await send('Page.reload', {}, sessionId);
    await sleep(1200);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('wss_demo_scenarios')).filter(s => s.name==='Original DRC inputs before mock setup').length`), 1);
    console.log('Mock setup: visible filled fields, 2309.58 rate, original backup, named mock scenario and once-only reload verified.');
  }
  await evaluate(`[...document.querySelectorAll('.wb-tab')].find(b => b.textContent.includes('BAU')).click()`);
  for (const sector of ['Water Supply', 'Sanitation']) {
    await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(sector)})).click()`);
    for (const scope of ['Urban', 'Rural', 'National (Urban + Rural)']) {
      await evaluate(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(scope)})).click()`);
      let plotted;
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(200);
        plotted = await evaluate(`({
          curves: [...document.querySelectorAll('.recharts-area path[d]')].filter(p => p.getAttribute('d')?.length > 30).length,
          headings: [...document.querySelectorAll('h3')].filter(h => h.textContent.includes('BAU vs Target')).length,
          missing: document.body.textContent.includes('Missing country-specific inputs'),
          generic: document.body.textContent.includes('calc failed'),
        })`);
        if (plotted.curves >= 2 && plotted.headings === 2) break;
      }
      if (plotted.curves < 2) {
        console.log(await evaluate(`({wrappers:[...document.querySelectorAll('.recharts-wrapper')].map(w => ({width:w.getBoundingClientRect().width,html:w.outerHTML.slice(0,160)})),paths:[...document.querySelectorAll('svg path')].map(p => p.getAttribute('class')),text:document.body.textContent.slice(-2200)})`));
      }
      assert.ok(plotted.curves >= 2 && plotted.headings === 2, JSON.stringify({sector, scope, plotted}));
      assert.equal(plotted.missing, false);
      assert.equal(plotted.generic, false);
    }
  }
  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  if (mockMode) {
    await evaluate(`[...document.querySelectorAll('.wb-saved-scenario')].find(b => b.textContent.includes('Original DRC inputs before mock setup')).click()`);
    await sleep(1000);
    await send('Page.reload', {}, sessionId);
    await sleep(1200);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.water_costs.network_cost_per_hh_serv1`), null,
      'Restoring the original must not automatically reapply mocks on reload.');
    await evaluate(`[...document.querySelectorAll('.wb-saved-scenario')].find(b => b.textContent.includes('DRC mock simulation')).click()`);
    await sleep(1000);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.water_costs.network_cost_per_hh_serv1`), 2771496);
    console.log('Original/mock scenario switching verified; restoring original inputs survives reload.');
  }
  console.log('Configured BAU: safely managed + basic curves render for both sectors in Urban/Rural/National.');
  console.log('Browser passed: DRC startup, preserved data/session, all workflow tabs accessible and safe reload.');
} finally {
  browser.kill('SIGTERM');
  for (const { timer } of pending.values()) clearTimeout(timer);
}