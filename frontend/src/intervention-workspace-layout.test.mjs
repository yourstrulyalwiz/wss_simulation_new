import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const panel = readFileSync(fileURLToPath(new URL('./components/InterventionPanel.tsx', import.meta.url)), 'utf8');
const styles = readFileSync(fileURLToPath(new URL('./modern.css', import.meta.url)), 'utf8');

test('intervention workspace has the three persistent numbered destinations', () => {
  for (const label of ['Intervention Design', 'Intervention Graph', 'Intervention Table']) {
    assert.ok(panel.includes(`'${label}'`), `missing navigation destination: ${label}`);
  }
  assert.match(panel, /useState<'design' \| 'graph' \| 'table'>\('design'\)/);
  assert.doesNotMatch(panel, /modern-workspace-sections/);
});

test('graph and table stay mounted together with shared selector state', () => {
  assert.match(panel, /data-section-key="graph"/);
  assert.match(panel, /data-section-key="table"/);
  assert.match(panel, /<LiveInterventionChart/);
  assert.match(panel, /<InterventionScenarioTable inputs=\{interventionChartInputs\} sector=\{sectorTab\} level=\{serviceLevel\}/);
  assert.doesNotMatch(panel, /activeSection === 'graph' &&/);
  assert.doesNotMatch(panel, /showTable=\{activeSection === 'table'\}/);
  assert.match(panel, /showTable=\{false\}/, 'coverage KPI cards remain above the graph');
  assert.equal((panel.match(/aria-label="Intervention (graph|table) geography"/g) || []).length, 1);
  assert.equal((panel.match(/aria-label="Intervention (graph|table) sector"/g) || []).length, 1);
  assert.doesNotMatch(panel, /aria-label="Intervention table (geography|sector)"/);
});

test('design controls and nested input drawer hide without unmounting their state/portal target', () => {
  assert.match(panel, /intervention-workspace__controls" hidden=\{activeSection !== 'design'\}/);
  assert.match(panel, /hidden=\{activeSection !== 'design' \|\| !selectedIntervention\}/);
  assert.match(panel, /intervention-input-drawer__body" ref=\{node => setDrawerTarget\(node\)\}/);
  assert.match(panel, /setSelectedIntervention\(null\);\s*selectedTrigger\.current = null;/);
  assert.match(styles, /\.intervention-section-workspace--drawer-open/);
});

test('intervention layout styles are scoped so BAU and Data Inputs workspaces remain independent', () => {
  assert.match(styles, /\.intervention-section-workspace\s*\{/);
  assert.match(styles, /\.intervention-reading-content\s*\{/);
  assert.doesNotMatch(styles, /\.modern-section-workspace\s*\{[^}]*intervention/s);
});
