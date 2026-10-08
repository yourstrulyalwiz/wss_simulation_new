import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { GLOBAL_INTERVENTION_ORDER, comparisonInputs, interventionEnabled, setInterventionEnabled } = require('../src/interventionRegistry.ts');
const { revenueSourceRows, reconciliationVersion } = require('../src/revenueSources.ts');
assert.deepEqual(GLOBAL_INTERVENTION_ORDER.slice(0, 2).map(d => d.key), ['ws_connections_enabled', 'san_connections_enabled']);
assert.equal(new Set(GLOBAL_INTERVENTION_ORDER.map(d => d.key)).size, GLOBAL_INTERVENTION_ORDER.length);
const input = { connection_revenue: { water: { enabled: true, new_billed_share_basic: 0 }, sanitation: { enabled: false } },
  toggles: { ws_nrw_enabled: true, san_nrw_link_enabled: true } };
const original = JSON.stringify(input);
const baseline = comparisonInputs(input, {});
assert.equal(baseline.connection_revenue.water.enabled, false);
assert.equal(baseline.connection_revenue.sanitation.enabled, false);
assert.equal(baseline.toggles.ws_nrw_enabled, false);
const stage = comparisonInputs(input, { ws_connections_enabled: true, san_connections_enabled: true });
assert.equal(stage.connection_revenue.water.enabled, true);
assert.equal(stage.connection_revenue.sanitation.enabled, false, 'Do not enable an off geography/sector');
assert.equal(stage.connection_revenue.water.new_billed_share_basic, 0);
assert.equal(JSON.stringify(input), original, 'Passes cannot mutate saved inputs');
assert.equal(interventionEnabled({ ...input, toggles: { ws_connections_enabled: false } }, 'ws_connections_enabled'), false);
assert.equal(setInterventionEnabled(input, 'ws_connections_enabled', false).connection_revenue.water.enabled, false);
const ledger = (connections, nrw, collection, tariff) => ({ years: [2026], water_supply: {
  scenario_connection_net_cash: [connections], scenario_connections_cash: [connections],
  scenario_connection_revenue_delta: [connections], scenario_nrw_net: [nrw],
  scenario_collection_cash: [collection], scenario_tariff_cash: [tariff],
  scenario_revenue_reconciliation: { version: 3 },
} });
assert.equal(reconciliationVersion(ledger(320, 110, 260, 1170), 'water_supply'), 3);
assert.deepEqual(revenueSourceRows([ledger(320, 110, 260, 1170)], 'water_supply'),
  [{ year: 2026, connections: 320, nrw: 110, collection: 260, tariff: 1170, total: 1860 }]);
assert.equal(revenueSourceRows([ledger(288, 110, 256, 1152)], 'water_supply')[0].total, 1806);
assert.equal(revenueSourceRows([ledger(100, -30, 0, 0)], 'water_supply')[0].total, 70, 'Signed NRW is not floored');
const national = revenueSourceRows([ledger(100, -30, 0, 0), ledger(0, 4, 12, 16)], 'water_supply')[0];
assert.equal(national.connections, 100);
assert.equal(national.total, 102, 'Sum authoritative area receipts, never recompute rates');
const missing = ledger(1, 2, 3, 4);
delete missing.water_supply.scenario_tariff_cash;
assert.equal(revenueSourceRows([missing], 'water_supply')[0].total, null);
const sanitation = { years: [2026], sanitation: { scenario_connection_net_cash: [0],
  scenario_eligible_nrw_link_cash: [-3], scenario_nrw_net: [-3], scenario_nrw_link_cash: [-3],
  scenario_collection_cash: [0], scenario_tariff_cash: [0] } };
assert.equal(revenueSourceRows([sanitation], 'sanitation')[0].total, -3, 'Sanitation aliases are not added twice');
const canonical = ledger(1, 2, 3, 4);
canonical.water_supply.scenario_connection_revenue_cash = [17];
assert.equal(revenueSourceRows([canonical], 'water_supply')[0].connections, 17);
console.log('Revenue v3: final-ledger identity fixtures, signed cash, one alias, area totals and isolated first connection stages passed.');
