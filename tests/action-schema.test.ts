import { test } from 'node:test';
import assert from 'node:assert';
import { validateAction } from '../src/actions/action-schema.js';
import {
  isAllowedNavigationUrl,
  assertAllowedNavigationUrl,
  isPrivateHostname
} from '../packages/core/security/url-policy.js';

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

test('validateAction allows valid https navigation', () => {
  const res = validateAction({ action: 'navigate', url: 'https://example.com/docs?query=test#section' });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.action?.url, 'https://example.com/docs?query=test#section');
});

test('validateAction blocks javascript: navigation', () => {
  const res = validateAction({ action: 'navigate', url: 'javascript:alert(document.cookie)' });
  assert.strictEqual(res.valid, false);
  assert.ok(res.error);
  assert.match(res.error!, /javascript/i);
});

test('validateAction blocks file: navigation', () => {
  const res = validateAction({ action: 'navigate', url: 'file:///etc/passwd' });
  assert.strictEqual(res.valid, false);
  assert.ok(res.error);
  assert.match(res.error!, /file/i);
});

test('validateAction blocks chrome: and internal browser scheme navigation', () => {
  const res = validateAction({ action: 'navigate', url: 'chrome://settings' });
  assert.strictEqual(res.valid, false);
  assert.ok(res.error);
  assert.match(res.error!, /chrome/i);

  const resExt = validateAction({ action: 'navigate', url: 'chrome-extension://abcdefg/popup.html' });
  assert.strictEqual(resExt.valid, false);
  assert.ok(resExt.error);
  assert.match(resExt.error!, /chrome-extension/i);
});

test('validateAction blocks private IP navigation by default', () => {
  const loopbackRes = validateAction({ action: 'navigate', url: 'http://127.0.0.1:8080/admin' });
  assert.strictEqual(loopbackRes.valid, false);
  assert.ok(loopbackRes.error);
  assert.match(loopbackRes.error!, /private network/i);

  const privateRes = validateAction({ action: 'navigate', url: 'http://192.168.1.1' });
  assert.strictEqual(privateRes.valid, false);
  assert.ok(privateRes.error);
  assert.match(privateRes.error!, /private network/i);

  const localhostRes = validateAction({ action: 'navigate', url: 'http://localhost:3000' });
  assert.strictEqual(localhostRes.valid, false);
  assert.ok(localhostRes.error);
  assert.match(localhostRes.error!, /private network/i);
});

test('validateAction blocks URLs with control characters or whitespace', () => {
  const nullByteRes = validateAction({ action: 'navigate', url: 'https://example.com/\x00evil' });
  assert.strictEqual(nullByteRes.valid, false);
  assert.ok(nullByteRes.error);
  assert.match(nullByteRes.error!, /control characters|whitespace/i);

  const crlfRes = validateAction({ action: 'navigate', url: 'https://example.com/\r\nHeader: Injection' });
  assert.strictEqual(crlfRes.valid, false);
  assert.ok(crlfRes.error);
  assert.match(crlfRes.error!, /control characters|whitespace/i);
});

test('url-policy options allow opt-in for private network, file, and blob', () => {
  assert.strictEqual(isAllowedNavigationUrl('http://127.0.0.1:8080').allowed, false);
  assert.strictEqual(
    isAllowedNavigationUrl('http://127.0.0.1:8080', { allowPrivateNetwork: true }).allowed,
    true
  );

  assert.strictEqual(isAllowedNavigationUrl('file:///etc/passwd').allowed, false);
  assert.strictEqual(
    isAllowedNavigationUrl('file:///etc/passwd', { allowFile: true }).allowed,
    true
  );

  assert.strictEqual(isAllowedNavigationUrl('blob:https://example.com/item').allowed, false);
  assert.strictEqual(
    isAllowedNavigationUrl('blob:https://example.com/item', { allowBlob: true }).allowed,
    true
  );

  assert.doesNotThrow(() => assertAllowedNavigationUrl('https://example.com'));
  assert.throws(() => assertAllowedNavigationUrl('javascript:alert(1)'), /javascript/i);

  assert.strictEqual(isPrivateHostname('localhost'), true);
  assert.strictEqual(isPrivateHostname('127.0.0.1'), true);
  assert.strictEqual(isPrivateHostname('10.0.0.1'), true);
  assert.strictEqual(isPrivateHostname('192.168.1.1'), true);
  assert.strictEqual(isPrivateHostname('172.16.0.1'), true);
  assert.strictEqual(isPrivateHostname('172.31.255.255'), true);
  assert.strictEqual(isPrivateHostname('::1'), true);
  assert.strictEqual(isPrivateHostname('[::1]'), true);
  assert.strictEqual(isPrivateHostname('host.local'), true);
  assert.strictEqual(isPrivateHostname('service.internal'), true);
  assert.strictEqual(isPrivateHostname('example.com'), false);
});


