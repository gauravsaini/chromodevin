import { test } from 'node:test';
import assert from 'node:assert';
import { AgentTestHarness, PipelineHarness } from '../src/testing/agent-harness.js';
import { BrowserEngine } from '../src/actions/browser-engine.js';

test('AgentTestHarness plans pure action payload without performing browser action', async () => {
  const mockSnapshot = {
    url: 'https://harness.test',
    title: 'Harness Test Page',
    elements: [
      { id: 'btn-1', tag: 'button', text: 'Search Wikipedia' },
      { id: 'inp-1', tag: 'input', placeholder: 'Enter query' }
    ]
  };

  let actionExecuted = false;
  const harness = new AgentTestHarness({
    initialSnapshot: mockSnapshot,
    onAction: () => {
      actionExecuted = true;
      return { success: true };
    }
  });

  // 1. Generate payload only (pure decision step)
  const payload = await harness.plan('Click search wikipedia');

  assert.strictEqual(actionExecuted, false, 'Browser action should not execute during plan()');
  assert.strictEqual(payload.action, 'click');
  assert.strictEqual(payload.targetId, 'btn-1');
  assert.ok(payload.explanation);
  assert.strictEqual(payload.risk?.requiresConfirmation, false);
});

test('BrowserEngine performs action payload independently', async () => {
  const executed: any[] = [];
  const engine = new BrowserEngine({
    executor: async (payload: any) => {
      executed.push(payload);
      return { success: true, message: `Mocked ${payload.action}` };
    }
  });

  const res = await engine.perform({ action: 'scroll', direction: 'down', amount: 300 });
  assert.strictEqual(res.success, true);
  assert.strictEqual(executed.length, 1);
  assert.strictEqual(executed[0].action, 'scroll');
  assert.strictEqual(executed[0].amount, 300);
});

test('AgentTestHarness runs multi-step goal collecting all payloads', async () => {
  const mockSnapshot = {
    url: 'https://harness.test',
    title: 'Store',
    elements: [
      { id: 'search-box', tag: 'input', role: 'searchbox', text: 'Search products' },
      { id: 'cart-btn', tag: 'button', text: 'View Cart' }
    ]
  };

  const harness = new AgentTestHarness({ initialSnapshot: mockSnapshot });
  const { result, payloads } = await harness.run('Scroll down then click search products');

  assert.strictEqual(result.success, true);
  assert.ok(payloads.length >= 2, 'Should have generated payloads for multi-stage command');
  assert.strictEqual(payloads[0].action, 'scroll');
  assert.strictEqual(payloads[1].action, 'click');
  assert.strictEqual(payloads[1].targetId, 'search-box');
});

test('PipelineHarness hooks into decomposer state and verifies results at browser action state', async () => {
  const mockSnapshot = {
    url: 'https://example.com',
    title: 'Example Domain',
    elements: [
      { id: 'search-inp', tag: 'input', role: 'searchbox', text: 'Search Query' },
      { id: 'submit-btn', tag: 'button', role: 'button', text: 'Submit' }
    ]
  };

  let hookedDecomposed: string[] | null = null;
  const hookedActions: any[] = [];

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    onDecompose: ({ subGoals }: { subGoals: string[] }) => {
      hookedDecomposed = [...subGoals];
    },
    onBrowserAction: ({ subGoal, payload, result }: any) => {
      hookedActions.push({ subGoal, payload, result });
    }
  });

  const trace = await harness.run('open wikipedia.org and scroll down');

  // 1. Verify decomposer hook was triggered
  assert.deepStrictEqual(hookedDecomposed, ['open wikipedia.org', 'scroll down']);
  assert.strictEqual(trace.decomposed.length, 2);

  // 2. Verify browser action hook was triggered for each stage
  assert.strictEqual(hookedActions.length, 2);
  assert.strictEqual(hookedActions[0].payload.action, 'navigate');
  assert.strictEqual(hookedActions[0].payload.url, 'https://www.wikipedia.org');
  assert.strictEqual(hookedActions[0].result.success, true);

  assert.strictEqual(hookedActions[1].payload.action, 'scroll');
  assert.strictEqual(hookedActions[1].payload.direction, 'down');
  assert.strictEqual(hookedActions[1].result.success, true);
});

test('PipelineHarness traces decision model probabilities and choices', async () => {
  const mockSnapshot = {
    url: 'https://test.local',
    title: 'Test',
    elements: [
      { id: 'btn-yes', role: 'button', text: 'Yes Confirm' },
      { id: 'btn-no', role: 'button', text: 'Cancel' }
    ]
  };

  const decisionAnswers: any[] = [];
  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    onDecision: ({ answers }: any) => {
      decisionAnswers.push(answers);
    }
  });

  await harness.run('click Yes Confirm');

  assert.strictEqual(decisionAnswers.length, 1);
  const decision = decisionAnswers[0];
  assert.strictEqual(decision.actionType.choice, 'click');
  assert.ok(decision.actionType.confidence > 0);
  assert.strictEqual(decision.targetElement.choice, 'btn-yes');
});

test('PipelineHarness declarative verify() succeeds on match and fails on mismatch', async () => {
  const mockSnapshot = {
    url: 'https://test.local',
    title: 'Test',
    elements: [
      { id: 'btn-buy', role: 'button', text: 'Buy Now' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: mockSnapshot });

  // Matching expectations
  const matchRes = await harness.verify('go to google and click Buy Now', {
    decomposed: ['go to google', 'click Buy Now'],
    actions: [
      { action: 'navigate', url: 'https://www.google.com' },
      { action: 'click', targetId: 'btn-buy' }
    ],
    maxRisk: 'high'
  });

  assert.strictEqual(matchRes.passed, true);
  assert.strictEqual(matchRes.errors.length, 0);

  // Mismatching expectations
  const failRes = await harness.verify('go to google', {
    actions: [
      { action: 'scroll' } // Expected scroll, but will be navigate
    ]
  });

  assert.strictEqual(failRes.passed, false);
  assert.ok(failRes.errors.length > 0);
});
