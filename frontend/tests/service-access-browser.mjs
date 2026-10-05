// Real Chromium interaction checks; isolated browser storage, no server profile writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL must identify the development app.');
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
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},20000);
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
    for(let i=0;i<60;i++) {
      if(await evaluate(expression)) return;
      await sleep(150);
    }
    throw new Error(message);
  }
  await send('Page.navigate',{url},sessionId);
  await waitFor(`!!document.querySelector('.wb-app')`,'Application did not load.');
  await sleep(1000);
  await evaluate(`(async()=>{
    const bundle=await (await fetch('/api/profiles/DRC_Mock_Simulation')).json();
    localStorage.setItem('wss_working_bundle',JSON.stringify(bundle));
  })()`);
  await send('Page.reload',{},sessionId);
  await sleep(1200);
  const original=await evaluate(`localStorage.getItem('wss_working_bundle')`);
  for(const tab of ['BAU Scenario','Intervention Design','Results Dashboard']) {
    assert.ok(await evaluate(`(()=>{
      const tab=[...document.querySelectorAll('.wb-tab')].find(b=>b.textContent.replace(/\\s/g,'').includes(${JSON.stringify(tab.replace(/\s/g,''))}));
      if(!tab || tab.disabled) return false; tab.click();return true;
    })()`),`Cannot open ${tab}`);
    for(const sector of tab==='Results Dashboard'?['both']:['Water Supply','Sanitation']) {
      if(sector!=='both') {
        assert.ok(await evaluate(`(()=>{
          const button=[...document.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s/g,'')===${JSON.stringify(sector.replace(/\s/g,''))});
          if(!button)return false;button.click();return true;
        })()`),`Cannot select ${sector}`);
      }
      await waitFor(`document.querySelectorAll('[data-service-access]').length===2`,`${tab}/${sector} diagnostics missing`);
      await sleep(500);
      const checks=await evaluate(`(()=>{
        const sections=[...document.querySelectorAll('[data-service-access]')];
        return sections.map(section=>{
          section.querySelector('details').open=true;
          return {name:section.dataset.serviceAccess,headers:[...section.querySelectorAll('th')].map(c=>c.textContent),
            rows:[...section.querySelectorAll('tbody tr')].map(r=>[...r.querySelectorAll('td')].map(c=>c.textContent)),
            explanation:section.textContent};
        });
      })()`);
      for(const check of checks) {
        assert.ok(check.headers.some(h=>h.includes('At-least-basic access gap (basic-entry costing)')));
        assert.ok(check.headers.some(h=>h.includes('Basic-only target shortfall after SM credit (diagnostic)')));
        assert.ok(check.headers.some(h=>h.includes('Original basic-only target')));
        assert.ok(check.explanation.includes('Gaps are assessed within each area before aggregation.'));
        assert.ok(check.rows.length>0);
        for(const row of check.rows) {
          // Values 7/10/11/12 are SM gap, at-least-basic gap, outstanding upgrades/entries.
          const numeric = column => Number(row[column].replaceAll(',',''));
          assert.ok(Math.abs(numeric(9)-numeric(13))<.00002,'SM gap/closing upgrades must reconcile');
          assert.ok(Math.abs(numeric(12)-numeric(14))<.00002,'At-least-basic gap/closing entries must reconcile');
        }
      }
      if(tab!=='BAU Scenario') assert.ok(checks.some(c=>c.rows.some(r=>r[1]==='Scenario')));
      assert.ok(await evaluate(`document.querySelectorAll('svg.recharts-surface').length>=2`),'Coverage graphs must remain rendered');
      if(tab==='Results Dashboard') {
        for(const key of ['water_gap','san_gap']) {
          assert.ok(await evaluate(`document.querySelector('[data-results-chart="${key}"]')?.textContent.includes('year-end financing requirement (safely managed + basic)')`),
            `${key} title must explicitly include both service levels`);
        }
      }
      console.log(`${tab}/${sector}: original targets, hierarchy diagnostics and outstanding transitions reconcile.`);
    }
  }
  assert.equal(await evaluate(`localStorage.getItem('wss_working_bundle')`),original,'Views must not mutate model inputs');
  assert.equal(errors.length,0,JSON.stringify(errors));
  await evaluate(`document.querySelector('[data-service-access]')?.scrollIntoView({block:'start'})`);
  const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
  writeFileSync('/tmp/wss-service-access.png',Buffer.from(screenshot.data,'base64'));
  console.log('Service access browser checks passed; screenshot /tmp/wss-service-access.png');
} finally {
  browser.kill('SIGTERM');
  for(const {timer} of pending.values()) clearTimeout(timer);
}
