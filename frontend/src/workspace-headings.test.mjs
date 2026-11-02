import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bau = read('./components/BAUWorkspace.tsx');
const intervention = read('./components/InterventionPanel.tsx');

test('workflow titles remain separate from numbered section headings', () => {
  assert.match(bau, /<h2 tabIndex=\{-1\}>BAU Scenario<\/h2>/);
  assert.match(intervention, /<h2>Intervention Design<\/h2>/);
  assert.match(intervention, /<h2 tabIndex=\{-1\}>Intervention Design<\/h2>/);
  for (const source of [bau, intervention]) {
    assert.doesNotMatch(source, /className="modern-bau-heading"/);
  }
});

test('workspace section headings reuse Data Inputs styles and navigation numbering', () => {
  for (const [source, labels] of [
    [bau, ['BAU Graph', 'BAU Table']],
    [intervention, ['Intervention Design', 'Intervention Graph', 'Intervention Table']],
  ]) {
    labels.forEach((label, index) => {
      assert.match(source, new RegExp(
        `<h[23] className="modern-input-section-heading" tabIndex=\\{-1\\}>\\s*` +
        `<span className="modern-input-section-heading__index">${index + 1}</span><span>${label}</span>\\s*</h[23]>`
      ));
    });
    for (const key of ['graph', 'table']) {
      assert.ok(source.includes(`data-section-key="${key}"`));
    }
  }
});
