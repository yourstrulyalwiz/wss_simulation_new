// Real backend, isolated browser storage: never modifies saved server profiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL is required');
const inputs = JSON.parse(execFileSync('python', ['-c',
  'import json; from test_utility_revenue import example; print(json.dumps(example()))'],
{ cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }));
inputs.toggles = Object.fromEntries(Object.keys(inputs.toggles).map(k=>[k,false]));
inputs.toggles.ws_collection_efficiency_enabled = true;
inputs.toggles.san_financial_commitment_enabled = true; // Enabled zero-effect rows must remain discoverable.
inputs.water_interventions.basic_share = .35;
inputs.sanitation_interventions.basic_share = .5;
const rural = structuredClone(inputs);
rural.toggles.ws_tariff_enabled = true; // Different from urban: combined scope must still attribute this.
rural.water_interventions.basic_share = .75;
const bundle = {__wss_bundle:1,inputs,altInputs:{rural,national:structuredClone(inputs)},
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true}};
const c = await openChromium(url);
const {evaluate:e,waitFor:w} = c;
const panel = sector => `[data-results-ledger="${sector}"]`;
const change = async (selector,value) => {
  await e(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(80);
};
try {
  await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__ledgerExports=[];window.__ledgerCalls=0;window.__ledgerCSVs=[];
    const originalBlobURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{
      if(blob.type.startsWith('text/csv')) blob.text().then(text=>window.__ledgerCSVs.push(text));
      return originalBlobURL(blob);
    };
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=(url,options)=>{
      if(String(url)==='/api/calculate') window.__ledgerCalls++;
      if(String(url)==='/api/export/table'){
        const item={body:JSON.parse(options.body),status:null};window.__ledgerExports.push(item);
        return fetchOriginal(url,options).then(response=>{item.status=response.status;return response});
      }return fetchOriginal(url,options);
    };`});
  await w(`document.querySelectorAll('.wb-tab').length===5`,'App not ready');
  await sleep(1500);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`,'App not ready');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[4].click()`);
  await w(`document.querySelectorAll('[data-results-ledger] [data-row-kind="category"]').length>0`,'Ledger attribution not ready');
  await e(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>['urban','rural','national']
    .every(value=>[...s.options].some(o=>o.value===value)));s.value='national';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`!!document.querySelector('[data-results-ledger="water"] [data-ledger-row="tariff"]')`,'Rural-only intervention missing in combined scope');
  assert.equal(await e(`document.querySelectorAll('.recharts-wrapper').length`),6);
  const start = inputs.period.baseline_year + 1;
  const end = Math.min(start+4,inputs.period.forecast_end_year);
  await change('[aria-label="Graph start year"]',String(start));
  await change('[aria-label="Graph end year"]',String(end));
  const expectedYears = Array.from({length:end-start+1},(_,i)=>String(start+i));
  const calls = await e('window.__ledgerCalls');
  let exports = 0;
  let csvs = 0;
  for (const sector of ['water','sanitation']) {
    const root = panel(sector);
    for (const metric of ['coverage','funding','requirements','gap']) {
      await change(`${root} select[aria-label$="ledger metric"]`,metric);
      for (const service of ['sm','basic','total']) {
        await change(`${root} select[aria-label$="ledger service"]`,service);
        for (const basis of ['requirements','gap'].includes(metric) ? ['annual','closing'] : ['annual']) {
          if (['requirements','gap'].includes(metric))
            await change(`${root} select[aria-label$="ledger basis"]`,basis);
          const state = await e(`(()=>{const p=document.querySelector('${root}');
            return {years:[...p.querySelectorAll('thead th')].slice(2).map(n=>n.textContent),
              kinds:[...p.querySelectorAll('tbody tr')].map(n=>n.dataset.rowKind),
              empty:[...p.querySelectorAll('[data-ledger-year]')].every(n=>n.textContent==='—')};})()`);
          assert.deepEqual(state.years,expectedYears);
          assert.ok(!state.empty,`${sector}/${metric}/${service} is empty`);
          if(metric==='funding' && service==='total'){
            assert.ok(await e(`document.querySelector('${root} [data-ledger-row="fundingShared"] [data-testid="funding-surplus-note"]')?.textContent.includes("Surplus relative to this year's applied spending")`),
              `${sector}: unapplied funding is missing the surplus explanation`);
          }
          await e(`([...document.querySelectorAll('${root} .results-ledger__export button')].find(b=>b.textContent.includes('Excel'))).click()`);
          await w(`window.__ledgerExports.length>${exports} && window.__ledgerExports[${exports}].status!==null`,'Excel export did not complete');
          const exported = await e(`window.__ledgerExports[${exports++}]`);
          assert.equal(exported.status,200);
          const sheet = exported.body.sheets[0];
          assert.deepEqual(sheet.headers,['Row','Unit',...expectedYears]);
          assert.equal(sheet.freeze_columns,2);
          assert.equal(sheet.rows.length,state.kinds.length);
          assert.ok(exported.body.filename.includes('without-debt'));
          const base = sheet.rows.find(row=>row[0]==='BAU');
          const full = sheet.rows.find(row=>row[0]==='Combined scenario');
          if (metric==='coverage' && service==='sm') {
            const target=sheet.rows.find(row=>row[0]==='Original target');
            const net=sheet.rows.find(row=>row[0]==='SM net gap (scenario − target)');
            const urbanGap=sheet.rows.find(row=>row[0]==='Urban SM gap (scenario − target)');
            const ruralGap=sheet.rows.find(row=>row[0]==='Rural SM gap (scenario − target)');
            assert.ok(urbanGap && ruralGap,'National gap breakdown missing from export');
            assert.ok(net && !sheet.rows.some(row=>row[0]==='Unmet SM targets across areas (no surplus offset)'));
            assert.equal(await e(`document.querySelectorAll('${root} [data-ledger-row="accessGap"]').length`),0,
              'Removed unmet SM target row remains visible');
            assert.equal(net[1],full[1]==='%' ? 'pp' : 'M households');
            for (let i=2;i<sheet.headers.length;i++) {
              assert.ok(Math.abs(net[i]-(full[i]-target[i]))<1e-10,'Exported SM net gap does not reconcile');
              assert.ok(Math.abs(urbanGap[i]+ruralGap[i]-net[i])<1e-10,'Urban + Rural gaps do not reconcile');
            }
            assert.ok(await e(`(()=>{const cells=[...document.querySelectorAll('${root} [data-ledger-row="smNetGap"] [data-ledger-year]')];
              return cells.length>0 && cells.every(cell=>{
                const v=Number(cell.title),text=cell.textContent.trim();
                return v>0 ? text.startsWith('+') && cell.classList.contains('results-ledger__value--surplus')
                  : v<0 ? text.startsWith('-') && cell.classList.contains('results-ledger__value--shortfall')
                  : text==='0' && cell.classList.contains('results-ledger__value--neutral');
              });})()`),'Signed SM gap formatting/colors incorrect');
          }
          if (metric==='coverage') {
            const target=sheet.rows.find(row=>row[0]==='Original target');
            await e(`([...document.querySelectorAll('${root} .results-ledger__export button')].find(b=>b.textContent.includes('CSV'))).click()`);
            await w(`window.__ledgerCSVs.length>${csvs}`,'CSV download did not complete');
            const csv=await e(`window.__ledgerCSVs[${csvs++}]`);
            const escape=value=>{
              const s=value==null?'':String(value);
              return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
            };
            for(const row of sheet.rows)
              assert.ok(csv.split('\r\n').includes(row.map(escape).join(',')),'CSV differs from visible/Excel data');
            assert.equal(await e(`document.querySelectorAll('${root} [data-ledger-row="accessGap"]').length`),0);
            const gapLabel=service==='sm'?'SM net gap':service==='basic'?'Basic-only gap':'At least basic net gap';
            const net=sheet.rows.find(row=>row[0]===`${gapLabel} (scenario − target)`);
            for(let i=2;i<sheet.headers.length;i++)
              assert.ok(Math.abs(net[i]-(full[i]-target[i]))<1e-10,'Coverage gap does not reconcile');
            assert.ok(exported.body.filename.includes(service==='total'?'at-least-basic':service==='basic'?'basic-only':'safely-managed'));
            assert.deepEqual(await e(`[...document.querySelector('${root} select[aria-label$="ledger service"]').options].map(o=>o.textContent)`),
              ['Safely managed','Basic only','At least basic']);
            if(service==='basic'){
              assert.ok(!sheet.rows.some(row=>/SM (net )?gap|At.least.basic access gap/.test(row[0])));
            }
            if(service==='total'){
              const sm=sheet.rows.find(row=>row[0]==='SM net gap (scenario − target)');
              const basic=sheet.rows.find(row=>row[0]==='Basic-only gap (scenario − target)');
              for(let i=2;i<sheet.headers.length;i++){
                assert.ok(Math.abs(sm[i]+basic[i]-net[i])<1e-10,'SM + Basic gap does not reconcile');
                for(const [row,label] of [[sm,'SM'],[basic,'Basic-only']]){
                  const urban=sheet.rows.find(r=>r[0]===`Urban ${label} gap (scenario − target)`);
                  const rural=sheet.rows.find(r=>r[0]===`Rural ${label} gap (scenario − target)`);
                  assert.ok(Math.abs(urban[i]+rural[i]-row[i])<1e-10,'Area/service gap does not reconcile');
                }
              }
              assert.equal(await e(`document.querySelector('${root} [data-ledger-row="basicNetGap-rural"]').dataset.rowDepth`),'2');
              // The total selection survives a metric switch; financial labels stay unchanged.
              await change(`${root} select[aria-label$="ledger metric"]`,'funding');
              assert.equal(await e(`document.querySelector('${root} select[aria-label$="ledger service"]').selectedOptions[0].textContent`),'Sector total');
              await change(`${root} select[aria-label$="ledger metric"]`,'coverage');
              assert.equal(await e(`document.querySelector('${root} select[aria-label$="ledger service"]').value`),'total');
            }
          }
          const categories = sheet.rows.filter((_,i)=>state.kinds[i]==='category');
          for (let i=2;i<sheet.headers.length;i++)
            assert.ok(Math.abs(base[i]+categories.reduce((sum,row)=>sum+row[i],0)-full[i])<1e-8,'Export does not reconcile');
        }
      }
    }
  }
  assert.equal(await e('window.__ledgerCalls'),calls,'Display-only changes re-ran the model');
  // Scope switching must retain only actual selected areas, in both sectors and exports.
  const scopeChange=async value=>{
    await e(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>['urban','rural','national']
      .every(value=>[...s.options].some(o=>o.value===value)));s.value=${JSON.stringify(value)};
      s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  for (const scope of ['urban','rural','national']) {
    await scopeChange(scope);
    for (const sector of ['water','sanitation']) {
      const root=panel(sector);
      await w(`!!document.querySelector('${root}')`,'Ledger missing after scope switch');
      await change(`${root} select[aria-label$="ledger metric"]`,'coverage');
      await change(`${root} select[aria-label$="ledger service"]`,'sm');
      await w(`(()=>{const p=document.querySelector('${root}');
        return !!p && ${scope==='national'
          ? "!!p.querySelector('[data-ledger-row=\"smNetGap-urban\"]') && !!p.querySelector('[data-ledger-row=\"smNetGap-rural\"]')"
          : `!!p.querySelector('[data-ledger-row="smNetGap-${scope}"]') && !p.querySelector('[data-ledger-row="smNetGap-${scope==='urban'?'rural':'urban'}"]')`};
      })()`,'Area gap rows do not match selected scope');
      await e(`([...document.querySelectorAll('button')].find(b=>b.textContent==='% of population')).click()`);
      await sleep(80);
      await e(`([...document.querySelectorAll('${root} .results-ledger__export button')].find(b=>b.textContent.includes('Excel'))).click()`);
      await w(`window.__ledgerExports.length>${exports} && window.__ledgerExports[${exports}].status!==null`,'Scope export did not complete');
      const exported=await e(`window.__ledgerExports[${exports++}]`);
      assert.equal(exported.status,200);
      const sheet=exported.body.sheets[0];
      const net=sheet.rows.find(r=>r[0]==='SM net gap (scenario − target)');
      const areas=sheet.rows.filter(r=>/^(Urban|Rural) SM gap/.test(r[0]));
      assert.equal(areas.length,scope==='national'?2:1);
      assert.ok(areas.every(r=>r[1]==='pp'));
      for(let i=2;i<sheet.headers.length;i++)
        assert.ok(Math.abs(areas.reduce((sum,r)=>sum+r[i],0)-net[i])<1e-10,'Share breakdown does not reconcile');
    }
  }
  await e(`([...document.querySelectorAll('button')].find(b=>b.textContent==='# Households')).click()`);
  await e(`document.querySelector('[data-results-sector="water"] [aria-label$="basic view table"]').click()`);
  await w(`document.querySelector('${panel('water')}').dataset.ledgerMetric==='coverage' &&
    document.querySelector('${panel('water')}').dataset.ledgerService==='basic'`,'Graph link did not select Basic table');
  await e(`([...document.querySelectorAll('[aria-label="Contribution view"] button')].find(b=>b.textContent==='Categories')).click()`);
  await sleep(100);
  const before = await e(`document.querySelector('${panel('water')} tbody').children.length`);
  await e(`document.querySelector('${panel('water')} [aria-expanded="false"]').click()`);
  assert.ok(await e(`document.querySelector('${panel('water')} tbody').children.length`) > before);
  await change(`${panel('water')} select[aria-label$="ledger service"]`,'total');
  await c.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await e(`document.querySelector('${panel('water')}').scrollIntoView({block:'start'})`);
  await sleep(400);
  writeFileSync('/tmp/results-ledger-desktop.png',Buffer.from((await c.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await c.call('Emulation.setDeviceMetricsOverride',{width:402,height:874,deviceScaleFactor:1,mobile:false});
  await e(`document.querySelector('${panel('water')}').scrollIntoView({block:'start'})`);
  await sleep(300);
  assert.ok(await e(`(()=>{const p=document.querySelector('${panel('water')}'),s=p.querySelector('.results-ledger__table-scroll');
    return p.getBoundingClientRect().width<=innerWidth && s.scrollWidth>s.clientWidth &&
      getComputedStyle(p.querySelector('th')).position==='sticky';})()`),'Mobile ledger does not contain/freeze its table');
  writeFileSync('/tmp/results-ledger-mobile.png',Buffer.from((await c.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await change(`${panel('sanitation')} select[aria-label$="ledger metric"]`,'coverage');
  await change(`${panel('sanitation')} select[aria-label$="ledger service"]`,'total');
  await e(`document.querySelector('${panel('sanitation')}').scrollIntoView({block:'start'})`);
  await sleep(250);
  assert.ok(await e(`document.querySelector('${panel('sanitation')}').getBoundingClientRect().width<=innerWidth`));
  writeFileSync('/tmp/results-ledger-sanitation-mobile.png',Buffer.from((await c.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  console.log(`Results ledger browser passed: ${exports} real year-column Excel exports and ${csvs} matching coverage CSV downloads across both sectors, all three services and bases; nested service/area gaps, differing area selections, metric switching, graph links, expandable categories, unchanged model requests, six charts and desktop/mobile layout.`);
} finally {c.close();}
