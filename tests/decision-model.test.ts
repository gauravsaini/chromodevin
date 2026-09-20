import { test } from 'node:test';
import assert from 'node:assert';
import { browserDecision } from '../src/ai/decision-model.js';

test('browserDecision returns kev-compatible typed answers and validated action', () => {
  const state = {
    goal: 'Click the Search button',
    url: 'https://example.com',
    title: 'Example Page',
    elements: [
      { id: 'btn-search', role: 'button', text: 'Search', tag: 'button' },
      { id: 'btn-cancel', role: 'button', text: 'Cancel', tag: 'button' },
      { id: 'link-home', role: 'link', text: 'Home', tag: 'a' }
    ]
  };

  const result = browserDecision({ state });

  // 1. Structure check: answers + action
  assert.ok(result.answers, 'Must include typed answers');
  assert.ok(result.action, 'Must include action payload');

  // 2. Action check
  assert.strictEqual(result.action.action, 'click');
  assert.strictEqual(result.action.targetId, 'btn-search');

  // 3. Kev choice answer check
  const actionAnswer = result.answers.actionType;
  assert.strictEqual(actionAnswer.type, 'choice');
  assert.strictEqual(actionAnswer.choice, 'click');
  assert.ok(actionAnswer.confidence > 0 && actionAnswer.confidence <= 1);
  assert.ok(actionAnswer.probabilities.click > actionAnswer.probabilities.scroll);

  // Probabilities must sum close to 1
  const sumProbs = Object.values(actionAnswer.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumProbs - 1.0) < 0.05, `Probabilities should sum to ~1, got ${sumProbs}`);

  // Target answer check
  const targetAnswer = result.answers.targetElement;
  assert.strictEqual(targetAnswer.type, 'choice');
  assert.strictEqual(targetAnswer.choice, 'btn-search');
  assert.ok(targetAnswer.probabilities['btn-search'] > targetAnswer.probabilities['btn-cancel']);
});

test('browserDecision handles navigation goals with URL shortcuts and queries', () => {
  const res1 = browserDecision({ state: { goal: 'go to wikipedia.org' } });
  assert.strictEqual(res1.action.action, 'navigate');
  assert.strictEqual(res1.action.url, 'https://www.wikipedia.org');

  const res2 = browserDecision({ state: { goal: 'open youtube' } });
  assert.strictEqual(res2.action.action, 'navigate');
  assert.strictEqual(res2.action.url, 'https://www.youtube.com');

  const res3 = browserDecision({ state: { goal: 'navigate to https://github.com/jaredpalmer/kev' } });
  assert.strictEqual(res3.action.action, 'navigate');
  assert.strictEqual(res3.action.url, 'https://github.com/jaredpalmer/kev');
});

test('browserDecision handles typing and search inputs with search noul probability', () => {
  const state = {
    goal: 'search for WebGPU',
    url: 'https://developer.mozilla.org',
    title: 'MDN Web Docs',
    elements: [
      { id: 'search-input', role: 'searchbox', placeholder: 'Search docs', tag: 'input', type: 'search' },
      { id: 'nav-link', role: 'link', text: 'References', tag: 'a' }
    ]
  };

  const result = browserDecision({ state });
  assert.strictEqual(result.action.action, 'type');
  assert.strictEqual(result.action.targetId, 'search-input');
  assert.strictEqual(result.action.text, 'WebGPU');
  assert.strictEqual(result.action.pressEnter, true);

  // Binary noul answer
  assert.strictEqual(result.answers.searchIntent.type, 'noul');
  assert.strictEqual(result.answers.searchIntent.noul, 0.9);
});

test('browserDecision handles scroll and done goals', () => {
  const scrollRes = browserDecision({ state: { goal: 'scroll down' } });
  assert.strictEqual(scrollRes.action.action, 'scroll');
  assert.strictEqual(scrollRes.action.direction, 'down');

  const doneRes = browserDecision({ state: { goal: 'done' } });
  assert.strictEqual(doneRes.action.action, 'done');
});

test('browserDecision is pure and deterministic', () => {
  const state = {
    goal: 'click submit',
    elements: [{ id: 'submit-btn', text: 'Submit', role: 'button' }]
  };

  const out1 = browserDecision({ state });
  const out2 = browserDecision({ state });

  assert.deepStrictEqual(out1, out2, 'Must be completely deterministic and pure');
});
