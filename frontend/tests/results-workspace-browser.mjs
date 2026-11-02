// Real Results component, real engine on EVERY calculation request. No server profiles or DB.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { build } from 'vite';
import { engineLoanFixtures } from './loan-workspace-fixtures.mjs';
import { openChromium, sleep } from './chromium-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = engineLoanFixtures();
// A persistent, isolated engine worker avoids either network fixtures or a fake ordered comparison.
const worker = spawn('python', ['-u', '-c', `
import json,sys
from demo_adapter import coerce_to_engine
from model.engine import calculate
for line in sys.stdin:
 try:
  result=calculate(coerce_to_engine(json.loads(line)))
  print(json.dumps({'status':200,'body':result},allow_nan=False),flush=True)
 except Exception as error:
  print(json.dumps({'status':422,'body':{'detail':str(error)}}),flush=True)
`], { cwd: path.resolve(root, '..'), stdio: ['pipe', 'pipe', 'inherit'] });
const pending = [];
let closed = false;
createInterface({ input: worker.stdout }).on('line', line => {
  if (!closed) pending.shift()?.(JSON.parse(line));
});
const calculate = body => new Promise(resolve => { pending.push(resolve); worker.stdin.write(JSON.stringify(body) + '\n'); });
const built = await build({ configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom'),
  } },
  build: { write: false, lib: { entry: path.join(root, 'tests/results-workspace-harness.tsx'), name: 'ResultsHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const browser = await openChromium('about:blank'), e = browser.evaluate, w = browser.waitFor;
// Bind browser requests to the actual local calculation engine without starting a workflow.
// CDP helper intentionally exposes command-only API; use a tiny in-page queue and poll it.
const bridge = setInterval(async () => {
  try {
    const jobs = await e('window.__jobs?.splice(0) || []');
    for (const job of jobs) calculate(job.body).then(result => {
      if (!closed) return e(`window.__resolve[${job.id}](${JSON.stringify(result)});delete window.__resolve[${job.id}]`);
    }).catch(error => { if (!closed) console.error(error); });
  } catch { /* page teardown */ }
}, 25);
const screenshots = path.join(root, 'screenshots/loan-workspace');
mkdirSync(screenshots, { recursive: true });
const capture = async name => writeFileSync(path.join(screenshots, name),
  Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const select = (selector, value) => e(`{
  const node=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,${JSON.stringify(String(value))});
  node.dispatchEvent(new Event('change',{bubbles:true}));
}`);
const pick = (label, text) => e(`[...document.querySelectorAll('[aria-label="${label}"] button')].find(n=>n.textContent===${JSON.stringify(text)}).click()`);
const ready = async () => {
  await w(`!!document.querySelector('[data-testid="results-funds-report"] tbody tr') && !document.querySelector('[aria-label="Loading results"]')`, 'Real Results reports failed to render');
};
const exportedFunds = async () => {
  await e(`document.querySelector('[data-testid="results-funds-report"] [title="Download this table as Excel (.xlsx)"]').click()`);
  await w(`__requests.some(r=>r.url.includes('/export/table'))`, 'Funds workbook request missing');
  return e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
};
const compare = (actual, expected, factor = 1) => {
  const columns = ['public', 'external', 'mobilized', 'connections', 'nrw', 'collection', 'tariff', 'additional', 'total', 'injection', 'newFunds', 'paid', 'net'];
  assert.equal(actual.rows.length, expected.length);
  actual.rows.forEach((row, index) => {
    assert.equal(row[0], expected[index].year);
    columns.forEach((key, i) => {
      const value = expected[index][key];
      if (value === null) assert.equal(row[i + 1], null);
      else assert.ok(Math.abs(row[i + 1] - value / 1000 / factor) < 1e-8, `${row[0]} ${key}: ${row[i + 1]} != ${value / 1000 / factor}`);
    });
  });
};
// Reporting helper and all nested imports loaded exactly as in reporting regression.
const report = spawnSync('node', ['--input-type=module', '-e', `
import { createRequire } from 'node:module';import fs from 'node:fs';import ts from 'typescript';
const require=createRequire(import.meta.url);require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,f);
const {aggregateLoanFundsRows}=require('./src/loanFundingReporting.ts');
const fixtures=JSON.parse(fs.readFileSync(0,'utf8'));
const out={};for(const sector of ['water_supply','sanitation'])for(const mode of ['enabled','disabled']){
out[sector+'_'+mode]={};
for(const area of ['urban','rural'])out[sector+'_'+mode][area]=aggregateLoanFundsRows([fixtures[area][mode]],sector,[2025]);
out[sector+'_'+mode].national=aggregateLoanFundsRows([fixtures.urban[mode],fixtures.rural[mode]],sector,[2025,2025]);}
console.log(JSON.stringify(out));
`], { cwd: root, input: JSON.stringify(fixtures), encoding: 'utf8', maxBuffer: 32e6 });
assert.equal(report.status, 0, report.stderr);
const expected = JSON.parse(report.stdout);
try {
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0';
    window.__jobs=[];window.__resolve={};window.__jobId=0;
    window.__calculate=body=>new Promise(resolve=>{const id=++__jobId;__resolve[id]=resolve;__jobs.push({id,body})});
    const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);
    window.__fixture=${JSON.stringify(fixtures)}`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex} *{box-sizing:border-box} body{font-family:system-ui,sans-serif}')};document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await ready();
  console.log('Results ready; checking defaults and matched funds exports');
  assert.equal(await e(`(()=>{const nav=document.querySelector('nav').getBoundingClientRect(),main=document.querySelector('.intervention-reading-content').getBoundingClientRect();return Math.abs(nav.right-main.left)<2 && main.width>800 && getComputedStyle(document.querySelector('.intervention-reading-content')).overflowY==='auto'})()`), true,
    'Numbered navigation and independently scrolling reading body must match Tabs 3 and 4');
  await capture('results-desktop-coverage.png');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'with_debt');
  assert.deepEqual(await e(`[...document.querySelectorAll('[data-section-key]')].map(n=>n.dataset.sectionKey)`),
    ['coverage', 'capital', 'funds', 'ledger', 'attribution', 'summary']);
  assert.equal(await e(`document.querySelectorAll('[data-results-chart$="_gap"],.remaining-need-chart,[data-revenue-details],.debt-controls,input[type="number"]').length`), 0);
  assert.equal(await e(`document.querySelectorAll('[data-section-key="summary"] > details[open]').length`), 0);
  assert.equal(await e(`document.querySelector('[aria-label="Graph start year"]').value`), '2026');
  const original = await e('JSON.stringify(__inputs)');
  for (const sector of ['water', 'sanitation']) {
    await pick('Results sector', sector === 'water' ? 'Water Supply' : 'Sanitation'); await ready();
    for (const area of ['urban', 'rural', 'national']) {
      console.log(`Results engine/export: ${area} ${sector}`);
      await pick('Results geography', area[0].toUpperCase() + area.slice(1)); await sleep(450); await ready();
      compare(await exportedFunds(), expected[`${sector === 'water' ? 'water_supply' : 'sanitation'}_enabled`][area]);
      assert.equal(await e(`document.querySelector('[data-section-key="ledger"] > h2').textContent.includes('${sector === 'water' ? 'Water Supply' : 'Sanitation'} Ledger')`), true);
    }
  }
  assert.equal(await e('JSON.stringify(__inputs)'), original, 'Read-only controls must never mutate saved settings');
  console.log('Checking preserved ledger services, metrics and visible-row exports');
  for (const sector of ['Water Supply', 'Sanitation']) {
    await pick('Results sector', sector); await ready();
    for (const metric of ['coverage', 'funding', 'requirements', 'gap']) {
      await select(`[aria-label="${sector} ledger metric"]`, metric);
      for (const service of ['sm', 'basic', 'total']) {
        await select(`[aria-label="${sector} ledger service"]`, service);
        await sleep(50);
        assert.equal(await e(`document.querySelectorAll('.results-ledger tbody tr[data-ledger-row]').length>0`), true);
      }
    }
    const visible = await e(`[...document.querySelectorAll('.results-ledger tbody tr[data-ledger-row]')].map(row=>({
      label:row.querySelector('th').textContent,values:[...row.querySelectorAll('[data-ledger-year]')].map(cell=>cell.title==='Not available'?null:Number(cell.title))
    }))`);
    await e(`document.querySelector('.results-ledger__export [title="Download this table as Excel (.xlsx)"]').click()`);
    await sleep(100);
    const ledgerExport = await e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
    const year = ledgerExport.headers.findIndex(header => /^\d{4}$/.test(header));
    assert.ok(year > 0);
    assert.deepEqual(ledgerExport.rows.map(row => row.slice(year, year + visible[0].values.length)), visible.map(row => row.values),
      'Visible exact ledger amounts and exported numbers must match');
  }
  await pick('Results sector', 'Water Supply');
  assert.equal(await e(`document.querySelector('[aria-label="Water Supply ledger service"]').value`), 'total', 'Sector selections must be independent and retained');
  await pick('Results sector', 'Sanitation');
  console.log('Checking navigation and collapsed summaries');
  for (let index = 0; index < 6; index++) {
    await e(`document.querySelectorAll('.modern-inputs-nav__item')[${index}].click()`);
    await sleep(80);
    assert.equal(await e(`Math.abs(document.querySelectorAll('[data-section-key]')[${index}].getBoundingClientRect().top-document.querySelector('.intervention-reading-content').getBoundingClientRect().top)<30`), true, `Navigation ${index + 1} must align the independent reading body`);
  }
  assert.equal(await e(`document.querySelectorAll('[data-section-key="summary"] > details[open]').length`), 0, 'Navigation must not expand all summaries');
  await e(`document.querySelector('[data-section-key="summary"] > details > summary').click()`);
  assert.equal(await e(`document.querySelector('[data-section-key="summary"] > details').open`), true);
  await capture('results-desktop-summary.png');
  await pick('Results geography', 'Urban'); await sleep(450); await ready();
  console.log('Checking year filters, CSV, currency and debt exclusion');
  await select('[aria-label="Graph start year"]', 2029); await select('[aria-label="Graph end year"]', 2034);
  compare(await exportedFunds(), expected.sanitation_enabled.urban.filter(row => row.year >= 2029 && row.year <= 2034));
  await e(`[...document.querySelectorAll('[data-testid="results-funds-report"] button')].find(n=>n.textContent.includes('CSV')).click()`);
  await w('__csv.length>0', 'CSV not produced');
  assert.match(await e('__csv.at(-1)'), /Net new available funds/);
  await pick('Contribution view', 'Categories');
  compare(await exportedFunds(), expected.sanitation_enabled.urban.filter(row => row.year >= 2029 && row.year <= 2034));
  await e(`[...document.querySelectorAll('button')].find(n=>n.textContent.includes('USD')).click()`);
  await sleep(80);
  compare(await exportedFunds(), expected.sanitation_enabled.urban.filter(row => row.year >= 2029 && row.year <= 2034), 132.7);
  await select('[aria-label="Results debt mode"]', 'without_debt'); await sleep(450); await ready();
  compare(await exportedFunds(), expected.sanitation_disabled.urban.filter(row => row.year >= 2029 && row.year <= 2034), 132.7);
  assert.equal(await e('JSON.stringify(__inputs)'), original);
  await select('[aria-label="Results debt mode"]', 'with_debt'); await sleep(450); await ready();
  console.log('Checking disabled, absent and active-invalid loans');
  await e(`__setAreas(Object.fromEntries(Object.entries(__inputs).map(([area,x])=>[area,{...x,utility_debt:{
    ...x.utility_debt,[area==='urban'?'water':'sanitation']:{...x.utility_debt[area==='urban'?'water':'sanitation'],enabled:false}}}])))`);
  for (const sector of ['water', 'sanitation']) {
    await pick('Results sector', sector === 'water' ? 'Water Supply' : 'Sanitation');
    for (const area of ['urban', 'rural']) {
      await pick('Results geography', area === 'urban' ? 'Urban' : 'Rural'); await sleep(450); await ready();
      const mode = (area === 'urban' ? sector === 'water' : sector === 'sanitation') ? 'disabled' : 'enabled';
      compare(await exportedFunds(), expected[`${sector === 'water' ? 'water_supply' : 'sanitation'}_${mode}`][area].filter(row => row.year >= 2029 && row.year <= 2034), 132.7);
    }
  }
  // Disabled malformed terms and absent settings must not invalidate ordinary results in either sector.
  await e(`__setAreas(Object.fromEntries(Object.entries(__inputs).map(([a,x])=>[a,{...x,utility_debt:{water:{enabled:false,annual_real_interest_rate:null},sanitation:{enabled:false,loan_term_years:null}}}])))`);
  await sleep(450); await ready();
  for (const sector of ['water', 'sanitation']) {
    await pick('Results sector', sector === 'water' ? 'Water Supply' : 'Sanitation'); await ready();
    for (const area of ['Urban', 'Rural']) {
      await pick('Results geography', area); await sleep(450); await ready();
      compare(await exportedFunds(), expected[`${sector === 'water' ? 'water_supply' : 'sanitation'}_disabled`][area.toLowerCase()].filter(row => row.year >= 2029 && row.year <= 2034), 132.7);
    }
  }
  await e(`__setAreas(Object.fromEntries(Object.entries(__inputs).map(([a,x])=>{const y={...x};delete y.utility_debt;return [a,y]})))`);
  await sleep(450); await ready();
  assert.equal(await e('__inputs.rural.utility_debt'), undefined);
  // Active invalid loan errors clear stale graphs in both areas and sectors.
  for (const area of ['urban', 'rural']) for (const sector of ['water', 'sanitation']) {
    await e(`__setAreas({urban:__fixture.urban.inputs,rural:__fixture.rural.inputs,${area}:{...__fixture.${area}.inputs,utility_debt:{...__fixture.${area}.inputs.utility_debt,
      ${sector}:{...__fixture.${area}.inputs.utility_debt.${sector},enabled:true,loan_term_years:null,annual_real_interest_rate:null}}}})`);
    await pick('Results geography', area === 'urban' ? 'Urban' : 'Rural');
    await pick('Results sector', sector === 'water' ? 'Water Supply' : 'Sanitation');
    await sleep(600);
    await w(`!!document.querySelector('[role="alert"]') && !document.querySelector('[data-testid="results-funds-report"]')`, 'Invalid loan must show error, never stale or BAU fallback');
    await select('[aria-label="Results debt mode"]', 'without_debt'); await sleep(450); await ready();
    await select('[aria-label="Results debt mode"]', 'with_debt'); await sleep(600);
    await pick('Results sector', sector === 'water' ? 'Sanitation' : 'Water Supply');
    assert.equal(await e(`!!document.querySelector('[role="alert"]') && !document.querySelector('[data-testid="results-funds-report"]')`), true,
      'Engine-wide invalid loan errors must remain explicit rather than silently using a different scenario');
    await e(`__setAreas({urban:__fixture.urban.inputs,rural:__fixture.rural.inputs})`); await sleep(450); await ready();
  }
  await e(`__setAreas({urban:__fixture.urban.inputs,rural:__fixture.rural.inputs})`); await sleep(450); await ready();
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await select('[aria-label="Results section"]', 'funds'); await sleep(150);
  assert.equal(await e(`document.documentElement.scrollWidth<=innerWidth+1`), true);
  assert.equal(await e(`getComputedStyle(document.querySelector('.results-funds-table tbody th')).whiteSpace`), 'nowrap');
  assert.equal(await e(`document.querySelector('.results-funds-table tbody th').getBoundingClientRect().width>=60`), true);
  await capture('results-mobile-funds.png');
  await select('[aria-label="Results section"]', 'ledger'); await sleep(150);
  assert.equal(await e(`document.querySelector('.results-ledger').getBoundingClientRect().width<=innerWidth`), true);
  await capture('results-mobile-ledger.png');
  await e(`__fail=true;__setAreas({...__inputs,urban:{...__inputs.urban},rural:{...__inputs.rural,notes:'retry'}})`);
  await sleep(600);
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('Temporary Results failure')`, 'Error state missing');
  await e(`__fail=false;document.querySelector('[role="alert"] button').click()`);
  await ready();
  await e(`__setSectors(['sanitation'])`); await ready();
  assert.equal(await e(`document.querySelectorAll('[aria-label="Results sector"] button').length`), 1);
  assert.equal(await e(`document.querySelector('[data-section-key="ledger"] > h2').textContent.includes('Sanitation Ledger')`), true);
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log('Results browser: real enabled/disabled/absent/invalid engine loans, both sectors/areas, national sums, default debt, ordered navigation, removed sections, collapsed summaries, forecast range, table/CSV/Excel/currency parity, read-only, retry and mobile passed.');
} finally { closed = true; clearInterval(bridge); worker.kill(); browser.close(); }
