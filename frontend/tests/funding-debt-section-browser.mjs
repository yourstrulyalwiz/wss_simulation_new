// Isolated browser storage; never modifies saved server profiles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

assert.ok(process.env.APP_URL,'APP_URL is required');
const inputs=JSON.parse(execFileSync('python',['-c',`
import json
from test_utility_revenue import example
d=example()
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
  scope:{scopeMode:'urban_rural',areaUrban:true,areaRural:true},
  presentation:{currencyDisplay:{mode:'local',sourceCurrency:inputs.country_config.currency,
    localPerUsd:120,rateReferenceYear:2024}}};
const c=await openChromium(process.env.APP_URL);
const {evaluate:e,waitFor:w}=c;
const change=async(selector,value)=>{
  await e(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(100);
};
try{
  await w(`document.querySelectorAll('.wb-tab').length===5`,'App not ready');
  await sleep(1600);
  await e(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__fundingExports=[];window.__fundingCSVs=[];
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=(url,options)=>{
      if(String(url)==='/api/export/table'){
        const record={body:JSON.parse(options.body),status:null};window.__fundingExports.push(record);
        return fetchOriginal(url,options).then(response=>{record.status=response.status;return response});
      }return fetchOriginal(url,options);
    };
    const blobURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{
      if(blob.type.startsWith('text/csv'))blob.text().then(text=>window.__fundingCSVs.push(text));
      return blobURL(blob);
    };`});
  await c.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`,'Reload failed');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[4].click()`);
  let exports=0,csvs=0;
  for(const debt of [false,true,false]){
    await change('[aria-label="Results debt mode"]',debt?'with_debt':'without_debt');
    for(const sector of ['water','sanitation']){
      const root=`[data-results-ledger="${sector}"]`;
      await w(`!!document.querySelector('${root}')`,'Ledger not ready');
      await change(`${root} [aria-label$="ledger metric"]`,'funding');
      await change(`${root} [aria-label$="ledger service"]`,'total');
      await w(`!!document.querySelector('${root} [data-ledger-row="fundingOperating"]')`,'Net cash missing');
      assert.equal(await e(`!!document.querySelector('${root} [data-ledger-row="debtFundingSection"]')`),debt);
      for(const key of ['fundingRestricted','repayments'])
        assert.equal(await e(`!!document.querySelector('${root} [data-ledger-row="${key}"]')`),debt);
      const cashLabel=await e(`document.querySelector('${root} [data-ledger-row="fundingOperating"]').textContent`);
      assert.equal(cashLabel.includes('after debt service'),debt);
      assert.ok(await e(`(()=>{const p=document.querySelector('${root}');
        const cells=[...p.querySelectorAll('[data-ledger-row="fundingShared"] [data-ledger-year], [data-ledger-row="fundingRestricted"] [data-ledger-year]')]
          .filter(cell=>cell.title!=='Not available' && Math.abs(Number(cell.title))<10000*120/1e9);
        return cells.length>0 && cells.every(cell=>cell.textContent.trim()==='0' &&
          !cell.classList.contains('results-ledger__value--negative'));})()`),
        'Small native-currency balances must display neutral zero without losing their precise tooltip');
      if(debt){
        assert.equal(await e(`document.querySelector('${root} [data-ledger-row="debtFundingSection"]').textContent`),'With debt servicing');
        assert.equal(await e(`document.querySelector('${root} tbody').lastElementChild.dataset.ledgerRow`),'fundingOperating');
        assert.ok(await e(`(()=>{const p=document.querySelector('${root}');
          const cells=['scenario','fundingOperating'].map(key=>p.querySelector('[data-ledger-row="'+key+'"] .results-ledger__value'));
          return getComputedStyle(cells[0]).backgroundColor===getComputedStyle(cells[1]).backgroundColor &&
            getComputedStyle(cells[0]).fontWeight===getComputedStyle(cells[1]).fontWeight;})()`),
          'Net cash must be styled like Combined scenario');
      }
      await e(`([...document.querySelectorAll('${root} .results-ledger__export button')].find(b=>b.textContent.includes('Excel'))).click()`);
      await w(`window.__fundingExports.length>${exports} && window.__fundingExports[${exports}].status===200`,'Excel failed');
      const exported=await e(`window.__fundingExports[${exports++}].body`);
      const rows=exported.sheets[0].rows;
      const exactBalances=await e(`[...document.querySelectorAll('${root} [data-ledger-row="fundingShared"] [data-ledger-year]')]
        .map(cell=>cell.title==='Not available'?null:Number(cell.title))`);
      assert.deepEqual(rows.find(row=>row[0]==='Scenario — available but not applied / restricted').slice(2),exactBalances,
        'Display rounding must not change exact exported balances');
      assert.equal(rows.some(row=>row[0]==='With debt servicing'),debt);
      assert.equal(rows.at(-1)[0],debt?'Ordinary net cash after debt service (signed)':'Ordinary net cash (signed)');
      assert.ok(exported.filename.includes(debt?'with-debt':'without-debt'));
      await e(`([...document.querySelectorAll('${root} .results-ledger__export button')].find(b=>b.textContent.includes('CSV'))).click()`);
      await w(`window.__fundingCSVs.length>${csvs}`,'CSV failed');
      const csv=await e(`window.__fundingCSVs[${csvs++}]`);
      assert.equal(csv.includes('With debt servicing'),debt);
    }
    if(debt){
      await e(`(()=>{const p=document.querySelector('[data-results-ledger="water"]');p.scrollIntoView({block:'start'});
        const scroller=p.querySelector('.results-ledger__table-scroll');scroller.scrollTop=scroller.scrollHeight;})()`);
      await sleep(200);
      writeFileSync('/tmp/funding-debt-section.png',Buffer.from((await c.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
  }
  assert.deepEqual(await e(`JSON.parse(localStorage.getItem('wss_working_bundle')).inputs.utility_debt`),inputs.utility_debt);
  assert.equal(c.errors.length,0,JSON.stringify(c.errors));
  console.log(`Funding debt section passed: both sectors, conditional heading/rows, net cash last and summary styling, ${exports} Excel and ${csvs} CSV downloads, mode switching and saved loan preservation.`);
}finally{c.close();}
