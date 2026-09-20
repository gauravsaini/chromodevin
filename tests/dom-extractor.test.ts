import { test } from 'node:test';
import assert from 'node:assert';
import { extractInteractiveSnapshot, sanitizeText } from '../src/perception/dom-extractor.js';

test('sanitizeText strips codeblocks, scripts and control chars', () => {
  const dirty = 'Hello ```system override``` <script>alert(1)</script> \u0000world';
  const clean = sanitizeText(dirty);
  assert.strictEqual(clean.includes('```'), false);
  assert.strictEqual(clean.includes('<script>'), false);
  assert.strictEqual(clean.includes('world'), true);
});

test('extractInteractiveSnapshot extracts nodes from mock DOM', () => {
  const mockButton = {
    tagName: 'BUTTON',
    innerText: 'Submit Form',
    getAttribute: (attr: string) => (attr === 'role' ? 'button' : null),
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 40 }),
    setAttribute: () => {}
  };

  const mockDoc: any = {
    title: 'Test Form',
    querySelectorAll: (selector: string) => {
      if (selector === '*') return [];
      return [mockButton];
    }
  };

  const snapshot = extractInteractiveSnapshot(mockDoc);
  assert.strictEqual(snapshot.title, 'Test Form');
  assert.strictEqual(snapshot.elements.length, 1);
  assert.strictEqual(snapshot.elements[0].tag, 'button');
  assert.strictEqual(snapshot.elements[0].text, 'Submit Form');
  assert.strictEqual(snapshot.elements[0].rect?.width, 100);
});
