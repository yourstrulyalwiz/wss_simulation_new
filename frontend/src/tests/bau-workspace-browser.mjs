// Public simulation route; anonymous browser. All fixtures are in-memory GET overlays after
// the real server has confirmed read-only access. Never create/save/modify a simulation.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openChromium, sleep } from '../../tests/chromium-client.mjs';

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const get = async path => {
  const response = await fetch(url + path);
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
};
const { items } = await get('/api/simulations?collection=examples');
const example = items.find(item => item.scope.areaUrban && item.scope.areaRural &&
  item.scope.sectors.includes('water') && item.scope.sectors.includes('sanitation'));
assert.ok(example, 'A publicly readable, two-area/two-sector example is required');
const original = await get(`/api/simulations/${example.id}`);
assert.ok(original.read_only && !original.is_owner);
const snapshot = JSON.stringify(original);
const inputs = await get('/api/defaults');
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
const bundle = { ...original.bundle, inputs, altInputs: { rural },
  scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true, sectors: ['water', 'sanitation'] },
  presentation: { currencyDisplay: { mode: 'local', sourceCurrency: inputs.country_config.currency,
    localPerUsd: 137.42, rateReferenceYear: 2025 } } };
const b = await openChromium('about:blank');
const { evaluate: e, waitFor: w } = b;
const nav = '.modern-inputs-nav';
const tab = async label => {
  await e(`[...document.querySelectorAll('.wb-tab')].find(node => node.textContent.replace(/\\s/g,'').includes(${JSON.stringify(label.replace(/\s/g, ''))})).click()`);
  await sleep(100);
};
const navigate = async index => {
  await e(`document.querySelectorAll('${nav} button')[${index}].click()`);
  await sleep(450);
  assert.ok(await e(`['H2','H3'].includes(document.activeElement.tagName)`), 'Section heading receives focus');
};
const select = async (level, location = 'graph') => {
  await e(`document.querySelector('[aria-label="BAU ${location} service level"] [data-service-level="${level}"]').click()`);
  await w(`document.querySelector('[data-bau-ledger="${level}"]') &&
    document.querySelector('[data-bau-kpi="bau"] strong').textContent.endsWith('%')`, `Missing ${level} results`);
  for (const group of ['graph', 'table']) {
    assert.equal(await e(`document.querySelector('[aria-label="BAU ${group} service level"] [aria-pressed="true"]').dataset.serviceLevel`), level);
  }
};
try {
  await b.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await b.call('Page.navigate', { url: `${url}/simulations/${example.id}` });
  await w(`document.querySelectorAll('.wb-tab').length===6`, 'Public workspace did not load');
  await tab('Setup');
  await w(`!!document.querySelector('[data-section-key="simulation_name"]')`, 'Setup is missing');
  assert.deepEqual(await e(`[...document.querySelectorAll('[data-section-key]')].map(node=>node.dataset.sectionKey)`),
    ['simulation_name', 'country', 'coverage', 'currency']);
  await tab('Data Inputs');
  await w(`document.querySelectorAll('${nav} button').length===9`, 'Nine Data Inputs sections are required');
  await tab('BAU Scenario');
  await w(`document.querySelectorAll('${nav} button').length===2`, 'Exactly two BAU sections are required');
  console.log('Verified actual public route, read-only Setup, nine input sections and two BAU sections.');

  // Branch regression fixture: preserve public access control and read-only metadata, replacing
  // only the local response's inputs so all sector/area combinations have valid engine data.
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch.bind(window);
    window.__bauResponses = [];
    window.__bauWrites = [];
    window.__bauDownloads = [];
    window.__bauExportBodies = [];
    window.__bauMode = 'ok';
    window.fetch = async (input, options) => {
      const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      const method = (options?.method || 'GET').toUpperCase();
      if (path.startsWith('/api/simulations') && method !== 'GET') {
        window.__bauWrites.push(path); throw new Error('Test forbids simulation writes');
      }
      if (path.startsWith('/api/export/') && options?.body) {
        window.__bauExportBodies.push({path, body:JSON.parse(options.body)});
      }
      const response = await originalFetch(input, options);
      if (path === '/api/simulations/${example.id}' && method === 'GET' && response.ok) {
        const project = await response.json();
        if (!project.read_only || project.is_owner) throw new Error('Fixture requires real public read-only access');
        return new Response(JSON.stringify({...project, bundle:${JSON.stringify(bundle)}, location:{}}),
          {status:response.status, headers:response.headers});
      }
      if (path === '/api/calculate' && response.ok) {
        const result = await response.clone().json();
        window.__bauResponses.push(result);
        if (window.__bauMode === 'missing') {
          if (result.water_supply) delete result.water_supply.replacement_backlog_closing_by_service;
          if (result.sanitation) delete result.sanitation.replacement_backlog_closing_by_service;
          return new Response(JSON.stringify(result), {status:200,headers:response.headers});
        }
      }
      return response;
    };
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__bauDownloads.push(blob); return createUrl(blob); };
    document.addEventListener('click', event => {
      if (event.target.closest?.('a[download]')) event.preventDefault();
    });
  ` });
  await b.call('Page.reload');
  await w(`Array.isArray(window.__bauResponses) && document.querySelectorAll('.wb-tab').length===6`, 'Fixture workspace did not load');
  await tab('Data Inputs');
  assert.equal(await e(`document.querySelectorAll('${nav} button').length`), 9);
  for (let index = 0; index < 9; index++) await navigate(index);
  await tab('BAU Scenario');
  await w(`document.querySelector('[data-bau-kpi="baseline"] strong')?.textContent==='60.0%'`, 'Combined urban baseline must come from engine');
  for (const location of ['graph', 'table']) {
    assert.equal(await e(`document.querySelector('[aria-label="BAU ${location} service level"] button[aria-pressed="true"]')?.dataset.serviceLevel`), 'at_least_basic', 'Graph and table default to At least basic');
  }
  assert.ok(await e(`document.querySelector('[aria-label="BAU graph area"]').compareDocumentPosition(document.querySelector('[aria-label="BAU sector"]')) & Node.DOCUMENT_POSITION_FOLLOWING`));
  assert.deepEqual(await e(`[...document.querySelectorAll('${nav} button')].map(n=>n.textContent.replace(/^\\d+/,''))`), ['BAU Graph', 'BAU Table']);
  for (const [sectorIndex, sectorKey] of [[0, 'water_supply'], [1, 'sanitation']]) {
    await e(`document.querySelectorAll('[aria-label="BAU sector"] button')[${sectorIndex}].click()`);
    for (const areaIndex of [0, 1]) {
      await e(`document.querySelectorAll('[aria-label="BAU graph area"] button')[${areaIndex}].click()`);
      for (const [level, rungs] of [['safely_managed', [0]], ['basic', [1]], ['at_least_basic', [0, 1]]]) {
        await select(level, level === 'at_least_basic' ? 'table' : 'graph');
        const result = await e(`window.__bauResponses.at(-1)`);
        const endIndex = result.years.indexOf(inputs.period.forecast_end_year);
        assert.ok(await e(`[...document.querySelectorAll('summary')].some(el=>el.textContent.includes('Annual replacement and expansion reconciliation'))`));
        assert.equal(await e(`document.querySelectorAll('.bau-forecast-table thead th').length`), 12);
        assert.equal(await e(`/cash deficit/i.test(document.querySelector('.bau-forecast-table').textContent)`), false);
        const moneyText = value => Number((value / 1000).toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
        assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:nth-child(9)').textContent`),
          moneyText(rungs.reduce((sum, rung) => sum + result[sectorKey].replacement_backlog_closing_by_service[rung][endIndex], 0)));
        assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:nth-child(10)').textContent`),
          moneyText(rungs.reduce((sum, rung) => sum + result[sectorKey].financing_gap_by_service[rung][endIndex], 0)));
        assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:nth-child(11)').textContent`),
          moneyText(result[sectorKey].financing_gap[endIndex]));
        assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:last-child').textContent`),
          Number((result[sectorKey].available_total[endIndex] / 1000).toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
          'Final column shows sector-wide annual funding in every service view');
        for (const [card, series, year] of [['baseline', 'bau_hh', inputs.period.baseline_year],
          ['bau', 'bau_hh', inputs.period.forecast_end_year], ['target', 'target_hh', inputs.period.forecast_end_year]]) {
          const i = result.years.indexOf(year);
          const hh = rungs.reduce((sum, rung) => sum + result[sectorKey][series][rung][i], 0);
          const expected = `${(Math.min(result.total_hh[i], hh) / result.total_hh[i] * 100).toFixed(1)}%`;
          assert.equal(await e(`document.querySelector('[data-bau-kpi="${card}"] strong').textContent`), expected);
        }
      }
    }
  }
  await w(`document.querySelectorAll('.modern-bau-chart-pair .recharts-wrapper').length===2`, 'Both charts must be populated');
  assert.equal(await e(`document.querySelectorAll('[data-section-key="table"] .bau-forecast-table').length`), 1);
  assert.equal(await e(`document.querySelectorAll('[data-section-key="graph"] [data-bau-ledger]').length`), 0);
  assert.ok(await e(`getComputedStyle(document.querySelector('.modern-bau-chart-pair')).gridTemplateColumns.split(' ').length===2`), 'Wide charts should be side by side');
  if (process.env.BAU_SCREENSHOT_DIR) {
    mkdirSync(process.env.BAU_SCREENSHOT_DIR, { recursive: true });
    await navigate(0);
    const image = await b.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${process.env.BAU_SCREENSHOT_DIR}/bau-desktop.png`, Buffer.from(image.data, 'base64'));
  }
  await e(`document.querySelector('.modern-bau-analysis-container > .modern-bau-chart-actions button').click()`);
  assert.ok(await e(`!!document.querySelector('.modern-bau-chart-pair--expanded')`));
  assert.equal(await e(`getComputedStyle(document.querySelector('.modern-bau-chart-pair')).gridTemplateColumns.split(' ').length`), 1);
  await e(`document.querySelector('.modern-bau-analysis-container > .modern-bau-chart-actions button').click()`);

  // Existing display control changes reporting only, even on read-only public simulations.
  const sourceCurrency = inputs.country_config.currency;
  await tab('Results Dashboard');
  await w(`!!document.querySelector('[aria-label="Display currency"] button[aria-pressed="false"]:not(:disabled)')`, 'Currency display control unavailable');
  await e(`document.querySelector('[aria-label="Display currency"] button[aria-pressed="false"]').click()`);
  await tab('BAU Scenario');
  await select('at_least_basic');
  await w(`document.querySelector('.bau-forecast-table caption').textContent.includes('USD')`, 'USD table conversion missing');
  assert.ok(await e(`document.querySelector('.modern-bau-spending').textContent.includes('B USD/yr')`));
  await e(`document.querySelector('[data-bau-ledger] button[title="Download this table as CSV"]').click()`);
  await w(`window.__bauDownloads.length>0`, 'CSV download missing');
  const csv = await e(`window.__bauDownloads.at(-1).text()`);
  assert.ok(!csv.split('\r\n').find(line => line.startsWith('Year,')).split(',').some(header => /cash deficit/i.test(header) && !/closing expansion/.test(header)));
  assert.equal(csv.trim().split('\r\n').at(-1).split(',').length, 12);
  assert.ok(csv.includes('USD M'), 'CSV labels must identify millions rather than table billions');
  assert.ok(csv.includes('At least basic') || csv.includes('at least basic'));
  assert.ok(csv.split('\r\n').find(line => line.startsWith('Year,'))?.endsWith('Sector available funding (USD M/yr)'));
  const rawResult = await e(`window.__bauResponses.at(-1)`);
  const last = rawResult.years.indexOf(inputs.period.forecast_end_year);
  const availableUsd = rawResult.sanitation.available_total[last] / 137.42;
  assert.equal(Number(csv.trim().split('\r\n').at(-1).split(',').at(-1)), Number(availableUsd.toPrecision(3)));
  assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:last-child').textContent`),
    Number((availableUsd / 1000).toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const needUsd = (rawResult.sanitation.new_capex_by_service[0][last] +
    rawResult.sanitation.new_capex_by_service[1][last]) / 137.42;
  assert.equal(Number(csv.trim().split('\r\n').at(-1).split(',')[5]), Number(needUsd.toPrecision(3)),
    'CSV must convert service costs to USD millions once');
  assert.equal(await e(`document.querySelector('.bau-forecast-table tbody tr:last-child td:nth-child(6)').textContent`),
    Number((needUsd / 1000).toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    'Displayed ledger must use USD billions rather than export millions');
  await e(`document.querySelector('[data-bau-ledger] button[title="Download this table as Excel (.xlsx)"]').click()`);
  await w(`window.__bauDownloads.length>1`, 'Excel download missing');
  assert.deepEqual(await e(`window.__bauDownloads.at(-1).slice(0,2).arrayBuffer().then(b=>[...new Uint8Array(b)])`), [80, 75]);
  const tableExport = await e(`window.__bauExportBodies.filter(item=>item.path==='/api/export/table').at(-1).body.sheets[0]`);
  assert.equal(tableExport.headers.length, 12);
  assert.ok(tableExport.headers.every(header => !/cash deficit/i.test(header) || /closing expansion/.test(header)));
  assert.equal(tableExport.headers.at(-1), 'Sector available funding (USD M/yr)');
  assert.ok(tableExport.rows.every(row => row.length === 12));
  const backlogUsd = rawResult.sanitation.replacement_backlog_closing[last] / 137.42;
  assert.ok(tableExport.headers[8].includes('Residual replacement cost (Cumulative)'));
  assert.equal(tableExport.rows.at(-1)[8], Number(backlogUsd.toPrecision(3)));
  assert.equal(Number(csv.trim().split('\r\n').at(-1).split(',')[8]), Number(backlogUsd.toPrecision(3)));
  assert.equal(tableExport.rows.at(-1)[11], Number(availableUsd.toPrecision(3)));
  assert.equal(tableExport.rows.at(-1)[9], Number(((rawResult.sanitation.financing_gap_by_service[0][last] + rawResult.sanitation.financing_gap_by_service[1][last]) / 137.42).toPrecision(3)));
  assert.equal(tableExport.rows.at(-1)[10], Number((rawResult.sanitation.financing_gap[last] / 137.42).toPrecision(3)));
  for (const panel of ['.modern-bau-plot-panel:not(.modern-bau-spending)', '.modern-bau-spending']) {
    for (const format of ['PNG', 'JPG', 'Excel']) {
      const downloads = await e(`window.__bauDownloads.length`);
      await e(`document.querySelector('${panel} button[title*="${format}"]').click()`);
      await w(`window.__bauDownloads.length>${downloads}`, `${panel} ${format} export failed`);
      const type = await e(`window.__bauDownloads.at(-1).type`);
      if (format === 'PNG') assert.equal(type, 'image/png');
      if (format === 'JPG') assert.equal(type, 'image/jpeg');
      if (format === 'Excel') {
        assert.deepEqual(await e(`window.__bauDownloads.at(-1).slice(0,2).arrayBuffer().then(b=>[...new Uint8Array(b)])`), [80, 75]);
      }
    }
  }
  const spendingExport = await e(`window.__bauExportBodies.filter(item=>item.body.filename?.endsWith('_bau_spending')).at(-1).body`);
  assert.equal(spendingExport.currency_display.mode, 'usd');
  for (const row of spendingExport.sheets[0].rows) {
    const i = rawResult.years.indexOf(row[0]);
    for (const [column, key] of [[1, 'annual_planned_expansion_cost'], [2, 'replacement_capex'], [3, 'available_total']]) {
      const expected = rawResult.sanitation[key][i] / 137.42 / 1000;
      assert.ok(Math.abs(row[column] - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
        `${key} export must use annual BAU flows and USD billions`);
    }
  }
  await tab('Results Dashboard');
  await w(`!!document.querySelector('[aria-label="Display currency"] button[aria-pressed="false"]:not(:disabled)')`, 'Currency display control unavailable');
  await e(`document.querySelector('[aria-label="Display currency"] button[aria-pressed="false"]').click()`);
  await tab('BAU Scenario');
  await select('at_least_basic');
  await w(`document.querySelector('.bau-forecast-table caption').textContent.includes(${JSON.stringify(sourceCurrency)})`, 'Local currency restoration missing');

  // Missing engine series must clear coverage/table; retry uses the unchanged input payload.
  await e(`[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent.includes('Annual replacement and expansion reconciliation')).open=true`);
  await e(`[...document.querySelectorAll('summary')].find(el=>el.textContent.includes('Annual replacement and expansion reconciliation')).scrollIntoView()`);
  if (process.env.BAU_SCREENSHOT_DIR) {
    const capture = await b.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${process.env.BAU_SCREENSHOT_DIR}/replacement-waterfall.png`, Buffer.from(capture.data, 'base64'));
  }
  await e(`window.__bauMode='missing'`);
  await e(`document.querySelector('[aria-label="BAU graph service level"] [data-service-level="basic"]').click()`);
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('missing a valid')`, 'Missing series must be explicit');
  assert.equal(await e(`document.querySelectorAll('[data-bau-ledger]').length`), 0);
  assert.equal(await e(`document.querySelector('[data-bau-kpi="baseline"] strong').textContent`), '—');
  await e(`window.__bauMode='ok'; [...document.querySelectorAll('button')].find(n=>n.textContent==='Retry calculation').click()`);
  await w(`!!document.querySelector('[data-bau-ledger="basic"]')`, 'Retry did not recover');
  await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const label of ['Setup', 'Data Inputs', 'BAU Scenario']) {
    await tab(label);
    assert.equal(await e(`getComputedStyle(document.querySelector('${nav} .modern-inputs-nav__items')).display`), 'none');
    assert.notEqual(await e(`getComputedStyle(document.querySelector('${nav} select')).display`), 'none');
    assert.ok(await e(`document.documentElement.scrollWidth<=innerWidth+1`), 'Mobile page overflow');
  }
  await select('safely_managed');
  await sleep(500);
  await e(`(()=>{const select=document.querySelector('${nav} select');select.value='table';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`document.querySelector('${nav} select').value==='table' &&
    document.querySelector('[data-section-key="table"]').getBoundingClientRect().top<innerHeight`, 'Mobile table navigation failed');
  await sleep(450);
  assert.equal(await e(`document.querySelector('${nav} select').value`), 'table');
  assert.ok(await e(`(()=>{const y=document.querySelector('[data-section-key="table"] h2').getBoundingClientRect().top;return y>0 && y<innerHeight;})()`), 'Table heading must remain visible after layout settles');
  assert.ok(await e(`['H2','H3'].includes(document.activeElement.tagName)`), 'Mobile table heading receives focus');
  assert.ok(await e(`document.querySelector('.bau-ledger-frame').scrollWidth<=document.querySelector('.bau-ledger-frame').clientWidth+1`));
  assert.ok(await e(`document.querySelector('.bau-forecast-table tbody td:nth-child(9)').dataset.label.includes('Residual replacement cost (Cumulative)')`));
  assert.equal(await e(`getComputedStyle(document.querySelector('.modern-bau-chart-pair')).gridTemplateColumns.split(' ').length`), 1);
  if (process.env.BAU_SCREENSHOT_DIR) {
    const image = await b.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${process.env.BAU_SCREENSHOT_DIR}/bau-mobile-table.png`, Buffer.from(image.data, 'base64'));
  }
  assert.deepEqual(await e(`window.__bauWrites`), []);
  assert.equal(b.errors.length, 0, 'No browser runtime errors');
  assert.equal(JSON.stringify(await get(`/api/simulations/${example.id}`)), snapshot, 'Published simulation must remain unchanged');
  console.log('PASS: public-route Setup/nine Data Inputs/two BAU sections, 12 sector/area/service combinations and 36 engine KPIs, synchronized switches, responsive pairing/expand, USD/local values, CSV/table Excel and both charts PNG/JPG/Excel, annual-capital export values, missing data/retry, mobile navigation and no persisted writes.');
} finally { b.close(); }
