import { test } from 'node:test';
import assert from 'node:assert';
import { decomposeCommand } from '../src/agent/plan-decomposer.js';

test('decomposeCommand splits single command into single element array', () => {
  const res = decomposeCommand('Scroll down');
  assert.deepStrictEqual(res, ['Scroll down']);
});

test('decomposeCommand splits compound command with "and"', () => {
  const res = decomposeCommand('Open wikipedia.org and search for WebGPU');
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0], 'Open wikipedia.org');
  assert.strictEqual(res[1], 'search for WebGPU');
});

test('decomposeCommand splits multi-part sequences with "then" and "after that"', () => {
  const res = decomposeCommand('Open google.com then type AI into search and then click search');
  assert.strictEqual(res.length, 3);
  assert.strictEqual(res[0], 'Open google.com');
  assert.strictEqual(res[1], 'type AI into search');
  assert.strictEqual(res[2], 'click search');
});

test('decomposeCommand handles comma-separated multi-step actions', () => {
  const res = decomposeCommand('Open google.com, search for AI news, and click the first result');
  assert.strictEqual(res.length, 3);
  assert.strictEqual(res[0], 'Open google.com');
  assert.strictEqual(res[1], 'search for AI news');
  assert.strictEqual(res[2], 'click the first result');
});

test('decomposeCommand handles complex multi-action sequence with scroll and extract', () => {
  const res = decomposeCommand('Scroll down, then extract page');
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0], 'Scroll down');
  assert.strictEqual(res[1], 'extract page');
});

test('decomposeCommand handles arrow-chained multi-step workflow', () => {
  const query = 'open google.com --> search for wikipedia-->click on wikipedia link and search for webgpu-->select 1st result from the dropdown--> find the website -->click on the website';
  const res = decomposeCommand(query);
  assert.strictEqual(res.length, 7);
  assert.strictEqual(res[0], 'open google.com');
  assert.strictEqual(res[1], 'search for wikipedia');
  assert.strictEqual(res[2], 'click on wikipedia link');
  assert.strictEqual(res[3], 'search for webgpu');
  assert.strictEqual(res[4], 'select 1st result from the dropdown');
  assert.strictEqual(res[5], 'find the website');
  assert.strictEqual(res[6], 'click on the website');
});


