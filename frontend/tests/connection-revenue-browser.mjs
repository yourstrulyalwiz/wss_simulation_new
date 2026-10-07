// Real Chromium interactions in isolated storage; never writes server profiles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const url = process.env.APP_URL;
assert.ok(url, 'APP_URL is required');
const fixture = JSON.parse(readFileSync('/tmp/connection-revenue-browser-bundle.json', 'utf8'));
const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0, buffer = '';
const pending = new Map(), errors = [];
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0,end));
    buffer = buffer.slice(end+1);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) {
      const {resolve,reject,timer} = pending.get(message.id);
      pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
});
function send(method,params={},sessionId) {
  const id=++sequence;
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error(`Timed out: ${method}`)),20000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
try {
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId);
  await send('Page.enable',{},sessionId);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false},sessionId);
  async function evaluate(expression) {
    const answer=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
    if(answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  }
  async function waitFor(expression,message) {
    for(let i=0;i<80;i++) {
      if(await evaluate(expression)) return;
      await sleep(150);
    }
    throw new Error(message);
  }
  async function enterInput(selector, value) {
    await evaluate(`(()=>{
      const el=${selector};
      const prototype=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await sleep(40);
  }
  await send('Page.navigate',{url},sessionId);
  await waitFor(`!!document.querySelector('.wb-app')`,'Application did not load');
  await sleep(700);
  await evaluate(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(fixture))})`);
  await send('Page.reload',{},sessionId);
  const section = `document.querySelector('section[aria-label^="Connection-based revenue"]')`;
  await waitFor(`!!document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger')`,
    'Revenue section missing');
  await evaluate(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  await waitFor(`!!${section}`,'Connection-based inputs missing');
  assert.equal(await evaluate(`${section}.querySelector('input[type="checkbox"]').checked`),false);
  await evaluate(`${section}.querySelector('input[type="checkbox"]').click()`);
  await waitFor(`${section}.querySelector('[role="status"]').textContent.includes('Effective: connection-based')`,
    'Backend did not confirm valid configuration');
  assert.ok(await evaluate(`${section}.textContent.includes('Baseline billed households:')`));
  assert.ok(await evaluate(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]')?.max === '100'`),
    'New Basic billing must display a 0–100 percentage');
  assert.ok(await evaluate(`${section}.querySelector('[aria-label="New Safely Managed connections billed (%)"]')?.max === '100'`),
    'New SM billing must display a 0–100 percentage');
  assert.ok(await evaluate(`${section}.querySelector('[aria-label="Cost source"]')?.value === 'per_m3'`),
    'Migrated legacy cost must remain on the per-m³ basis');
  assert.ok(await evaluate(`${section}.textContent.includes('Advanced / baseline calibration')`),
    'Baseline calibration controls must remain available under Advanced');
  const billedBasicPercent = await evaluate(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]').value`);
  await enterInput(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]')`, '0');
  await enterInput(`${section}.querySelector('[aria-label="Source / assumption note"]')`, 'Browser regression: explicitly selected zero future Basic billing');
  await waitFor(`(()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle')||'{}');
    return [b.inputs,...Object.values(b.altInputs||{})].some(i=>i?.connection_revenue?.water?.version===3&&i.connection_revenue.water.new_billed_share_basic===0);
  })()`,'Percentage input did not persist as a v3 fractional zero');
  await enterInput(`${section}.querySelector('[aria-label="New Basic connections billed (%)"]')`, billedBasicPercent);
  assert.ok(await evaluate(`${section}.querySelector('[aria-label="Source / assumption note"]') != null`),
    'Shared source / assumption note must be visible');
  const billedSmPercent = await evaluate(`${section}.querySelector('[aria-label="New Safely Managed connections billed (%)"]').value`);
  await enterInput(`${section}.querySelector('[aria-label="New Safely Managed connections billed (%)"]')`, '');
  await waitFor(`${section}.querySelector('[role="alert"]')?.textContent.includes('New Safely Managed connections billed is required')`,
    'Missing new-connection calibration must be disclosed');
  await enterInput(`${section}.querySelector('[aria-label="New Safely Managed connections billed (%)"]')`, billedSmPercent);
  await evaluate(`${section}.querySelector('[aria-label="Cost source"]').value='annual_household';${section}.querySelector('[aria-label="Cost source"]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await waitFor(`${section}.querySelector('[aria-label="Annual operating cost per billed household"]')?.type==='number'`,
    'Manual annual household cost control did not appear');
  await enterInput(`${section}.querySelector('[aria-label="Annual operating cost per billed household"]')`, '0');
  await waitFor(`${section}.textContent.includes('confirm zero cost')`,
    'Zero-cost confirmation must appear for an explicitly selected zero cost');
  await evaluate(`${section}.querySelector('[aria-label="Cost source"]').value='per_m3';${section}.querySelector('[aria-label="Cost source"]').dispatchEvent(new Event('change',{bubbles:true}))`);
  // Disabling restores exogenous mode but must not erase empirical inputs.
  const shares=await evaluate(`[...${section}.querySelectorAll('input[type="number"]')].slice(0,4).map(e=>e.value)`);
  await evaluate(`${section}.querySelector('input[type="checkbox"]').click()`);
  await waitFor(`${section}.querySelector('[role="status"]').textContent.includes('Effective: exogenous')`,
    'Disabling did not restore exogenous mode');
  assert.deepEqual(await evaluate(`[...${section}.querySelectorAll('input[type="number"]')].slice(0,4).map(e=>e.value)`),shares);
  await evaluate(`${section}.querySelector('input[type="checkbox"]').click()`);
  await waitFor(`${section}.querySelector('[role="status"]').textContent.includes('Effective: connection-based')`,
    'Re-enabling discarded configuration');
  await waitFor(`(()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle')||'{}');
    return [b.inputs,...Object.values(b.altInputs||{})].some(i=>{
      const c=i?.connection_revenue?.water;
      return c?.enabled===true && c.cost_basis==='per_m3' &&
        c.new_billed_share_basic===${Number(billedBasicPercent)/100} &&
        c.new_billed_share_sm===${Number(billedSmPercent)/100};
    });
  })()`,'Debounced autosave did not persist the enabled configuration');
  await send('Page.reload',{},sessionId);
  await waitFor(`!!document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger')`,
    'Revenue section missing after reload');
  await evaluate(`document.querySelector('[data-section-key="revenue_inputs"] .wb-section-trigger').click()`);
  await waitFor(`${section}?.querySelector('[role="status"]')?.textContent.includes('Effective: connection-based')`,
    'Save/reload lost active configuration');
  assert.deepEqual(await evaluate(`[...${section}.querySelectorAll('input[type="number"]')].slice(0,4).map(e=>e.value)`),shares);
  // The other sector must remain independently disabled.
  await evaluate(`(()=>{
    const b=[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s/g,'')==='Sanitation');
    if(!b)throw Error('Sanitation selector missing');b.click();
  })()`);
  await waitFor(`${section}?.getAttribute('aria-label').endsWith('sanitation')`,'Sector switch failed');
  assert.equal(await evaluate(`${section}.querySelector('input[type="checkbox"]').checked`),false);
  await evaluate(`(()=>{
    const b=[...document.querySelectorAll('.wb-tab')].find(b=>b.textContent.replace(/\\s/g,'').includes('ResultsDashboard'));
    if(!b)throw Error('Results tab missing');b.click();
  })()`);
  await waitFor(`document.querySelectorAll('[data-revenue-details]').length===2`,'Revenue tables missing');
  const details=await evaluate(`[...document.querySelectorAll('[data-revenue-details]')].map(s=>{
    const d=s.querySelector('details');if(d)d.open=true;
    return {text:s.textContent,rows:s.querySelectorAll('tbody tr').length};
  })`);
  for(const detail of details) {
    assert.ok(detail.rows>0,'Annual revenue rows missing');
    assert.ok(detail.text.includes('Connection net cash'),'Signed connection cash column missing');
    assert.ok(detail.text.includes('operating'),'Operating cost disclosure missing');
  }
  const financingScope = await evaluate(`document.querySelector('[data-results-chart="water_gap"]')?.textContent || ''`);
  assert.match(financingScope, /safely managed.*basic/i, 'Financing chart must disclose its combined service scope');
  assert.equal(errors.length,0,JSON.stringify(errors));
  await send('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:true},sessionId);
  await sleep(300);
  assert.ok(await evaluate(`document.querySelectorAll('[data-revenue-details]').length===2`));
  console.log('Connection revenue: enable/disable, calibration, preservation, reload, sector isolation, annual diagnostics, graphs and mobile render passed.');
} finally {
  browser.kill();
  for(const value of pending.values())clearTimeout(value.timer);
}
