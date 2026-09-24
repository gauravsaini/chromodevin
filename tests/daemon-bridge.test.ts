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

test('Daemon auth: rejects unauthenticated requests when authToken is configured and accepts valid token', async () => {
  const secret = 'super-secret-token-1234';
  const daemon = new KevinDaemon({
    port: 0,
    authToken: secret,
    mockPage: createMockPage()
  });

  const { port } = await daemon.start();

  // 1. Client without token rejected
  const unauthClient = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await unauthClient.connect();
  const unauthRes = await unauthClient.status();
  assert.strictEqual(unauthRes.success, false);
  assert.ok(/unauthorized/i.test(unauthRes.error));
  unauthClient.close();

  // 2. Client with invalid token rejected
  const badAuthClient = new KevinDaemonClient(`ws://127.0.0.1:${port}`, { token: 'wrong-token' });
  await badAuthClient.connect();
  const badRes = await badAuthClient.status();
  assert.strictEqual(badRes.success, false);
  assert.ok(/unauthorized/i.test(badRes.error));
  badAuthClient.close();

  // 3. Client with valid token accepted
  const authClient = new KevinDaemonClient(`ws://127.0.0.1:${port}`, { token: secret });
  await authClient.connect();
  const okRes = await authClient.status();
  assert.strictEqual(okRes.success, true);
  assert.strictEqual(okRes.status, 'ready');
  authClient.close();

  await daemon.stop();
});

test('Daemon auth: supports KEVIN_DAEMON_TOKEN environment variable', async () => {
  process.env.KEVIN_DAEMON_TOKEN = 'env-token-secret-999';
  try {
    const daemon = new KevinDaemon({
      port: 0,
      mockPage: createMockPage()
    });

    const { port } = await daemon.start();

    // Client without token rejected
    const unauthClient = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
    await unauthClient.connect();
    const unauthRes = await unauthClient.status();
    assert.strictEqual(unauthRes.success, false);
    assert.ok(/unauthorized/i.test(unauthRes.error));
    unauthClient.close();

    // Client with valid token accepted
    const authClient = new KevinDaemonClient(`ws://127.0.0.1:${port}`, { token: 'env-token-secret-999' });
    await authClient.connect();
    const okRes = await authClient.status();
    assert.strictEqual(okRes.success, true);
    assert.strictEqual(okRes.status, 'ready');
    authClient.close();

    await daemon.stop();
  } finally {
    delete process.env.KEVIN_DAEMON_TOKEN;
  }
});

test('Daemon: rejects oversized payload exceeding 256KB', async () => {
  const daemon = new KevinDaemon({
    port: 0,
    mockPage: createMockPage()
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  const oversizedData = 'A'.repeat(300 * 1024);
  const res = await client.send('PING', { data: oversizedData });

  assert.strictEqual(res.success, false);
  assert.ok(/exceeds/i.test(res.error));
  assert.ok(/256/i.test(res.error));

  client.close();
  await daemon.stop();
});

test('Daemon: concurrent ACTs on same tab serialize (order preserved)', async () => {
  const state = {
    url: 'https://store.example.com',
    title: 'Daemon Test Store',
    elements: [
      { id: 'cd-1', role: 'button', text: 'Step 1', tag: 'button' },
      { id: 'cd-2', role: 'button', text: 'Step 2', tag: 'button' },
      { id: 'cd-3', role: 'button', text: 'Step 3', tag: 'button' }
    ] as any[],
    clicks: [] as string[],
    types: [] as any[]
  };

  const executionLog: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;

  const mockPage = {
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
            async click() {
              concurrent++;
              if (concurrent > maxConcurrent) maxConcurrent = concurrent;
              executionLog.push(`start:${sel}`);
              await new Promise((r) => setTimeout(r, 30));
              executionLog.push(`end:${sel}`);
              state.clicks.push(sel);
              concurrent--;
            },
            async fill(text: string) { state.types.push({ sel, text }); },
            async press(key: string) { state.types.push({ sel, key }); }
          };
        }
      };
    }
  };

  const daemon = new KevinDaemon({
    port: 0,
    mockPage
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  // Dispatch 3 ACTs concurrently without awaiting
  const p1 = client.act('Click Step 1');
  const p2 = client.act('Click Step 2');
  const p3 = client.act('Click Step 3');

  // Verify concurrent PING executes while ACTs are processing
  const pingRes = await client.send('PING');
  assert.strictEqual(pingRes.success, true);

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  assert.strictEqual(r1.success, true);
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r3.success, true);

  assert.strictEqual(maxConcurrent, 1, 'Concurrent ACTs must not overlap execution');
  assert.strictEqual(executionLog.length, 6);
  assert.ok(executionLog[0].startsWith('start:') && executionLog[0].includes('cd-1'));
  assert.ok(executionLog[1].startsWith('end:') && executionLog[1].includes('cd-1'));
  assert.ok(executionLog[2].startsWith('start:') && executionLog[2].includes('cd-2'));
  assert.ok(executionLog[3].startsWith('end:') && executionLog[3].includes('cd-2'));
  assert.ok(executionLog[4].startsWith('start:') && executionLog[4].includes('cd-3'));
  assert.ok(executionLog[5].startsWith('end:') && executionLog[5].includes('cd-3'));

  client.close();
  await daemon.stop();
});

test('Daemon: port-conflict start failure cleans up', async () => {
  const daemon1 = new KevinDaemon({
    port: 0,
    mockPage: createMockPage()
  });

  const { port } = await daemon1.start();
  assert.ok(port > 0, 'daemon1 should obtain an ephemeral port');
  assert.ok(daemon1.wss !== null, 'daemon1 wss should be active');

  const daemon2 = new KevinDaemon({
    port,
    mockPage: createMockPage()
  });

  // Attempting to bind to the same port must fail with EADDRINUSE
  await assert.rejects(
    async () => {
      await daemon2.start();
    },
    (err: any) => {
      assert.strictEqual(err.code, 'EADDRINUSE');
      return true;
    }
  );

  // Ensure daemon2 cleaned up and its wss is null
  assert.strictEqual(daemon2.wss, null, 'daemon2.wss must be null after failed startup');

  // Stop daemon1 to free up the port
  await daemon1.stop();
  assert.strictEqual(daemon1.wss, null);

  // Now daemon2 can successfully start on the now-freed port
  const started2 = await daemon2.start();
  assert.strictEqual(started2.port, port);
  assert.ok(daemon2.wss !== null);
  await daemon2.stop();
  assert.strictEqual(daemon2.wss, null);
});

test('Daemon: enforces per-connection rate limit', async () => {
  const daemon = new KevinDaemon({
    port: 0,
    rateLimit: 5,
    mockPage: createMockPage()
  });

  const { port } = await daemon.start();
  const client = new KevinDaemonClient(`ws://127.0.0.1:${port}`);
  await client.connect();

  for (let i = 0; i < 5; i++) {
    const res = await client.send('PING');
    assert.strictEqual(res.success, true);
  }

  const rateLimitRes = await client.send('PING');
  assert.strictEqual(rateLimitRes.success, false);
  assert.ok(/rate limit/i.test(rateLimitRes.error));

  client.close();
  await daemon.stop();
});

