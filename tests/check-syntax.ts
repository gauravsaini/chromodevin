import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function getFiles(dir: string, exts = ['.js']): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getFiles(full, exts));
    } else if (exts.some((ext) => full.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

const targetDirs = ['background', 'content', 'harness', 'popup'];
let count = 0;

for (const dir of targetDirs) {
  const files = getFiles(dir);
  for (const file of files) {
    try {
      execSync(`node --check ${file}`, { stdio: 'pipe' });
      count++;
    } catch (err: any) {
      console.error(`Syntax error in ${file}:`, err.message);
      process.exit(1);
    }
  }
}

// Run TypeScript typecheck for all TS packages and tests
try {
  const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');
  execSync(`${process.execPath} ${tscBin} --noEmit`, { stdio: 'inherit' });
} catch (err) {
  console.error('TypeScript typecheck failed');
  process.exit(1);
}

console.log(`syntax and type checks passed: verified ${count} JS files and all TS source files`);
process.exit(0);
