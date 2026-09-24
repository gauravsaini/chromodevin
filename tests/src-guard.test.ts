import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function getTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

test('all src files are re-export-only facades', () => {
  const repoRoot = process.cwd();
  const srcDir = path.join(repoRoot, 'src');
  const tsFiles = getTsFiles(srcDir);
  assert.ok(tsFiles.length > 0, 'No TypeScript files found in src');

  const violations: string[] = [];
  for (const file of tsFiles) {
    const relPath = path.relative(repoRoot, file);
    const content = fs.readFileSync(file, 'utf8');
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = stripped.split('\n');
    for (const line of lines) {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (!code) continue;
      const isReExport = /^export\s+(?:type\s+)?\*\s+from\s+['"][^'"]+['"];?$/.test(code);
      const isImportType = /^import\s+type\s+.*?from\s+['"][^'"]+['"];?$/.test(code);
      if (!isReExport && !isImportType) {
        violations.push(`${relPath}: "${line.trim()}"`);
      }
    }
  }
  assert.deepEqual(violations, [], `Disallowed lines in src:\n${violations.join('\n')}`);
});
