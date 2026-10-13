import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openChromium, sleep} from './chromium-client.mjs';
const profile = JSON.parse(readFileSync(new URL('../../profiles/Oct 13.json', import.meta.url),'utf8'));
const c = await openChromium(process.env.APP_URL);
try {
  await c.waitFor(`!!document.querySelector('.wb-tab')`, 'App not loaded');
  await sleep(1500);
  await c.evaluate(`localStorage.setItem('wss_working_bundle',${JSON.stringify(JSON.stringify(profile))})`);
  await c.call('Page.reload');
  await c.waitFor(`!!document.querySelector('.wb-tab')`, 'Reload failed');
  await c.evaluate(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[2].click()`);
  await c.waitFor(`document.querySelectorAll('.recharts-area').length > 0`, 'Valid water intervention chart missing');
  await c.evaluate(`document.querySelectorAll('.wb-tab')[4].click()`);
  await c.waitFor(`document.body.innerText.includes('Combined summary unavailable')`, 'Combined incomplete status missing');
  await c.waitFor(`document.querySelectorAll('.recharts-area').length > 0`, 'Valid water results missing');
  assert.equal(c.errors.length,0,JSON.stringify(c.errors));
  console.log('PASS: Oct 13 valid water chart and Results survive incomplete sanitation; combined summary unavailable; no browser exceptions.');
} finally { c.close(); }
