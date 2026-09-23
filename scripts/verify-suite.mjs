// Root-owned oracle for node N4 gates. Passes only when the full suite has
// exactly one failing file and it is the known pre-existing env failure
// (tests/playwright-e2e.test.ts needs the missing 'playwright' package).
// Prints 'suite verification passed' and exits 0 on success; otherwise prints
// the failing files and exits 1. (tsx itself exits nonzero on any failure,
// so the raw command can never satisfy a zero-exit gate.)
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const files = readdirSync(new URL('tests/', root))
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => `tests/${f}`);

execFile('npx', ['tsx', '--test', ...files],
  { cwd: root, timeout: 300000, maxBuffer: 32 * 1024 * 1024 },
  (_err, stdout, stderr) => {
    const out = String(stdout || '') + '\n' + String(stderr || '');
    const failLine = out.split('\n').find((l) => /^ℹ fail \d+/.test(l.trim()));
    const failCount = failLine ? Number(failLine.trim().split(' ')[2]) : NaN;
    const failingFiles = [...new Set(
      out.split('\n')
        .map((l) => l.trim().match(/^✖ (tests\/\S+\.test\.ts)/))
        .filter(Boolean)
        .map((m) => m[1])
    )];
    if (failCount === 1 && failingFiles.length === 1 && failingFiles[0] === 'tests/playwright-e2e.test.ts') {
      console.log('suite verification passed');
      return;
    }
    console.log(`SUITE REGRESSION: fail=${failCount} files=${JSON.stringify(failingFiles)}`);
    process.exit(1);
  });
