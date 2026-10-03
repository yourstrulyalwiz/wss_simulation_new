import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';

const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/components/BorrowingControls.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React, esModuleInterop: true } });
const exports = {};
const NumInput = () => null;
new Function('exports', 'require', outputText)(exports, name => {
  if (name === 'react') return React;
  if (name === './NumInput') return NumInput;
  throw new Error(`Unexpected import ${name}`);
});
const Controls = exports.default;
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(elements)];
}
function render(section, updates) {
  return elements(Controls({ section, currency: 'NPR', areaSectorFallback: 'Urban Water',
    onChange: (key, value) => updates.push([key, value]) }));
}
test('cash-use control defaults to reinvest and exposes exactly the three alpha modes', () => {
  const updates = [];
  const select = render({}, updates).find(e => e.props['aria-label'] === 'Use of additional net utility cash');
  assert.equal(select.props.value, 'reinvest');
  assert.equal(React.Children.count(select.props.children), 3);
  select.props.onChange({ target: { value: 'partial' } });
  select.props.onChange({ target: { value: 'all' } });
  select.props.onChange({ target: { value: 'reinvest' } });
  assert.deepEqual(updates, [['cash_allocation_alpha', .5], ['cash_allocation_alpha', 1],
    ['cash_allocation_alpha', 0]]);
});
test('partial allocation stays strictly between zero and one', () => {
  const updates = [];
  const input = render({ cash_allocation_alpha: .25 }, updates).find(e => e.props.id === 'borrow-alpha');
  assert.equal(input.props.value, 25);
  input.props.onValue(0);
  input.props.onValue(100);
  assert.ok(updates.every(([, value]) => value > 0 && value < 1));
});
test('pool and contract inputs persist values and independent stream choices', () => {
  const updates = [];
  const els = render({ borrow_cash_streams: ['collection'] }, updates);
  els.find(e => e.props.id === 'borrow-entity-name').props.onChange({ target: { value: 'Urban Water Utility' } });
  els.find(e => e.props.id === 'borrow-contract-principal').props.onValue(50);
  const checkboxes = els.filter(e => e.props.type === 'checkbox');
  assert.equal(checkboxes[0].props.checked, true);
  checkboxes[1].props.onChange({ target: { checked: true } });
  assert.deepEqual(updates, [['borrow_entity_name', 'Urban Water Utility'],
    ['borrow_contract_principal', 50], ['borrow_cash_streams', ['collection', 'nrw']]]);
});