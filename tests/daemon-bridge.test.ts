import { test } from 'node:test';
import assert from 'node:assert';
import { KevinDaemon, KevinDaemonClient } from '../packages/daemon/index.js';

function createMockPage(elements: any[] = []): any {
  const state = {
    url: 'https://store.example.com',
    title: 'Daemon Test Store',
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

test('Daemon: starts on ephemeral port and handles STATUS request', async () => {
  const daemon = new KevinDaemon({
    port: 0,
    mockPage: createMockPage()
  });

  const { port } = await daemon.start();
  assert.ok(port > 0, 'Port should be allocated');

  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  const status = await client.status();
  assert.strictEqual(status.success, true);
  assert.strictEqual(status.status, 'ready');

  client.close();
  await daemon.stop();
});

test('Daemon: orchestrates OBSERVE, PLAN, and ACT across WebSocket client', async () => {
  const mockPage = createMockPage([
    { id: 'cd-10', role: 'button', text: 'Buy Now', tag: 'button' }
  ]);

  const daemon = new KevinDaemon({
    port: 0,
    mockPage
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  // 1. Observe
  const obsRes = await client.observe();
  assert.strictEqual(obsRes.success, true);
  assert.strictEqual(obsRes.snapshot.title, 'Daemon Test Store');
  assert.strictEqual(obsRes.snapshot.elements.length, 1);

  // 2. Plan
  const planRes = await client.plan('Click Buy Now');
  assert.strictEqual(planRes.success, true);
  assert.strictEqual(planRes.plan.action, 'click');
  assert.strictEqual(planRes.plan.targetId, 'cd-10');
  assert.strictEqual(mockPage.state.clicks.length, 0);

  // 3. Act
  const actRes = await client.act('Click Buy Now');
  assert.strictEqual(actRes.success, true);
  assert.strictEqual(mockPage.state.clicks.length, 1);
  assert.ok(mockPage.state.clicks[0].includes('cd-10'));

  // 4. Navigate
  const navRes = await client.navigate('https://checkout.example.com');
  assert.strictEqual(navRes.success, true);
  assert.strictEqual(mockPage.state.url, 'https://checkout.example.com');

  client.close();
  await daemon.stop();
});

test('Daemon: handles malformed command payload gracefully', async () => {
  const daemon = new KevinDaemon({
    port: 0,
    mockPage: createMockPage()
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  const errRes = await client.send('UNKNOWN_TYPE', {});
  assert.strictEqual(errRes.success, false);
  assert.ok(errRes.error.includes('Unknown command type'));

  client.close();
  await daemon.stop();
});
