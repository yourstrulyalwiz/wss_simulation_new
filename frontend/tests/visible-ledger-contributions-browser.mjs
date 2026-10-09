// Run after the owning agent restarts the server:
// LEDGER_SERVER_RESTARTED=1 APP_URL=http://127.0.0.1:5000 node frontend/tests/visible-ledger-contributions-browser.mjs
// Uses an in-memory copy of the saved profile in a fresh Chromium process; never saves it.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

assert.equal(process.env.LEDGER_SERVER_RESTARTED, '1', 'Owner must restart the serving workflow after the static build.');
const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const profilePath = new URL('../../profiles/DRC OCT 8.json', import.meta.url);
const originalProfile = readFileSync(profilePath, 'utf8');
const bundle = structuredClone(JSON.parse(originalProfile));
bundle.presentation = { ...bundle.presentation, contributionView: 'individual' };
const inputs = bundle.inputs;
const rural = bundle.altInputs.rural;
for (const area of [inputs, rural]) {
  area.toggles.ws_collection_efficiency_enabled = true;
  area.toggles.ws_financial_commitment_enabled = true;
  area.toggles.ws_costeff_enabled = true;
  area.toggles.san_financial_commitment_enabled = true;
}
inputs.toggles.ws_tariff_enabled = false;
rural.toggles.ws_tariff_enabled = true; // Deliberately different area toggles.
bundle.scope = { ...bundle.scope, scopeMode: 'urban_rural', areaUrban: true, areaRural: true };
const previewResponse = await fetch(`${url}/api/development-preview`);
const preview = previewResponse.ok ? await previewResponse.json() : {};
const staticIndex = readFileSync(new URL('../../static/index.html', import.meta.url), 'utf8');
const asset = staticIndex.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(asset && (await (await fetch(url)).text()).includes(asset), 'Server is not serving the current static build.');
const dir = new URL('../screenshots/visible-ledger-contributions/', import.meta.url);
mkdirSync(dir, { recursive: true });
const browser = await openChromium('about:blank');
const { evaluate: e, waitFor: w } = browser;
const root = sector => `[data-results-ledger="${sector}"]`;
const change = async (selector, value) => {
  await e(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});
    if(!select) throw new Error('Missing select '+${JSON.stringify(selector)});
    select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(120);
};
const setScope = async value => {
  await e(`(()=>{const select=Array.from(document.querySelectorAll('select')).find(s=>['urban','rural','national'].every(value=>Array.from(s.options).some(o=>o.value===value)));
    if(!select) throw new Error('Results scope selector missing');
    select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(250);
};
const tableRows = sector => e(`Array.from(document.querySelectorAll('${root(sector)} tbody tr[data-ledger-row]')).map(row=>({
  key:row.dataset.ledgerRow, kind:row.dataset.rowKind, depth:Number(row.dataset.rowDepth),
  label:row.querySelector('th').textContent,
  values:Array.from(row.querySelectorAll('[data-ledger-year]')).map(cell=>cell.title==='Not available'?null:Number(cell.title))
}))`);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9 + Math.abs(b) * 1e-10, `${a} != ${b}`);
let exports = 0;
let csvs = 0;
const checkExport = async sector => {
  const visible = await tableRows(sector);
  await e(`Array.from(document.querySelectorAll('${root(sector)} .results-ledger__export button')).find(b=>b.textContent.includes('Excel')).click()`);
  await w(`window.__visibleLedgerExports.length>${exports} && window.__visibleLedgerExports[${exports}].status!==null`, 'Excel export did not finish');
  const payload = await e(`window.__visibleLedgerExports[${exports++}]`);
  assert.equal(payload.status, 200);
  const sheet = payload.body.sheets[0];
  assert.equal(sheet.rows.length, visible.length, 'Export must contain exactly visible rows.');
  const yearStart = sheet.headers.findIndex(value => /^\d{4}$/.test(value));
  assert.ok(yearStart > 0);
  for (const [i, row] of visible.entries()) {
    assert.equal(sheet.rows[i][8], row.depth);
    assert.deepEqual(sheet.rows[i].slice(yearStart, yearStart + row.values.length), row.values, `${row.key}: export differs from exact cell values`);
    if (row.kind === 'category' || row.kind === 'scenario' || row.kind === 'baseline')
      assert.equal(sheet.rows[i][6], 'No — subtotal/reference');
    if (row.kind === 'intervention') assert.equal(sheet.rows[i][6], 'Yes — contribution to parent subtotal');
  }
  await e(`Array.from(document.querySelectorAll('${root(sector)} .results-ledger__export button')).find(b=>b.textContent.includes('CSV')).click()`);
  await w(`window.__visibleLedgerCSVs.length>${csvs}`, 'CSV export did not finish');
  const csv = await e(`window.__visibleLedgerCSVs[${csvs++}]`);
  const escape = value => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  for (const row of sheet.rows) assert.ok(csv.split('\r\n').includes(row.map(escape).join(',')), 'CSV differs from Excel/visible exact rows.');
};
const capture = async (sector, metric, width) => {
  await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 768 });
  await sleep(300);
  await e(`document.querySelector('${root(sector)} .results-ledger__table-scroll').scrollIntoView({block:'start'});
    document.querySelector('${root(sector)} .results-ledger__table-scroll').scrollLeft=0`);
  await sleep(250);
  const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`${sector}-${metric}-${width < 768 ? 'mobile' : 'desktop'}.png`, dir), Buffer.from(screenshot.data, 'base64'));
  if (width < 768) {
    // Inspect the real horizontal-scroll interaction, not a test stylesheet.
    await e(`(()=>{const scroll=document.querySelector('${root(sector)} .results-ledger__table-scroll');
      const cell=Array.from(scroll.querySelectorAll('tbody [data-ledger-year]')).find(c=>c.dataset.ledgerYear==='2026');
      scroll.scrollLeft+=cell.getBoundingClientRect().right-scroll.getBoundingClientRect().right+2;})()`);
    await sleep(150);
    const valuesShot = await browser.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL(`${sector}-${metric}-mobile-values.png`, dir), Buffer.from(valuesShot.data, 'base64'));
    const geometry = await e(`(()=>{const scroll=document.querySelector('${root(sector)} .results-ledger__table-scroll');
      const label=scroll.querySelector('tbody .results-ledger__rowhead').getBoundingClientRect();
      const bounds=scroll.getBoundingClientRect();
      const cell=scroll.querySelector('tbody [data-ledger-year="2026"]').getBoundingClientRect();
      return {viewport:innerWidth,containerWidth:bounds.width,containerRight:bounds.right,
        stickyLabelWidth:label.width,stickyLabelRight:label.right,yearCellLeft:cell.left,yearCellRight:cell.right,
        unobscuredWidth:Math.max(0,bounds.right-label.right)};})()`);
    writeFileSync(new URL(`${sector}-${metric}-mobile-geometry.json`, dir), JSON.stringify(geometry, null, 2));
    console.log(`${sector}/${metric} mobile geometry`, geometry);
  }
  await e(`(()=>{const scroll=document.querySelector('${root(sector)} .results-ledger__table-scroll');
    const row=scroll.querySelector('[data-ledger-row="scenario"]');
    scroll.scrollTop+=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-scroll.clientHeight/2;})()`);
  await sleep(150);
  const combinedShot = await browser.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`${sector}-${metric}-${width < 768 ? 'mobile' : 'desktop'}-combined.png`, dir), Buffer.from(combinedShot.data, 'base64'));
  await e(`document.querySelector('${root(sector)} .results-ledger__table-scroll').scrollTop=0`);
  assert.ok(await e(`document.documentElement.scrollWidth<=innerWidth+2`), 'Document horizontal overflow');
};
try {
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))});
    localStorage.setItem('wss_development_preview_revision',${JSON.stringify(preview.revision || '')});
    localStorage.setItem('wss_mock_setup_revision',${JSON.stringify(preview.mock_setup_revision || '')});
    window.__visibleLedgerExports=[];window.__visibleLedgerCSVs=[];window.__visibleLedgerCalls=[];window.__visibleLedgerAlerts=[];
    window.alert=message=>window.__visibleLedgerAlerts.push(String(message));
    const blobURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(blob.type.startsWith('text/csv')) blob.text().then(text=>window.__visibleLedgerCSVs.push(text));return blobURL(blob)};
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=(url,options)=>fetchOriginal(url,options).then(async response=>{
      if(String(url)==='/api/calculate') window.__visibleLedgerCalls.push({input:JSON.parse(options.body),status:response.status,data:await response.clone().json()});
      if(String(url)==='/api/export/table') window.__visibleLedgerExports.push({body:JSON.parse(options.body),status:response.status});
      return response;
    });` });
  await browser.call('Page.navigate', { url });
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App did not load');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[4].click()`);
  await w(`!!document.querySelector('${root('water')} [data-ledger-row="scenario"]')`, 'Water ledger did not load');
  // Select combined results through the existing scope control.
  await setScope('national');
  await w(`!!document.querySelector('${root('water')} [data-ledger-row="tariff"]')`, 'Mixed-area tariff source missing');
  for (const sector of ['water', 'sanitation']) {
    for (const metric of ['coverage', 'funding']) {
      await change(`${root(sector)} select[aria-label$="ledger metric"]`, metric);
      for (const service of ['sm', 'basic', 'total']) {
        console.log(`Checking ${sector}/${metric}/${service}`);
        await change(`${root(sector)} select[aria-label$="ledger service"]`, service);
        const list = await tableRows(sector);
        assert.equal(new Set(list.map(row=>`${row.kind}:${row.key}`)).size, list.length,
          'Stale/duplicate rows after metric/service switch.');
        const combined = list.findIndex(row => row.key === 'scenario');
        const categories = list.filter(row => row.kind === 'category');
        const contributions = list.filter(row => row.kind === 'intervention');
        assert.ok(contributions.length > 0, 'Selected individual contributions should be visible by default.');
        assert.ok(!contributions.some(row => ['loan', 'funding-source-loan', 'zero_cost', 'funding-source-zero_cost'].includes(row.key)),
          'Disabled loan or non-selectable zero-cost source shown as an intervention.');
        assert.ok(categories.length && list.slice(combined + 1).every(row => row.kind !== 'category' && row.kind !== 'intervention'), 'Historical contribution ordering changed.');
        assert.ok(!list.some(row => row.kind === 'component' && row.depth > 1), 'Nested allocation children must not be expanded by default.');
        const baseline = list.find(row => row.key === (metric === 'coverage' ? 'opening-baseline' : 'funding-source-baseline'));
        for (const [i, value] of baseline.values.entries()) {
          if (value == null) continue;
          const sum = categories.reduce((total, row) => total + row.values[i], 0);
          close(value + sum, list[combined].values[i]);
          for (const category of categories) {
            const index = list.indexOf(category);
            const next = list.findIndex((row, j) => j > index && row.depth === 0);
            close(category.values[i], list.slice(index + 1, next < 0 ? undefined : next).reduce((total, row) => total + row.values[i], 0));
          }
        }
        if (metric === 'funding') {
          assert.ok(contributions.every(row => row.values.some(value => value != null)), 'Blank funding source parent.');
          const key = contributions.find(row => row.key === 'funding-source-tariff')?.key ?? contributions[0].key;
          await e(`document.querySelector('${root(sector)} [data-ledger-row="${key}"] button').click()`);
          assert.ok((await tableRows(sector)).some(row => row.depth === 2), 'Allocation details not expandable.');
          await checkExport(sector);
          // A metric/service change must forget manual nested expansion.
          await change(`${root(sector)} select[aria-label$="ledger metric"]`, 'coverage');
          await change(`${root(sector)} select[aria-label$="ledger metric"]`, 'funding');
          assert.ok(!(await tableRows(sector)).some(row => row.depth > 1));
        } else await checkExport(sector);
      }
      await capture(sector, metric, 1440);
      await capture(sector, metric, 402);
    }
  }
  // Same annual source metric must add across real Urban and Rural scopes.
  console.log('Checking Urban/Rural source addition');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  for (const sector of ['water', 'sanitation']) {
    await change(`${root(sector)} select[aria-label$="ledger metric"]`, 'funding');
    for (const service of ['sm', 'basic', 'total']) {
      await change(`${root(sector)} select[aria-label$="ledger service"]`, service);
      const values = {};
      for (const scope of ['urban', 'rural', 'national']) {
        console.log(`Checking ${sector}/${service}/${scope}`);
        await setScope(scope);
        await w(`!!document.querySelector('${root(sector)} [data-ledger-row="scenario"]')`, 'Scope ledger unavailable.');
        if (sector === 'water') {
          const scopeRows = await tableRows(sector);
          assert.equal(scopeRows.some(row => row.key === 'funding-source-tariff'), scope !== 'urban',
            'Tariff visibility must follow selected area toggles, not source registry presence.');
          await checkExport(sector);
        }
        values[scope] = (await tableRows(sector)).find(row => row.key === 'scenario').values;
      }
      values.national.forEach((value, i) => {
        if (value != null) close(value, values.urban[i] + values.rural[i]);
      });
    }
  }
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  console.log('Checking category controls');
  await e(`Array.from(document.querySelectorAll('[aria-label="Contribution view"] button')).find(b=>b.textContent==='Categories').click()`);
  await w(`!document.querySelector('${root('water')} [data-row-kind="intervention"]')`, 'Category control did not collapse members');
  await checkExport('water');
  await e(`document.querySelector('${root('water')} [data-row-kind="category"] button').click()`);
  assert.ok((await tableRows('water')).some(row => row.kind === 'intervention'), 'Category members are not discoverable');
  await e(`Array.from(document.querySelectorAll('[aria-label="Contribution view"] button')).find(b=>b.textContent==='Individual interventions').click()`);
  await change('[aria-label="Results debt mode"]', 'with_debt');
  console.log('Checking included debt');
  await w(`!!document.querySelector('${root('water')} [data-ledger-row="loanOpeningUnspent"]')`, 'Restricted carryover missing from included-debt funding.');
  console.log('Included-debt rows loaded');
  const funded = await tableRows('water');
  assert.ok(!funded.some(row => row.key === 'funding-source-loan'), 'Restricted loan cash must not be an ordinary contribution.');
  for (const key of ['loanInjection', 'loanOpeningUnspent', 'repayments', 'repaymentsPaid', 'repaymentsUnfunded'])
    assert.ok(funded.some(row => row.key === key), `Debt detail missing: ${key}`);
  console.log('Checking included-debt export');
  await checkExport('water');
  console.log('Included-debt export finished');
  // Keep the full engine response in the browser for local assertions; transferring
  // every audit/source array through CDP needlessly exceeds its response budget.
  const calls = await e(`window.__visibleLedgerCalls.map(call=>({
    status:call.status,tariffEnabled:!!call.input.toggles.ws_tariff_enabled
  }))`);
  assert.ok(calls.length && calls.every(call => call.status === 200), 'Real calculation failed.');
  assert.ok(calls.some(call => call.tariffEnabled) && calls.some(call => !call.tariffEnabled), 'Different area toggles were not exercised.');
  assert.deepEqual(browser.errors, [], 'Browser runtime exception');
  assert.deepEqual(await e('window.__visibleLedgerAlerts'), [], 'Unexpected browser alert');
  assert.equal(readFileSync(profilePath, 'utf8'), originalProfile, 'Saved profile changed.');
  console.log(`Visible ledger browser passed: historical order, signed/paid source parents, categories, expansion reset, shared sanitation, debt, ${exports} exact Excel/CSV pairs, desktop/mobile. Screenshots: ${dir.pathname}`);
} catch (error) {
  console.error('Browser check failed:', error.message);
  if (!error.message.includes('Timed out:')) console.error(await e(`({ledgerErrors:Array.from(document.querySelectorAll('.results-ledger__error')).map(n=>n.textContent),errors:window.__visibleLedgerCalls?.map(c=>({status:c.status,error:c.data?.error})),tabs:Array.from(document.querySelectorAll('.wb-tab')).map(t=>t.textContent)})`));
  throw error;
} finally {
  browser.close();
}
