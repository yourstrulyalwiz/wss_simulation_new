// Focused browser regression; no project dependency or backend changes.
// Run with PLAYWRIGHT_MODULE pointing to playwright's index.mjs if installed outside this project.
// Optional APP_URL (default http://127.0.0.1:5000), CHROMIUM_PATH and SCREENSHOT_DIR.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.APP_URL || 'http://127.0.0.1:5000';
const screenshotDir = process.env.SCREENSHOT_DIR || 'frontend/tests/screenshots';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium',
  headless: true, args: ['--no-sandbox'],
});
const headings = [
  '1. Funding Mobilization',
  '2. Operational Efficiency Improvements',
  '3. Investment Planning and Delivery Improvements',
  '4. Tariff Reform',
  '5. Household Financing and Affordability',
];
const expectedMembers = sector => [
  ['Increase in Financial Commitments', 'Exogenous Injection of Funds'],
  ['Collection efficiency', sector === 'water' ? 'NRW reduction' : 'NRW-linked sanitation revenue'],
  ['Budget execution improvement', 'Capex efficiency (unit cost)', 'Optimised technology selection'],
  ['Tariff reform'],
  ['Microfinance'],
];
const serial = page => page.evaluate(() => localStorage.getItem('wss_working_bundle'));
const settle = async page => {
  await page.waitForTimeout(1100); // existing calculation/autosave debounces
  await page.waitForLoadState('networkidle');
};

try {
  await mkdir(screenshotDir, { recursive: true });
  const request = await browser.newContext();
  const defaultsResponse = await request.request.get(`${url}/api/defaults`);
  assert.equal(defaultsResponse.ok(), true);
  const fixture = await defaultsResponse.json();
  for (const key of Object.keys(fixture.toggles)) fixture.toggles[key] = true;
  // Resolve the existing shared-base reconciliation before loading the saved scenario.
  fixture.revenue_bases = {
    water: { version: 1, origin: 'tariff', volume_mld: 87.6, reference_year: 2025, tariff: 32, collection_ratio: 0.8, growth_rate: null },
    sanitation: { version: 1, origin: 'tariff', volume_mld: 43.8, reference_year: 2025, tariff: 16, collection_ratio: 0.8, growth_rate: null },
  };
  fixture.sanitation_interventions.ce_target_ratio = 0.94;
  fixture.water_interventions.mf_connection_fee = 138742;
  fixture.sanitation_interventions.mf_connection_fee = 112946;
  fixture.water_interventions.grant_total = 17.3;
  fixture.sanitation_interventions.grant_total = 19.7;
  fixture.custom_interventions = [{
    name: 'Community service fund', enabled: true, sector: 'both', intervention_type: 'new_revenue',
    start_year: 2028, end_year: 2040, implement_cost: 8.7, cost_years: 3,
    output_unit: 'm³', output_start_year: 2028, output_quantity: 721, output_value: 13.4,
    outputs_affected: 'sm', cost_effect_mode: 'pct', cost_effect: 0.1, color: '#9e17bf',
  }];
  const calculate = async inputs => {
    const response = await request.request.post(`${url}/api/calculate`, { data: inputs });
    assert.equal(response.ok(), true, await response.text());
    return response.json();
  };
  const csv = async inputs => {
    const response = await request.request.post(`${url}/api/export/csv`, { data: inputs });
    assert.equal(response.ok(), true, await response.text());
    return response.text();
  };
  const baselineResults = await calculate(fixture);
  const baselineCsv = await csv(fixture);
  assert.equal(/Energy improvements|Coming soon|Subsidies/.test(baselineCsv), false);

  for (const scope of ['urban', 'rural', 'national']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    const bundle = {
      __wss_bundle: 1, inputs: fixture,
      altInputs: scope === 'urban' ? {} : { [scope]: fixture },
      scope: { scopeMode: scope === 'national' ? 'national' : 'urban_rural',
        areaUrban: scope !== 'rural', areaRural: scope === 'rural' },
    };
    await context.addInitScript(value => {
      localStorage.setItem('wss_working_bundle', JSON.stringify(value));
      localStorage.setItem('wss_demo_scenarios', JSON.stringify([{ name: 'Category regression', inputs: value }]));
      localStorage.setItem('wss_scope_hint_seen', '1');
      localStorage.setItem('wss_tool_overview_seen', '1');
    }, bundle);
    const page = await context.newPage();
    const errors = [];
    let calculations = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (req.url().endsWith('/api/calculate')) calculations++; });
    await page.goto(url);
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.getByRole('button', { name: 'Category regression', exact: true }).click();
    await page.getByRole('button', { name: 'Intervention Design', exact: false }).click();
    await settle(page);
    assert.deepEqual(JSON.parse(await serial(page)), bundle, 'Saved scenario must load without changing values');

    for (const sector of ['water', 'sanitation']) {
      if (sector === 'sanitation') {
        await page.getByRole('button', { name: 'Sanitation', exact: true }).click();
        await settle(page);
      }
      const sections = page.locator('.intervention-category');
      assert.deepEqual(await page.locator('.intervention-category-header').allTextContents(),
        headings.map(h => `${h}▴`));
      for (let i = 0; i < 5; i++) {
        const section = sections.nth(i);
        const header = section.getByRole('button', { name: headings[i], exact: true });
        assert.equal(await header.getAttribute('type'), 'button');
        assert.equal(await header.getAttribute('aria-expanded'), 'true');
        assert.equal(await section.locator(`#${await header.getAttribute('aria-controls')}`).count(), 1);
        assert.deepEqual(await section.locator('input[type="checkbox"]').evaluateAll(
          nodes => nodes.map(node => node.parentElement.textContent)), expectedMembers(sector)[i]);
        assert.equal(await section.getByRole('button', { name: '▾ Show', exact: true }).count(),
          expectedMembers(sector)[i].length);
      }
      assert.equal(await page.locator('.coming-soon-badge').filter({ hasText: /^Coming soon$/ }).count(), 2);
      const placeholders = page.locator('.coming-soon-intervention');
      assert.equal(await placeholders.locator('input, button, select, textarea, [tabindex]').count(), 0);
      assert.equal(await placeholders.getByText('Energy efficiency measures will be available in a future update.', { exact: true }).count(), 1);
      assert.equal(await placeholders.getByText('Additional subsidy options will be available in a future update.', { exact: true }).count(), 1);
      assert.equal(await placeholders.getByText('Means-based grants within Microfinance remain available.', { exact: true }).count(), 1);
      const before = await serial(page);
      const countBefore = calculations;

      // Open an existing parameter panel; its Show/Hide state must survive category hiding.
      const funding = sections.nth(0);
      await funding.getByRole('button', { name: '▾ Show', exact: true }).first().click();
      await settle(page);
      assert.equal(await serial(page), before);
      const mountedCheckboxes = await funding.locator('input[type="checkbox"]').count();
      const header = funding.locator('.intervention-category-header');
      await header.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await header.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
      await page.keyboard.press('Enter');
      assert.equal(await header.getAttribute('aria-expanded'), 'false');
      assert.equal(await funding.locator('input[type="checkbox"]').count(), mountedCheckboxes, 'Hidden contents remain mounted');
      assert.equal(await funding.getByRole('checkbox').count(), 0, 'Hidden descendants are inaccessible');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), `${headings[1]}▴`);
      await header.focus();
      await page.keyboard.press('Space');
      assert.equal(await header.getAttribute('aria-expanded'), 'true');
      assert.equal(await funding.getByRole('button', { name: '▴ Hide', exact: true }).count(), 1);
      for (let i = 0; i < 5; i++) await sections.nth(i).locator('.intervention-category-header').click();
      for (let i = 0; i < 5; i++) {
        assert.equal(await sections.nth(i).locator('.intervention-category-header').getAttribute('aria-expanded'), 'false');
      }
      for (let i = 0; i < 5; i++) await sections.nth(i).locator('.intervention-category-header').click();
      await settle(page);
      assert.equal(await serial(page), before, 'Category actions leave serialized inputs exactly equal');
      assert.equal(calculations, countBefore, 'Category/Show actions must not trigger calculation requests');
      assert.deepEqual(JSON.parse(before), bundle);
      const current = JSON.parse(await serial(page));
      const active = scope === 'urban' ? current.inputs : current.altInputs[scope];
      assert.deepEqual(await calculate(active), baselineResults, 'All model outputs remain exactly equal');
      assert.equal(await csv(active), baselineCsv, 'CSV contents and contributions remain exactly equal');
      await funding.getByRole('button', { name: '▴ Hide', exact: true }).click();
      const closeGuide = page.getByRole('button', { name: '✕ Close', exact: true });
      if (await closeGuide.count()) await closeGuide.click();
      if (scope === 'urban') await page.screenshot({ path: `${screenshotDir}/${sector}-categories.png` });

      await page.setViewportSize({ width: 900, height: 1100 });
      assert.equal(await sections.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
      assert.equal(await page.locator('.intervention-category-header').evaluateAll(nodes =>
        nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
      if (scope === 'urban') await page.screenshot({ path: `${screenshotDir}/${sector}-narrow.png` });
      await page.setViewportSize({ width: 420, height: 1100 });
      assert.equal(await page.locator('.intervention-category-header').evaluateAll(nodes =>
        nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true, 'Headings wrap at phone width');
      assert.equal(await page.locator('.coming-soon-intervention').evaluateAll(nodes =>
        nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true, 'Badges remain within narrow rows');
      await page.setViewportSize({ width: 1440, height: 1500 });
      assert.deepEqual(errors, []);
      console.log(`PASS ${scope}/${sector}: membership, placeholders, keyboard, mounted state, serialization, no UI-triggered calculations, exact numerical/CSV equality, narrow wrapping`);
    }

    // Existing Microfinance fields and checkbox semantics still work independently.
    const household = page.locator('.intervention-category').nth(4);
    await household.getByRole('button', { name: '▾ Show', exact: true }).click();
    const grant = household.locator('label').filter({ hasText: 'Grant budget (one-time pool)' }).locator('..').locator('input');
    assert.equal(await grant.isEditable(), true);
    assert.equal(await household.getByText('Self-finance carve-out', { exact: true }).count(), 1);
    await grant.fill('23.7');
    await grant.press('Tab');
    await settle(page);
    let saved = JSON.parse(await serial(page));
    let active = scope === 'urban' ? saved.inputs : saved.altInputs[scope];
    assert.equal(active.sanitation_interventions.grant_total, 23.7);
    await household.getByRole('checkbox').uncheck();
    await settle(page);
    assert.equal(await household.getByRole('button', { name: '▴ Hide', exact: true }).count(), 1);
    saved = JSON.parse(await serial(page));
    active = scope === 'urban' ? saved.inputs : saved.altInputs[scope];
    assert.equal(active.toggles.san_microfinance_enabled, false);
    assert.equal(active.sanitation_interventions.grant_total, 23.7);
    assert.deepEqual(active.custom_interventions, fixture.custom_interventions);
    await household.getByRole('button', { name: '▴ Hide', exact: true }).click();
    await settle(page);
    assert.deepEqual(JSON.parse(await serial(page)), saved, 'Hide changes no model values');
    console.log(`PASS ${scope}: Microfinance grant editing, carve-out, independent checkbox/Show/Hide, custom preservation`);
    await context.close();
  }
  // Characterize (do not fix) the existing sector-switch side effect for non-"both" customs.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const sectorFixture = structuredClone(fixture);
  sectorFixture.custom_interventions.push({
    ...sectorFixture.custom_interventions[0], name: 'Water-only service fund', sector: 'water',
  });
  await context.addInitScript(inputs => {
    localStorage.setItem('wss_working_bundle', JSON.stringify({
      __wss_bundle: 1, inputs, altInputs: {},
      scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: false },
    }));
    localStorage.setItem('wss_scope_hint_seen', '1');
  }, sectorFixture);
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
  await page.getByRole('button', { name: 'Intervention Design', exact: false }).click();
  await settle(page);
  const before = await serial(page);
  await page.locator('.intervention-category-header').first().click();
  await settle(page);
  assert.equal(await serial(page), before, 'Category clicks must not run custom sector remapping');
  await page.getByRole('button', { name: 'Sanitation', exact: true }).click();
  await settle(page);
  assert.deepEqual(JSON.parse(await serial(page)).inputs.custom_interventions.map(ci => ci.sector), ['both', 'sanitation']);
  console.log('PASS existing custom-sector side effect: only sector switching remaps non-both customs; category clicks do not');
  await context.close();
  await request.close();
} finally {
  await browser.close();
}