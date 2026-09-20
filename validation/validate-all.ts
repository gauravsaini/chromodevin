#!/usr/bin/env node
/**
 * Runs all validation scripts and prints a summary.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

const dir = import.meta.dirname;
const scripts = [
  { name: 'MCP Server', file: 'validate-mcp.mjs' },
  { name: 'Resilient Primitives', file: 'validate-primitives.mjs' },
  { name: 'E2E Browser', file: 'validate-e2e.mjs' }
];

console.log('╔══════════════════════════════════════════════╗');
console.log('║       KEVIN — INDEPENDENT VALIDATION        ║');
console.log('╚══════════════════════════════════════════════╝');

let allOk = true;

for (const { name, file } of scripts) {
  const fullPath = path.join(dir, file);
  try {
    execSync(`node ${fullPath}`, { stdio: 'inherit', cwd: dir });
    console.log(`\n📦 ${name}: PASS\n`);
  } catch {
    console.log(`\n📦 ${name}: FAIL\n`);
    allOk = false;
  }
}

console.log('═'.repeat(50));
if (allOk) {
  console.log('🎉 ALL VALIDATIONS PASSED');
} else {
  console.log('💥 SOME VALIDATIONS FAILED');
  process.exit(1);
}
