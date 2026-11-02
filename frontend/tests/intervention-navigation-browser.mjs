import assert from 'node:assert/strict';
import { openChromium } from './chromium-client.mjs';

const base = process.env.WSS_TEST_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const route = process.env.WSS_TEST_PATH || '/simulations/2ecaa81d-b43e-55cc-9c33-e801444eb13f';
const saved = await (await fetch(`${base}${route.replace('/simulations/', '/api/simulations/')}`)).json();
const browser = await openChromium(`${base}${route}`);
const evaluate = expression => browser.evaluate(expression);
const navigate = index => evaluate(`document.querySelectorAll('.intervention-section-nav .modern-inputs-nav__item')[${index}].click()`);

try {
  await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.waitFor('document.querySelectorAll(".wb-tab").length > 4', 'Workspace did not load');
  await evaluate(`Array.from(document.querySelectorAll('.wb-tab')).find(node => /BAU/i.test(node.textContent)).click()`);
  await browser.waitFor('!!document.querySelector(".modern-section-workspace .modern-inputs-content")', 'BAU workspace did not load');
  await browser.waitFor('!!document.querySelector(".bau-forecast-table tbody tr")', 'BAU forecast table did not load');
  assert.equal(await evaluate(`[...document.querySelectorAll('.bau-forecast-table tbody tr')].every(row=>[4,9,10].every(i=>!row.children[i].classList.contains('forecast-value--deficit') || row.children[i].textContent.trim().startsWith('-')))`), true, 'BAU deficits have minus signs');
  await evaluate(`window.__bauForecast = {
    headers: [...document.querySelectorAll('.bau-forecast-table thead th')].map(node => node.textContent),
    rows: [...document.querySelectorAll('.bau-forecast-table tbody tr')].map(row => [...row.children].map(node => node.textContent))
  }; true`);
  await evaluate(`window.__workspaceBackground = node => {
    while (node) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
      node = node.parentElement;
    }
    return 'transparent';
  }; window.__bauBackground = window.__workspaceBackground(document.querySelector('.modern-section-workspace .modern-inputs-content')); true`);
  await evaluate(`window.__savedCurrency = ${JSON.stringify(saved.bundle.presentation.currencyDisplay)};
    window.__originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await window.__originalFetch(...args);
      if (String(args[0]).includes('/calculate') && response.ok) {
        const result = await response.clone().json();
        if (result.water_supply) {
          window.__scenarioResult = result;
          window.__scenarioInputs = JSON.parse(args[1].body);
        }
      }
      return response;
    }; true`);
  await evaluate(`Array.from(document.querySelectorAll('.wb-tab')).find(node => /intervention/i.test(node.textContent)).click()`);
  await browser.waitFor('!!document.querySelector(".intervention-section-nav")', 'Numbered navigation is missing');
  assert.equal(await evaluate(`window.__workspaceBackground(document.querySelector('.intervention-reading-content')) === window.__bauBackground`), true, 'Intervention background must match BAU');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Intervention table geography"], [aria-label="Intervention table sector"]').length`), 0, 'Table must use the top geography and sector selectors');
  // The funding breakdown shares the table styling; inspect only the scenario ledger.
  await browser.waitFor('!!document.querySelector(".modern-intv-table-wrap .modern-intv-table tbody tr")', 'Live scenario table did not load');
  assert.equal(await evaluate(`(()=>{const table=document.querySelector('.modern-intv-table-wrap .modern-intv-table'); return table.scrollWidth <= table.parentElement.clientWidth+2;})()`), true, 'All intervention columns fit the content area');
  assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('.modern-intv-table-wrap .modern-intv-table thead th')].filter((_,index)=>index!==3).map(node=>node.textContent)) === JSON.stringify(window.__bauForecast.headers)`), true, 'Keep BAU-style headings');
  assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('.modern-intv-table-wrap .modern-intv-table tbody tr')].map(row=>row.children[2].textContent)) === JSON.stringify(window.__bauForecast.rows.map(row=>row[2]))`), true, 'BAU households remains unchanged');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.modern-intv-table-wrap .modern-intv-table thead th')].slice(2,5).map(node=>node.textContent)`),
    ['BAU households (M)', 'Intervention households (M)', 'Target households (M)']);
  assert.equal(await evaluate(`document.querySelectorAll('.modern-intv-table-wrap .modern-intv-table thead th').length`), 13, 'Do not duplicate scenario funding');
  await browser.waitFor('!!window.__scenarioResult', 'Scenario response missing');
  const expectedRows = await evaluate(`(()=>{
    const r = window.__scenarioResult, s = r.water_supply, settings = window.__savedCurrency;
    const usd = document.querySelector('.modern-intv-table-wrap .modern-intv-table thead').textContent.includes('(B USD');
    const factor = usd && settings.sourceCurrency !== 'USD' ? 1/settings.localPerUsd : 1;
    const fmt = (value, signed=false) => {
      const rounded=Number(value.toPrecision(3));
      return (signed && rounded>0 ? '+' : '') + rounded.toLocaleString('en-US', {maximumFractionDigits:rounded!==0 && Math.abs(rounded)<0.01 ? 6 : 2});
    };
    return r.years.flatMap((year,i)=>{
      if(year <= window.__scenarioInputs.period.baseline_year) return [];
      const sum = key => s[key][0][i] + s[key][1][i];
      const bau = Math.min(r.total_hh[i],sum('bau_hh'));
      const scenario = Math.min(r.total_hh[i],sum('scenario_hh'));
      const target = Math.min(r.total_hh[i],sum('scenario_target_hh'));
      const money = ['new_capex_by_service','replacement_by_service','funded_by_service',
        'replacement_backlog_closing_by_service','financing_gap_by_service'].map(key=>sum('scenario_'+key));
      money[4] = -money[4];
      money.push(-s.scenario_financing_gap[i], s.scenario_available_total[i]);
      return [[String(year), ...[r.total_hh[i],bau,scenario,target].map(value=>fmt(value)), fmt(scenario-target,true),
        ...money.map((value,index)=>fmt(value*factor/1000,index===4 || index===5))]];
    });
  })()`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.modern-intv-table-wrap .modern-intv-table tbody tr')].map(row=>[...row.children].map(node=>node.textContent))`),
    expectedRows, 'Displayed financial values and gaps must match the intervention engine, not BAU');
  await browser.waitFor('document.querySelectorAll(\'[data-section-key="graph"] .modern-intv-kpi\').length === 3', 'Coverage KPI cards must stay above the graphs');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.intervention-section-nav .modern-inputs-nav__item')].map(node => node.textContent.replace(/^\\d+/, '').trim())`),
    ['Intervention Design', 'Intervention Graph', 'Intervention Table']);
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), false);
  const groupedNavigation = await evaluate(`({
    groups: document.querySelectorAll('.intervention-nav-group').length,
    rows: [...document.querySelectorAll('.intervention-nav-link')].map(row => {
      const label = row.querySelector('span').textContent;
      const controlLabel = label === 'Revenue from new connections' ? 'Include revenue from new connections' : label;
      const control = [...document.querySelectorAll('.intervention-workspace__controls input[type="checkbox"]')]
        .find(input => input.getAttribute('aria-label') === 'Enable ' + controlLabel);
      const dot = row.querySelector('.intervention-nav-status');
      return { label, active: dot.dataset.active === 'true', checked: control?.checked,
        color: getComputedStyle(dot).backgroundColor, status: row.getAttribute('aria-label') };
    })
  })`);
  assert.equal(groupedNavigation.groups, 5, 'Live Design navigation contains all five lever categories');
  assert.equal(groupedNavigation.rows.length, 10, 'Live Design navigation contains every available intervention');
  for (const row of groupedNavigation.rows) {
    assert.equal(row.active, row.checked, `${row.label}: live dot matches current enable control`);
    assert.ok(row.status.endsWith(row.active ? 'Active' : 'Inactive'), `${row.label}: accessible active status`);
    if (row.active) assert.equal(row.color, 'rgb(0, 156, 167)', `${row.label}: enabled dot is teal`);
  }
  console.log(`PASS: live grouped navigation has five categories, ten interventions, and ${groupedNavigation.rows.filter(row => row.active).length} teal active dots matching enable controls.`);
  await evaluate(`window.__tableBeforeNavigation = document.querySelector('.modern-intv-table-wrap .modern-intv-table'); window.__coverageBeforeNavigation = document.querySelector('[data-section-key="graph"] .recharts-wrapper'); true`);
  await evaluate(`Array.from(document.querySelectorAll('.intervention-workspace__controls button')).find(node => node.textContent === 'Collection efficiency').click()`);
  await browser.waitFor('!!document.querySelector(".intervention-input-drawer.is-open input")', 'Intervention inputs did not open');
  await navigate(2);
  await browser.waitFor(`(()=>{
    const host = document.querySelector('.intervention-reading-content');
    const top = document.querySelector('[data-section-key="table"]').getBoundingClientRect().top;
    const bounds = host.getBoundingClientRect();
    return Math.abs(top - bounds.top) < 65 ||
      (host.scrollTop >= host.scrollHeight - host.clientHeight - 2 && top >= bounds.top && top < bounds.bottom);
  })()`, 'Table navigation did not scroll');
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), true);
  assert.equal(await evaluate('document.querySelector(".intervention-input-drawer").hidden'), true);
  assert.equal(await evaluate(`window.__tableBeforeNavigation === document.querySelector('.modern-intv-table-wrap .modern-intv-table') && window.__coverageBeforeNavigation === document.querySelector('[data-section-key="graph"] .recharts-wrapper')`), true);
  await evaluate(`document.querySelector('[aria-label="Intervention table service level"] [data-service-level="basic"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Intervention graph service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  await navigate(0);
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), false);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(()=>{ const select = document.querySelector('.intervention-section-nav select'); select.value = 'table'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await browser.waitFor(`(()=>{
    const host = document.querySelector('.intervention-section-workspace');
    const top = document.querySelector('[data-section-key="table"]').getBoundingClientRect().top;
    const bounds = host.getBoundingClientRect();
    return Math.abs(top - bounds.top) < 65 ||
      (host.scrollTop >= host.scrollHeight - host.clientHeight - 2 && top >= bounds.top && top < bounds.bottom);
  })()`, 'Mobile Table navigation did not scroll');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile page overflows horizontally');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: numbered navigation, persistent long-page graph/table, conditional design rail, shared selectors, and mobile section scrolling.');
} finally {
  browser.close();
}
