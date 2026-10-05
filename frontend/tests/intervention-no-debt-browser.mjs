// Isolated browser storage: saved server profiles are never modified.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openChromium, sleep } from './chromium-client.mjs';

const url=process.env.APP_URL;
assert.ok(url,'APP_URL is required');
const inputs=JSON.parse(execFileSync('python',['-c',`
import json
from test_utility_revenue import example
d=example()
d['toggles']={k:False for k in d['toggles']}
d['toggles'].update(ws_collection_efficiency_enabled=True,ws_tariff_enabled=True,
                   san_collection_efficiency_enabled=True,san_tariff_enabled=True)
cfg=dict(enabled=True,allocation_share=.5,annual_real_interest_rate=.05,
         disbursement_year=d['period']['baseline_year']+5,
         maturity_year=d['period']['forecast_end_year']+3,
         principal_grace_years=0,repayment_structure='annuity',loan_ceiling=.01)
d['utility_debt']={'water':dict(cfg),'sanitation':dict(cfg)}
print(json.dumps(d))
`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'}));
const bundle={__wss_bundle:1,inputs,altInputs:{rural:structuredClone(inputs)},
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true}};
inputs.custom_interventions=[{name:'Custom non-debt revenue',enabled:true,sector:'both',
  intervention_type:'new_revenue',start_year:inputs.period.baseline_year+1,
  end_year:inputs.period.forecast_end_year,implement_cost:0,cost_years:1,
  output_start_year:inputs.period.baseline_year+1,output_quantity:1000000,output_value:10}];
const c=await openChromium(url);
const {evaluate:e,waitFor:w}=c;
try {
  await w(`document.querySelectorAll('.wb-tab').length===5`,'App not ready');
  await sleep(1600);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__interventionCalls=[];window.__interventionExports=[];
    const original=window.fetch.bind(window);
    window.fetch=(url,options)=>{
      if(String(url)==='/api/calculate'){
        const record={body:JSON.parse(options.body),status:null};
        window.__interventionCalls.push(record);
        return original(url,options).then(response=>{record.status=response.status;return response});
      }
      if(String(url)==='/api/export/xlsx'){
        const record={body:JSON.parse(options.body),status:null};
        window.__interventionExports.push(record);
        return original(url,options).then(response=>{record.status=response.status;return response});
      }
      return original(url,options);
    };`});
  await c.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`,'Reload failed');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[2].click()`);
  for(const [sector,prefix] of [['Water Supply','ws'],['Sanitation','san']]) {
    if(prefix==='san')
      await e(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sanitation')).click()`);
    await w(`document.querySelectorAll('.recharts-wrapper').length===2 &&
      [...document.querySelectorAll('.recharts-wrapper')].every(chart=>
        chart.querySelectorAll('.recharts-cartesian-axis-tick-value').length>0)`,'SM and Basic intervention graphs not populated');
    await w(`(()=>{const calls=window.__interventionCalls.filter(c=>
      !c.body.utility_debt?.water?.enabled && !c.body.utility_debt?.sanitation?.enabled &&
      c.body.toggles?.${prefix}_collection_efficiency_enabled && c.body.toggles?.${prefix}_tariff_enabled &&
      c.body.custom_interventions?.some(ci=>ci.name==='Custom non-debt revenue'));
      return calls.length>0 && calls.every(c=>c.status===200);})()`,'Selected intervention passes did not finish without debt');
    assert.ok(await e(`!!document.querySelector('[data-testid="intervention-no-debt-note"]')`));
    assert.equal(await e(`document.querySelectorAll('[data-testid="utility-debt-preview"]').length`),0);
    assert.ok(await e(`![...document.querySelectorAll('.recharts-legend-item')].some(n=>/Utility debt financing/.test(n.textContent))`));
    assert.ok(await e(`!document.querySelector('[role="alert"]')`),`${sector} graphs have an error`);
    const saved=await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt`);
    assert.deepEqual(saved,inputs.utility_debt,'Intervention Design changed saved loan settings');
  }
  assert.equal(c.errors.length,0,JSON.stringify(c.errors));
  console.log('Intervention Design passed: direct entry without visiting Debt servicing; live SM/Basic graphs for both sectors; selected reform and custom passes exclude debt; no loan bands; saved enabled loan settings preserved.');
} finally {c.close();}
