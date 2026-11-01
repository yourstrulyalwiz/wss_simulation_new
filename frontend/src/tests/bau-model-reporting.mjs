// Read-only calculations against an in-memory copy. No simulation writes, saves or auth changes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const ts = createRequire(import.meta.url)('typescript');
const code = ts.transpileModule(readFileSync(new URL('../bauServiceView.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { bauServiceValue, bauAccessGap, bauSpendingRows } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const gallery = await (await fetch(`${url}/api/simulations?collection=examples`)).json();
const example = gallery.items.find(item => item.read_only && item.visibility === 'public');
assert.ok(example, 'A public example is required for anonymous calculation authorization');
const response = await fetch(`${url}/api/defaults`);
assert.ok(response.ok);
const inputs = await response.json();
inputs.toggles = Object.fromEntries(Object.keys(inputs.toggles).map(key => [key, false]));
const count = inputs.period.forecast_end_year - inputs.period.model_start_year + 1;
for (const prefix of ['ws', 'san']) {
  inputs.bau[`${prefix}_expend_ts`] = Array(count).fill(100);
  inputs.bau[`${prefix}_alloc_ts`] = Array(count).fill(200);
}
const before = JSON.stringify(inputs);
async function calculate() {
  const response = await fetch(`${url}/api/calculate`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-simulation-id': example.id }, body: before });
  assert.ok(response.ok, `Calculation failed (${response.status})`);
  return response.json();
}
const first = await calculate();
assert.deepEqual(first.sector_errors, {});
const resultSnapshot = JSON.stringify(first);
for (const key of ['water_supply', 'sanitation']) {
  assert.ok(first[key], `${key} results required`);
  for (let i = 0; i < first.years.length; i++) {
    for (const series of ['bau_hh', 'target_hh', 'financing_gap_by_service', 'new_capex_by_service',
      'replacement_by_service', 'funded_by_service', 'cash_deficit_by_service']) {
      const managed = bauServiceValue(first[key], series, i, 'safely_managed');
      const basic = bauServiceValue(first[key], series, i, 'basic');
      assert.equal(bauServiceValue(first[key], series, i, 'at_least_basic'), managed + basic);
    }
    assert.equal(bauAccessGap(first[key], i, 'at_least_basic'), first[key].at_least_basic_access_gap[i]);
  }
  const rows = bauSpendingRows([first], key, inputs.period.baseline_year);
  assert.equal(rows.length, first.years.filter(year => year > inputs.period.baseline_year).length);
  for (const row of rows) {
    const i = first.years.indexOf(row.year);
    assert.equal(row.expansion, first[key].annual_planned_expansion_cost[i]);
    assert.equal(row.replacement, first[key].replacement_capex[i]);
    assert.equal(row.available, first[key].available_total[i]);
  }
}
assert.equal(JSON.stringify(first), resultSnapshot);
assert.equal(JSON.stringify(inputs), before);
assert.deepEqual(await calculate(), first, 'Identical inputs return identical model output after cycling every reporting view');
console.log('PASS: real engine, both sectors/all years/all service views, annual capital sources, unchanged inputs/results and identical repeated calculations.');
