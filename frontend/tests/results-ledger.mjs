import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const categories = readFileSync(new URL('../src/contributionView.tsx', import.meta.url), 'utf8')
  .split('export function ContributionViewToggle')[0].replace("import React from 'react';", '')
  .replace('import.meta.env.DEV', 'false');
const source = readFileSync(new URL('../src/resultsLedger.ts', import.meta.url), 'utf8')
  .replace("import { CONTRIBUTION_CATEGORIES } from './contributionView';", categories);
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { ledgerSnapshots, ledgerRows, ledgerCategory } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const fixture = JSON.parse(execFileSync('python', ['-c', `
import json
from test_utility_revenue import example
from demo_adapter import coerce_to_engine
from model.engine import calculate
d = example()
d['toggles'] = {k:False for k in d['toggles']}
d['water_interventions']['basic_share'] = .4
d['sanitation_interventions']['basic_share'] = .6
results = [calculate(coerce_to_engine(d))]
keys = ['ws_collection_efficiency_enabled','ws_tariff_enabled','san_tariff_enabled']
for key in keys:
    d['toggles'][key] = True
    results.append(calculate(coerce_to_engine(d)))
print(json.dumps({'results':results,'keys':keys,'baseline':d['period']['baseline_year']}))
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }));

const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
let comparisons = 0;
for (const sector of ['water_supply', 'sanitation']) {
  const snapshots = fixture.results.map(result => ledgerSnapshots([result], sector, fixture.baseline));
  const base = ledgerSnapshots([fixture.results.at(-1)], sector, fixture.baseline, false);
  const scenario = snapshots.at(-1);
  const years = scenario.map(row => row.year);
  const contributions = fixture.keys.map((key,i) => ({
    key, label:key, category:ledgerCategory(key), before:snapshots[i], after:snapshots[i+1],
  }));
  contributions.push({key:'custom',label:'Enabled zero-effect custom',category:'custom',before:scenario,after:scenario});
  const data = {years,baselineYear:fixture.baseline,base,scenario,contributions,attributionComplete:true,includesDebt:false};
  for (const metric of ['coverage','funding','requirements','gap'])
    for (const service of ['sm','basic','total'])
      for (const basis of ['annual','closing'])
        for (const isShare of [false,true]) {
          const options = {metric,service,basis,years,isShare,moneyFactor:.001,currency:'USD',view:'effects'};
          const rows = ledgerRows(data, options);
          const categories = rows.filter(row=>row.kind==='category');
          assert.ok(categories.some(row=>row.key==='custom' && row.children[0].key==='custom'));
          assert.equal(rows[0].key, 'bau');
          const final = rows.find(row=>row.key==='scenario');
          if (metric==='requirements') {
            const rung=service==='sm'?0:service==='basic'?1:2;
            for (const [key,label] of [['replacementPaid','Replacement paid — current year'],['expansionPaid','Expansion paid — current year (household and ancillary)']]) {
              const paid=rows.find(row=>row.key===key);
              assert.equal(paid.label,label);
              assert.equal(paid.unit,final.unit);
              paid.values.forEach((value,i)=>{
                const exact=scenario[i].values[key][rung];
                if(exact==null)assert.equal(value,null);
                else close(value,exact*options.moneyFactor/1000);
              });
            }
            assert.equal(rows.findIndex(row=>row.key==='replacementPaid'),rows.findIndex(row=>row.key==='replacement')+1);
            assert.equal(rows.findIndex(row=>row.key==='expansionPaid'),rows.findIndex(row=>row.key==='plannedExpansion')+1);
          }
          for (let i=0;i<years.length;i++) {
            if (rows[0].values[i] == null) {
              assert.equal(final.values[i],null);
              if (metric !== 'coverage') assert.ok(years[i]<=fixture.baseline);
              continue;
            }
            const bridge = categories.reduce((sum,row)=>sum+row.values[i],0);
            close(metric === 'requirements' || metric === 'gap'
              ? rows[0].values[i] - bridge : rows[0].values[i] + bridge,final.values[i]);
            for (const row of categories)
              close(row.values[i],row.children.reduce((sum,child)=>sum+child.values[i],0));
            comparisons++;
          }
          if (metric === 'coverage' && isShare)
            assert.ok(categories.every(row=>row.unit==='pp') && final.unit==='%');
          if (metric === 'coverage' && service === 'sm') {
            const target = rows.find(row=>row.key==='target');
            const net = rows.find(row=>row.key==='smNetGap');
            assert.equal(net.signedGap, true);
            assert.equal(net.unit, isShare ? 'pp' : 'M households');
            net.values.forEach((value,i)=>close(value,final.values[i]-target.values[i]));
          }
          const limited = ledgerRows(data,{...options,years:years.slice(-3)});
          assert.equal(limited[0].values.length,3);
          assert.deepEqual(limited[0].values,rows[0].values.slice(-3));
        }
  // National aggregation preserves the locally-assessed gaps, and weights shares by households.
  const combined = ledgerSnapshots([fixture.results.at(-1), fixture.results.at(-1)],sector,fixture.baseline);
  combined.forEach((row,i) => {
    close(row.population,scenario[i].population*2);
    for (const key of Object.keys(row.values))
      row.values[key].forEach((value,j) => value==null ?
        assert.equal(scenario[i].values[key][j],null) : close(value,scenario[i].values[key][j]*2));
  });
  // Audit the other tables in BAU and scenario, locally and at National scope.
  for (const isScenario of [false,true]) {
    const result = fixture.results.at(-1);
    const prefix = isScenario ? 'scenario_' : '';
    const reports = [result,result];
    for (const snap of ledgerSnapshots(reports,sector,fixture.baseline,isScenario)) {
      if (snap.year<=fixture.baseline) continue;
      const i = result.years.indexOf(snap.year);
      const v = snap.values;
      close(v.funding[2],v.fundingApplied[2]+v.fundingShared[2]);
      for (let rung=0;rung<3;rung++) {
        close(v.fundingApplied[rung],v.replacementPaid[rung]+v.expansionPaid[rung]);
        const actual = key => reports.reduce((sum,r)=>sum+r[sector][prefix+key]
          .reduce((amount,row,j)=>amount+(rung===2 || j===rung ? row[i] : 0),0),0);
        close(v.replacementPaid[rung],actual('replacement_funding_applied_by_service'));
        close(v.expansionPaid[rung],actual('sector_funded_expansion_by_service')+actual('externally_funded_expansion_by_service'));
        close(v.requirementsAnnual[rung],v.plannedExpansion[rung]+v.replacement[rung]+v.cashDeficit[rung]);
        close(v.gapAnnual[rung],v.outstanding[rung]+v.replacement[rung]-v.replacementCredit[rung]+v.cashDeficit[rung]);
        close(v.gapClosing[rung],v.outstanding[rung]+v.accumulatedShortfalls[rung]);
      }
      for (const key of ['fundingApplied','replacementPaid','expansionPaid','requirementsAnnual','requirementsCatchUp','gapAnnual','gapClosing'])
        close(v[key][0]+v[key][1],v[key][2]);
      close(v.gapAnnual[2],reports.reduce((sum,r)=>sum+r[sector][prefix+'financing_gap'][i],0));
      close(v.gapClosing[2],reports.reduce((sum,r)=>sum+r[sector][prefix+'endline_financing_requirement'][i],0));
      close(v.requirementsCatchUp[2],reports.reduce((sum,r)=>sum+
        r[sector][prefix+'catch_up_requirement'][i]+r[sector][prefix+'cash_deficit'][i],0));
      const exactSources = [
        ['scheduledExpansion','scheduled_household_expansion_by_service'],
        ['prefundingHousehold','prefunding_household_expansion_by_service'],
        ['closingHousehold','closing_household_expansion_by_service'],
        ['prefundingAncillary','prefunding_ancillary_by_service'],
        ['closingAncillary','closing_ancillary_by_service'],
        ['currentUnpaidReplacement','current_unpaid_replacement_by_service'],
        ['priorReplacementShortfall','prior_replacement_shortfall_by_service'],
        ['accumulatedReplacementShortfall','accumulated_replacement_shortfall_by_service'],
        ['currentCashShortfall','current_cash_shortfall_by_service'],
        ['priorCashShortfall','prior_cash_shortfall_by_service'],
        ['accumulatedCashShortfall','accumulated_cash_shortfall_by_service'],
        ['householdExpansionPaid','household_expansion_paid_by_service'],
        ['noncashDeliveryHH','noncash_delivery_hh_by_service'],
        ['noncashDeliveryCredit','noncash_delivery_credit_by_service'],
        ['cancelledExpansionCost','cancelled_household_expansion_cost_by_service'],
        ['outstandingRepricing','outstanding_repricing_by_service'],
        ['openingExpansionCost','opening_household_expansion_cost_by_service'],
        ['advanceDeliveryCredit','advance_delivery_credit_by_service'],
        ['newAncillaryCommitment','new_ancillary_commitment_by_service'],
      ];
      if (snap.year > fixture.baseline) for (const [measure, field] of exactSources) {
        const engine = reports.map(r => r[sector][prefix + field]);
        assert.ok(engine.every(Array.isArray), `${prefix}${field} source field must be present`);
        for (let serviceIndex=0;serviceIndex<2;serviceIndex++)
          assert.equal(v[measure][serviceIndex],engine.reduce((sum, rows) => sum + rows[serviceIndex][i], 0),
            `${measure} exact source mapping`);
      }
    }
  }
  const unavailable = ledgerRows({...data,attributionComplete:false},{
    metric:'coverage',service:'basic',basis:'annual',years,isShare:false,moneyFactor:1,currency:'USD',
  });
  assert.ok(!unavailable.some(row=>row.kind==='category'));
  assert.ok(unavailable.find(row=>row.key==='scenario'));
  // Basic remains exclusive, including its signed category gap.
  const basic = ledgerRows(data,{metric:'coverage',service:'basic',basis:'annual',years,isShare:false,moneyFactor:1,currency:'USD'});
  basic.find(row=>row.key==='scenario').values.forEach((value,i)=>close(value,fixture.results.at(-1)[sector].scenario_hh[1][i]));
  assert.ok(!basic.some(row=>row.key==='accessGap' || row.key==='smNetGap'));
  basic.find(row=>row.key==='basicNetGap').values.forEach((value,i)=>
    close(value,basic.find(row=>row.key==='scenario').values[i]-basic.find(row=>row.key==='target').values[i]));
  const smEffects = contributions.flatMap(c=>c.after.map((row,i)=>row.values.coverage[0]-c.before[i].values.coverage[0]));
  const basicEffects = contributions.flatMap(c=>c.after.map((row,i)=>row.values.coverage[1]-c.before[i].values.coverage[1]));
  assert.ok(smEffects.some(value=>value>0) || sector==='sanitation');
  assert.ok(basicEffects.some(value=>value<0) || sector==='sanitation');
  const fundingOptions={metric:'funding',service:'total',basis:'annual',years,isShare:false,moneyFactor:1,currency:'USD'};
  const ordinary=ledgerRows({...data,includesDebt:false},fundingOptions);
  assert.ok(!ordinary.some(r=>['debtFundingSection','fundingRestricted','repayments'].includes(r.key)));
  assert.equal(ordinary.find(r=>r.key==='fundingOperating').label,'Ordinary net cash (signed)');
  const debtFunding=ledgerRows({...data,includesDebt:true},fundingOptions);
  assert.equal(debtFunding.find(r=>r.key==='debtFundingSection').label,'With debt servicing');
  assert.equal(debtFunding.at(-1).key,'fundingOperating');
  assert.equal(debtFunding.at(-1).kind,'summary');
  assert.ok(debtFunding.findIndex(r=>r.key==='debtFundingSection')>debtFunding.findIndex(r=>r.key==='fundingExternal'));
  assert.deepEqual(debtFunding.at(-1).values,ordinary.find(r=>r.key==='fundingOperating').values,
    'Presentation mode must not change the supplied monetary data');
}
// National signed differences add; locally floored deficits deliberately do not net surpluses.
for (const sector of ['water_supply','sanitation']) {
  const makeArea = (target,coverage) => {
    const result=structuredClone(fixture.results.at(-1));
    result.total_hh=result.years.map(()=>3);
    result[sector].target_hh[0]=result.years.map(()=>target);
    result[sector].scenario_hh[0]=result.years.map(()=>coverage);
    result[sector].scenario_sm_access_gap=result.years.map(()=>Math.max(target-coverage,0));
    return result;
  };
  const urban=makeArea(2,2.10), rural=makeArea(1.84,1.69);
  const rowsFor = (areas,isShare=false,keys=['urban','rural'],service='sm') => {
    const snapshots=ledgerSnapshots(areas,sector,fixture.baseline);
    return ledgerRows({years:urban.years,baselineYear:fixture.baseline,base:snapshots,scenario:snapshots,
      contributions:[],attributionComplete:true,includesDebt:false,
      areas: areas.map((result,i)=>({key:keys[i],label:keys[i]==='urban' ? 'Urban' : 'Rural',
        scenario:ledgerSnapshots([result],sector,fixture.baseline)}))},
      {metric:'coverage',service,basis:'annual',years:urban.years,isShare,moneyFactor:1,currency:'USD'});
  };
  const rows=rowsFor([urban,rural]);
  const values=(rs,key)=>rs.find(row=>row.key===key).values;
  values(rows,'target').forEach((v,i)=>{
    close(v,3.84);close(values(rows,'scenario')[i],3.79);
    close(values(rows,'smNetGap')[i],-.05);
    assert.ok(!rows.some(row=>row.key==='accessGap'),'Removed unmet SM target row must not be exported');
    close(ledgerSnapshots([urban,rural],sector,fixture.baseline)[i].values.accessGap[0],.15);
    close(values(rowsFor([urban]),'smNetGap')[i]+values(rowsFor([rural]),'smNetGap')[i],-.05);
    close(values(rows,'smNetGap-urban')[i],.10);
    close(values(rows,'smNetGap-rural')[i],-.15);
    close(values(rows,'smNetGap-urban')[i]+values(rows,'smNetGap-rural')[i],values(rows,'smNetGap')[i]);
  });
  const urbanOnly=rowsFor([urban]), ruralOnly=rowsFor([rural],false,['rural']);
  assert.ok(urbanOnly.some(r=>r.key==='smNetGap-urban') && !urbanOnly.some(r=>r.key==='smNetGap-rural'));
  assert.ok(ruralOnly.some(r=>r.key==='smNetGap-rural') && !ruralOnly.some(r=>r.key==='smNetGap-urban'));
  close(values(ruralOnly,'smNetGap-rural')[0],-.15);
  for (const [target,actual,gap] of [[2,2.1,.1],[2,1.9,-.1],[2,2,0],[2,2+Number.EPSILON,0]]) {
    const row=rowsFor([makeArea(target,actual)]).find(r=>r.key==='smNetGap');
    row.values.forEach(value=>{close(value,gap);assert.ok(!Object.is(value,-0));});
  }
  const shares=rowsFor([urban,rural],true);
  assert.equal(shares.find(row=>row.key==='smNetGap').unit,'pp');
  values(shares,'smNetGap').forEach((v,i)=>{
    close(v,-.05/6*100);
    close(v,values(shares,'scenario')[i]-values(shares,'target')[i]);
    close(values(shares,'smNetGap-urban')[i]+values(shares,'smNetGap-rural')[i],v);
    close(values(shares,'smNetGap-urban')[i],.10/6*100);
    close(values(shares,'smNetGap-rural')[i],-.15/6*100);
  });
  const ruralShares=rowsFor([rural],true,['rural']);
  close(values(ruralShares,'smNetGap-rural')[0],-.15/3*100);
  // Combined access decomposes by exclusive service, then by real entered area.
  urban[sector].target_hh[1]=urban.years.map(()=>1);
  urban[sector].scenario_hh[1]=urban.years.map(()=>.7);
  rural[sector].target_hh[1]=rural.years.map(()=>.5);
  rural[sector].scenario_hh[1]=rural.years.map(()=>.8);
  for(const isShare of [false,true]) {
    const total=rowsFor([urban,rural],isShare,['urban','rural'],'total');
    const basic=rowsFor([urban,rural],isShare,['urban','rural'],'basic');
    const factor=isShare?100/6:1;
    for(let i=0;i<urban.years.length;i++){
      close(values(total,'scenario')[i],5.29*factor);
      close(values(total,'target')[i],5.34*factor);
      close(values(total,'atLeastBasicNetGap')[i],-.05*factor);
      close(values(total,'smNetGap')[i]+values(total,'basicNetGap')[i],values(total,'atLeastBasicNetGap')[i]);
      for(const key of ['smNetGap','basicNetGap'])
        close(values(total,`${key}-urban`)[i]+values(total,`${key}-rural`)[i],values(total,key)[i]);
      close(values(basic,'basicNetGap')[i],values(total,'basicNetGap')[i]);
    }
    assert.equal(total.find(r=>r.key==='smNetGap').depth,1);
    assert.equal(total.find(r=>r.key==='basicNetGap-rural').depth,2);
    assert.ok(!basic.some(r=>r.key==='accessGap' || r.key.startsWith('smNetGap')));
    for(const [area,key] of [[urban,'urban'],[rural,'rural']]){
      const single=rowsFor([area],isShare,[key],'total');
      for(const component of ['smNetGap','basicNetGap']){
        close(values(single,component)[0],values(single,`${component}-${key}`)[0]);
        assert.ok(!single.some(r=>r.key===`${component}-${key==='urban'?'rural':'urban'}`));
      }
    }
  }
  // Upgrading Basic to SM does not fabricate a combined access shortfall.
  const upgraded=makeArea(70,80);
  upgraded.total_hh=upgraded.years.map(()=>100);
  upgraded[sector].target_hh[1]=upgraded.years.map(()=>30);
  upgraded[sector].scenario_hh[1]=upgraded.years.map(()=>20);
  const combined=rowsFor([upgraded],false,['urban'],'total');
  close(values(combined,'smNetGap')[0],10);
  close(values(combined,'basicNetGap')[0],-10);
  close(values(combined,'atLeastBasicNetGap')[0],0);
  // National-only input must not invent an area split.
  const snap=ledgerSnapshots([upgraded],sector,fixture.baseline);
  const national=ledgerRows({years:upgraded.years,baselineYear:fixture.baseline,base:snap,scenario:snap,
    contributions:[],attributionComplete:false,includesDebt:false},
    {metric:'coverage',service:'total',basis:'annual',years:upgraded.years,isShare:false,moneyFactor:1,currency:'USD'});
  assert.ok(!national.some(r=>/-urban$|-rural$/.test(r.key)));
  assert.ok(national.some(r=>r.key==='atLeastBasicNetGap'));
}
const invalid = structuredClone(fixture.results[0]);
delete invalid.water_supply.scenario_annual_planned_expansion_cost_by_service;
const missingSource = ledgerSnapshots([invalid],'water_supply',fixture.baseline);
const firstForecast = missingSource.find(row=>row.year>fixture.baseline);
assert.equal(firstForecast.values.plannedExpansion[0],null,'Missing financial sources remain unavailable');
assert.equal(firstForecast.values.requirementsAnnual[0],null,'Unknown requirement totals are not replaced with zero');
console.log(`Results ledger tests passed: ${comparisons} unrounded scenario bridges; signed/local SM gaps, National aggregation, financial component identities, service splits, shares, currency, year filters, explicit missing data and breakdown fallback.`);
