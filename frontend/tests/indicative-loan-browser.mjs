// Real model and isolated browser storage; no server profile modifications.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdirSync, writeFileSync} from 'node:fs';
import {openChromium, sleep} from './chromium-client.mjs';

const inputs = JSON.parse(execFileSync('python', ['-c', `
import json
from test_utility_revenue import example
d=example()
d['toggles'].update(ws_collection_efficiency_enabled=True,ws_tariff_enabled=True,
                   san_collection_efficiency_enabled=True,san_tariff_enabled=True)
cfg=dict(enabled=True,mode='indicative_lump_sum',allocation_share=.5,
         annual_real_interest_rate=.05,loan_term_years=10,
         disbursement_year=d['period']['baseline_year']+5,
         revenue_sources=['collection','tariff'])
d['utility_debt']={'schema_version':2,'water':dict(cfg),'sanitation':dict(cfg)}
print(json.dumps(d))
`], {cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'}));
const bundle = {__wss_bundle:1,inputs,altInputs:{rural:structuredClone(inputs)},
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true}};
const c = await openChromium(process.env.APP_URL);
const {evaluate:e,waitFor:w} = c;
const captureDir = fileURLToPath(new URL('../../screenshots/indicative-loan/',import.meta.url));
mkdirSync(captureDir,{recursive:true});
async function screenshot(name) {
  const {data} = await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(captureDir+name,Buffer.from(data,'base64'));
}
async function tab(index) {
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[${index}].click()`);
}
async function ready() {
  await w(`!!document.querySelector('[data-testid="indicative-principal"]') &&
    document.querySelector('[data-testid="indicative-principal"]').textContent!=='—'`, 'Indicative preview not ready');
}
async function actual() {
  return e(`(async()=>{
    const b=JSON.parse(localStorage.getItem('wss_working_bundle'));
    const r=await fetch('/api/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b.inputs)});
    if(!r.ok)throw new Error(await r.text());
    return (await r.json()).water_supply.scenario_utility_debt;
  })()`);
}
async function number(index,value) {
  await e(`(()=>{
    const input=document.querySelectorAll('.debt-controls input[type=number]')[${index}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(900);
}
try {
  await w(`!!document.querySelector('.wb-tab')`,'App did not load');
  await sleep(1800);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__loanCalls=[];window.__loanCSVs=[];
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>{
      if(String(url)==='/api/calculate' && options?.body) window.__loanCalls.push(JSON.parse(options.body));
      return originalFetch(url,options);
    };
    const originalBlobURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{
      if(blob.type.startsWith('text/csv')) blob.text().then(t=>window.__loanCSVs.push(t));
      return originalBlobURL(blob);
    };
  `});
  await c.call('Page.reload');
  await w(`!!document.querySelector('.wb-tab')`,'Reload failed');
  await tab(3);
  await ready();
  const debt = await actual();
  assert.ok(debt.indicative_principal>0);
  assert.ok(Math.abs(debt.indicative_principal - debt.selected_signed_pool*.5*debt.annuity_factor)<1e-10);
  assert.equal(debt.repayment_accounting,'fixed_annuity_modeled');
  assert.equal(debt.schema_version ?? debt.summary_version,3);
  assert.equal(debt.fixed_annual_debt_service,debt.selected_signed_pool*.5);
  assert.equal(debt.first_repayment_year,debt.reference_year+1);
  assert.equal(debt.maturity_year,debt.reference_year+10);
  assert.equal(debt.repayment_schedule.filter(r=>r.debt_service>0).length,10);
  assert.equal(debt.repayment_schedule[0].year,debt.reference_year);
  assert.equal(debt.repayment_schedule.at(-1).year,debt.maturity_year);
  assert.ok(Math.abs(debt.repayment_schedule.at(-1).closing_principal)<1e-8);
  const text = await e(`document.querySelector('.debt-preview').textContent`);
  assert.ok(text.includes('fixed annual obligations modeled'));
  assert.ok(text.includes('Repayment schedule'));
  assert.ok(text.includes('Ordinary funds after funded service'));
  assert.ok(!/verified feasible|Supportable borrowing|Protected revenue|Tightest repayment/.test(text));
  const displayed = await e(`document.querySelector('[data-testid="indicative-principal"]').textContent`);
  assert.equal(Number(displayed.split(' ')[0].replaceAll(',','')),Number(debt.indicative_principal.toFixed(3)));
  const heads = await e(`[...document.querySelector('[data-testid="loan-injection-table"]').querySelectorAll('thead th')].map(x=>x.textContent)`);
  assert.deepEqual(heads,['Year','Ordinary funds before service','Debt service due','Debt service funded','Debt service unfunded',
    'Funded interest','Funded principal','Unfunded interest','Unfunded principal','Ordinary funds after funded service',
    'New injection','Opening unspent proceeds','Investment from proceeds','Closing unspent proceeds']);
  assert.equal(debt.annual_injection.filter(r=>r.disbursement>0).length,1);
  for(const r of debt.annual_injection) assert.ok(Math.abs(r.opening_unspent_proceeds+r.disbursement-r.investment_from_loan_proceeds-r.closing_unspent_proceeds)<1e-9);
  for(const row of debt.annual_injection) if(row.ordinary_before_debt_service!=null&&row.ordinary_after_debt_service!=null)
    {
      assert.ok(Math.abs(row.ordinary_before_debt_service-row.debt_service_paid-row.ordinary_after_debt_service)<1e-8);
      assert.ok(Math.abs(row.debt_service-row.debt_service_paid-row.debt_service_unfunded)<1e-8);
    }
  for (const row of debt.repayment_schedule) {
    if (row.year <= inputs.period.forecast_end_year) {
      assert.ok(Math.abs(row.funded_interest+row.funded_principal-row.debt_service_paid)<1e-8);
      assert.ok(Math.abs(row.unfunded_interest+row.unfunded_principal-row.debt_service_unfunded)<1e-8);
      assert.ok(Math.abs(row.debt_service_paid+row.debt_service_unfunded-row.debt_service)<1e-8);
    } else for (const field of ['debt_service_paid','debt_service_unfunded','funded_interest','funded_principal','unfunded_interest','unfunded_principal'])
      assert.equal(row[field],null,`Future contractual ${field} must remain unavailable`);
  }
  await screenshot('loan-desktop.png');
  await e(`document.querySelector('.debt-annual button[title="Download this table as CSV"]').click()`);
  await w(`window.__loanCSVs.length>0`,'No proceeds table CSV download');
  assert.ok((await e(`window.__loanCSVs[0]`)).includes('Only funded payments are deducted'));
  await e(`document.querySelector('[data-testid="loan-repayment-schedule"] button[title="Download this table as CSV"]')?.click()`);
  await w(`window.__loanCSVs.length>1`,'No repayment schedule CSV download');
  assert.ok((await e(`window.__loanCSVs[1]`)).includes('Interest due'));
  await number(0,75);
  await w(`Number(document.querySelector('[data-testid="indicative-principal"]').textContent.split(' ')[0].replaceAll(',',''))===${Number((debt.indicative_principal*1.5).toFixed(3))}`,'Allocation did not update live principal');
  const larger = await actual();
  assert.deepEqual(larger.reference_source_cash,debt.reference_source_cash);
  assert.ok(Math.abs(larger.indicative_principal-debt.indicative_principal*1.5)<1e-10);
  await number(1,'');
  await w(`document.querySelector('.debt-controls').textContent.includes('Enter a finite') || document.querySelector('.debt-preview').textContent.includes('Estimate unavailable')`,'Missing active rate not visibly incomplete');
  await number(0,0);
  await number(2,'');
  await ready();
  assert.equal((await actual()).indicative_principal,0);
  await number(1,5);
  await number(2,10);
  await number(0,50);
  await ready();
  await e(`(()=>{const guide=document.querySelector('.wb-guide-toggle');if(guide?.textContent.includes('Close Guide'))guide.click();})()`);
  await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(400);
  assert.ok(await e(`document.documentElement.scrollWidth<=window.innerWidth+2`),'Mobile horizontal overflow');
  await screenshot('loan-mobile.png');
  await c.call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
  await tab(4);
  await w(`!!document.querySelector('[data-results-ledger]')`,'Results ledger missing');
  const resultsText = await e(`document.body.textContent`);
  assert.ok(resultsText.includes('Loan funding'));
  assert.equal(await e(`document.querySelector('[aria-label="Results debt mode"]').value`),'without_debt');
  await w(`window.__loanCalls.some(x=>!x.utility_debt?.water?.enabled)`,'Excluded Results did not calculate without loans');
  const saved = await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt`);
  await e(`(()=>{window.__loanCalls=[];const s=document.querySelector('[aria-label="Results debt mode"]');s.value='with_debt';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await w(`window.__loanCalls.some(x=>x.utility_debt?.water?.enabled)`,'Included Results did not use enabled settings');
  await w(`document.querySelectorAll('.recharts-wrapper svg.recharts-surface').length>=2`,'Included Results graphs missing');
  assert.deepEqual(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt`),saved);
  await e(`(()=>{const s=document.querySelector('[aria-label="Results debt mode"]');s.value='without_debt';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(600);
  assert.deepEqual(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt`),saved);
  await screenshot('results-desktop.png');
  assert.equal(c.errors.length,0,JSON.stringify(c.errors));
  console.log('PASS: real API sizing, frozen pool under allocation change, one injection, carry identity, blank active rate, zero share with blank terms, proceeds CSV, default-excluded/explicit-included Results and preserved settings, desktop/mobile.');
} catch (error) {
  console.error('Browser state:', await e(`JSON.stringify({text:document.body.innerText.slice(-12000),inputs:[...document.querySelectorAll('input,select')].map(x=>({label:x.getAttribute('aria-label'),value:x.value})),errors:window.__errors||[]})`));
  await screenshot('failure.png');
  throw error;
} finally {c.close();}
