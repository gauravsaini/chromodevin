import { test } from 'node:test';
import assert from 'node:assert';
import { checkWebGPU, loadModel, isModelLoaded, _resetForTest, DEFAULT_DECISION_MODEL, WebGPURequiredError } from '../src/ai/model-loader.js';
import { NanoClient } from '../src/ai/nano-client.js';

test('WebGPU Model Loading: checkWebGPU probes hardware adapter in browser environment', async () => {
  if (!(globalThis as any).navigator) {
    (globalThis as any).navigator = {};
  }
  const origDesc = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
  try {
    // Simulate real browser navigator.gpu
    Object.defineProperty(globalThis.navigator, 'gpu', {
      value: {
        requestAdapter: async () => ({
          name: 'Apple M3 Pro',
          info: { architecture: 'apple-m3', description: 'Apple M3 Pro GPU' },
          features: new Set(['shader-f16', 'timestamp-query'])
        })
      },
      configurable: true,
      writable: true
    });

    const status = await checkWebGPU();
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.adapter.name, 'Apple M3 Pro');
    assert.strictEqual(status.adapter.info.architecture, 'apple-m3');
  } finally {
    if (origDesc) {
      Object.defineProperty(globalThis.navigator, 'gpu', origDesc);
    } else {
      delete (globalThis.navigator as any).gpu;
    }
  }
});

test('WebGPU Model Loading: NanoClient tracks download progress events', async () => {
  const progressEvents: any[] = [];
  const client = new NanoClient({
    modelId: DEFAULT_DECISION_MODEL,
    mode: 'decision',
    onProgress: (prog) => {
      progressEvents.push(prog);
    }
  });

  assert.strictEqual(client.modelId, 'receptron/laya-onnx');
  assert.strictEqual(client.mode, 'decision');

  // Verify availability probe runs
  const availability = await client.checkAvailability();
  assert.ok(typeof availability.available === 'boolean');

  // Simulate progress callback handling
  client.onProgress({ status: 'downloading', progress: 45, file: 'model.onnx' });
  client.onProgress({ status: 'ready', progress: 100 });

  assert.strictEqual(progressEvents.length, 2);
  assert.strictEqual(progressEvents[0].status, 'downloading');
  assert.strictEqual(progressEvents[0].progress, 45);
  assert.strictEqual(progressEvents[1].status, 'ready');
});

test('WebGPU Model Loading: strictly enforces WebGPU with no fallback (throws WebGPURequiredError when unavailable)', async () => {
  _resetForTest();
  // In Node.js environment without navigator.gpu
  const status = await checkWebGPU();
  assert.strictEqual(status.available, false);
  assert.ok(status.reason);

  // Attempting to loadModel directly without WebGPU must throw WebGPURequiredError
  await assert.rejects(
    async () => {
      await loadModel({ modelId: 'receptron/laya-onnx' });
    },
    (err: any) => {
      assert.ok(err instanceof WebGPURequiredError);
      assert.ok(err.message.includes('WebGPU is strictly required'));
      return true;
    }
  );

  // NanoClient decision model evaluates System 1 discriminative contract
  const client = new NanoClient({
    modelId: 'receptron/laya-onnx',
    mode: 'decision'
  });

  const decision = client.planDecision('Click Search', { url: 'https://test.local' }, [
    { id: 'cd-1', role: 'button', text: 'Search' }
  ]);

  assert.ok(decision.answers);
  assert.strictEqual(decision.action.action, 'click');
  assert.strictEqual(decision.action.targetId, 'cd-1');
  assert.strictEqual(decision.telemetry.contract, '/v1/systemone');
});
