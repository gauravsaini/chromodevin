import { test } from 'node:test';
import assert from 'node:assert';
import { validateAction } from '../src/actions/action-schema.js';

test('validateAction accepts valid click action', () => {
  const res = validateAction({ action: 'click', targetId: 'cd-5', explanation: 'Click search' });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.action?.action, 'click');
  assert.strictEqual(res.action?.targetId, 'cd-5');
});

test('validateAction rejects click without targetId', () => {
  const res = validateAction({ action: 'click' });
  assert.strictEqual(res.valid, false);
  assert.ok(res.error);
  assert.match(res.error!, /requires targetId/);
});

test('validateAction accepts type action with text', () => {
  const res = validateAction({ action: 'type', targetId: 'cd-2', text: 'hello world' });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.action?.text, 'hello world');
});

test('validateAction accepts scroll with defaults', () => {
  const res = validateAction({ action: 'scroll', direction: 'up', amount: 300 });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.action?.direction, 'up');
  assert.strictEqual(res.action?.amount, 300);
});

test('validateAction accepts navigation and history actions', () => {
  const nav = validateAction({ action: 'navigate', url: 'https://example.com' });
  assert.strictEqual(nav.valid, true);
  assert.strictEqual(nav.action?.url, 'https://example.com');

  const back = validateAction({ action: 'back' });
  assert.strictEqual(back.valid, true);

  const forward = validateAction({ action: 'forward' });
  assert.strictEqual(forward.valid, true);

  const done = validateAction({ action: 'done', explanation: 'All done' });
  assert.strictEqual(done.valid, true);
});

test('validateAction rejects unknown action types', () => {
  const res = validateAction({ action: 'eval_arbitrary_js' as any });
  assert.strictEqual(res.valid, false);
  assert.ok(res.error);
  assert.match(res.error!, /Unsupported action/);
});
