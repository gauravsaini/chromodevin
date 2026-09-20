import { test } from 'node:test';
import assert from 'node:assert';

import { PipelineHarness } from '../src/testing/agent-harness.js';
import { NanoClient } from '../src/ai/nano-client.js';
import { checkWebGPU, isModelLoaded } from '../src/ai/model-loader.js';

test('PipelineHarness Scenario 1: direct URL navigation', async () => {
  const harness = new PipelineHarness();
  const { passed, trace, errors } = await harness.verify('open github.com', {
    decomposed: ['open github.com'],
    actions: [{ action: 'navigate', url: 'https://github.com' }]
  });
  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].url, 'https://github.com');
});

test('PipelineHarness Scenario 2: search on docs with searchbox detection', async () => {
  const snapshot = {
    url: 'https://developer.mozilla.org/en-US/',
    title: 'MDN Web Docs',
    elements: [
      { id: 'search-input', tag: 'input', role: 'searchbox', placeholder: 'Site search...' },
      { id: 'nav-link', tag: 'a', role: 'link', text: 'Curriculum' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: snapshot });
  const { passed, trace, errors } = await harness.verify('search for WebGPU shaders', {
    actions: [
      { action: 'type', targetId: 'search-input', text: 'WebGPU shaders', pressEnter: true }
    ]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.steps[0].decisionAnswers.searchIntent.noul, 0.9);
});

test('PipelineHarness Scenario 3: button interaction with candidate scoring', async () => {
  const snapshot = {
    url: 'https://repl.local',
    title: 'Code Playground',
    elements: [
      { id: 'btn-run', tag: 'button', role: 'button', text: 'Run Code' },
      { id: 'btn-clear', tag: 'button', role: 'button', text: 'Clear Console' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: snapshot });
  const { passed, trace, errors } = await harness.verify('click Run Code', {
    actions: [
      { action: 'click', targetId: 'btn-run' }
    ]
  });

  assert.strictEqual(passed, true, errors.join(', '));
  assert.ok(trace.steps[0].decisionAnswers.actionType.confidence > 0.8);
});

test('PipelineHarness Scenario 4: compound multi-step chained workflow', async () => {
  const snapshots = [
    { url: 'about:blank', title: 'New Tab', elements: [] },
    {
      url: 'https://www.youtube.com',
      title: 'YouTube',
      elements: [{ id: 'yt-search', tag: 'input', role: 'searchbox', name: 'search_query' }]
    },
    {
      url: 'https://www.youtube.com/results?search_query=LFM2.5',
      title: 'YouTube Search',
      elements: [{ id: 'video-thumb-1', tag: 'a', role: 'link', text: 'LFM2.5 Architecture Explained' }]
    }
  ];

  let currentStep = 0;
  const harness = new PipelineHarness({
    getSnapshot: () => snapshots[Math.min(currentStep++, snapshots.length - 1)]
  });

  const { passed, trace, errors } = await harness.verify(
    'open youtube.com and search for LFM2.5 then click first video',
    {
      decomposed: ['open youtube.com', 'search for LFM2.5', 'click first video'],
      actions: [
        { action: 'navigate', url: 'https://www.youtube.com' },
        { action: 'type', targetId: 'yt-search', text: 'LFM2.5' },
        { action: 'click', targetId: 'video-thumb-1' }
      ]
    }
  );

  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads.length, 3);
});

test('PipelineHarness Scenario 5: pronoun reference resolution across steps', async () => {
  const snapshot = {
    url: 'https://articles.local',
    title: 'News',
    elements: [
      { id: 'art-1', tag: 'a', role: 'link', text: 'WebGPU in 2026' },
      { id: 'art-2', tag: 'a', role: 'link', text: 'Transformers.js v4' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: snapshot });
  const trace = await harness.run('click WebGPU in 2026 and click it');

  assert.strictEqual(trace.decomposed.length, 2);
  assert.strictEqual(trace.payloads[0].targetId, 'art-1');
  assert.strictEqual(trace.payloads[1].targetId, 'art-1', 'Pronoun "it" resolved to previous target');
});

test('PipelineHarness Scenario 6: high-risk action confirmation gate', async () => {
  const snapshot = {
    url: 'https://shop.local/cart',
    title: 'Checkout',
    elements: [
      { id: 'btn-pay', tag: 'button', role: 'button', text: 'Confirm purchase $500' }
    ]
  };

  let confirmationPrompted = false;
  const harness = new PipelineHarness({
    initialSnapshot: snapshot
  });

  // Test approval
  const approveTrace = await harness.run('click Confirm purchase $500', {
    onConfirmationRequired: async ({ risk }: { risk: any }) => {
      confirmationPrompted = true;
      assert.strictEqual(risk.risk, 'high');
      return true; // Approve
    }
  });

  assert.strictEqual(confirmationPrompted, true);
  assert.strictEqual(approveTrace.success, true);
  assert.strictEqual(approveTrace.payloads[0].targetId, 'btn-pay');

  // Test denial
  const denyTrace = await harness.run('click Confirm purchase $500', {
    onConfirmationRequired: async () => false // Deny
  });

  assert.strictEqual(denyTrace.success, false);
  assert.strictEqual(denyTrace.steps[0].aborted, true);
});

test('PipelineHarness Scenario 7: scrolling and page traversal', async () => {
  const harness = new PipelineHarness();
  const { passed, trace, errors } = await harness.verify('scroll down', {
    actions: [{ action: 'scroll', direction: 'down' }]
  });
  assert.strictEqual(passed, true, errors.join(', '));
  assert.strictEqual(trace.payloads[0].direction, 'down');
});

test('PipelineHarness Scenario 8: Kev-style custom question answering in decision model', async () => {
  const snapshot = {
    url: 'https://news.local',
    title: 'Tech News',
    elements: [{ id: 'link-ai', text: 'AI Research Updates' }]
  };

  const customQuestions = {
    category: {
      type: 'choice',
      options: ['tech', 'sports', 'entertainment']
    },
    isInformational: {
      type: 'noul',
      prompt: 'read'
    }
  };

  const harness = new PipelineHarness({ initialSnapshot: snapshot });
  const trace = await harness.run('read tech AI updates', {
    questions: customQuestions
  });

  const answers = trace.steps[0].decisionAnswers;
  assert.ok(answers.category);
  assert.strictEqual(answers.category.choice, 'tech');
  assert.ok(answers.category.probabilities.tech > answers.category.probabilities.sports);
  assert.strictEqual(answers.isInformational.noul, 0.85);
});
