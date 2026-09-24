import { test } from 'node:test';
import assert from 'node:assert';
import { KevinDaemon, KevinDaemonClient } from '../packages/daemon/index.js';
import { KevinMcpServer, handleJsonRpcRequest } from '../packages/mcp/index.js';
import { PlaywrightBrowserEngine } from '../packages/playwright/index.js';

function createMockPage(initialUrl = 'https://store.example.com'): any {
  const state = {
    url: initialUrl,
    title: 'URL Policy Test Page',
    elements: [] as any[],
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

test('Daemon: NAVIGATE blocks javascript: URL and rejects with error', async () => {
  const mockPage = createMockPage();
  const daemon = new KevinDaemon({
    port: 0,
    mockPage
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  try {
    // Attempt NAVIGATE with javascript: pseudo-protocol
    const navRes = await client.navigate('javascript:alert(document.cookie)');
    assert.strictEqual(navRes.success, false);
    assert.ok(navRes.error);
    assert.match(navRes.error, /javascript/i);
    assert.strictEqual(mockPage.state.url, 'https://store.example.com', 'Page URL must remain unchanged');

    // Attempt OBSERVE with javascript: URL
    const obsRes = await client.send('OBSERVE', { url: 'javascript:alert(1)' });
    assert.strictEqual(obsRes.success, false);
    assert.ok(obsRes.error);
    assert.match(obsRes.error, /javascript/i);

    // Attempt PLAN with javascript: URL
    const planRes = await client.send('PLAN', { goal: 'Search', url: 'javascript:alert(1)' });
    assert.strictEqual(planRes.success, false);
    assert.ok(planRes.error);
    assert.match(planRes.error, /javascript/i);

    // Attempt ACT with javascript: URL
    const actRes = await client.send('ACT', { goal: 'Click button', url: 'javascript:alert(1)' });
    assert.strictEqual(actRes.success, false);
    assert.ok(actRes.error);
    assert.match(actRes.error, /javascript/i);

    // Valid HTTPS navigation succeeds
    const validRes = await client.navigate('https://checkout.example.com');
    assert.strictEqual(validRes.success, true);
    assert.strictEqual(mockPage.state.url, 'https://checkout.example.com');
  } finally {
    client.close();
    await daemon.stop();
  }
});

test('MCP: kevin_navigate blocks file: URL and returns -32602 invalid params', async () => {
  const mockPage = createMockPage();
  const server = new KevinMcpServer({ page: mockPage });

  try {
    // 1. handleMessage tools/call with file: URL returns -32602
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'kevin_navigate',
        arguments: { url: 'file:///etc/passwd' }
      }
    });

    assert.ok(res !== null);
    assert.strictEqual(res!.id, 101);
    assert.ok(res!.error, 'Expected error in JSON-RPC response');
    assert.strictEqual(res!.error?.code, -32602);
    assert.match(res!.error?.message || '', /file/i);
    assert.strictEqual(mockPage.state.url, 'https://store.example.com', 'Page URL must remain unchanged');

    // 2. handleJsonRpcRequest directly with file: URL returns -32602
    const rpcRes = await handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'kevin_navigate',
        arguments: { url: 'file:///etc/shadow' }
      }
    }, {
      executeTool: (name: string, args?: Record<string, any>) => server.executeTool(name, args)
    });

    assert.ok(rpcRes !== null);
    assert.strictEqual(rpcRes!.id, 102);
    assert.strictEqual(rpcRes!.error?.code, -32602);
    assert.match(rpcRes!.error?.message || '', /file/i);

    // 3. executeTool directly with file: URL throws error with code -32602
    await assert.rejects(
      async () => {
        await server.executeTool('kevin_navigate', { url: 'file:///etc/passwd' });
      },
      (err: any) => {
        assert.strictEqual(err.code, -32602);
        assert.match(err.message, /file/i);
        return true;
      }
    );

    // 4. kevin_act / observe / plan with blocked file: URL returns -32602
    const actRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'kevin_act',
        arguments: { goal: 'Exploit', url: 'file:///etc/passwd' }
      }
    });
    assert.strictEqual(actRes?.error?.code, -32602);

    const obsRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 104,
      method: 'tools/call',
      params: {
        name: 'kevin_observe',
        arguments: { url: 'file:///etc/passwd' }
      }
    });
    assert.strictEqual(obsRes?.error?.code, -32602);

    const planRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 105,
      method: 'tools/call',
      params: {
        name: 'kevin_plan',
        arguments: { goal: 'Plan file access', url: 'file:///etc/passwd' }
      }
    });
    assert.strictEqual(planRes?.error?.code, -32602);
  } finally {
    await server.close();
  }
});

test('Driver: navigate action blocks chrome: and internal browser scheme URLs', async () => {
  const mockPage = createMockPage();
  const engine = new PlaywrightBrowserEngine(mockPage);

  // 1. Block chrome:// URL
  const chromeRes = await engine.perform({
    action: 'navigate',
    url: 'chrome://settings'
  });
  assert.strictEqual(chromeRes.success, false);
  assert.ok(chromeRes.error);
  assert.match(chromeRes.error!, /chrome/i);
  assert.strictEqual(mockPage.state.url, 'https://store.example.com', 'Page URL must not change to chrome://');

  // 2. Block chrome-extension:// URL
  const extRes = await engine.perform({
    action: 'navigate',
    url: 'chrome-extension://abcdefghijklm/manifest.json'
  });
  assert.strictEqual(extRes.success, false);
  assert.ok(extRes.error);
  assert.match(extRes.error!, /chrome-extension/i);

  // 3. Block devtools:// URL
  const devtoolsRes = await engine.perform({
    action: 'navigate',
    url: 'devtools://devtools/bundled/inspector.html'
  });
  assert.strictEqual(devtoolsRes.success, false);
  assert.ok(devtoolsRes.error);
  assert.match(devtoolsRes.error!, /devtools/i);

  // 4. Valid HTTPS navigation succeeds
  const validRes = await engine.perform({
    action: 'navigate',
    url: 'https://docs.example.com/api'
  });
  assert.strictEqual(validRes.success, true);
  assert.strictEqual(mockPage.state.url, 'https://docs.example.com/api');
});
