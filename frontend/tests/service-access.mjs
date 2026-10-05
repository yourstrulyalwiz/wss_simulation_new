import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/serviceAccess.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { ACCESS_COLUMNS, serviceAccessRows } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function area(sm, basic, smGap, basicGap) {
  const sec = {};
  for (const [,key] of ACCESS_COLUMNS) {
    sec[key] = [[key === 'sm_access_gap' ? smGap : key === 'at_least_basic_access_gap' ? basicGap : 0]].flat();
    sec['scenario_'+key] = [...sec[key]];
  }
  sec.bau_hh = [[sm], [basic]];
  sec.target_hh = [[70], [30]];
  sec.closing_outstanding_hh = [[smGap], [basicGap]];
  sec.scenario_hh = [[sm], [basic]];
  sec.scenario_target_hh = [[70], [30]];
  sec.scenario_closing_outstanding_hh = [[smGap], [basicGap]];
  return { years:[2026], water_supply:sec, sanitation:sec };
}
const results = [area(80,20,0,0), area(60,30,10,10)];
const before = JSON.stringify(results);
for (const sector of ['water_supply','sanitation']) {
  const rows = serviceAccessRows(results,sector,2025);
  assert.equal(rows.length,2);
  for (const row of rows) {
    assert.equal(row.values[7],10, 'SM surplus elsewhere must not cancel local deficits');
    assert.equal(row.values[10],10, 'Use assessed local basic-entry gaps');
    assert.equal(row.values[11],10);
    assert.equal(row.values[12],10);
  }
  assert.equal(serviceAccessRows(results,sector,2026).length,0);
  assert.equal(serviceAccessRows(results,sector,2025,['BAU']).length,1);
}
assert.equal(JSON.stringify(results),before);
console.log('Service access rows passed: both sectors/passes, local gaps before aggregation, baseline filtering and unchanged inputs.');
