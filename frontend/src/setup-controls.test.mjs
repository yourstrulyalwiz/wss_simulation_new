import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Compile only the two existing modules under test. Portal's unrelated route,
// identity and API imports are inert: these controls must not make requests.
function load(relative, dependencies = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(fileURLToPath(new URL('.', import.meta.url)));
  loaded.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id);
  const source = readFileSync(filename, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports;
}
const scopeModule = load('./projectScope.tsx');
const { ScopeFields } = load('./Portal.tsx', {
  './accessMode': {},
  wouter: {},
  './projectScope': scopeModule,
  './projectApi': {},
});
const { normalizeScope, geography } = scopeModule;
function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)];
}
function controls(scope, props = {}) {
  let changed;
  const element = ScopeFields({ scope, variant: 'setup', onChange: value => { changed = value; }, ...props });
  return { element, inputs: nodes(element).filter(node => node.type === 'input'), changed: () => changed };
}

test('setup sectors are independent checkboxes and never remove the final sector', () => {
  const scope = normalizeScope({ sectors: ['water', 'sanitation'], futureScopeField: 'retained' });
  const fields = controls(scope);
  const checkboxes = fields.inputs.filter(input => input.props.type === 'checkbox');
  assert.equal(checkboxes.length, 2);
  assert.ok(checkboxes.every(input => input.props.checked && !input.props.disabled));
  checkboxes[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(fields.changed().sectors, ['sanitation']);
  assert.equal(fields.changed().futureScopeField, 'retained');
  const single = controls(fields.changed());
  const remaining = single.inputs.filter(input => input.props.type === 'checkbox')[1];
  assert.equal(remaining.props.disabled, true);
  remaining.props.onChange({ target: { checked: false } });
  assert.equal(single.changed(), undefined);
  single.inputs[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(single.changed().sectors, ['sanitation', 'water']);
});

test('setup offers four exclusive calculation geographies without changing sectors', () => {
  const scope = normalizeScope({ sectors: ['water'], areaUrban: true, areaRural: false, futureScopeField: 'retained' });
  const radios = controls(scope).inputs.filter(input => input.props.type === 'radio');
  assert.deepEqual(radios.map(input => input.props.value), ['Urban', 'Rural', 'Urban + Rural', 'National']);
  assert.equal(radios.filter(input => input.props.checked).length, 1);
  assert.equal(new Set(radios.map(input => input.props.name)).size, 1);
  for (const value of ['Urban', 'Rural', 'Urban + Rural', 'National']) {
    const fields = controls(scope);
    fields.inputs.find(input => input.props.value === value).props.onChange();
    assert.equal(geography(fields.changed()), value);
    assert.deepEqual(fields.changed().sectors, ['water']);
    assert.equal(fields.changed().futureScopeField, 'retained');
  }
});

test('read-only and pending setup disable all choices, retaining readable descriptions', () => {
  const scope = normalizeScope({ sectors: ['sanitation'] });
  const fields = controls(scope, { disabled: true });
  assert.ok(fields.inputs.every(input => input.props.disabled));
  const markup = renderToStaticMarkup(fields.element);
  assert.equal((markup.match(/<fieldset[^>]*disabled/g) || []).length, 2);
  for (const text of ['Independently entered national dataset', 'Two area datasets with a combined overview', 'retained but inactive', 'Country Profile area of focus']) assert.ok(markup.includes(text));
});

test('default creation controls keep their existing select and layout', () => {
  const markup = renderToStaticMarkup(ScopeFields({ scope: normalizeScope(), onChange: () => {} }));
  assert.ok(markup.includes('<select'));
  assert.ok(markup.includes('setup-choices'));
  assert.ok(!markup.includes('project-setup-option'));
  assert.ok(!markup.includes('type="radio"'));
});
