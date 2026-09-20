#!/usr/bin/env node
/**
 * CLI Entrypoint for Kevin MCP Server over Stdio.
 */

import readline from 'node:readline';
import { KevinMcpServer } from '../server.js';

const server = new KevinMcpServer({
  headless: true
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const request = JSON.parse(trimmed);
    const response = await server.handleMessage(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err: any) {
    const errResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err?.message || String(err)}` }
    };
    process.stdout.write(JSON.stringify(errResponse) + '\n');
  }
});

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});
