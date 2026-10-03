import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  new Function('exports', outputText)(exports);
  return exports;
}
const { sumServiceGaps, cumulativeAnnualFlow } = load('../src/programmeFinance.ts');
const { migrateInputCompatibility } = load('../src/inputCompatibility.ts');
const { areasOf, BUNDLE_KEY } = load('../src/areaBundle.ts');

// Use real engine/deck/report output, not a separately reimplemented model or
// frozen mocked data. No running web server or additional packages are needed.
const fixture = JSON.parse(execFileSync('python', ['-c', `
import json
from validation_fixtures import mixed_area_inputs
from deck_data import build
from reporting import annual_reporting_tables
from input_compatibility import migrate_input_compatibility
inputs = mixed_area_inputs()
data = build(inputs)
old = inputs['urban'].copy()
old.pop('reporting_schema_version', None)
old['water_interventions'] = {k:v for k,v in old['water_interventions'].items()
                            if k not in ('borrow_rate_basis','borrow_contract_principal')}
old['toggles'] = {**old['toggles'], 'ws_borrowing_enabled': True}
old['water_interventions']['cash_allocation_alpha'] = .7
print(json.dumps({'areas':inputs,'results':data['results'],'old':old,
                  'migrated':migrate_input_compatibility(old),
                  'reports':{s:annual_reporting_tables(data['results']['national'],inputs['urban'],s)
                             for s in ('water_supply','sanitation')}}))
`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).toString());

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)),
    `${actual} must match ${expected}`);
}

test('chart/table service-gap selector matches engine, geographic totals and annual report exports', () => {
  const results = [fixture.results.urban, fixture.results.rural];
  for (const sector of ['water_supply', 'sanitation']) {
    for (const scenario of [false, true]) {
      for (const rung of [0, 1]) {
        const actual = sumServiceGaps(results, sector, scenario, rung);
        const canonical = fixture.results.national[sector][scenario ? 'scenario_service_gap_display' : 'service_gap_display'][rung];
        const exported = fixture.reports[sector][rung].rows.map(row => row[scenario ? 5 : 4]);
        actual.forEach((v, i) => { near(v, canonical[i]); near(v, exported[i]); });
      }
    }
    const years = fixture.results.national.years;
    const annual = years.map((_, i) => results.reduce((sum, r) => sum + r[sector].scenario_financing_gap[i], 0));
    near(cumulativeAnnualFlow(annual, years, fixture.areas.urban.period.baseline_year),
      fixture.results.national[sector].scenario_cumulative_financing_gap.at(-1));
  }
});

test('Python and frontend migrations agree and saved bundles preserve sector/geography choices', () => {
  assert.deepEqual(migrateInputCompatibility(fixture.old), fixture.migrated);
  const urban = migrateInputCompatibility(fixture.areas.urban);
  const rural = migrateInputCompatibility(fixture.areas.rural);
  const snapshot = JSON.parse(JSON.stringify({ [BUNDLE_KEY]: 1, inputs: urban, altInputs: { rural },
    scope: { areaUrban: true, areaRural: true } }));
  const areas = areasOf(snapshot);
  assert.deepEqual(areas, { urban, rural });
  for (const [area, saved] of Object.entries(areas)) {
    assert.deepEqual(saved.water_service, fixture.areas[area].water_service);
    assert.deepEqual(saved.sanitation_service, fixture.areas[area].sanitation_service);
  }
});

test('aggregation fails explicitly for mismatched years or missing/nonfinite canonical gaps', () => {
  const valid = fixture.results.urban;
  const mismatched = { ...fixture.results.rural, years: [2000] };
  assert.throws(() => sumServiceGaps([valid, mismatched], 'water_supply', true, 0), /years must match/);
  assert.throws(() => sumServiceGaps([{ years: valid.years }], 'water_supply', true, 0), /Missing canonical/);
  const invalid = structuredClone(valid);
  invalid.water_supply.scenario_service_gap_display[0][0] = NaN;
  assert.throws(() => sumServiceGaps([invalid], 'water_supply', true, 0), /finite and nonnegative/);
});