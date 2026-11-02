import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'vite';
import { openChromium, sleep } from './chromium-client.mjs';
import { engineLoanFixtures } from './loan-workspace-fixtures.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const built = await build({ configFile: false, root, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.resolve(root, '../node_modules/react'), 'react-dom': path.resolve(root, '../node_modules/react-dom'),
  } },
  build: { write: false, lib: { entry: path.join(root, 'tests/loan-workspace-harness.tsx'), name: 'LoanHarness', formats: ['iife'] }, minify: false },
});
const output = (Array.isArray(built) ? built[0] : built).output;
const browser = await openChromium('about:blank'), e = browser.evaluate, w = browser.waitFor;
const screenshots = path.join(root, 'screenshots/loan-workspace');
mkdirSync(screenshots, { recursive: true });
const capture = async name => {
  const { data } = await browser.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(screenshots, name), Buffer.from(data, 'base64'));
};
const navigate = index => e(`document.querySelectorAll('.loan-workspace .modern-inputs-nav__item')[${index}].click()`);
const change = (selector, value, select = true) => e(`{
  const n=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(n,${JSON.stringify(String(value))});
  n.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));
}`);
const clickExport = async (selector, label) => {
  await e(`Array.from(document.querySelectorAll('${selector} button')).find(n=>n.textContent.includes('${label}')).click()`);
  await sleep(100);
};
try {
  await e(`document.body.innerHTML='<div id="root"></div>';document.body.style.margin='0'`);
  await e(`{const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';document.head.append(viewport)}`);
  await e(`window.__fixture=${JSON.stringify(engineLoanFixtures())}`);
  const css = output.filter(asset => asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  await e(`{const style=document.createElement('style');style.textContent=${JSON.stringify(css + '\n#root{height:100dvh;display:flex} *{box-sizing:border-box} body{font-family:system-ui,sans-serif}')} ;document.head.append(style)}`);
  await e(output.find(asset => asset.type === 'chunk').code);
  await w(`!!document.querySelector('[data-testid="loan-coverage-chart"] .recharts-surface')`, 'Coverage graph failed to mount');
  assert.deepEqual(await e(`[...document.querySelectorAll('.modern-inputs-nav__item')].map(n=>n.textContent)`), ['1Loan Settings', '2Loan Graph', '3Coverage Comparison', '4Loan Cash Flow & Repayment']);
  assert.equal(await e(`(()=>{
    const nav=document.querySelector('nav').getBoundingClientRect(), settings=document.querySelector('.loan-settings').getBoundingClientRect(), main=document.querySelector('.intervention-reading-content').getBoundingClientRect();
    return Math.abs(nav.right-settings.left)<2 && Math.abs(settings.right-main.left)<2 && main.width>500;
  })()`), true, 'Settings immediately right of nav, independent long body next');
  assert.equal(await e(`document.querySelectorAll('[data-testid="loan-coverage-chart"]').length`), 1);
  assert.equal(await e(`document.querySelectorAll('[data-testid="loan-funds-chart"]').length`), 1);
  assert.equal(await e(`document.querySelectorAll('.loan-optional[open]').length`), 0);
  assert.equal(await e(`document.querySelectorAll('.loan-workspace .debt-chart-stack, .loan-workspace .intervention-nav-groups').length`), 0);
  const before = await e(`JSON.stringify(__inputs)`);
  await capture('desktop-settings.png');
  await navigate(1);
  await w(`document.querySelector('.loan-settings').hidden`, 'Graph navigation must hide settings');
  assert.equal(await e(`JSON.stringify(__inputs)`), before, 'Navigation must not mutate loan state');
  await sleep(2100);
  await e(`{const host=document.querySelector('.intervention-reading-content'),funds=document.querySelector('[data-testid="loan-funds-chart"]');host.scrollTop+=funds.getBoundingClientRect().top-host.getBoundingClientRect().top-12}`);
  await capture('desktop-funds.png');
  await navigate(2);
  await w(`Math.abs(document.querySelector('[data-section-key="table"]').getBoundingClientRect().top-document.querySelector('.intervention-reading-content').getBoundingClientRect().top)<30`, 'Comparison destination must remain anchored');
  await capture('desktop-comparison.png');
  assert.deepEqual(await e(`[...document.querySelectorAll('[data-testid="loan-coverage-comparison"] thead th')].slice(2,7).map(n=>n.textContent)`),
    ['BAU households (M)', 'Intervention without loan households (M)', 'With loan households (M)', 'Target households (M)', 'Marginal loan effect (M HH)']);
  assert.equal(await e(`[...document.querySelectorAll('[data-testid="loan-coverage-comparison"] tbody tr')].every(n=>+n.firstElementChild.textContent>2025)`), true);
  for (const label of ['Safely managed', 'Basic only', 'At least basic']) {
    await e(`[...document.querySelectorAll('[aria-label="Loan comparison service level"] button')].find(n=>n.textContent==='${label}').click()`);
    assert.equal(await e(`document.querySelector('[aria-label="Loan graph service level"] [aria-pressed="true"]').textContent`), label);
    assert.equal(await e(`document.querySelector('[data-section-key="table"] h2').textContent.includes('${label}')`), true);
  }
  await e(`document.querySelector('[aria-label="Loan coverage units"] button:last-child').click()`);
  await change('[aria-label="Loan chart start year"]', 2029);
  await change('[aria-label="Loan chart end year"]', 2034);
  await clickExport('[data-testid="loan-coverage-chart"]', 'Excel');
  await w(`__requests.some(r=>r.url.includes('/export/chart'))`, 'Coverage native Excel export missing');
  const chart = await e(`__requests.find(r=>r.url.includes('/export/chart')).body`);
  assert.deepEqual(chart.sheets[0].rows.map(row => row[0]), [2029, 2030, 2031, 2032, 2033, 2034]);
  assert.ok(chart.sheets[0].headers.some(header => header.includes('Marginal loan effect') && header.includes('(pp)')));
  assert.ok(chart.chartSpec.lines.some(line => line.name.includes('Intervention without loan')));
  await clickExport('[data-testid="loan-funds-chart"]', 'Excel');
  const fundExport = await e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
  assert.deepEqual(fundExport.rows.map(row => row[0]), [2029, 2030, 2031, 2032, 2033, 2034]);
  assert.ok(fundExport.headers.some(header => header.includes('Opening restricted carry') && !header.includes('/yr')));
  await e(`[...document.querySelectorAll('[aria-label="Contribution view"] button')].find(n=>n.textContent==='Categories').click()`);
  assert.equal(await e(`document.querySelector('[aria-label="Contribution view"] [aria-pressed="true"]').textContent`), 'Categories');
  await clickExport('[data-testid="loan-coverage-comparison"]', 'CSV');
  await w('__csv.length>0', 'CSV missing');
  await clickExport('[data-testid="loan-coverage-comparison"]', 'Excel');
  await w(`__requests.some(r=>r.url.includes('/export/table'))`, 'Excel request missing');
  const exported = await e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
  assert.equal(exported.headers.length, 18);
  assert.equal(exported.rows[0][0], 2026);
  assert.equal(exported.headers[6], 'Marginal loan effect (M HH)');
  assert.match(await e('__csv[0]'), /Intervention without loan households \(M\)/);
  const exact = await e(`__fixture.urban.enabled.water_supply.scenario_hh[0][15]+__fixture.urban.enabled.water_supply.scenario_hh[1][15]`);
  assert.ok(Math.abs(exported.rows[0][4] - exact) < 1e-10);
  await e(`__editRate()`); await sleep(80);
  await clickExport('[data-testid="loan-coverage-comparison"]', 'Excel');
  const usd = await e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
  assert.ok(usd.headers[8].includes('B USD'));
  assert.ok(Math.abs(usd.rows[0][8] * 132.7 - exported.rows[0][8]) < 1e-8);
  assert.equal(usd.rows[0][4], exported.rows[0][4], 'Currency must not alter households');
  for (const key of ['cash_flow']) {
    await navigate(3);
    await w(`document.querySelector('[data-testid="loan-${key}"]').open`, 'Navigation opens the ledger');
    assert.equal(await e(`document.querySelector('[data-section-key="${key}"] h2').classList.contains('modern-input-section-heading')`), true);
    assert.equal(await e(`[...document.querySelectorAll('[data-testid="loan-${key}"] tbody tr')].every(n=>+n.firstElementChild.textContent>2025)`), true);
    await clickExport(`[data-testid="loan-${key}"]`, 'Excel');
    const ledger = await e(`__requests.filter(r=>r.url.includes('/export/table')).at(-1).body.sheets[0]`);
    assert.ok(ledger.rows.every(row => row[0] > 2025));
    assert.ok(ledger.rows.at(-1)[0] > 2040);
    assert.ok(ledger.headers.every(header => !/unfunded|new injection|investment from proceeds|disbursement/i.test(header)));
    assert.equal(typeof ledger.rows[0][1], 'number', 'Excel cells remain numeric');
  }
  await navigate(0);
  await e(`document.querySelector('[aria-label="Include indicative borrowing"]').click()`);
  await w(`!__inputs.urban.utility_debt.water.enabled`, 'Activation failed');
  assert.equal(await e(`__inputs.urban.utility_debt.water.loan_term_years`), 16, 'Disabled state retains terms');
  assert.equal(await e(`[...document.querySelectorAll('[data-testid="loan-coverage-comparison"] tbody tr')].every(n=>n.children[6].textContent==='0')`), true, 'Disabled marginal must be exact engine zero');
  await e(`document.querySelector('[aria-label="Include indicative borrowing"]').click()`);
  await change('.debt-controls input[type="number"]', 72, false);
  await w(`__inputs.urban.utility_debt.water.allocation_share===.72`, 'Loan settings not wired');
  await e(`[...document.querySelectorAll('[aria-label="Loan geography"] button')].find(n=>n.textContent==='Rural').click()`);
  await w(`document.querySelector('.loan-settings h2').textContent.includes('Rural')`, 'Scope heading not synchronized');
  assert.equal(await e('__inputs.rural.utility_debt.water.allocation_share'), .3, 'Separate areas retain independent assumptions');
  for (const sector of ['water', 'sanitation']) {
    await e(`[...document.querySelectorAll('[aria-label="Loan sector"] button')].find(n=>n.textContent==='${sector === 'water' ? 'Water Supply' : 'Sanitation'}').click()`);
    assert.equal(await e(`document.querySelector('[data-section-key="graph"] h2').textContent.includes('${sector === 'water' ? 'Water Supply' : 'Sanitation'}')`), true);
  }
  await e(`__setReadOnly(true)`);
  await w(`document.querySelector('.debt-controls fieldset').disabled`, 'Saved read-only loan controls remain editable');
  assert.equal(await e(`[...document.querySelectorAll('[aria-label="Loan geography"] button')].every(n=>!n.disabled)`), true, 'Read-only presentation scope remains usable');
  assert.equal(await e(`document.querySelector('[aria-label="Loan geography"] button[aria-pressed="true"]').textContent`), 'Rural');
  await capture('saved-read-only.png');
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  assert.equal(await e(`document.documentElement.scrollWidth <= innerWidth+1`), true, 'Mobile must not overflow viewport');
  assert.equal(await e(`document.querySelector('.intervention-reading-content').getBoundingClientRect().top >= document.querySelector('.loan-settings').getBoundingClientRect().bottom-1`), true, 'Mobile main body must follow the full settings panel without overlap');
  await capture('mobile-settings.png');
  await change('[aria-label="Loan funding section"]', 'table');
  await w(`document.querySelector('.loan-settings').hidden`, 'Mobile section navigation did not hide settings');
  await sleep(250);
  assert.equal(await e(`getComputedStyle(document.querySelector('[data-testid="loan-coverage-comparison"] tbody tr')).display`), 'grid', 'Comparison becomes labeled cards');
  await capture('mobile-comparison.png');
  await e(`__setReadOnly(false); __setError('Temporary calculation failure')`);
  await w(`document.querySelector('[role="alert"]')?.textContent.includes('Temporary')`, 'Error state missing');
  await e(`document.querySelector('[role="alert"] button').click()`);
  await w(`!!document.querySelector('[data-testid="loan-coverage-chart"]')`, 'Retry did not recover');
  await e(`__setLoading(true)`);
  await w(`!!document.querySelector('[aria-label="Loading loan results"] .modern-skeleton')`, 'Loading skeleton missing');
  await e(`__setLoading(false);__setInputs({...__inputs.rural,utility_debt:{...__inputs.rural.utility_debt,sanitation:{...__inputs.rural.utility_debt.sanitation,annual_real_interest_rate:null,loan_term_years:null}}})`);
  await w(`!!document.querySelector('.debt-invalid-year')`, 'Missing required settings need validation');
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log('Loan browser: real engine snapshots; adjacent layout, long-body navigation, activation/settings, three service views, sector/scope isolation, CSV/Excel dates/numeric units, full maturity, read-only, mobile, retry/loading/validation passed.');
} finally { browser.close(); }
