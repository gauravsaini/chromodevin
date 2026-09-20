import { test } from 'node:test';
import assert from 'node:assert';

import { PipelineHarness } from '../src/testing/agent-harness.js';
import { NanoClient } from '../src/ai/nano-client.js';
import { AgentRuntime } from '../src/agent/agent-runtime.js';
import { SUPPORTED_DECISION_MODELS } from '../src/ai/model-loader.js';

test('Extension Pathway: receptron/laya-onnx default decision model executes clicks and calibrated scoring', async () => {
  const snapshot = {
    url: 'https://huggingface.co/receptron/laya-onnx',
    title: 'receptron/laya-onnx · Hugging Face',
    elements: [
      { id: 'item-1', tag: 'a', role: 'link', text: 'laya-onnx Model Card' },
      { id: 'item-2', tag: 'a', role: 'link', text: 'WebGPU Benchmarks' }
    ]
  };

  const client = new NanoClient({
    mode: 'decision' // uses DEFAULT_DECISION_MODEL = 'receptron/laya-onnx'
  });

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify(
    'click laya-onnx Model Card',
    {
      decomposed: ['click laya-onnx Model Card'],
      actions: [
        { action: 'click', targetId: 'item-1' }
      ]
    }
  );

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].action, 'click');
  assert.strictEqual(trace.payloads[0].targetId, 'item-1');

  // Verify Laya decision outputs and telemetry
  const decision = trace.steps[0].decisionAnswers;
  assert.strictEqual(decision.actionType.choice, 'click');
  assert.ok(decision.actionType.confidence > 0.85);
  assert.strictEqual(decision.targetElement.choice, 'item-1');
  assert.strictEqual(trace.steps[0].decisionTelemetry.model, 'receptron/laya-onnx');
  assert.strictEqual(trace.steps[0].decisionTelemetry.family, 'laya');
  assert.strictEqual(trace.steps[0].decisionTelemetry.contract, '/v1/systemone');
});

test('Extension Pathway: onnx-community/LFM2.5-350M-ONNX decision model executes clicks and calibrated scoring', async () => {
  const snapshot = {
    url: 'https://huggingface.co/onnx-community',
    title: 'ONNX Community Models',
    elements: [
      { id: 'item-1', tag: 'a', role: 'link', text: 'LFM2.5-350M-ONNX Model Card' },
      { id: 'item-2', tag: 'a', role: 'link', text: 'WebGPU Benchmarks' }
    ]
  };

  const client = new NanoClient({
    modelId: 'onnx-community/LFM2.5-350M-ONNX',
    mode: 'decision'
  });

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify(
    'click LFM2.5-350M-ONNX Model Card',
    {
      decomposed: ['click LFM2.5-350M-ONNX Model Card'],
      actions: [
        { action: 'click', targetId: 'item-1' }
      ]
    }
  );

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].action, 'click');
  assert.strictEqual(trace.payloads[0].targetId, 'item-1');

  // Verify RLCD decision outputs and telemetry
  const decision = trace.steps[0].decisionAnswers;
  assert.strictEqual(decision.actionType.choice, 'click');
  assert.ok(decision.actionType.confidence > 0.85);
  assert.strictEqual(decision.targetElement.choice, 'item-1');
  assert.strictEqual(trace.steps[0].decisionTelemetry.model, 'onnx-community/LFM2.5-350M-ONNX');
  assert.strictEqual(trace.steps[0].decisionTelemetry.family, 'rlcd-decision');
});

test('Extension Pathway: jaredpalmer/kev-0.6b decision model executes navigation and clicks', async () => {
  const snapshot = {
    url: 'https://news.ycombinator.com',
    title: 'Hacker News',
    elements: [
      { id: 'item-1', tag: 'a', role: 'link', text: 'Show HN: Kev — Fast Browser Decision Models' },
      { id: 'item-2', tag: 'a', role: 'link', text: 'Ask HN: Favorite WebGPU libraries?' }
    ]
  };

  const client = new NanoClient({
    modelId: 'jaredpalmer/kev-0.6b',
    mode: 'decision'
  });

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify(
    'click Show HN: Kev — Fast Browser Decision Models',
    {
      decomposed: ['click Show HN: Kev — Fast Browser Decision Models'],
      actions: [
        { action: 'click', targetId: 'item-1' }
      ]
    }
  );

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].action, 'click');
  assert.strictEqual(trace.payloads[0].targetId, 'item-1');

  // Verify Kev decision outputs
  const decision = trace.steps[0].decisionAnswers;
  assert.strictEqual(decision.actionType.choice, 'click');
  assert.ok(decision.actionType.confidence > 0.85);
  assert.strictEqual(decision.targetElement.choice, 'item-1');
  assert.strictEqual(trace.steps[0].decisionTelemetry.family, 'kev');
});


test('Extension Pathway: notnotsamuel/LFM2.5-350M-RLCD executes search and type workflow', async () => {
  const snapshot = {
    url: 'https://github.com/search',
    title: 'Code Search · GitHub',
    elements: [
      { id: 'gh-search', tag: 'input', role: 'searchbox', name: 'q', placeholder: 'Search GitHub' },
      { id: 'filter-repo', tag: 'button', text: 'Repositories' }
    ]
  };

  const client = new NanoClient({
    modelId: 'notnotsamuel/LFM2.5-350M-RLCD',
    mode: 'decision'
  });

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify('search for LFM2.5-350M', {
    decomposed: ['search for LFM2.5-350M'],
    actions: [
      { action: 'type', targetId: 'gh-search', text: 'LFM2.5-350M', pressEnter: true }
    ]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].text, 'LFM2.5-350M');
  assert.strictEqual(trace.payloads[0].pressEnter, true);
});

test('Extension Pathway: receptron/laya-onnx decision model executes button click', async () => {
  const snapshot = {
    url: 'https://github.com/receptron/laya',
    title: 'receptron/laya · GitHub',
    elements: [
      { id: 'star-btn', tag: 'button', text: 'Star this repo' },
      { id: 'fork-btn', tag: 'button', text: 'Fork repository' }
    ]
  };

  const client = new NanoClient({
    modelId: 'receptron/laya-onnx',
    mode: 'decision'
  });

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: client
  });

  const { passed, trace, errors } = await harness.verify('click Star this repo', {
    decomposed: ['click Star this repo'],
    actions: [
      { action: 'click', targetId: 'star-btn' }
    ]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].action, 'click');
  assert.strictEqual(trace.payloads[0].targetId, 'star-btn');
  assert.strictEqual(trace.steps[0].decisionTelemetry.model, 'receptron/laya-onnx');
  assert.strictEqual(trace.steps[0].decisionTelemetry.family, 'laya');
  assert.strictEqual(trace.steps[0].decisionTelemetry.contract, '/v1/systemone');
});


test('Extension Pathway: multi-step compound goal executed end-to-end via AgentRuntime', async () => {
  const snapshots = [
    { url: 'about:blank', title: 'New Tab', elements: [] },
    {
      url: 'https://www.google.com',
      title: 'Google',
      elements: [{ id: 'q-input', tag: 'input', role: 'searchbox', name: 'q' }]
    },
    {
      url: 'https://www.google.com/search?q=WebGPU',
      title: 'WebGPU - Google Search',
      elements: [{ id: 'res-link-1', tag: 'a', role: 'link', text: 'WebGPU - Web APIs | MDN' }]
    }
  ];

  let stepCount = 0;
  const client = new NanoClient({ mode: 'decision' }); // defaults to onnx-community/LFM2.5-350M-ONNX
  const harness = new PipelineHarness({

    nanoClient: client,
    getSnapshot: () => snapshots[Math.min(stepCount++, snapshots.length - 1)]
  });

  const trace = await harness.run('open google.com and search for WebGPU then click first result');

  assert.strictEqual(trace.success, true);
  assert.strictEqual(trace.decomposed.length, 3);
  assert.deepStrictEqual(trace.decomposed, [
    'open google.com',
    'search for WebGPU',
    'click first result'
  ]);

  assert.strictEqual(trace.payloads[0].action, 'navigate');
  assert.strictEqual(trace.payloads[0].url, 'https://www.google.com');

  // Search on Google optimizes to direct search navigation or searchbox typing
  const searchPayload = trace.payloads[1];
  assert.ok(
    (searchPayload.action === 'navigate' && searchPayload.url?.includes('WebGPU')) ||
    (searchPayload.action === 'type' && searchPayload.text === 'WebGPU')
  );

  assert.strictEqual(trace.payloads[2].action, 'click');
  assert.strictEqual(trace.payloads[2].targetId, 'res-link-1');
});
