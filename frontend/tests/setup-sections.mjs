import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (loaded, filename) => loaded._compile(
    ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText, filename);
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const InputPanel = require('../src/components/InputPanel.tsx').default;
const { ProjectScopeContext } = require('../src/projectScope.tsx');
const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL('../../snapshots/oct-24-zarif/inputs.json', import.meta.url)), 'utf8'));
const render = showSection => renderToStaticMarkup(React.createElement(ProjectScopeContext.Provider, {
  value: { sectors: ['water', 'sanitation'], readOnly: true, projectMode: true },
}, React.createElement(InputPanel, {
  inputs: snapshot.bundle.inputs, onChange: () => {}, showSection,
  scopeControls: React.createElement('div', null, 'Coverage controls'),
})));
const setup = render('setup');
for (const section of ['country', 'currency', 'period', 'coverage']) assert.ok(setup.includes(`data-section-key="${section}"`));
for (const label of ['Country Profile', 'ISO country code (alpha-3)', 'Income group', 'Region']) assert.ok(setup.includes(label));
assert.ok(!setup.includes('data-section-key="budget"'));
assert.ok(setup.includes('Coverage controls'));
assert.ok(setup.includes('fieldset disabled'));
const inputs = render('inputs');
for (const section of ['country', 'currency', 'period', 'coverage']) assert.ok(!inputs.includes(`data-section-key="${section}"`));
for (const section of ['service_levels', 'budget', 'investment_split', 'revenue_inputs']) assert.ok(inputs.includes(`data-section-key="${section}"`));
console.log('Setup/Data Inputs section separation and read-only checks passed.');
const { findProfile } = require('../src/components/CountryProfileFields.tsx');
const countries = [
  { id: 'COD', iso2Code: 'CD', name: 'Congo, Dem. Rep.' },
  { id: 'NPL', iso2Code: 'NP', name: 'Nepal' },
];
assert.equal(findProfile(countries, 'COD', 'DRC')?.id, 'COD');
assert.equal(findProfile(countries, undefined, 'DRC')?.id, 'COD');
assert.equal(findProfile(countries, undefined, 'Nepal')?.id, 'NPL');
assert.equal(findProfile(countries, 'NP')?.id, 'NPL');
assert.equal(findProfile(countries, 'COG', 'Congo, Dem. Rep.'), undefined);
console.log('Legacy DRC/Nepal country matching checks passed.');
const { default: AreaFocusFields, focusScope } = require('../src/components/AreaFocusFields.tsx');
assert.equal(focusScope({ area: 'Kathmandu Valley' }), 'subnational');
assert.equal(focusScope({ area: 'National' }), 'national');
assert.equal(focusScope({ area: '' }), 'national');
assert.equal(focusScope({ focus_scope: 'subnational', area: '' }), 'subnational');
const focus = (config, readOnly = false) => AreaFocusFields({ config, readOnly, onChange: patch => { lastPatch = patch; } });
let lastPatch;
const national = focus({ area: 'National' });
assert.ok(!renderToStaticMarkup(national).includes('focus-area-name'));
national.props.children[0].props.children[1].props.onChange({ target: { value: 'subnational' } });
assert.deepEqual(lastPatch, { focus_scope: 'subnational', area: '' });
const subnational = focus({ focus_scope: 'subnational', area: 'Kathmandu Valley' });
assert.ok(renderToStaticMarkup(subnational).includes('Kathmandu Valley'));
subnational.props.children[1].props.children[1].props.onChange({ target: { value: 'Maseru' } });
assert.deepEqual(lastPatch, { area: 'Maseru' });
subnational.props.children[0].props.children[1].props.onChange({ target: { value: 'national' } });
assert.deepEqual(lastPatch, { focus_scope: 'national', area: 'National' });
assert.ok(renderToStaticMarkup(focus({ area: 'National' }, true)).includes('disabled'));
console.log('Area focus selection, legacy names, text updates and read-only checks passed.');
