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
    for (const service of metric === 'coverage' ? ['sm','basic'] : ['sm','basic','total'])
      for (const basis of ['annual','closing'])
        for (const isShare of [false,true]) {
          const options = {metric,service,basis,years,isShare,moneyFactor:.001,currency:'USD'};
          const rows = ledgerRows(data, options);
          const categories = rows.filter(row=>row.kind==='category');
          assert.ok(categories.some(row=>row.key==='custom' && row.children[0].key==='custom'));
          assert.equal(rows[0].key, 'bau');
          const final = rows.find(row=>row.key==='scenario');
          for (let i=0;i<years.length;i++) {
            if (rows[0].values[i] == null) {
              assert.equal(final.values[i],null);
              if (metric !== 'coverage') assert.ok(years[i]<=fixture.baseline);
              continue;
            }
            close(rows[0].values[i] + categories.reduce((sum,row)=>sum+row.values[i],0),final.values[i]);
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
            net.values.forEach((value,i)=>close(value,target.values[i]-final.values[i]));
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
        close(v.requirementsAnnual[rung],v.plannedExpansion[rung]+v.replacement[rung]+v.cashDeficit[rung]);
        close(v.gapAnnual[rung],v.outstanding[rung]+v.replacement[rung]-v.replacementCredit[rung]+v.cashDeficit[rung]);
        close(v.gapClosing[rung],v.outstanding[rung]+v.accumulatedShortfalls[rung]);
      }
      for (const key of ['fundingApplied','requirementsAnnual','requirementsCatchUp','gapAnnual','gapClosing'])
        close(v[key][0]+v[key][1],v[key][2]);
      close(v.gapAnnual[2],reports.reduce((sum,r)=>sum+r[sector][prefix+'financing_gap'][i],0));
      close(v.gapClosing[2],reports.reduce((sum,r)=>sum+r[sector][prefix+'endline_financing_requirement'][i],0));
      close(v.requirementsCatchUp[2],reports.reduce((sum,r)=>sum+
        r[sector][prefix+'catch_up_requirement'][i]+r[sector][prefix+'cash_deficit'][i],0));
    }
  }
  const unavailable = ledgerRows({...data,attributionComplete:false},{
    metric:'coverage',service:'basic',basis:'annual',years,isShare:false,moneyFactor:1,currency:'USD',
  });
  assert.ok(!unavailable.some(row=>row.kind==='category'));
  assert.ok(unavailable.find(row=>row.key==='scenario'));
  // Basic remains exclusive: the access gap is the separate at-least-basic measure.
  const basic = ledgerRows(data,{metric:'coverage',service:'basic',basis:'annual',years,isShare:false,moneyFactor:1,currency:'USD'});
  basic.find(row=>row.key==='scenario').values.forEach((value,i)=>close(value,fixture.results.at(-1)[sector].scenario_hh[1][i]));
  const smEffects = contributions.flatMap(c=>c.after.map((row,i)=>row.values.coverage[0]-c.before[i].values.coverage[0]));
  const basicEffects = contributions.flatMap(c=>c.after.map((row,i)=>row.values.coverage[1]-c.before[i].values.coverage[1]));
  assert.ok(smEffects.some(value=>value>0) || sector==='sanitation');
  assert.ok(basicEffects.some(value=>value<0) || sector==='sanitation');
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
  const rowsFor = (areas,isShare=false) => {
    const snapshots=ledgerSnapshots(areas,sector,fixture.baseline);
    return ledgerRows({years:urban.years,baselineYear:fixture.baseline,base:snapshots,scenario:snapshots,
      contributions:[],attributionComplete:true,includesDebt:false},
      {metric:'coverage',service:'sm',basis:'annual',years:urban.years,isShare,moneyFactor:1,currency:'USD'});
  };
  const rows=rowsFor([urban,rural]);
  const values=(rs,key)=>rs.find(row=>row.key===key).values;
  values(rows,'target').forEach((v,i)=>{
    close(v,3.84);close(values(rows,'scenario')[i],3.79);
    close(values(rows,'smNetGap')[i],.05);close(values(rows,'accessGap')[i],.15);
    close(values(rowsFor([urban]),'smNetGap')[i]+values(rowsFor([rural]),'smNetGap')[i],.05);
  });
  for (const [target,actual,gap] of [[2,2.1,-.1],[2,1.9,.1],[2,2,0],[2,2+Number.EPSILON,0]]) {
    const row=rowsFor([makeArea(target,actual)]).find(r=>r.key==='smNetGap');
    row.values.forEach(value=>{close(value,gap);assert.ok(!Object.is(value,-0));});
  }
  const shares=rowsFor([urban,rural],true);
  assert.equal(shares.find(row=>row.key==='smNetGap').unit,'pp');
  values(shares,'smNetGap').forEach((v,i)=>{
    close(v,.05/6*100);
    close(v,values(shares,'target')[i]-values(shares,'scenario')[i]);
  });
}
const invalid = structuredClone(fixture.results[0]);
delete invalid.water_supply.scenario_annual_planned_expansion_cost_by_service;
assert.throws(()=>ledgerSnapshots([invalid],'water_supply',fixture.baseline),/Missing service ledger measure/);
console.log(`Results ledger tests passed: ${comparisons} unrounded scenario bridges; signed/local SM gaps, National aggregation, financial component identities, service splits, shares, currency, year filters, explicit missing data and breakdown fallback.`);
