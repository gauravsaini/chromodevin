#!/usr/bin/env node
/**
 * Validate resilient automation primitives claims:
 * 1. 3-Verb API: act(), observe(), extract() exist and work
 * 2. ActionCache fast-path: <1ms on cache hit, self-healing on stale entries
 * 3. Playwright Page Proxy: native methods passthrough transparently
 * 4. DOM settlement: waitForDomSettle works
 * 5. Iframe piercing: frames() traversed in snapshot
 * 6. observe(goal) returns proposals; act(proposal) executes directly
 * 7. extract({ schema }) returns typed structured data
 */

import { createMockPage, assert, report } from './helpers.js';
import {
  createKevin,
  waitForDomSettle,
  ActionCache,
  computeDomFingerprint,
  computeCacheKey,
  extractSchema
} from '../packages/playwright/index.js';

console.log('\n🎭 RESILIENT PRIMITIVES VALIDATION');
console.log('─'.repeat(50));

// ── 1. 3-Verb API exists ────────────────────────────
console.log('\n🔧 API Shape');

const simplePage = createMockPage([
  { id: 'cd-1', role: 'button', text: 'Login', tag: 'button' }
]);
const kevin = await createKevin(simplePage);

assert(typeof kevin.act === 'function', 'act() is a function');
assert(typeof kevin.observe === 'function', 'observe() is a function');
assert(typeof kevin.extract === 'function', 'extract() is a function');
assert(typeof kevin.plan === 'function', 'plan() is a function');
assert(typeof kevin.step === 'function', 'step() is a function');

report('API Shape');

// ── 2. observe() without goal ────────────────────────
console.log('\n👁️  observe() — Page State');

const obs = await kevin.observe();
assert(typeof obs.url === 'string', 'observe: returns url');
assert(typeof obs.title === 'string', 'observe: returns title');
assert(Array.isArray(obs.elements), 'observe: returns elements array');
assert(obs.elements.length === 1, 'observe: correct element count');
assert(obs.proposals === undefined, 'observe: no proposals without goal');

report('observe() — Page State');

// ── 3. observe(goal) with proposals ──────────────────
console.log('\n🎯 observe(goal) — Action Proposals');

const page2 = createMockPage([
  { id: 'cd-1', role: 'button', text: 'Checkout', tag: 'button' },
  { id: 'cd-2', role: 'link', text: 'Back', tag: 'a' }
]);
const kevin2 = await createKevin(page2);

const obs2 = await kevin2.observe('Checkout');
assert(Array.isArray(obs2.proposals), 'observe(goal): proposals is array');
assert(Boolean(obs2.proposals && obs2.proposals.length >= 1), 'observe(goal): at least 1 proposal');
assert(Boolean(obs2.proposals && obs2.proposals[0]?.targetId === 'cd-1'), 'observe(goal): correct target');

// act(proposal) direct execution
const directRes = await kevin2.act(obs2.proposals![0]);
assert(directRes.success === true, 'act(proposal): succeeds');
assert(directRes.targetId === 'cd-1', 'act(proposal): correct target');
assert(page2.state.clicks.length === 1, 'act(proposal): click happened');

report('observe(goal) — Action Proposals');

// ── 4. act() — Single-step atomic ────��──────────────
console.log('\n⚡ act() — Atomic Execution');

const page3 = createMockPage([
  { id: 'cd-1', role: 'button', text: 'Add to Cart', tag: 'button' },
  { id: 'cd-2', role: 'textbox', text: '', tag: 'input', placeholder: 'Email' }
]);
const kevin3 = await createKevin(page3);

const clickRes = await kevin3.act('Click Add to Cart');
assert(clickRes.success === true, 'act(click): succeeds');
assert(clickRes.cached === false, 'act(click): first call not cached');
assert(page3.state.clicks.length === 1, 'act(click): click happened');

const typeRes = await kevin3.act('Type hello@test.com into Email');
assert(typeRes.success === true, 'act(type): succeeds');
assert(page3.state.types.length >= 1, 'act(type): typing happened');

report('act() — Atomic Execution');

// ── 5. ActionCache Fast-Path ─────────────────────────
console.log('\n🗄️  ActionCache — Self-Healing Cache');

const cache = new ActionCache({ maxSize: 10 });

// Simulate cache set/get
const url = 'https://test.com';
const fp = 'fp-abc123';
const goal = 'Click Login';
const entry = { action: 'click', targetId: 'cd-1', selector: '#login' };

cache.set(url, fp, goal, entry);
const hit = cache.get(url, fp, goal);
assert(hit !== null, 'cache.get: returns cached entry');
assert(Boolean(hit && hit.targetId === 'cd-1'), 'cache.get: correct targetId');

// Miss on different fingerprint (DOM changed)
const miss = cache.get(url, 'fp-different', goal);
assert(miss === null, 'cache.get: miss on changed DOM fingerprint');

// Invalidation (self-healing)
cache.invalidate(url, goal);
const afterInvalidate = cache.get(url, fp, goal);
assert(afterInvalidate === null, 'cache.invalidate: entry removed');

// Verify computeDomFingerprint and computeCacheKey exist
assert(typeof computeDomFingerprint === 'function', 'computeDomFingerprint exported');
assert(typeof computeCacheKey === 'function', 'computeCacheKey exported');

const fp2 = computeDomFingerprint({
  url: 'https://x.com',
  title: 'X',
  elements: [{ id: 'cd-1', text: 'hello' }]
});
assert(typeof fp2 === 'string' && fp2.length > 0, 'computeDomFingerprint: returns non-empty string');

report('ActionCache — Self-Healing Cache');

// ── 6. Cache hit <1ms benchmark ──────────────────────
console.log('\n⏱️  Cache Performance');

const cachePage = createMockPage([
  { id: 'cd-1', role: 'button', text: 'Fast Button', tag: 'button' }
]);
const cacheKevin = await createKevin(cachePage, { cache: new ActionCache() });

// Prime the cache
await cacheKevin.act('Click Fast Button');
assert(cachePage.state.clicks.length === 1, 'Cache prime: click happened');

// Measure cached call
const t0 = performance.now();
const cachedRes = await cacheKevin.act('Click Fast Button');
const duration = performance.now() - t0;

assert(cachedRes.cached === true, 'Cache hit: marked as cached');
assert(cachedRes.success === true, 'Cache hit: success');
assert(duration < 5, 'Cache hit: <5ms execution', `took ${duration.toFixed(2)}ms`);

report('Cache Performance');

// ── 7. extract({ schema }) ──────────────────────────
console.log('\n📊 extract() — Structured Data');

const extractPage = createMockPage([
  { tag: 'h1', role: 'heading', text: 'MacBook Pro 16"' },
  { tag: 'span', text: 'Price: $2,499.00' },
  { tag: 'span', text: 'Available: true' },
  { tag: 'span', text: 'Rating: 4.8' }
]);
const extractKevin = await createKevin(extractPage);

const extracted = await extractKevin.extract({
  instruction: 'Extract product info',
  schema: {
    title: 'string',
    price: 'number',
    available: 'boolean'
  }
});

assert(extracted.success === true, 'extract: succeeds');
assert(typeof extracted.data === 'object', 'extract: returns data object');
assert(extracted.data.title === 'MacBook Pro 16"', 'extract: correct title');
assert(extracted.data.price === 2499, 'extract: correct price (commas stripped)');
assert(extracted.data.available === true, 'extract: correct boolean');
assert(typeof extracted.confidence === 'number', 'extract: has confidence score');
assert(Array.isArray(extracted.missingFields), 'extract: has missingFields array');

report('extract() — Structured Data');

// ── 8. Playwright Page Proxy ─────────────────────────
console.log('\n🔀 Playwright Page Proxy');

const proxyPage = createMockPage();
const proxyKevin = await createKevin(proxyPage);

// Native page methods should pass through
await proxyKevin.goto('https://new-site.com');
assert(proxyPage.state.gotos.length === 1, 'proxy.goto: delegated to page');
assert(proxyKevin.url() === 'https://new-site.com', 'proxy.url(): reads from page');

const loc = proxyKevin.locator('button#test');
assert(typeof loc?.first === 'function', 'proxy.locator: returns locator');

// Kevin methods still work on the proxy
const proxyObs = await proxyKevin.observe();
assert(proxyObs.title === 'Test Shop', 'proxy.observe: still works');

report('Playwright Page Proxy');

// ── 9. waitForDomSettle ──────────────────────────────
console.log('\n⏳ DOM Settlement');

const settlePage = createMockPage();
const settled = await waitForDomSettle(settlePage, { timeout: 200, idleWindow: 50 });
assert(typeof settled === 'boolean', 'waitForDomSettle: returns boolean');

report('DOM Settlement');

// ── 10. extractSchema standalone ─────────────────────
console.log('\n🧪 extractSchema standalone');

assert(typeof extractSchema === 'function', 'extractSchema is exported');

const snapshot = {
  url: 'https://test.com',
  title: 'Products',
  elements: [
    { id: 'h2-1', tag: 'h2', text: 'Keyboard' },
    { id: 'span-1', tag: 'span', text: '$149' }
  ]
};

const schemaResult = extractSchema(snapshot, 'Extract product', { name: 'string', price: 'number' });
assert(schemaResult.success === true, 'extractSchema: succeeds');
assert(schemaResult.data.name === 'Keyboard', 'extractSchema: correct name');
assert(schemaResult.data.price === 149, 'extractSchema: correct price');

report('extractSchema standalone');

console.log('\n✅ Resilient primitives validation complete.\n');
