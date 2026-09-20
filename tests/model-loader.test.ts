import { test } from 'node:test';
import assert from 'node:assert';

import {
  checkWebGPU,
  isModelLoaded,
  _resetForTest,
  SUPPORTED_DECISION_MODELS,
  DEFAULT_DECISION_MODEL
} from '../src/ai/model-loader.js';
import { PipelineHarness } from '../src/testing/agent-harness.js';
import { NanoClient } from '../src/ai/nano-client.js';

test('SUPPORTED_DECISION_MODELS registers receptron/laya-onnx as default and all models', () => {
  assert.strictEqual(DEFAULT_DECISION_MODEL, 'receptron/laya-onnx');
  assert.ok(SUPPORTED_DECISION_MODELS['laya-onnx']);
  assert.strictEqual(SUPPORTED_DECISION_MODELS['laya-onnx'].contract, '/v1/systemone');
  assert.strictEqual(SUPPORTED_DECISION_MODELS['laya-onnx'].id, 'receptron/laya-onnx');
  assert.ok(SUPPORTED_DECISION_MODELS['lfm2.5-350m-onnx']);
  assert.strictEqual(SUPPORTED_DECISION_MODELS['lfm2.5-350m-onnx'].contract, 'constrained-likelihood');
  assert.ok(SUPPORTED_DECISION_MODELS['lfm2.5-rlcd']);
  assert.strictEqual(SUPPORTED_DECISION_MODELS['lfm2.5-rlcd'].contract, 'constrained-likelihood');
  assert.ok(SUPPORTED_DECISION_MODELS['kev-0.6b']);
  assert.strictEqual(SUPPORTED_DECISION_MODELS['kev-0.6b'].contract, '/v1/systemone');
});

test('checkWebGPU returns unavailable in Node.js environment', async () => {
  const result = await checkWebGPU();
  assert.strictEqual(result.available, false);
  assert.ok(result.reason?.includes('WebGPU'));
});

test('checkWebGPU handles mock navigator.gpu successfully', async () => {
  if (!globalThis.navigator) {
    (globalThis as any).navigator = {};
  }
  const nav = (globalThis as any).navigator;
  const origDesc = Object.getOwnPropertyDescriptor(nav, 'gpu');
  try {
    Object.defineProperty(nav, 'gpu', {
      value: {
        requestAdapter: async () => ({
          name: 'Apple M-series GPU',
          features: new Set(['shader-f16'])
        })
      },
      configurable: true,
      writable: true
    });

    const result = await checkWebGPU();
    assert.strictEqual(result.available, true);
  } finally {
    if (origDesc) {
      Object.defineProperty(nav, 'gpu', origDesc);
    } else {
      try {
        delete nav.gpu;
      } catch {
        nav.gpu = undefined;
      }
    }
  }
});

test('isModelLoaded returns false before any load and updates after reset', () => {
  _resetForTest();
  assert.strictEqual(isModelLoaded(), false);
});

test('PipelineHarness leverages jaredpalmer/kev-0.6b decision model with WebGPU metadata', async () => {
  const mockSnapshot = {
    url: 'https://huggingface.co/jaredpalmer/kev-0.6b',
    title: 'Kev 0.6B Decision Model',
    elements: [
      { id: 'btn-readme', role: 'tab', text: 'Model card' },
      { id: 'btn-files', role: 'tab', text: 'Files' }
    ]
  };

  const mockKevWebGpuModel = {
    id: 'jaredpalmer/kev-0.6b',
    family: 'kev',
    baseModel: 'Qwen/Qwen3-0.6B-Base',
    contract: '/v1/systemone',
    device: 'webgpu',
    dtype: 'q4'
  };

  let capturedDecision: any = null;

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    model: mockKevWebGpuModel,
    onDecision: ({ answers, action }: any) => {
      capturedDecision = { answers, action };
    }
  });

  const trace = await harness.run('click Files tab');

  assert.strictEqual(trace.success, true);
  assert.strictEqual(trace.modelLoaded, true);
  assert.strictEqual(trace.payloads.length, 1);
  assert.strictEqual(trace.payloads[0].action, 'click');
  assert.strictEqual(trace.payloads[0].targetId, 'btn-files');

  // Verify Kev /v1/systemone answers & confidence were produced
  assert.ok(capturedDecision);
  assert.strictEqual(capturedDecision.answers.actionType.choice, 'click');
  assert.ok(capturedDecision.answers.actionType.confidence > 0);
  assert.strictEqual(capturedDecision.answers.targetElement.choice, 'btn-files');
});

test('PipelineHarness leverages notnotsamuel/LFM2.5-350M-RLCD decision model', async () => {
  const mockSnapshot = {
    url: 'https://huggingface.co/notnotsamuel/LFM2.5-350M-RLCD',
    title: 'LFM2.5 RLCD Decision Engine',
    elements: [
      { id: 'btn-benchmark', role: 'button', text: 'View Benchmark Report' }
    ]
  };

  const mockRlcdModel = {
    id: 'notnotsamuel/LFM2.5-350M-RLCD',
    family: 'rlcd',
    baseModel: 'LiquidAI/LFM2.5-350M',
    contract: 'constrained-likelihood',
    device: 'webgpu',
    dtype: 'q4'
  };

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    model: mockRlcdModel
  });

  const { passed, trace, errors } = await harness.verify('click View Benchmark Report', {
    actions: [{ action: 'click', targetId: 'btn-benchmark' }]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.modelLoaded, true);
  assert.strictEqual(trace.payloads[0].targetId, 'btn-benchmark');
});

test('PipelineHarness leverages NanoClient decision mode for complex workflow', async () => {
  const mockSnapshot = {
    url: 'https://docs.local',
    title: 'Documentation',
    elements: [
      { id: 'search-input', role: 'searchbox', text: 'Search docs', tag: 'input', type: 'search' },
      { id: 'link-guide', role: 'link', text: 'Getting Started Guide', tag: 'a' }
    ]
  };

  const client = new NanoClient({ mode: 'decision' });
  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify('search for WebGPU', {
    decomposed: ['search for WebGPU'],
    actions: [
      { action: 'type', targetId: 'search-input', text: 'WebGPU' }
    ]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.steps[0].action.pressEnter, true);
});

test('PipelineHarness leverages onnx-community/LFM2.5-350M-ONNX decision model', async () => {
  const mockSnapshot = {
    url: 'https://huggingface.co/onnx-community/LFM2.5-350M-ONNX',
    title: 'LFM2.5 350M ONNX WebGPU Model',
    elements: [
      { id: 'btn-tree', role: 'tab', text: 'Files tab' }
    ]
  };

  const mockOnnxModel = {
    id: 'onnx-community/LFM2.5-350M-ONNX',
    family: 'rlcd-decision',
    baseModel: 'LiquidAI/LFM2.5-350M',
    contract: 'constrained-likelihood',
    device: 'webgpu',
    dtype: 'q4'
  };

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    model: mockOnnxModel
  });

  const { passed, trace, errors } = await harness.verify('click Files tab', {
    actions: [{ action: 'click', targetId: 'btn-tree' }]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.modelLoaded, true);
  assert.strictEqual(trace.payloads[0].targetId, 'btn-tree');
  assert.strictEqual(trace.steps[0].decisionTelemetry.model, 'onnx-community/LFM2.5-350M-ONNX');
  assert.strictEqual(trace.steps[0].decisionTelemetry.contract, 'constrained-likelihood');
});

test('PipelineHarness leverages receptron/laya-onnx decision model', async () => {
  const mockSnapshot = {
    url: 'https://huggingface.co/receptron/laya-onnx',
    title: 'Laya ONNX Model',
    elements: [
      { id: 'btn-explore', role: 'button', text: 'Explore Architecture' }
    ]
  };

  const mockLayaModel = {
    id: 'receptron/laya-onnx',
    family: 'laya',
    baseModel: 'convaiinnovations/laya',
    contract: '/v1/systemone',
    device: 'webgpu',
    dtype: 'fp32'
  };

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    model: mockLayaModel
  });

  const { passed, trace, errors } = await harness.verify('click Explore Architecture', {
    actions: [{ action: 'click', targetId: 'btn-explore' }]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.modelLoaded, true);
  assert.strictEqual(trace.payloads[0].targetId, 'btn-explore');
  assert.strictEqual(trace.steps[0].decisionTelemetry.model, 'receptron/laya-onnx');
  assert.strictEqual(trace.steps[0].decisionTelemetry.family, 'laya');
  assert.strictEqual(trace.steps[0].decisionTelemetry.contract, '/v1/systemone');
});
