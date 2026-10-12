// Uses a disposable browser and controlled budgets; does not save country profiles.
import { openChromium } from './chromium-client.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const inputs = JSON.parse(execFileSync('python', ['-c',
  'import json; from test_support import frontend_defaults; print(json.dumps(frontend_defaults()))'], { encoding: 'utf8' }));
const preview = await (await fetch(`${url}/api/development-preview`)).json();
const bundle = { inputs, altInputs: { rural: structuredClone(inputs) },
  scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true } };
const b = await openChromium('about:blank');
const toggle = `document.querySelector('[data-section-key="budget"] label input[type=checkbox]')`;
const slider = `document.querySelector('input[aria-label="Capital share of total spending"]')`;
try {
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(bundle))});
    localStorage.setItem('wss_development_preview_revision',${JSON.stringify(preview.revision || '')});
    localStorage.setItem('wss_mock_setup_revision',${JSON.stringify(preview.mock_setup_revision || '')});` });
  await b.call('Page.navigate', { url });
  await b.waitFor(`!!document.querySelector('[data-section-key="budget"] button')`, 'Budget section missing');
  await b.evaluate(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelector('[data-section-key="budget"] button').click()`);
  await b.waitFor(`!!${toggle}`, 'Budget toggle missing');
  assert.equal(await b.evaluate(`${toggle}.checked`), false);
  await b.evaluate(`${toggle}.click()`);
  await b.waitFor(`!!${slider}`, 'Slider missing');
  assert.equal(await b.evaluate(`${slider}.value`), '100');
  await b.evaluate(`(()=>{const e=${slider};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'30');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await b.evaluate(`${toggle}.click()`);
  assert.equal(await b.evaluate(`!!${slider}`), false);
  await b.evaluate(`${toggle}.click()`);
  assert.equal(await b.evaluate(`${slider}.value`), '30');
  await b.evaluate(`${toggle}.scrollIntoView({block:'center'})`);
  const shot = await b.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/budget-controls.png', Buffer.from(shot.data, 'base64'));
  assert.deepEqual(b.errors, []);
  console.log('Budget controls passed: off by default, 100% initial slider, 30% selection retained across toggles.');
} finally { b.close(); }
