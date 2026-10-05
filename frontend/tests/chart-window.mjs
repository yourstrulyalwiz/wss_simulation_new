import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/chartWindow.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { resolveChartWindow: window } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const years = Array.from({length:30}, (_,i) => 2011+i);
const period = {model_start_year:2011, baseline_year:2025, forecast_end_year:2040};
const before = JSON.stringify({years,period});
assert.deepEqual(window(years,period),{years,start:2023,end:2040});
assert.equal(window(years,period,2011).start,2011,'full history remains selectable');
assert.equal(window(years,period,null,2030).end,2030);
assert.equal(window(years,period).start,2023,'reset restores simulation default');
assert.equal(window(years,{...period,baseline_year:2030}).start,2028,'period changes move untouched default');
assert.equal(window(years,{...period,baseline_year:2030},2015).start,2015,'valid override survives changed inputs');
assert.equal(window(years.slice(14),period).start,2025,'short history is clamped');
assert.deepEqual(window([],period),{years:[],start:null,end:null});
assert.deepEqual(window([2025],period),{years:[2025],start:2025,end:2025});
assert.deepEqual(window([2027,2023,NaN,2023,2025],period),{years:[2023,2025,2027],start:2023,end:2027});
assert.equal(window(years,period,2000,2050).start,2011);
assert.equal(window(years,period,2000,2050).end,2040);
assert.equal(window(years,period,2035,2020).end,2035,'crossed bounds remain nonempty');
assert.equal(JSON.stringify({years,period}),before,'presentation never mutates model inputs');
for (const name of ['LiveBAUChart','LiveInterventionChart','ResultsDashboard']) {
  const component=readFileSync(new URL(`../src/components/${name}.tsx`,import.meta.url),'utf8');
  assert.ok(component.includes('resolveChartWindow('),`${name} must share the default policy`);
  assert.ok(component.includes('setChartStart(null); setChartEnd(null);'),'reset clears overrides');
}
console.log('Graph windows: simulation defaults, full history, manual overrides, reset, changed periods, sparse/short history and immutable model data passed.');
