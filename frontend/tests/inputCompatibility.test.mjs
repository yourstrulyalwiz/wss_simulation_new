import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Use the project's existing compiler; no additional test runtime is required.
function loadTypeScript(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('exports', outputText)(exports);
  return exports;
}
const { migrateInputCompatibility, BORROWING_DEFAULTS } = loadTypeScript('../src/inputCompatibility.ts');
const { areasOf, liveAreas, BUNDLE_KEY } = loadTypeScript('../src/areaBundle.ts');

test('legacy saved inputs keep history, milestones and sector settings, with borrowing off', () => {
  const old = {
    period: { baseline_year: 2025, target1_year: 2030, target2_year: 2040 },
    water_service: { serv1_ts: [0.1, 0.2, null, 0.5] },
    sanitation_service: { sserv1_ts: [0.05, 0.1, null, 0.4] },
    population: { hh_ts: [100, 110] },
    toggles: { ws_tariff_enabled: true, san_tariff_enabled: false },
    water_interventions: { tariff_target: 40 },
    sanitation_interventions: { tariff_target: 16 },
  };
  const before = structuredClone(old);
  const migrated = migrateInputCompatibility(old);
  assert.deepEqual(old, before, 'loading must not mutate the stored snapshot');
  for (const key of ['period', 'water_service', 'sanitation_service', 'population']) {
    assert.deepEqual(migrated[key], old[key]);
  }
  for (const section of ['water_interventions', 'sanitation_interventions']) {
    for (const [key, value] of Object.entries(BORROWING_DEFAULTS)) assert.deepEqual(migrated[section][key], value);
  }
  assert.equal(migrated.toggles.ws_borrowing_enabled, false);
  assert.equal(migrated.toggles.san_borrowing_enabled, false);
  assert.equal(migrated.water_interventions.tariff_target, 40);
  assert.equal(migrated.sanitation_interventions.tariff_target, 16);
  assert.deepEqual(migrateInputCompatibility(migrated), migrated, 'migration must be idempotent');
});

test('supported unversioned financing settings stay independent and are not overwritten', () => {
  const old = {
    toggles: { ws_borrowing_enabled: true, san_borrowing_enabled: false,
      ws_financial_commitment_enabled: true, san_financial_commitment_enabled: false },
    water_interventions: { cash_allocation_alpha: 0.7, borrow_interest_rate: 0, fin_injection_enabled: true, borrow_rate_basis: 'real', borrow_contract_principal: 0 },
    sanitation_interventions: { cash_allocation_alpha: 0.2, borrow_interest_rate: null, fin_injection_enabled: true, borrow_rate_basis: 'nominal', borrow_contract_principal: 0 },
  };
  const migrated = migrateInputCompatibility(old);
  assert.equal(migrated.water_interventions.cash_allocation_alpha, 0.7);
  assert.equal(migrated.water_interventions.borrow_interest_rate, 0);
  assert.equal(migrated.sanitation_interventions.cash_allocation_alpha, 0.2);
  assert.equal(migrated.sanitation_interventions.borrow_interest_rate, null);
  assert.equal(migrated.toggles.ws_borrowing_enabled, true);
  assert.equal(migrated.toggles.san_borrowing_enabled, false);
  assert.equal(migrated.toggles.ws_exogenous_injection_enabled, true);
  assert.equal(migrated.toggles.san_exogenous_injection_enabled, false);
});

test('ambiguous legacy borrowing is not silently activated and review notes survive resaving', () => {
  const old = { toggles: { ws_borrowing_enabled: true }, water_interventions: {
    cash_allocation_alpha: .7, borrow_interest_rate: .06, tariff_target: 99,
  }};
  const migrated = migrateInputCompatibility(old);
  assert.equal(migrated.toggles.ws_borrowing_enabled, false);
  assert.equal(migrated.water_interventions.cash_allocation_alpha, 0);
  assert.equal(migrated.water_interventions.tariff_target, 99);
  assert.equal(migrated.water_interventions.borrow_interest_rate, .06);
  assert.equal(migrated.legacy_financing_settings.water_interventions.cash_allocation_alpha, .7);
  assert.ok(migrated.migration_notes.some(note => note.includes('interest basis was not recorded')));
  assert.deepEqual(migrateInputCompatibility(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('saved and live exports preserve national, urban, rural and combined scope selection', () => {
  const urban = { name: 'urban' }, rural = { name: 'rural' }, national = { name: 'national' };
  const bundle = { [BUNDLE_KEY]: 1, inputs: urban, altInputs: { rural, national } };
  assert.deepEqual(areasOf({ ...bundle, scope: { scopeMode: 'national' } }), { national });
  assert.deepEqual(areasOf({ ...bundle, scope: { areaUrban: true, areaRural: true } }), { urban, rural });
  assert.deepEqual(areasOf({ ...bundle, scope: { areaUrban: true, areaRural: false } }), { urban });
  assert.deepEqual(areasOf({ ...bundle, scope: { areaUrban: false, areaRural: true } }), { rural });
  assert.deepEqual(areasOf(urban), { national: urban }, 'legacy single-area snapshots retain their whole dataset');
  assert.deepEqual(liveAreas('national', urban, { rural, national }), { national });
  assert.deepEqual(liveAreas('urban_rural', urban, { rural }), { urban, rural });
  assert.deepEqual(liveAreas('urban', urban, { rural }), { urban });
  assert.deepEqual(liveAreas('rural', urban, { rural }), { rural });
});