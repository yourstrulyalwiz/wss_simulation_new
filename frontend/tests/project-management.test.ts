import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeScope, scopedBundle, scopeWithGeography, preserveDormantInputs } from '../src/projectScope';
import { areasOf, comparisonAreas } from '../src/areaBundle';
import { calculationPayload, resolveRevenueBases, runCalculation, runEconomicProjections } from '../src/api';
import { projectMutation, ProjectError, recoveryKey } from '../src/projectApi';
import { simulationHeaders, withSimulationId, stripSimulationId } from '../src/simulationTransport';

test('scope round trips preserve unknown fields, inactive data and spending schedules', () => {
  const scope = normalizeScope({ sectors: ['water'], scopeMode: 'urban_rural', areaUrban: true, areaRural: false, futureScopeField: 'retained' });
  const original = { __wss_bundle: 1, futureEnvelope: { retained: true }, inputs: { sanitation_service: { sserv1_ts: [.27] }, water_interventions: { financial_commitment_schedule: [{ year: 2031, target: .17 }] } }, altInputs: { rural: { population: { pop_ts: [2.73] } }, national: { population: { pop_ts: [7.21] } } }, presentation: { futureMode: 'retained' } };
  const result = scopedBundle(original, scope);
  assert.deepEqual(result.inputs.sanitation_service, original.inputs.sanitation_service);
  assert.deepEqual(result.altInputs.rural.population, original.altInputs.rural.population);
  assert.deepEqual(result.inputs.water_interventions, original.inputs.water_interventions);
  assert.deepEqual(result.futureEnvelope, original.futureEnvelope);
  assert.deepEqual(result.presentation, original.presentation);
  assert.deepEqual(Object.keys(areasOf(result)), ['urban']);
  assert.deepEqual(areasOf(result).urban.calculation_scope, ['water']);
  const narrowed = scopedBundle(result, scopeWithGeography(scope, 'National'));
  assert.deepEqual(Object.keys(areasOf(narrowed)), ['national']);
  assert.deepEqual(areasOf(narrowed).national.population, original.altInputs.national.population);
  assert.equal(normalizeScope(scopeWithGeography(scope, 'National')).areaUrban, false);
});
test('imports and master edits cannot change dormant sector observations', () => {
  const original = { water_service: { serv1_ts: [.32] }, sanitation_service: { sserv1_ts: [.18] }, technical: { san_asset_life: 23, ws_asset_life: 38 }, toggles: { san_nrw_link_enabled: true, ws_nrw_enabled: false }, bau: { san_expend_ts: [3.82], ws_expend_ts: [8.13] }, utility_debt: { sanitation: { interest_rate: .043 } }, custom_interventions: [{ name: 'Dormant', sector: 'sanitation' }] };
  const imported = { ...original, sanitation_service: {}, technical: {}, toggles: {}, bau: {}, utility_debt: {}, custom_interventions: [] };
  const preserved = preserveDormantInputs(original, imported, ['water']);
  assert.deepEqual(preserved.sanitation_service, original.sanitation_service);
  assert.equal(preserved.technical.san_asset_life, 23);
  assert.equal(preserved.toggles.san_nrw_link_enabled, true);
  assert.deepEqual(preserved.bau.san_expend_ts, [3.82]);
  assert.deepEqual(preserved.utility_debt.sanitation, original.utility_debt.sanitation);
  assert.deepEqual(preserved.custom_interventions, original.custom_interventions);
});
test('sanitation-only effective configuration disables NRW linkage without changing saved inputs', () => {
  const inputs = { calculation_scope: ['sanitation'], toggles: { san_nrw_link_enabled: true }, sanitation_interventions: { nrw_link_eligible_share: .83 } };
  assert.equal(calculationPayload(inputs).toggles.san_nrw_link_enabled, false);
  assert.equal(inputs.toggles.san_nrw_link_enabled, true);
  assert.deepEqual(calculationPayload(inputs).sanitation_interventions, inputs.sanitation_interventions);
});
test('comparison exports cannot relabel Urban snapshots as newly included Rural or National data', () => {
  const saved = { __wss_bundle: 1, inputs: { population: { pop_ts: [1.87] } }, scope: { sectors: ['water'], scopeMode: 'urban_rural', areaUrban: true, areaRural: false } };
  assert.deepEqual(comparisonAreas(saved, normalizeScope({ sectors: ['water'], areaUrban: false, areaRural: true })), {});
  assert.deepEqual(comparisonAreas(saved, normalizeScope({ sectors: ['water'], scopeMode: 'national' })), {});
  assert.deepEqual(comparisonAreas(saved, normalizeScope({ sectors: ['sanitation'], areaUrban: true })), {});
  assert.deepEqual(comparisonAreas(saved, normalizeScope({ sectors: ['water'], areaUrban: true })).urban.calculation_scope, ['water']);
});
test('all calculation requests use scope and cookies; unrelated result validation does not block', async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url, options) => {
    assert.equal(options?.credentials, 'include');
    assert.deepEqual(JSON.parse(String(options?.body)).calculation_scope, ['water']);
    seen.push(String(url));
    return { ok: true, json: async () => ({ water_supply: { valid: true }, years: [] }) } as Response;
  }) as typeof fetch;
  try {
    const inputs = { calculation_scope: ['water'] };
    await runCalculation(inputs); await runEconomicProjections(inputs); await resolveRevenueBases(inputs);
    assert.deepEqual(seen, ['/api/calculate', '/api/projections', '/api/revenue-bases']);
  } finally { globalThis.fetch = originalFetch; }
});
test('legacy model endpoints receive per-input project headers without body or cross-project leakage', async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<[string, string | null]> = [];
  globalThis.fetch = (async (url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.__wss_simulation_id, undefined);
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    seen.push([String(url), new Headers(options?.headers).get('x-simulation-id')]);
    return { ok: true, json: async () => ({ water_supply: {}, years: [] }) } as Response;
  }) as typeof fetch;
  try {
    const first = withSimulationId({ calculation_scope: ['water'] }, 'seed-oct12');
    await Promise.all([runCalculation(first), runEconomicProjections(first), resolveRevenueBases(first)]);
    const next = withSimulationId(first, 'owned-next-project');
    await runCalculation(next);
    await runCalculation({ calculation_scope: ['water'] });
    assert.deepEqual(seen.map(([, id]) => id), ['seed-oct12', 'seed-oct12', 'seed-oct12', 'owned-next-project', null]);
    assert.equal(simulationHeaders({ areas: { urban: first } })['x-simulation-id'], 'seed-oct12');
    assert.equal(simulationHeaders(first, 'explicit-current-project')['x-simulation-id'], 'explicit-current-project');
    assert.deepEqual(stripSimulationId(first), { calculation_scope: ['water'] });
    assert.equal(simulationHeaders()['x-simulation-id'], undefined);
  } finally { globalThis.fetch = originalFetch; }
});
test('project mutations use revision + cookie auth and surface conflicts rather than reporting success', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, options) => {
    assert.equal(url, '/api/simulations/owned-record');
    assert.equal(options?.credentials, 'include');
    assert.equal(JSON.parse(String(options?.body)).revision, 7);
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    return { ok: false, status: 409, json: async () => ({ detail: 'Newer revision exists.' }) } as Response;
  }) as typeof fetch;
  try {
    await assert.rejects(projectMutation('/simulations/owned-record', { revision: 7 }, 'PATCH'), error => error instanceof ProjectError && error.status === 409);
    assert.notEqual(recoveryKey('person-a', 'project-a'), recoveryKey('person-b', 'project-a'));
    assert.notEqual(recoveryKey('person-a', 'project-a'), recoveryKey('person-a', 'project-b'));
  } finally { globalThis.fetch = originalFetch; }
});
test('project workspace has no global persistence, profile APIs or automatic preview replacement', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /\/api\/profiles|\/api\/development-preview|\/api\/mock-drc-inputs|wss_working_bundle|wss_demo_scenarios/);
  assert.doesNotMatch(app, /JSON\.parse\(JSON\.stringify\(inputs\)\)/);
  assert.match(app, /!modified\.current/);
  const router = readFileSync(new URL('../src/Router.tsx', import.meta.url), 'utf8');
  assert.match(router, /path="\/sign-in\/\*\?"/);
  assert.match(router, /path="\/sign-up\/\*\?"/);
  assert.match(router, /proxyUrl=\{clerkProxyUrl\}/);
  assert.match(router, /publishableKeyFromHost/);
});
