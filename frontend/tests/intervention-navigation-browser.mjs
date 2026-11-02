import assert from 'node:assert/strict';
import { openChromium } from './chromium-client.mjs';

const base = process.env.WSS_TEST_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const route = process.env.WSS_TEST_PATH || '/simulations/2ecaa81d-b43e-55cc-9c33-e801444eb13f';
const browser = await openChromium(`${base}${route}`);
const evaluate = expression => browser.evaluate(expression);
const navigate = index => evaluate(`document.querySelectorAll('.intervention-section-nav button')[${index}].click()`);

try {
  await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.waitFor('document.querySelectorAll(".wb-tab").length > 4', 'Workspace did not load');
  await evaluate(`Array.from(document.querySelectorAll('.wb-tab')).find(node => /intervention/i.test(node.textContent)).click()`);
  await browser.waitFor('!!document.querySelector(".intervention-section-nav")', 'Numbered navigation is missing');
  await browser.waitFor('!!document.querySelector(".modern-intv-table tbody tr")', 'Live scenario table did not load');
  await browser.waitFor('document.querySelectorAll(\'[data-section-key="graph"] .modern-intv-kpi\').length === 3', 'Coverage KPI cards must stay above the graphs');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.intervention-section-nav button')].map(node => node.textContent.replace(/^\\d+/, '').trim())`),
    ['Intervention Design', 'Intervention Graph', 'Intervention Table']);
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), false);
  await evaluate(`window.__tableBeforeNavigation = document.querySelector('.modern-intv-table'); window.__coverageBeforeNavigation = document.querySelector('[data-section-key="graph"] .recharts-wrapper'); true`);
  await evaluate(`Array.from(document.querySelectorAll('.intervention-workspace__controls button')).find(node => node.textContent === 'Collection efficiency').click()`);
  await browser.waitFor('!!document.querySelector(".intervention-input-drawer.is-open input")', 'Intervention inputs did not open');
  await navigate(2);
  await browser.waitFor(`(()=>{
    const host = document.querySelector('.intervention-reading-content');
    const top = document.querySelector('[data-section-key="table"]').getBoundingClientRect().top;
    const bounds = host.getBoundingClientRect();
    return Math.abs(top - bounds.top) < 65 ||
      (host.scrollTop >= host.scrollHeight - host.clientHeight - 2 && top >= bounds.top && top < bounds.bottom);
  })()`, 'Table navigation did not scroll');
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), true);
  assert.equal(await evaluate('document.querySelector(".intervention-input-drawer").hidden'), true);
  assert.equal(await evaluate(`window.__tableBeforeNavigation === document.querySelector('.modern-intv-table') && window.__coverageBeforeNavigation === document.querySelector('[data-section-key="graph"] .recharts-wrapper')`), true);
  await evaluate(`document.querySelector('[aria-label="Intervention table service level"] [data-service-level="basic"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Intervention graph service level"] [data-service-level="basic"]').getAttribute('aria-pressed')`), 'true');
  await navigate(0);
  assert.equal(await evaluate('document.querySelector(".intervention-workspace__controls").hidden'), false);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(()=>{ const select = document.querySelector('.intervention-section-nav select'); select.value = 'table'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await browser.waitFor(`Math.abs(document.querySelector('[data-section-key="table"]').getBoundingClientRect().top - document.querySelector('.intervention-section-workspace').getBoundingClientRect().top) < 65`, 'Mobile Table navigation did not scroll');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile page overflows horizontally');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: numbered navigation, persistent long-page graph/table, conditional design rail, shared selectors, and mobile section scrolling.');
} finally {
  browser.close();
}
