import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createKevin } from '../packages/playwright/index.js';

function getChromeExecutable(): string | undefined {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter((c): c is string => Boolean(c));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Kevin Audio Store</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .cart-count { font-weight: bold; }
    #cart-status { margin-top: 10px; color: green; display: none; }
  </style>
</head>
<body>
  <h1>Kevin Audio Store</h1>
  <form id="search-form" onsubmit="event.preventDefault(); document.getElementById('search-result').innerText = 'Results for: ' + document.getElementById('search-input').value;">
    <input id="search-input" type="search" placeholder="Search headphones..." aria-label="Search headphones" />
    <button id="search-button" type="submit">Search</button>
  </form>
  <div id="search-result" style="margin-top: 10px;"></div>

  <div class="product" style="margin-top: 20px;">
    <h2>Sony WH-1000XM5</h2>
    <p>Premium noise canceling headphones - $399</p>
    <button id="add-to-cart-btn" onclick="document.getElementById('cart-status').style.display='block'; document.getElementById('cart-status').innerText='Added to Cart!';">Add to Cart</button>
  </div>
  <div id="cart-status"></div>
</body>
</html>`;

test('Real-Browser E2E: Kevin observes, types, searches, and clicks in headless Chrome', async () => {
  const executablePath = getChromeExecutable();
  const launchOptions = {
    headless: true,
    ...(executablePath ? { executablePath } : {})
  };

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setContent(FIXTURE_HTML, { waitUntil: 'domcontentloaded' });

    const kevin = await createKevin(page);

    // 1. Observe real DOM snapshot
    const t0 = performance.now();
    const snapshot = await kevin.observe();
    const observeDuration = performance.now() - t0;

    assert.strictEqual(snapshot.title, 'Kevin Audio Store');
    assert.ok(snapshot.elements.length >= 3, `Expected at least 3 elements, found ${snapshot.elements.length}`);

    const searchInputEl = snapshot.elements.find((e: any) => e.placeholder === 'Search headphones...' || e.role === 'searchbox' || e.tag === 'input');
    assert.ok(searchInputEl, 'Should identify search input element');

    // 2. Perform Type & Search
    const tSearch0 = performance.now();
    const typeRes = await kevin.act('Type Sony WH-1000XM5 into search headphones');
    const searchDuration = performance.now() - tSearch0;

    assert.strictEqual(typeRes.success, true);
    const inputValue = await page.inputValue('#search-input');
    assert.strictEqual(inputValue, 'Sony WH-1000XM5');

    // 3. Perform Click on "Add to Cart"
    const tClick0 = performance.now();
    const clickRes = await kevin.act('Click Add to Cart');
    const clickDuration = performance.now() - tClick0;

    assert.strictEqual(clickRes.success, true);
    const cartStatusText = await page.textContent('#cart-status');
    assert.strictEqual(cartStatusText, 'Added to Cart!');

    // 4. Verify loop decision benchmark (< 60ms for perception + decision scoring)
    const tPlan0 = performance.now();
    const plan = await kevin.plan('Click Search');
    const planDuration = performance.now() - tPlan0;

    assert.strictEqual(plan.action, 'click');
    assert.ok(planDuration < 60, `Decision planning loop should be < 60ms, took ${planDuration.toFixed(1)}ms`);
  } finally {
    await browser.close();
  }
});
