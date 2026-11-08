import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
Module._extensions['.ts'] = (loaded, filename) => loaded._compile(
  ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
const { WORKSPACE_TABS, validWorkspaceTab } = require('../workspaceNavigation.ts');
const { emptyPostSettings, postTargetError, postSum, postCoverage, verifiedPostBucket, postCsv } = require('../postInterventionPresentation.ts');
assert.equal(WORKSPACE_TABS.find(tab => tab.id === 5).label, 'Slide Deck');
assert.equal(WORKSPACE_TABS.find(tab => tab.id === 5).step, 7);
assert.equal(WORKSPACE_TABS.find(tab => tab.id === 6).step, 6);
assert.equal(WORKSPACE_TABS[6].id, 6);
for (const id of [-1, 0, 1, 2, 3, 4, 5, 6]) assert.ok(validWorkspaceTab(id));
for (const id of [-2, 7, null, undefined, NaN, '5', 5.1]) assert.equal(validWorkspaceTab(id), false);
assert.deepEqual(emptyPostSettings(), { version: 1, targetYear: null, targetOverrides: {}, toggleOverrides: {}, fundingMethod: 'constant_gdp_share' });
assert.equal(postTargetError({ safelyManagedShare: 0, atLeastBasicShare: 0 }), '');
assert.equal(postTargetError({ safelyManagedShare: .4, atLeastBasicShare: 1 }), '');
for (const target of [
  { safelyManagedShare: null, atLeastBasicShare: 0 },
  { safelyManagedShare: 0, atLeastBasicShare: null },
  { safelyManagedShare: .8, atLeastBasicShare: .6 },
  { safelyManagedShare: -.01, atLeastBasicShare: .6 },
  { safelyManagedShare: .4, atLeastBasicShare: 1.01 },
  { safelyManagedShare: Infinity, atLeastBasicShare: 1 },
]) assert.ok(postTargetError(target));
assert.equal(postSum([0, 0]), 0);
assert.equal(postSum([.21, .39]), .6);
for (const values of [[], [undefined], [null], [0, undefined], [NaN], [Infinity], ['0']]) assert.equal(postSum(values), null);
const make = (sm, total) => ({ solver_status: 'solved', funding_fraction: .0013,
  reference_coverage: { sm: [sm], basic: [total - sm], at_least_basic: [total], total: [total] },
  verified_funded_coverage: { sm: [sm], basic: [total - sm], at_least_basic: [total], total: [total] },
});
const urban = make(.4, .8), rural = make(.02, .2);
const before = JSON.stringify([urban, rural]);
assert.equal(postCoverage([urban, rural], 'reference_coverage', 0, 'sm'), .42000000000000004);
assert.equal(postCoverage([urban, rural], 'reference_coverage', 0, 'total'), 1);
assert.equal(postCoverage([urban, undefined], 'reference_coverage', 0, 'sm'), null);
assert.equal(postCoverage([urban, { solver_status: 'invalid_inputs', error: 'Missing costs' }], 'reference_coverage', 0, 'sm'), null);
assert.equal(verifiedPostBucket(urban), true);
for (const solver_status of ['invalid_inputs', 'nonconvergent', 'coverage_met_finance_unresolved', 'not_resolved_within_bounds', 'delivery_constraint']) {
  const failed = { ...rural, solver_status, candidate_fraction: .21 };
  assert.equal(verifiedPostBucket(failed), false);
  assert.equal(postCoverage([urban, failed], 'verified_funded_coverage', 0, 'sm'), null);
}
assert.equal(JSON.stringify([urban, rural]), before, 'Display aggregation must never mutate API results');
assert.ok(postCsv(['Scope', 'Value'], [['Rural, sanitation', 0], ['=SUM(A1)', null]]).includes('"Rural, sanitation","0"'));
assert.ok(postCsv(['Scope'], [['=SUM(A1)']]).includes("\"'=SUM(A1)\""));
// Persistence and isolation wiring: the shared loan choice is saved/restored once, including legacy reset.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.match(app, /useState<PostInterventionSettings \| undefined>\(initialBundle\.postIntervention\)/);
assert.match(app, /scope: \{[^\n]*\},\n    postIntervention,\n    presentation: \{[^\n]*currencyDisplay, includeDebt/);
assert.match(app, /setPostIntervention\(obj\.postIntervention\)/);
assert.doesNotMatch(app, /presentation\??\.postIntervention/);
assert.match(app, /setIncludeDebt\(obj\.presentation\?\.includeDebt !== false\)/);
assert.equal((app.match(/onIncludeDebtChange=\{updateIncludeDebt\}/g) || []).length, 3);
assert.match(app, /<SlideDeckWorkspace active=\{activeTab === 5\}/);
assert.match(app, /if \(!readOnly && i !== 6\) modified\.current = true/, 'Opening the analysis alone must not dirty the project');
const hook = readFileSync(new URL('../hooks/use-post-intervention.ts', import.meta.url), 'utf8');
assert.match(hook, /controller\.abort\(\)/);
assert.match(hook, /current = false/);
assert.match(hook, /credentials: 'same-origin'/);
assert.match(hook, /simulationHeaders\(bundle, projectId\)/);
console.log('Post-intervention presentation, validation, aggregation, navigation and persistence checks passed.');
