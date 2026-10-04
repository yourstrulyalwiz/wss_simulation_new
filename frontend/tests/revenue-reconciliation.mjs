// No additional dependencies: compile the TSX and check its rendered states.
// Run: node frontend/tests/revenue-reconciliation.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sourcePath = fileURLToPath(new URL('../src/components/RevenueBase.tsx', import.meta.url));
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
const componentModule = new Module(sourcePath);
componentModule.filename = sourcePath;
componentModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
componentModule._compile(compiled, sourcePath);
const { default: RevenueReconciliation, RevenueInputErrors, restoreBlankRevenueBases } = componentModule.exports;
const props = {
  inputs: { country_config: { currency: 'LCU' }, period: { baseline_year: 2025 },
    water_interventions: {}, sanitation_interventions: {} },
  onChange() {}, area: 'urban', error: '',
};
const render = extra => renderToStaticMarkup(React.createElement(RevenueInputErrors, { ...props, ...extra }));

assert.equal(renderToStaticMarkup(React.createElement(RevenueReconciliation, props)), '',
  'Initial automatic check must not show a panel.');
assert.equal(render({}), '', 'Pending inputs without an error must stay hidden.');
assert.equal(render({ resolution: { water: { base: {}, error: null }, sanitation: { base: {}, error: null } } }), '',
  'Successful automatic resolution must stay hidden before bases are saved.');
assert.equal(render({ inputs: { ...props.inputs, revenue_bases: { water: {}, sanitation: {} } } }), '',
  'Resolved inputs must not show an error.');

const missing = render({ resolution: { water: { error: 'Legacy volume must be numeric.' }, sanitation: { error: null } } });
assert.match(missing, /Legacy volume must be numeric/);
assert.match(missing, /role="alert"/);
assert.match(missing, /Enter shared revenue inputs/);
assert.doesNotMatch(missing, /<h4>Sanitation/);
assert.doesNotMatch(missing, /Checking existing revenue bases|Reconcile billed revenue/);

const invalid = render({ inputs: { ...props.inputs, revenue_bases: { water: { volume_mld: -1, origin: 'user-entered' } } },
  error: 'Billed volume must be nonnegative.' });
assert.match(invalid, /Billed volume must be nonnegative/);
assert.match(invalid, /Shared billed-revenue base/);
assert.match(invalid, /value="-1"/);
assert.match(invalid, /Enter shared revenue inputs/);
assert.equal(render({ inputs: null, error: 'Ignored without inputs.' }), '');

const blank = { version: 1, origin: 'user-entered', volume_mld: null, tariff: null,
  collection_ratio: null, reference_year: 2025, growth_rate: null, legacy: { retained: true } };
const draftInputs = { ...props.inputs, revenue_bases: { water: { ...blank }, sanitation: { ...blank } },
  revenue_legacy: { retained: true }, extraScenarioData: { retained: true } };
const snapshot = JSON.stringify(draftInputs);
let corrected;
const recoveryTree = RevenueInputErrors({ ...props, inputs: draftInputs,
  error: 'volume_mld is required.', onChange(value) { corrected = value; } });
function findButton(element) {
  if (!React.isValidElement(element)) return null;
  if (element.type === 'button' && element.props.children === 'Restore blank bases from existing inputs') return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
}
const recoveryButton = findButton(recoveryTree);
assert.ok(recoveryButton, 'Blank saved drafts must offer a recovery action.');
recoveryButton.props.onClick();
assert.deepEqual(corrected.revenue_bases, {}, 'The action must discard both blank drafts for automatic resolution.');
assert.equal(JSON.stringify(draftInputs), snapshot, 'Recovery must not mutate original inputs.');
for (const field of ['water_interventions', 'sanitation_interventions', 'revenue_legacy', 'extraScenarioData']) {
  assert.equal(corrected[field], draftInputs[field], `Recovery must retain ${field}.`);
}
assert.match(render({ inputs: draftInputs, error: 'volume_mld is required.' }), /Billed volume is required/);
const custom = { ...blank, volume_mld: 0, tariff: 0, collection_ratio: 0 };
const mixed = { ...draftInputs, revenue_bases: { water: custom, sanitation: blank } };
assert.equal(restoreBlankRevenueBases(mixed).revenue_bases.water, custom, 'Explicit zeros are custom values, not blanks.');
assert.ok(!restoreBlankRevenueBases(mixed).revenue_bases.sanitation);
const partial = { ...draftInputs, revenue_bases: { water: { ...blank, tariff: 10 } } };
assert.equal(restoreBlankRevenueBases(partial), partial, 'Partially entered values must never be reset.');
const legacyOrigin = { ...draftInputs, revenue_bases: { water: { ...blank, origin: 'collection' } } };
assert.equal(restoreBlankRevenueBases(legacyOrigin), legacyOrigin, 'Only user-entered empty drafts can be reset.');
console.log('Revenue reconciliation: automatic checks hidden; validation errors and correction controls preserved.');