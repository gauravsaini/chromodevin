#!/usr/bin/env node

/**
 * Documentation verification script for Kevin.
 * Validates consistency between code implementation and architectural documentation.
 */

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, 'docs');
const lldHtmlPath = path.join(docsDir, 'lld-kevin-pipeline.html');
const readmePath = path.join(repoRoot, 'README.md');

const failures = [];

function checkDocsFiles() {
  if (!fs.existsSync(docsDir)) {
    failures.push(`Docs directory not found at ${docsDir}`);
    return;
  }

  const docFiles = fs.readdirSync(docsDir);
  let found9222 = false;

  for (const file of docFiles) {
    const fullPath = path.join(docsDir, file);
    if (!fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    if (content.includes('8765')) {
      failures.push(`Found obsolete port '8765' in ${file}`);
    }
    if (content.includes('9222')) {
      found9222 = true;
    }
  }

  if (!found9222) {
    failures.push("Port '9222' not found anywhere in docs/");
  }
}

function checkLldHtml() {
  if (!fs.existsSync(lldHtmlPath)) {
    failures.push(`LLD HTML file not found at ${lldHtmlPath}`);
    return;
  }

  const lldContent = fs.readFileSync(lldHtmlPath, 'utf8');

  // (b) 'Decision Fusion' present in LLD html
  if (!lldContent.includes('Decision Fusion')) {
    failures.push("'Decision Fusion' not found in docs/lld-kevin-pipeline.html");
  }

  // (c) verify-loop wording present (match 'verified:false' or 'Verify' + 'maxAttempts')
  const hasVerifyFalse = lldContent.includes('verified:false') || lldContent.includes('verified: false');
  const hasVerifyMaxAttempts = lldContent.includes('Verify') && lldContent.includes('maxAttempts');
  if (!hasVerifyFalse && !hasVerifyMaxAttempts) {
    failures.push("Verify loop wording ('verified:false' or 'Verify' + 'maxAttempts') not found in docs/lld-kevin-pipeline.html");
  }

  // (d) stateful-stores wording present
  const hasStatefulStores = lldContent.includes('Stateful Stores') || 
    (lldContent.toLowerCase().includes('stateful') && lldContent.includes('inferSessions'));
  if (!hasStatefulStores) {
    failures.push("Stateful stores wording not found in docs/lld-kevin-pipeline.html");
  }
}

function checkReadme() {
  if (!fs.existsSync(readmePath)) {
    failures.push(`README file not found at ${readmePath}`);
    return;
  }

  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  // (e) README mentions kevin_infer
  if (!readmeContent.includes('kevin_infer')) {
    failures.push("README.md does not mention 'kevin_infer'");
  }
}

checkDocsFiles();
checkLldHtml();
checkReadme();

if (failures.length > 0) {
  console.error('Documentation verification failed:');
  for (const failure of failures) {
    console.error(` - ${failure}`);
  }
  process.exit(1);
} else {
  console.log('docs verification passed');
}
