import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const testFiles = readdirSync('tests')
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => join('tests', f));

let passed = 0;
let failed = 0;

for (const file of testFiles) {
  const res = spawnSync('npx', ['tsx', '--test', file], { stdio: 'inherit' });
  if (res.status === 0) {
    passed++;
  } else {
    failed++;
    console.error(`Failed test: ${file}`);
  }
}

if (failed > 0) {
  console.error(`Tests failed: ${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`all tests passed: ${passed} test suites verified successfully`);
process.exit(0);
