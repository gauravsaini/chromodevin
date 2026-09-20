import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function verifyManifest(relPath: string): void {
  const manifestPath = resolve(relPath);
  if (!existsSync(manifestPath)) {
    console.error(`${relPath} does not exist`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    console.error(`Expected manifest_version 3 in ${relPath}`);
    process.exit(1);
  }

  if (!manifest.name || !manifest.version || !manifest.description) {
    console.error(`Missing core manifest fields in ${relPath}`);
    process.exit(1);
  }

  const requiredPermissions = ['activeTab', 'scripting', 'storage', 'tabs'];
  for (const p of requiredPermissions) {
    if (!manifest.permissions?.includes(p)) {
      console.error(`Missing permission: ${p} in ${relPath}`);
      process.exit(1);
    }
  }
}

verifyManifest('manifest.json');
verifyManifest('packages/extension/manifest.json');

console.log('manifest verification passed');
process.exit(0);
