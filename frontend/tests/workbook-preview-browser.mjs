// Real Chromium checks via its built-in DevTools pipe; no browser-test packages.
// Run: APP_URL=https://<development-host> node frontend/tests/workbook-preview-browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const url = process.env.APP_URL;
assert.ok(url, 'APP_URL must identify the development app.');
const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-pipe'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
const pending = new Map();
const browserErrors = [];
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id); clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }
});
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  const previous = { __wss_bundle: 1, inputs: { retainedOriginalSession: true },
    altInputs: { rural: { retainedOriginalArea: true } }, scope: { areaRural: true } };
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    `if (!localStorage.getItem('wss_development_preview_revision')) {
      localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(previous))});
    }` }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`document.body?.textContent?.includes('DRC spreadsheet data preview') || false`)) break;
    await sleep(200);
  }
  let state = await evaluate(`({
    working: JSON.parse(localStorage.getItem('wss_working_bundle')),
    saved: JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]'),
    revision: localStorage.getItem('wss_development_preview_revision')
  })`);
  assert.equal(state.working.inputs.profile_metadata.imported_cells, 265);
  assert.equal(state.working.altInputs.rural.profile_metadata.imported_cells, 273);
  assert.deepEqual(state.saved.find(s => s.name.startsWith('Previous working session')).inputs, previous);
  assert.ok(state.revision);
  // Open the actual data sections, then inspect the inputs populated from each file.
  await evaluate(`Array.from(document.querySelectorAll('button')).filter(
    b => /SERVICE LEVELS|ECONOMIC.*DEMOGRAPHIC/i.test(b.textContent) && b.textContent.includes('▾')).forEach(b => b.click())`);
  await sleep(350);
  const urbanValues = await evaluate(`Array.from(document.querySelectorAll('input')).map(i => i.value)`);
  assert.ok(urbanValues.includes((28.187377).toFixed(2)),
    'The Urban population must render with the table’s two-decimal display formatting.');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'rural').click()`);
  await sleep(400);
  await evaluate(`Array.from(document.querySelectorAll('button')).filter(
    b => /SERVICE LEVELS|ECONOMIC.*DEMOGRAPHIC/i.test(b.textContent) && b.textContent.includes('▾')).forEach(b => b.click())`);
  await sleep(200);
  const ruralValues = await evaluate(`Array.from(document.querySelectorAll('input')).map(i => i.value)`);
  assert.ok(ruralValues.includes((42.661934).toFixed(2)),
    'The Rural population must differ from Urban and match its workbook.');
  for (const label of ['BAU Scenario', 'Intervention Design', 'Results Dashboard']) {
    const opened = await evaluate(`(() => {
      const tab = Array.from(document.querySelectorAll('.wb-tab')).find(
        b => b.textContent.replace(/\\s/g, '').includes(${JSON.stringify(label.replace(/\s/g, ''))}));
      if (!tab || tab.disabled) return false;
      tab.click(); return true;
    })()`);
    assert.equal(opened, true, `${label} must be accessible for the DRC preview.`);
    await sleep(400);
    assert.ok(await evaluate(`document.querySelector('.wb-tab-active')?.textContent.replace(/\\s/g, '').includes(${JSON.stringify(label.replace(/\s/g, ''))})`),
      `${label} must actually open.`);
    assert.ok(await evaluate(`!!document.querySelector('.wb-app')`), 'Page must remain rendered.');
  }
  await send('Page.reload', {}, sessionId);
  await sleep(1000);
  state = await evaluate(`JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]')`);
  assert.equal(state.filter(s => s.name.startsWith('Previous working session')).length, 1,
    'Reload must not archive or reset the session again.');
  assert.equal(browserErrors.length, 0, JSON.stringify(browserErrors));
  console.log('Browser passed: DRC startup, preserved data/session, all workflow tabs accessible and safe reload.');
} finally {
  browser.kill('SIGTERM');
  for (const { timer } of pending.values()) clearTimeout(timer);
}