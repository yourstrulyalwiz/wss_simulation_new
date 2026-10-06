// Verify interactive views with the saved DRC bundle in isolated browser storage.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { openChromium, sleep } from './chromium-client.mjs';

const bundle = JSON.parse(readFileSync(new URL('../../profiles/DRC_Mock_Simulation.json', import.meta.url)));
const c = await openChromium(process.env.APP_URL);
const { evaluate: e, waitFor: w } = c;
const root = '[data-results-ledger="water"]';
const change = async (selector, value) => {
  await w(`!!document.querySelector(${JSON.stringify(selector)})`, `Control missing: ${selector}`);
  await e(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});
    s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(160);
};
const capture = async (selector, filename) => {
  await e(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});
    const scroller=node.closest('.results-ledger__table-scroll');
    if(scroller){
      const pinned=scroller.querySelector('[data-ledger-row="source-total"]')?.offsetHeight ?? 0;
      scroller.scrollTop+=node.getBoundingClientRect().top-scroller.getBoundingClientRect().top-36-pinned-8;
      scroller.scrollIntoView({block:'start'});window.scrollBy(0,-150);
    }else node.scrollIntoView({block:'start'});})()`);
  await sleep(200);
  writeFileSync(`screenshots/financing-ledger/${filename}.png`,
    Buffer.from((await c.call('Page.captureScreenshot', {format:'png'})).data, 'base64'));
};
try {
  mkdirSync('screenshots/financing-ledger', {recursive:true});
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'App not ready');
  await sleep(1500);
  await e(`localStorage.setItem('wss_working_bundle', ${JSON.stringify(JSON.stringify(bundle))})`);
  await c.call('Page.reload');
  await w(`document.querySelectorAll('.wb-tab').length===5`, 'Reload not ready');
  await e(`document.querySelector('.wb-onboarding-overlay')?.click();document.querySelectorAll('.wb-tab')[4].click()`);
  await w(`!!document.querySelector('${root} [data-ledger-row="scenario"]')`, 'Results not ready');
  await e(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>['urban','rural','national']
    .every(value=>[...s.options].some(o=>o.value===value)));s.value='national';
    s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await change('[aria-label="Graph start year"]', '2033');
  await change('[aria-label="Graph end year"]', '2035');
  await change(`${root} [aria-label$="ledger metric"]`, 'gap');
  await change(`${root} [aria-label$="ledger service"]`, 'total');
  await w(`!!document.querySelector('${root} [data-ledger-row="source-total"] [data-ledger-year="2035"]')`, 'Closing ledger missing');
  await capture(root, 'default-closing');
  // Native buttons are keyboard-operable; exercise Enter on an area expansion.
  await e(`(()=>{const b=document.querySelector('${root} [data-ledger-row="area-urban"] button');b.focus();})()`);
  await c.call('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', text:'\r', unmodifiedText:'\r', windowsVirtualKeyCode:13});
  await c.call('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13});
  await w(`!!document.querySelector('${root} [data-ledger-row="need-Urban-sm"]')`, 'Keyboard expansion failed');
  await e(`(()=>{const row=[...document.querySelectorAll('${root} [data-row-kind="service"]')]
    .find(n=>n.textContent.includes('Safely managed'));row.querySelector('button[aria-expanded="false"]')?.click();})()`);
  await capture(root, 'expanded-area-service');
  await e(`document.querySelector('${root} [data-ledger-row="coverage-thresholds-section"] button[aria-expanded="false"]')?.click()`);
  await capture(`${root} [data-ledger-row="coverage-thresholds-section"]`, 'coverage-comparison');
  const closingCells = await e(`Object.fromEntries([...document.querySelectorAll('${root} [data-ledger-row="source-total"] [data-ledger-year]')]
    .map(n=>[n.dataset.ledgerYear,Number(n.title)]))`);
  assert.ok(Number.isFinite(closingCells['2035']), 'Closing balance unavailable');
  await change(`${root} [aria-label$="financial view"]`, 'effects');
  await w(`!!document.querySelector('${root} [data-ledger-row="scenario"]')`, 'Effects view missing');
  await capture(root, 'intervention-effects');
  await change(`${root} [aria-label$="ledger basis"]`, 'annual');
  assert.ok(await e(`document.querySelector('${root} [aria-label$="ledger basis"] option:checked').textContent.includes('Closing expansion plus current-year')`));
  await change(`${root} [aria-label$="financial view"]`, 'source');
  await capture('.remaining-need-chart', 'remaining-need-graph');
  assert.equal(await e(`document.querySelectorAll('.remaining-need-chart').length`), 2);
  assert.deepEqual(c.errors, []);
  console.log('DRC interactive checks passed: keyboard expansion, source/effects/advanced views, two closing charts and five screenshots.');
} finally {
  c.close();
}
