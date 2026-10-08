import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/connectionRevenueConfig.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { migrateConnectionRevenueConfig: migrate, validateConnectionRevenueConfig: validate,
  migrateConnectionRevenueInputs } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
assert.deepEqual(migrate(), { version: 5, method: 'aggregate_coverage_expansion', enabled: false,
  new_billed_share_basic: null, new_billed_share_sm: null, shared_assumption_note: '' });
for (const version of [1, 2]) {
  const old = { version, enabled: true, billed_share_basic: 0, billed_share_sm: .63, marginal_cost: .8 };
  const result = migrate(old);
  assert.equal(result.new_billed_share_basic, 0);
  assert.equal(result.new_billed_share_sm, .63);
  assert.equal(result.marginal_cost, undefined, 'Old costs never remain active');
  assert.equal(result.legacy_metadata.marginal_cost, .8);
  assert.deepEqual(validate(result), [], 'Historical shares/costs/provenance no longer gate activation');
  assert.deepEqual(old, { version, enabled: true, billed_share_basic: 0, billed_share_sm: .63, marginal_cost: .8 });
  assert.deepEqual(migrate(result), result, 'Migration is idempotent');
}
for (const version of [3, 4]) {
  const old = { version, enabled: true, new_billed_share_basic: 0, new_billed_share_sm: .63, shared_assumption_note: 'retain' };
  const result = migrate(old);
  assert.equal(result.new_billed_share_basic, 0);
  assert.equal(result.new_billed_share_sm, .63);
  assert.match(result.current_behavior_notice, /addition-only/);
  assert.deepEqual(migrate(result), result);
}
const priorNotice = migrate({ version: 4, enabled: false, migration_notice: 'Historical note retained.' });
assert.equal(priorNotice.migration_notice, 'Historical note retained.');
assert.match(priorNotice.current_behavior_notice, /addition-only/);
const draft = migrate({ version: 3, enabled: true, billed_share_basic: .8,
  new_billed_share_basic: null, new_billed_share_sm: 0, shared_assumption_note: 'Keep me' });
assert.equal(draft.new_billed_share_basic, null);
assert.equal(draft.new_billed_share_sm, 0);
assert.equal(draft.shared_assumption_note, 'Keep me');
assert.equal(validate(draft).length, 1);
assert.deepEqual(validate({ ...draft, new_billed_share_basic: 0 }), []);
for (const bad of [-.1, 1.1, NaN, Infinity]) assert.ok(validate({ ...draft, new_billed_share_basic: bad }).length);
assert.deepEqual(validate({ ...draft, enabled: false }), []);
const sectorInputs = { connection_revenue: { water: { version: 3, enabled: true,
  new_billed_share_basic: 0, new_billed_share_sm: .9 }, sanitation: { version: 3, enabled: false,
  new_billed_share_basic: .5, new_billed_share_sm: .6 } }, technical: { ws_non_hh_pct: .4 } };
const migrated = migrateConnectionRevenueInputs(sectorInputs);
assert.equal(migrated.connection_revenue.water.new_billed_share_basic, 0);
assert.equal(migrated.connection_revenue.sanitation.new_billed_share_basic, .5);
assert.deepEqual(migrated.technical, sectorInputs.technical);
assert.equal(migrated.connection_revenue.sanitation.enabled, false);
assert.deepEqual(JSON.parse(JSON.stringify(migrated)), migrated);
assert.equal(migrateConnectionRevenueInputs({ ...sectorInputs, toggles: { ws_connections_enabled: false } })
  .connection_revenue.water.enabled, false, 'An explicit false pseudo toggle must not be ignored');
console.log('Connection v5 migration: explicit zeros, legacy values/provenance, idempotence, sector isolation and no obsolete gates passed.');
