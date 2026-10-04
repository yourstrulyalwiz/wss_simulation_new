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
const { default: RevenueReconciliation, RevenueInputErrors } = componentModule.exports;
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
console.log('Revenue reconciliation: automatic checks hidden; validation errors and correction controls preserved.');