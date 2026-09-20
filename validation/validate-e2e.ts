#!/usr/bin/env node
/**
 * Validate E2E: real Playwright browser launch with createKevin.
 * Tests actual browser interaction (headless Chrome) to prove claims
 * aren't just mock-friendly but work in a real DOM environment.
 */

import fs from 'node:fs';
import { createKevin } from '../packages/playwright/index.js';
import { KevinMcpServer } from '../packages/mcp/index.js';

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
  <title>Kevin Validation Store</title>
</head>
<body>
  <h1>Kevin Validation Store</h1>
  <input id="search" type="text" placeholder="Search products..." aria-label="Search products" />
  <button id="search-btn" onclick="document.getElementById('result').innerText='Found: ' + document.getElementById('search').value">Search</button>
  <div id="result"></div>
  <div class="product">
    <h2>Premium Headphones</h2>
    <span class="price">$299.00</span>
    <button id="add-cart" onclick="document.getElementById('cart-msg').innerText='Item added!'">Add to Cart</button>
  </div>
  <div id="cart-msg"></div>
  <a id="about-link" href="#">About Us</a>
</body>
</html>`;

let passed = 0;
let failed = 0;

function check(ok: boolean, name: string, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n🌐 E2E BROWSER VALIDATION');
console.log('─'.repeat(50));

let browser: any;
try {
  const { chromium } = await import('playwright');
  const executablePath = getChromeExecutable();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  const page = await browser.newPage();
  await page.setContent(FIXTURE_HTML, { waitUntil: 'domcontentloaded' });

  // ── 1. createKevin on real page ──────────────────
  console.log('\n🔧 createKevin');
  const kevin = await createKevin(page);
  check(typeof kevin.act === 'function', 'kevin.act exists');
  check(typeof kevin.observe === 'function', 'kevin.observe exists');
  check(typeof kevin.extract === 'function', 'kevin.extract exists');

  // ── 2. observe() real DOM ────────────────────────
  console.log('\n👁️  observe() on real DOM');
  const obs = await kevin.observe();
  check(obs.title === 'Kevin Validation Store', 'observe: correct title');
  check(obs.elements.length >= 3, 'observe: detects multiple elements', `found ${obs.elements.length}`);

  // ── 3. act() — type into search ──────────────────
  console.log('\n⌨️  act() — type');
  const typeRes = await kevin.act('Type wireless into search products');
  check(typeRes.success === true, 'act(type): success');
  const searchVal = await page.inputValue('#search');
  check(searchVal === 'wireless', 'act(type): input value correct', `got "${searchVal}"`);

  // ── 4. act() — click button ──────────────────────
  console.log('\n🖱️  act() — click');
  const clickRes = await kevin.act('Click Add to Cart');
  check(clickRes.success === true, 'act(click): success');
  const cartMsg = await page.textContent('#cart-msg');
  check(cartMsg === 'Item added!', 'act(click): side effect verified');

  // ── 5. plan() — no side effects ──────────────────
  console.log('\n📝 plan() — no side effects');
  const plan = await kevin.plan('Click Search');
  check(plan.action === 'click', 'plan: returns click action');
  // The search result should still be empty (no side effect from plan)
  const resultBefore = await page.textContent('#result');
  check(!resultBefore?.includes('Found:'), 'plan: no side effects on DOM');

  // ── 6. Page Proxy on real page ───────────────────
  console.log('\n🔀 Page Proxy on real browser');
  const title = await kevin.title();
  check(title === 'Kevin Validation Store', 'proxy.title(): works');

  // ── 7. MCP Server with real page ─────────────────
  console.log('\n🔌 MCP Server with real page');
  const mcpServer = new KevinMcpServer({ page });
  const mcpObs = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'kevin_observe', arguments: {} }
  });
  check(mcpObs?.result?.isError === false, 'MCP kevin_observe: no error');
  const mcpData = JSON.parse(mcpObs?.result?.content?.[0]?.text || '{}');
  check(mcpData.title === 'Kevin Validation Store', 'MCP kevin_observe: correct title');

  const mcpPlan = await mcpServer.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'kevin_plan', arguments: { goal: 'Click About Us' } }
  });
  check(mcpPlan?.result?.isError === false, 'MCP kevin_plan: no error');

  await mcpServer.close();

  // ── 8. Performance benchmark ──────���──────────────
  console.log('\n⏱️  Performance');
  const t0 = performance.now();
  await kevin.plan('Click Search');
  const planMs = performance.now() - t0;
  check(planMs < 100, 'plan() < 100ms', `took ${planMs.toFixed(1)}ms`);
} catch (err: any) {
  console.error(`\n💥 E2E Error: ${err?.message || String(err)}`);
  console.error(err?.stack);
  failed++;
} finally {
  if (browser) await browser.close();
}

console.log(`\n  E2E: ${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`);
console.log('\n✅ E2E validation complete.\n');

if (failed > 0) process.exit(1);
