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
  const page = await browser.newPage({ viewport: { width: 390, height: 740 }, deviceScaleFactor: 1 });
  const failures = collectFailures(page);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#column-controls .column-value');
  await page.waitForTimeout(1000);

  assert.equal(await page.locator('#columns').getAttribute('max'), '3');
  await expectColumnValues(page, Array.from({ length: 3 }, () => '0'));
  await expectNumberBoardReady(page);
  await expectAppFitsViewport(page);

  await page.locator('#columns').fill('2');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await expectColumnValues(page, Array.from({ length: 2 }, () => '0'));
  await page.locator('#soroban-canvas').screenshot({ path: `${artifactDir}/app-columns-2.png` });
  await expectAppFitsViewport(page);

  await page.locator('#columns').fill('3');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await page.locator('#soroban-canvas').screenshot({ path: `${artifactDir}/app-columns-3.png` });
  await page.locator('#randomize').click();
  await page.waitForTimeout(250);
  const randomizedValues = await columnValues(page);
  assert.equal(randomizedValues.length, 3);
  assert.match(randomizedValues.join(''), /^[0-9]{3}$/);
  assert.equal(await page.locator('#board-target').innerText(), String(Number(randomizedValues.join(''))));

  await page.locator('#columns').fill('2');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  const lowPlaceSuffix = randomizedValues.slice(-2);
  await expectColumnValues(page, lowPlaceSuffix);

  await page.locator('#columns').fill('3');
  await page.locator('#columns').dispatchEvent('change');
  await page.waitForTimeout(750);
  await expectColumnValues(page, ['0', ...lowPlaceSuffix]);

  await page.locator('#reset').click();
  await page.waitForTimeout(250);
  await expectColumnValues(page, Array.from({ length: 3 }, () => '0'));
  await expectAppFitsViewport(page);

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
  await page.waitForSelector('#number-board .number-board-canvas');
  assert.equal(await page.locator('#number-board .number-cell').count(), 9);
  assert.equal(await page.locator('#board-target').innerText(), '0');
  assert.equal(await page.locator('#board-go').isDisabled(), true);

  const bubbleCanvas = await page.locator('#number-board .number-board-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();

    return {
      width: rect.width,
      height: rect.height
    };
  });

  assert.ok(bubbleCanvas.width > 200, `expected WebGL bubble board width, got ${bubbleCanvas.width}`);
  assert.ok(bubbleCanvas.height > 200, `expected WebGL bubble board height, got ${bubbleCanvas.height}`);
}

async function expectAppFitsViewport(page) {
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('#soroban-canvas');
    const rect = canvas?.getBoundingClientRect();

    return {
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
      canvasBottom: rect?.bottom ?? 0,
      canvasHeight: rect?.height ?? 0
    };
  });

  assert.equal(metrics.bodyOverflow, 'hidden');
  assert.ok(metrics.scrollHeight <= metrics.viewportHeight + 1, `expected app to fit viewport, got scrollHeight ${metrics.scrollHeight}`);
  assert.ok(metrics.canvasHeight >= 220, `expected visible soroban canvas, got height ${metrics.canvasHeight}`);
  assert.ok(metrics.canvasBottom <= metrics.viewportHeight, `expected soroban canvas in viewport, bottom ${metrics.canvasBottom}`);
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
