import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeBoundingBox, findElementAtPoint } from '../src/perception/visual.js';

test('normalizeBoundingBox maps screen pixels to 0..1 ratio', () => {
  const rect = { x: 640, y: 400, width: 320, height: 200 };
  const viewport = { width: 1280, height: 800 };

  const norm = normalizeBoundingBox(rect, viewport);
  assert.ok(norm !== null);
  assert.strictEqual(norm!.left, 0.5);
  assert.strictEqual(norm!.top, 0.5);
  assert.strictEqual(norm!.width, 0.25);
  assert.strictEqual(norm!.height, 0.25);
  assert.strictEqual(norm!.centerX, 0.625);
});

test('findElementAtPoint hits candidate within coordinates', () => {
  const candidates: any[] = [
    { id: 'cd-1', rect: { x: 0, y: 0, width: 100, height: 50 } },
    { id: 'cd-2', rect: { x: 100, y: 100, width: 200, height: 100 } }
  ];

  const match = findElementAtPoint(candidates, 150, 150);
  assert.notStrictEqual(match, null);
  assert.strictEqual(match!.id, 'cd-2');

  const miss = findElementAtPoint(candidates, 500, 500);
  assert.strictEqual(miss, null);
});
