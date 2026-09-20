import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'core/index': 'packages/core/index.ts',
    'playwright/index': 'packages/playwright/index.ts',
    'playwright/driver': 'packages/playwright/driver.ts',
    'mcp/index': 'packages/mcp/index.ts',
    'daemon/index': 'packages/daemon/index.ts'
  },
  format: ['esm'],
  clean: true,
  sourcemap: true
});
