import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('exports', 'require', outputText)(exports, name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  });
  return exports;
}
const compatibility = load('../src/inputCompatibility.ts');
const { marginalPassInput, enabledInAnyArea } = load('../src/interventionPasses.ts', {
  './inputCompatibility': compatibility,
});

test('marginal passes preserve each area selection rather than copying one area to all', () => {
  const urban = { toggles: { ws_costeff_enabled: true, san_costeff_enabled: false } };
  const rural = { toggles: { ws_costeff_enabled: false, san_costeff_enabled: true } };
  const mask = { ws_costeff_enabled: true, san_costeff_enabled: true };
  assert.equal(enabledInAnyArea([urban, rural], 'san_costeff_enabled'), true);
  assert.equal(marginalPassInput(urban, mask, false).toggles.san_costeff_enabled, false);
  assert.equal(marginalPassInput(rural, mask, false).toggles.ws_costeff_enabled, false);
  assert.equal(marginalPassInput(rural, mask, false).toggles.san_costeff_enabled, true);
});

test('public financing steps retain customs and do not mutate saved assignments', () => {
  const input = { toggles: { ws_exogenous_injection_enabled: true },
    custom_interventions: [{ sector: 'both', enabled: true, water_allocation_share: 0.25,
      sanitation_allocation_share: 0.75 }] };
  const original = structuredClone(input);
  assert.deepEqual(marginalPassInput(input, {}, false).custom_interventions, []);
  assert.deepEqual(marginalPassInput(input, { ws_exogenous_injection_enabled: true }, true).custom_interventions,
    input.custom_interventions);
  assert.deepEqual(input, original);
});

test('legacy injection migration occurs before measuring explicit public capital', () => {
  const legacy = { toggles: { ws_financial_commitment_enabled: true },
    water_interventions: { fin_injection_enabled: true } };
  assert.equal(enabledInAnyArea([legacy], 'ws_exogenous_injection_enabled'), true);
  assert.equal(marginalPassInput(legacy, {}, false).toggles.ws_exogenous_injection_enabled, false);
  assert.equal(marginalPassInput(legacy, { ws_exogenous_injection_enabled: true }, false)
    .toggles.ws_exogenous_injection_enabled, true);
  assert.equal(marginalPassInput(legacy, {}, false).toggles.ws_borrowing_enabled, false);
});