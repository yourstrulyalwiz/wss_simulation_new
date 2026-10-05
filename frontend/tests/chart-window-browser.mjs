// Run from the workspace root: APP_URL=https://... node frontend/tests/chart-window-browser.mjs
// Uses the existing controlled calculation fixture; never writes server profiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openChromium, sleep } from './chromium-client.mjs';
const url=process.env.APP_URL;
assert.ok(url,'APP_URL is required');
const inputs=JSON.parse(execFileSync('python',['-c',
  'import json; from test_utility_revenue import example; print(json.dumps(example()))'],
  {cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'}));
const bundle={__wss_bundle:1,inputs,altInputs:{rural:structuredClone(inputs)},
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true}};
const expectedStart=inputs.period.baseline_year-2;
const expectedEnd=inputs.period.forecast_end_year;
const earliest=inputs.period.model_start_year;
const c=await openChromium(url);
const {evaluate:e,waitFor:w}=c;
async function tab(label) {
  await e(`([...document.querySelectorAll('.wb-tab')].find(b=>b.textContent.replace(/\\s/g,'').toLowerCase().includes(${JSON.stringify(label)}))).click()`);
}
async function select(label,value,index=0) {
  await e(`(()=>{const s=document.querySelectorAll('select[aria-label=${JSON.stringify(label)}]')[${index}];
    s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function windows(startLabel,endLabel,minimum=1) {
  await w(`document.querySelectorAll('select[aria-label=${JSON.stringify(startLabel)}]').length>=${minimum}`,'Year controls missing');
  const bounds=await e(`[...document.querySelectorAll('select[aria-label=${JSON.stringify(startLabel)}]')].map((s,i)=>({
    start:+s.value,end:+document.querySelectorAll('select[aria-label=${JSON.stringify(endLabel)}]')[i].value,
    options:[...s.options].map(o=>+o.value)}))`);
  for(const b of bounds) {
    assert.equal(b.start,expectedStart);assert.equal(b.end,expectedEnd);
    assert.ok(b.options.includes(earliest),'Earlier history must remain selectable');
  }
  await w(`document.querySelectorAll('.recharts-wrapper svg.recharts-surface').length>=${bounds.length}`,'Rendered charts missing');
  return bounds.length;
}
async function renderedStart(year,minimum=1) {
  try { await w(`(()=>{
    const ticks=[...document.querySelectorAll('.recharts-wrapper')].map(p=>
      [...p.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(t=>+t.textContent).filter(Number.isFinite));
    return ticks.filter(t=>t[0]===${year}).length>=${minimum};
  })()`, `Rendered chart did not start at ${year}`); }
  catch (error) {
    console.log(await e(`[...document.querySelectorAll('.recharts-wrapper')].map(p=>({
      axes:[...p.querySelectorAll('[class*="Axis"]')].map(n=>n.getAttribute('class')),
      ticks:[...p.querySelectorAll('text.recharts-cartesian-axis-tick-value')].map(n=>n.textContent)
    }))`));
    throw error;
  }
}
try {
  await w(`!!document.querySelector('.wb-app')`,'App did not load');
  await sleep(1600); // Finish the one-time development setup in isolated storage.
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`!!document.querySelector('.wb-tab')`,'Reload failed');
  await tab('bauscenario');
  const bauCount=await windows('Chart start year','Chart end year',2);
  await renderedStart(expectedStart,bauCount);
  await select('Chart start year',earliest);
  await renderedStart(earliest);
  await select('Chart end year',inputs.period.baseline_year+3);
  await sleep(300);
  assert.ok(!(await e(`[...document.querySelectorAll('.recharts-wrapper svg text')].some(t=>t.textContent.includes('Financing gap · ${expectedEnd}'))`)),
    'Hidden endline must not leave a financing call-out on the plot');
  await e(`document.querySelector('select[aria-label="Chart start year"]').parentElement.querySelector('button').click()`);
  await renderedStart(expectedStart,bauCount);
  await tab('interventiondesign');
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sanitation')).click()`);
  const interventionCount=await windows('Chart start year','Chart end year');
  await renderedStart(expectedStart,interventionCount);
  await select('Chart start year',earliest);
  await renderedStart(earliest);
  await e(`document.querySelector('select[aria-label="Chart start year"]').parentElement.querySelector('button').click()`);
  await renderedStart(expectedStart,interventionCount);
  await tab('resultsdashboard');
  await windows('Graph start year','Graph end year');
  await renderedStart(expectedStart,6); // Two sectors × SM, basic, financing.
  await select('Graph start year',earliest);
  await renderedStart(earliest,6);
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent==='% of population')).click()`);
  assert.equal(await e(`+document.querySelector('select[aria-label="Graph start year"]').value`),earliest);
  await e(`document.querySelector('select[aria-label="Graph start year"]').parentElement.querySelector('button').click()`);
  await renderedStart(expectedStart,6);
  for(const scope of ['urban','rural','national']) {
    await e(`(()=>{
      const s=[...document.querySelectorAll('select')].find(s=>
        ['urban','rural','national'].every(v=>[...s.options].some(o=>o.value===v)));
      s.value=${JSON.stringify(scope)};s.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await windows('Graph start year','Graph end year');
    await renderedStart(expectedStart,6);
  }
  const stored=await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs`);
  assert.deepEqual(stored.period,inputs.period,'Graph filters must not change simulation dates');
  assert.deepEqual(stored.revenue_bases,inputs.revenue_bases,'Graph filters must not alter revenue inputs');
  assert.equal(c.errors.length,0,JSON.stringify(c.errors));
  console.log(`Browser graph windows passed: ${bauCount} BAU, ${interventionCount} intervention, 6 Results graphs; full history, reset, unit switches and unchanged inputs.`);
} finally { c.close(); }
