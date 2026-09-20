import { test } from 'node:test';
import assert from 'node:assert';
import { KevinMcpServer, handleJsonRpcRequest, MCP_TOOLS } from '../packages/mcp/index.js';

function createMockPage(elements: any[] = []): any {
  const state = {
    url: 'https://store.example.com',
    title: 'Kevin MCP Test Store',
    elements: [...elements] as any[],
    clicks: [] as string[],
    types: [] as any[]
  };

  return {
    state,
    url() { return state.url; },
    async title() { return state.title; },
    async goto(url: string) { state.url = url; },
    async evaluate(fn: any, arg?: any) {
      if (typeof fn === 'string') {
        return { url: state.url, title: state.title, elements: state.elements };
      }
      if (typeof fn === 'function') return fn(arg);
      return null;
    },
    locator(sel: string) {
      return {
        first() {
          return {
            async scrollIntoViewIfNeeded() {},
            async click() { state.clicks.push(sel); },
            async fill(text: string) { state.types.push({ sel, text }); },
            async press(key: string) { state.types.push({ sel, key }); }
          };
        }
      };
    }
  };
}

test('MCP: tools/list returns supported tools and schemas', async () => {
  const req = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const res = await handleJsonRpcRequest(req);

  assert.ok(res !== null);
  assert.strictEqual(res!.jsonrpc, '2.0');
  assert.strictEqual(res!.id, 1);
  assert.ok(Array.isArray(res!.result.tools));

  const names = res!.result.tools.map((t: any) => t.name);
  assert.ok(names.includes('kevin_act'));
  assert.ok(names.includes('kevin_observe'));
  assert.ok(names.includes('kevin_plan'));
  assert.ok(names.includes('kevin_navigate'));
});

test('MCP: initialize returns valid capabilities and server info', async () => {
  const req = { jsonrpc: '2.0', id: 2, method: 'initialize' };
  const res = await handleJsonRpcRequest(req);

  assert.ok(res !== null);
  assert.strictEqual(res!.jsonrpc, '2.0');
  assert.strictEqual(res!.id, 2);
  assert.strictEqual(res!.result.serverInfo.name, 'kevin-mcp');
  assert.ok(res!.result.capabilities.tools);
});

test('MCP: ping responds with empty result', async () => {
  const req = { jsonrpc: '2.0', id: 3, method: 'ping' };
  const res = await handleJsonRpcRequest(req);

  assert.ok(res !== null);
  assert.strictEqual(res!.jsonrpc, '2.0');
  assert.strictEqual(res!.id, 3);
  assert.deepStrictEqual(res!.result, {});
});

test('MCP: tools/call executes kevin_observe', async () => {
  const mockPage = createMockPage([
    { id: 'cd-1', role: 'button', text: 'Checkout', tag: 'button' }
  ]);

  const server = new KevinMcpServer({ page: mockPage });
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'kevin_observe',
      arguments: {}
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.jsonrpc, '2.0');
  assert.strictEqual(res!.id, 10);
  assert.strictEqual(res!.result.isError, false);

  const parsed = JSON.parse(res!.result.content[0].text);
  assert.strictEqual(parsed.title, 'Kevin MCP Test Store');
  assert.strictEqual(parsed.elements.length, 1);
});

test('MCP: tools/call executes kevin_plan without side effects', async () => {
  const mockPage = createMockPage([
    { id: 'cd-1', role: 'button', text: 'Submit Order', tag: 'button' }
  ]);

  const server = new KevinMcpServer({ page: mockPage });
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'kevin_plan',
      arguments: { goal: 'Click Submit Order' }
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.result.isError, false);
  const plan = JSON.parse(res!.result.content[0].text);
  assert.strictEqual(plan.action, 'click');
  assert.strictEqual(mockPage.state.clicks.length, 0);
});

test('MCP: tools/call executes kevin_act side effect', async () => {
  const mockPage = createMockPage([
    { id: 'cd-2', role: 'button', text: 'Add to Cart', tag: 'button' }
  ]);

  const server = new KevinMcpServer({ page: mockPage });
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 12,
    method: 'tools/call',
    params: {
      name: 'kevin_act',
      arguments: { goal: 'Click Add to Cart' }
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.result.isError, false);
  assert.strictEqual(mockPage.state.clicks.length, 1);
  assert.ok((mockPage.state.clicks[0] as string).includes('cd-2'));
});

test('MCP: handles unknown tool error properly', async () => {
  const mockPage = createMockPage();
  const server = new KevinMcpServer({ page: mockPage });
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 13,
    method: 'tools/call',
    params: {
      name: 'non_existent_tool',
      arguments: {}
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.result.isError, true);
  assert.ok(res!.result.content[0].text.includes('Unsupported tool'));
});
