import { test } from 'node:test';
import assert from 'node:assert';
import { DecisionEngine } from '../src/perception/decision-engine.js';

test('DecisionEngine scores candidates and ranks best match', async () => {
  const engine = new DecisionEngine();

  const candidates = [
    { id: 'cd-1', tag: 'a', role: 'link', text: 'About Us', rect: { x: 10, y: 10, width: 50, height: 20 } },
    { id: 'cd-2', tag: 'input', role: 'searchbox', type: 'search', text: '', placeholder: 'Search products', name: 'q', rect: { x: 100, y: 50, width: 200, height: 30 } },
    { id: 'cd-3', tag: 'button', role: 'button', text: 'Checkout Now', rect: { x: 400, y: 50, width: 100, height: 40 } },
    { id: 'cd-4', tag: 'button', role: 'button', text: 'Contact Support', rect: { x: 20, y: 800, width: 80, height: 20 } }
  ];

  const searchResult = await engine.decide({
    candidates,
    question: 'Click on the search box',
    topK: 2
  });

  assert.strictEqual(searchResult.topCandidates.length, 2);
  assert.strictEqual(searchResult.topCandidates[0].id, 'cd-2');

  const checkoutResult = await engine.decide({
    candidates,
    question: 'Proceed to checkout and pay',
    topK: 2
  });

  assert.strictEqual(checkoutResult.topCandidates[0].id, 'cd-3');
});

test('DecisionEngine handles empty candidates gracefully', async () => {
  const engine = new DecisionEngine();
  const res = await engine.decide({ candidates: [], question: 'test' });
  assert.deepStrictEqual(res.ranked, []);
  assert.deepStrictEqual(res.topCandidates, []);
});
