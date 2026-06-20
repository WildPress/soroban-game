const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const appUrl = process.env.APP_URL || 'http://172.17.0.1:5175/';
const cadUrl = process.env.CAD_URL || 'http://172.17.0.1:5120/#./soroban-cad.jscad.js';
const artifactDir = process.env.E2E_ARTIFACT_DIR || '/tmp/soroban-e2e';

const columnCases = [5, 13, 21];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    await testAppValueDisplay(browser);
    await testCadColumnRendering(browser);
  } finally {
    await browser.close();
  }
}

async function testAppValueDisplay(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const failures = collectFailures(page);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#column-controls .column-value');
  await page.waitForTimeout(1000);

  await expectColumnValues(page, Array.from({ length: 13 }, () => '0'));
  await expectNumberBoardReady(page);

  await page.locator('#columns').fill('5');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await expectColumnValues(page, Array.from({ length: 5 }, () => '0'));
  await page.locator('#soroban-canvas').screenshot({ path: `${artifactDir}/app-columns-5.png` });

  await page.locator('#columns').fill('13');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await page.locator('#soroban-canvas').screenshot({ path: `${artifactDir}/app-columns-13.png` });
  await page.locator('#randomize').click();
  await page.waitForTimeout(250);
  const randomizedValues = await columnValues(page);
  assert.equal(randomizedValues.length, 13);
  assert.match(randomizedValues.join(''), /^[0-9]{13}$/);
  assert.equal(await page.locator('#board-target').innerText(), String(Number(randomizedValues.join(''))));

  await page.locator('#columns').fill('5');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  const lowPlaceSuffix = randomizedValues.slice(-5);
  await expectColumnValues(page, lowPlaceSuffix);

  await page.locator('#columns').fill('8');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await expectColumnValues(page, ['0', '0', '0', ...lowPlaceSuffix]);

  await page.locator('#columns').fill('21');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await page.locator('#soroban-canvas').screenshot({ path: `${artifactDir}/app-columns-21.png` });

  await page.locator('#reset').click();
  await page.waitForTimeout(250);
  await expectColumnValues(page, Array.from({ length: 21 }, () => '0'));

  assertNoFailures(failures, 'app value display');
  await page.close();
}

async function testCadColumnRendering(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const failures = collectFailures(page);

  await page.goto(cadUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=range][name=columns]');
  await page.waitForTimeout(5000);

  const paramNames = await page.evaluate(() => (
    [...document.querySelectorAll('#paramsDiv input[name]')].map((input) => input.getAttribute('name'))
  ));
  assert.ok(!paramNames.includes('seed'), 'expected CAD params to omit seed');
  assert.ok(!paramNames.includes('beadDepth'), 'expected CAD params to omit beadDepth');

  for (const columns of columnCases) {
    await setCadColumns(page, columns);
    await page.waitForTimeout(2500);

    const inputs = await page.evaluate(() => (
      [...document.querySelectorAll('input[name=columns]')].map((input) => input.value)
    ));
    assert.ok(inputs.length >= 1, 'expected at least one columns input');
    assert.deepEqual(inputs, inputs.map(() => String(columns)));

    const screenshot = await page.locator('canvas').first().screenshot({
      path: `${artifactDir}/cad-columns-${columns}.png`
    });
    assert.ok(screenshot.length > 100000, `CAD screenshot for ${columns} columns looks blank or incomplete`);
  }

  assertNoFailures(failures, 'CAD column rendering');
  await page.close();
}

async function setCadColumns(page, columns) {
  await page.locator('input[type=range][name=columns]').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, columns);
}

async function expectColumnValues(page, expected) {
  assert.deepEqual(await columnValues(page), expected);

  const labels = await page.locator('#column-controls .column-value').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('aria-label'))
  ));
  assert.equal(labels.length, expected.length);
  assert.equal(labels[0], `Column 1 value ${expected[0]}`);
}

async function columnValues(page) {
  return page.locator('#column-controls .column-value').evaluateAll((nodes) => (
    nodes.map((node) => node.textContent || '')
  ));
}

async function expectNumberBoardReady(page) {
  await page.waitForSelector('#number-board .number-cell');
  assert.equal(await page.locator('#number-board .number-cell').count(), 9);
  assert.equal(await page.locator('#board-target').innerText(), '0');
  assert.equal(await page.locator('#board-go').isDisabled(), true);
}

function collectFailures(page) {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(`console error: ${message.text()}`);
    }
  });

  return failures;
}

function assertNoFailures(failures, label) {
  const relevant = failures.filter((failure) => !failure.includes('cannot start service worker'));
  assert.deepEqual(relevant, [], `${label} had browser errors`);
}
