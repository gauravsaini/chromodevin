import { test } from 'node:test';
import assert from 'node:assert';
import { checkWebGPU, loadModel, isModelLoaded, _resetForTest, DEFAULT_DECISION_MODEL, WebGPURequiredError } from '../src/ai/model-loader.js';
import { NanoClient } from '../src/ai/nano-client.js';
import { WebGPUDecisionRunner } from '../packages/playwright/webgpu-runner.js';

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

test('WebGPUDecisionRunner: score() falls back to baseline with gpuSelected: false when WebGPU is unavailable or fails', async () => {
  const runner = new WebGPUDecisionRunner();
  const snapshot = {
    url: 'https://example.com',
    title: 'Test Page',
    elements: [
      { id: 'btn-1', role: 'button', text: 'Search' },
      { id: 'btn-2', role: 'button', text: 'Cancel' }
    ]
  };

  const result = await runner.score(snapshot, 'Click Search');
  assert.strictEqual(result.gpuSelected, false);
  assert.strictEqual(result.provider, 'systemone-js');
  assert.strictEqual(result.action.targetId, 'btn-1');

  // Verify evaluate failure also falls back to baseline with gpuSelected: false
  const failingRunner = new WebGPUDecisionRunner({
    page: {
      evaluate: async () => {
        throw new Error('WebGPU error');
      }
    }
  });
  const fallbackResult = await failingRunner.score(snapshot, 'Click Search');
  assert.strictEqual(fallbackResult.gpuSelected, false);
  assert.strictEqual(fallbackResult.provider, 'systemone-js');
  assert.strictEqual(fallbackResult.action.targetId, 'btn-1');
});

test('WebGPUDecisionRunner: retargets action to top candidate when GPU softmax selects different candidate', async () => {
  const snapshot = {
    url: 'https://example.com',
    title: 'Test Page',
    elements: [
      { id: 'btn-search', role: 'button', text: 'Search' },
      { id: 'btn-featured', role: 'button', text: 'Featured Products' }
    ]
  };

  // Mock page whose evaluate returns GPU compute selecting btn-featured instead of baseline btn-search
  const mockPage = {
    evaluate: async (_fn: any, args: any) => {
      return {
        success: true,
        adapter: 'apple-m3',
        topCandidateId: 'btn-featured',
        confidence: 0.965,
        action: args.baselineAction,
        answers: args.baselineAnswers
      };
    }
  };

  const runner = new WebGPUDecisionRunner({ page: mockPage });
  const result = await runner.score(snapshot, 'Click Search');

  assert.strictEqual(result.gpuSelected, true);
  assert.strictEqual(result.provider, 'webgpu');
  assert.strictEqual(result.action.action, 'click'); // preserved baseline action type
  assert.strictEqual(result.action.targetId, 'btn-featured'); // retargeted to top candidate
  assert.strictEqual(result.action.targetText, 'Featured Products');
  assert.strictEqual(result.confidence, 0.965);
});

