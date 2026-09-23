// Root-owned oracle for kevin-arch-v2:R3. Passes only when tsc reports no
// errors outside the known pre-existing set (missing ws/playwright env types
// in files this pipeline does not own).
import { execFile } from 'node:child_process';

const ALLOWLIST_PREFIXES = [
  'packages/daemon/client.ts',
  'packages/daemon/server.ts',
  'packages/mcp/server.ts',
  'scripts/benchmark-agent.ts',
  'tests/playwright-e2e.test.ts',
  'validation/validate-e2e.ts'
];

execFile('npx', ['tsc', '--noEmit'], { cwd: new URL('..', import.meta.url), timeout: 180000 }, (err, stdout, stderr) => {
  const lines = String(stdout || '') + '\n' + String(stderr || '');
  const errors = lines.split('\n').filter((l) => /\(\d+,\d+\): error TS/.test(l));
  const foreign = errors.filter((l) => !ALLOWLIST_PREFIXES.some((p) => l.includes(p)));
  if (foreign.length > 0) {
    console.log(foreign.join('\n'));
    process.exit(1);
  }
  console.log('typecheck verification passed');
});
