// Read-only regression against the real persisted public simulation and real HTTP API.
// Only presentation buttons and calculation requests are used. No saved data is changed.
import assert from 'node:assert/strict';
import { openChromium, sleep } from './chromium-client.mjs';

const origin = process.env.APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://127.0.0.1:5000');
const id = '2ecaa81d-b43e-55cc-9c33-e801444eb13f';
const browser = await openChromium(`${origin}/simulations/${id}`);
const e = browser.evaluate, w = browser.waitFor;
const pick = (label, text) => e(`[...document.querySelectorAll('[aria-label="${label}"] button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`);
const populated = sector => w(`document.querySelector('[data-results-sector="${sector}"] [data-testid="results-funds-report"] tbody tr') &&
  document.querySelectorAll('[data-results-sector="${sector}"] .recharts-wrapper').length>=4`, `Persisted ${sector} charts did not populate`);
try {
  await w(`document.querySelectorAll('.wb-tab').length>=5`, 'Public saved route did not open');
  const before = await e(`fetch('/api/simulations/${id}').then(r=>r.json()).then(r=>JSON.stringify(r.bundle))`);
  await e(`window.__publicResultsCalls=[];
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(url,options)=>{
      const response=await originalFetch(url,options);
      if(String(url)==='/api/calculate') {
        const result=await response.clone().json();
        __publicResultsCalls.push({input:JSON.parse(options.body),status:response.status,
          water:!!result.water_supply,sanitation:!!result.sanitation,
          issues:result.intervention_issues||[],errors:result.sector_errors||{}});
      }
      return response;
    };
    [...document.querySelectorAll('.wb-tab')].at(-1).click()`);
  await populated('water');
  assert.equal(await e(`document.querySelector('[aria-label="Results geography"] [aria-pressed="true"]').textContent`), 'Urban',
    'Initial Results scope must match the active area rather than silently jumping to National');
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`), 'with_debt');
  assert.equal(await e(`document.querySelector('[aria-label="Graph start year"]').value`), '2026');
  await pick('Results geography', 'National');
  await w(`document.querySelector('[data-testid="results-dashboard"] [role="alert"]')?.textContent.includes('Rural:')`, 'National must identify the invalid constituent area');
  assert.equal(await e(`document.querySelectorAll('[data-testid="results-funds-report"]').length`), 0,
    'Incomplete National must never use Urban-only totals or BAU');
  assert.equal(await e(`document.querySelector('[data-testid="results-dashboard"]').textContent.includes('Improvement start year')`), true,
    'Intervention validation reasons must remain visible even when sector_errors is empty');
  await pick('Results geography', 'Rural'); await pick('Results sector', 'Sanitation');
  await populated('sanitation');
  await pick('Results geography', 'Urban');
  await w(`document.querySelector('[data-testid="results-dashboard"] [role="alert"]')?.textContent.includes('Urban:')`, 'Urban Sanitation must explain its incomplete saved inputs');
  assert.equal(await e(`document.querySelectorAll('[data-testid="results-funds-report"]').length`), 0);
  await pick('Results sector', 'Water Supply'); await populated('water');
  const requests = await e(`__publicResultsCalls`);
  assert.ok(requests.some(call => call.water && !call.sanitation && call.issues.some(issue => issue.sector === 'sanitation')));
  assert.ok(requests.some(call => !call.water && call.sanitation && call.issues.some(issue => issue.sector === 'water')));
  assert.ok(requests.some(call => call.input.utility_debt?.water?.enabled));
  const after = await e(`fetch('/api/simulations/${id}').then(r=>r.json()).then(r=>JSON.stringify(r.bundle))`);
  assert.equal(after, before, 'The public persisted bundle must remain unchanged');
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  console.log('Persisted public Results: real HTTP partial-sector responses, active Urban default with saved enabled loan, valid Urban Water/Rural Sanitation charts, explicit area-specific invalid National/Urban Sanitation errors, no fallback and unchanged saved bundle passed.');
} finally { browser.close(); }
