import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionCache,
  computeDomFingerprint,
  computeCacheKey
} from '../packages/core/cache/action-cache.js';

test('computeDomFingerprint returns deterministic hash for identical snapshot', () => {
  const snapshot1 = {
    url: 'https://example.com',
    elements: [
      { tag: 'button', role: 'button', text: 'Submit' },
      { tag: 'input', role: 'textbox', text: 'Search' }
    ]
  };
  const snapshot2 = {
    url: 'https://example.com/other',
    elements: [
      { tag: 'button', role: 'button', text: 'Submit' },
      { tag: 'input', role: 'textbox', text: 'Search' }
    ]
  };
  const fp1 = computeDomFingerprint(snapshot1);
  const fp2 = computeDomFingerprint(snapshot2);

  assert.equal(typeof fp1, 'string');
  assert.equal(fp1.length, 16);
  assert.equal(fp1, fp2);
});

test('computeDomFingerprint changes when DOM structure changes', () => {
  const snapshot1 = {
    elements: [{ tag: 'button', role: 'button', text: 'Submit' }]
  };
  const snapshot2 = {
    elements: [
      { tag: 'button', role: 'button', text: 'Submit' },
      { tag: 'a', role: 'link', text: 'Learn more' }
    ]
  };
  assert.notEqual(computeDomFingerprint(snapshot1), computeDomFingerprint(snapshot2));
});

test('computeCacheKey normalizes URL and instruction', () => {
  const k1 = computeCacheKey('https://example.com/checkout?ref=123', 'fp1', ' Click Submit ');
  const k2 = computeCacheKey('https://example.com/checkout', 'fp1', 'click submit');
  assert.equal(k1, k2);
});

test('ActionCache sets, gets, and tracks hits with LRU ordering', () => {
  const cache = new ActionCache({ maxSize: 3 });

  cache.set('https://app.com', 'fpA', 'click login', {
    selector: '[data-kevin-id="cd-1"]',
    targetId: 'cd-1',
    action: 'click'
  });

  const hit = cache.get('https://app.com', 'fpA', 'click login');
  assert.ok(hit);
  assert.equal(hit.targetId, 'cd-1');
  assert.equal(hit.hits, 2);

  const miss = cache.get('https://app.com', 'fpB', 'click login');
  assert.equal(miss, null);
});

test('ActionCache enforces maxSize eviction', () => {
  const cache = new ActionCache({ maxSize: 2 });
  cache.set('https://a.com', 'fp1', 'act1', { targetId: 'cd-1' });
  cache.set('https://b.com', 'fp2', 'act2', { targetId: 'cd-2' });
  cache.set('https://c.com', 'fp3', 'act3', { targetId: 'cd-3' });

  assert.equal(cache.size(), 2);
  assert.equal(cache.get('https://a.com', 'fp1', 'act1'), null);
  assert.ok(cache.get('https://b.com', 'fp2', 'act2'));
  assert.ok(cache.get('https://c.com', 'fp3', 'act3'));
});

test('ActionCache invalidates matching entries', () => {
  const cache = new ActionCache();
  cache.set('https://site.com/form', 'fp1', 'click submit', { targetId: 'cd-1' });
  cache.set('https://site.com/form', 'fp1', 'type email', { targetId: 'cd-2' });
  cache.set('https://other.com/form', 'fp2', 'click submit', { targetId: 'cd-3' });

  const count = cache.invalidate('https://site.com/form');
  assert.equal(count, 2);
  assert.equal(cache.size(), 1);
  assert.ok(cache.get('https://other.com/form', 'fp2', 'click submit'));
});
