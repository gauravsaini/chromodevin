#!/usr/bin/env node
/**
 * Validate MCP Server claims:
 * 1. JSON-RPC 2.0 protocol compliance (initialize, tools/list, tools/call, ping)
 * 2. Tool definitions have proper schemas
 * 3. kevin_observe, kevin_act, kevin_plan, kevin_navigate execute correctly
 * 4. Error handling for unknown tools and missing arguments
 * 5. Stdio CLI binary exists and is a valid entrypoint
 */

import { createMockPage, assert, report } from './helpers.js';
import {
  KevinMcpServer,
  handleJsonRpcRequest,
  MCP_TOOLS
} from '../packages/mcp/index.js';
import fs from 'node:fs';
import path from 'node:path';

console.log('\n🔌 MCP SERVER VALIDATION');
console.log('─'.repeat(50));

// ── 1. MCP_TOOLS export shape ────────────────────────
console.log('\n📋 Tool Definitions');

assert(Array.isArray(MCP_TOOLS), 'MCP_TOOLS is an array');
assert(MCP_TOOLS.length === 4, 'Exactly 4 tools defined', `found ${MCP_TOOLS.length}`);

const toolNames = MCP_TOOLS.map((t) => t.name);
assert(toolNames.includes('kevin_act'), 'kevin_act tool exists');
assert(toolNames.includes('kevin_observe'), 'kevin_observe tool exists');
assert(toolNames.includes('kevin_plan'), 'kevin_plan tool exists');
assert(toolNames.includes('kevin_navigate'), 'kevin_navigate tool exists');

for (const tool of MCP_TOOLS) {
  assert(typeof tool.description === 'string' && tool.description.length > 10, `${tool.name} has meaningful description`);
  assert(tool.inputSchema && tool.inputSchema.type === 'object', `${tool.name} has object inputSchema`);
}

report('Tool Definitions');

// ── 2. JSON-RPC Protocol Compliance ──────────────────
console.log('\n📡 JSON-RPC Protocol');

const initRes = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
assert(initRes?.jsonrpc === '2.0', 'initialize: jsonrpc 2.0');
assert(initRes?.id === 1, 'initialize: id echoed');
assert(initRes?.result?.protocolVersion === '2024-11-05', 'initialize: protocol version');
assert(initRes?.result?.serverInfo?.name === 'kevin-mcp', 'initialize: server name');
assert(initRes?.result?.capabilities?.tools !== undefined, 'initialize: tools capability');

const pingRes = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 2, method: 'ping' });
assert(pingRes?.id === 2 && JSON.stringify(pingRes?.result) === '{}', 'ping: empty result');

const listRes = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
assert(listRes?.result?.tools?.length === 4, 'tools/list: returns 4 tools');

const unknownRes = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 4, method: 'nonexistent/method' });
assert(unknownRes?.error?.code === -32601, 'Unknown method: -32601 error');

const nullRes = await handleJsonRpcRequest(null);
assert(nullRes?.error?.code === -32700, 'Null payload: -32700 parse error');

const notifRes = await handleJsonRpcRequest({ method: 'notifications/initialized' });
assert(notifRes === null, 'Notification: returns null (no response)');

report('JSON-RPC Protocol');

// ── 3. KevinMcpServer Tool Execution ─────────────────
console.log('\n⚡ Tool Execution');

const mockPage = createMockPage([
  { id: 'cd-1', role: 'button', text: 'Buy Now', tag: 'button' },
  { id: 'cd-2', role: 'textbox', text: '', tag: 'input', placeholder: 'Search...' },
  { id: 'cd-3', role: 'link', text: 'About Us', tag: 'a' }
]);
const server = new KevinMcpServer({ page: mockPage });

// kevin_observe
const obsRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 10,
  method: 'tools/call',
  params: { name: 'kevin_observe', arguments: {} }
});
assert(obsRes?.result?.isError === false, 'kevin_observe: no error');
const obsData = JSON.parse(obsRes?.result?.content?.[0]?.text || '{}');
assert(obsData.title === 'Test Shop', 'kevin_observe: correct title');
assert(obsData.elements?.length === 3, 'kevin_observe: sees 3 elements');

// kevin_plan (no side effects)
const planRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 11,
  method: 'tools/call',
  params: { name: 'kevin_plan', arguments: { goal: 'Click Buy Now' } }
});
assert(planRes?.result?.isError === false, 'kevin_plan: no error');
const planData = JSON.parse(planRes?.result?.content?.[0]?.text || '{}');
assert(planData.action === 'click', 'kevin_plan: plans click action');
assert(mockPage.state.clicks.length === 0, 'kevin_plan: zero side effects');

// kevin_act (with side effects)
const actRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 12,
  method: 'tools/call',
  params: { name: 'kevin_act', arguments: { goal: 'Click Buy Now' } }
});
assert(actRes?.result?.isError === false, 'kevin_act: no error');
assert(mockPage.state.clicks.length === 1, 'kevin_act: click happened');

// kevin_navigate
const navRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 13,
  method: 'tools/call',
  params: { name: 'kevin_navigate', arguments: { url: 'https://other.test.com' } }
});
assert(navRes?.result?.isError === false, 'kevin_navigate: no error');
assert(mockPage.state.url === 'https://other.test.com', 'kevin_navigate: URL changed');

// Unknown tool error
const badRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 14,
  method: 'tools/call',
  params: { name: 'totally_fake_tool', arguments: {} }
});
assert(badRes?.result?.isError === true, 'Unknown tool: returns isError=true');

// Missing tool name
const noNameRes = await server.handleMessage({
  jsonrpc: '2.0',
  id: 15,
  method: 'tools/call',
  params: { arguments: {} }
});
assert(noNameRes?.error?.code === -32602, 'Missing tool name: -32602 error');

report('Tool Execution');

// ── 4. CLI Entrypoint ────────────────────────────────
console.log('\n📂 CLI Entrypoint');

const cliPath = path.resolve(import.meta.dirname || '.', '..', 'packages/mcp/bin/kevin-mcp.ts');
assert(fs.existsSync(cliPath), 'kevin-mcp.ts CLI file exists');

const cliContent = fs.readFileSync(cliPath, 'utf-8');
assert(cliContent.startsWith('#!/usr/bin/env node'), 'CLI has shebang');
assert(cliContent.includes('KevinMcpServer'), 'CLI imports KevinMcpServer');
assert(cliContent.includes('readline'), 'CLI uses readline for stdio');

report('CLI Entrypoint');

// ── 5. Close ─────────────────────────────────────────
await server.close();
console.log('\n✅ MCP validation complete.\n');
