import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('lockfile guard: pnpm-lock.yaml exists and yarn.lock is absent', () => {
  const repoRoot = process.cwd();
  const pnpmLockPath = path.join(repoRoot, 'pnpm-lock.yaml');
  const yarnLockPath = path.join(repoRoot, 'yarn.lock');

  assert.ok(fs.existsSync(pnpmLockPath), 'pnpm-lock.yaml must exist');
  assert.ok(!fs.existsSync(yarnLockPath), 'yarn.lock must be absent');
});
