import test from 'node:test';
import assert from 'node:assert';
import { PipelineHarness, AgentTestHarness } from '../src/testing/agent-harness.js';
import { NanoClient } from '../src/ai/nano-client.js';

test('Browser Tab Pipeline Harness: executes end-to-end trace with WebGPU decision model', async () => {
  const mockSnapshot = {
    url: 'https://en.wikipedia.org',
    title: 'Wikipedia, the free encyclopedia',
    elements: [
      { id: 'cd-1', tag: 'input', role: 'searchbox', text: 'Search Wikipedia', placeholder: 'Search Wikipedia', type: 'search' },
      { id: 'cd-2', tag: 'button', role: 'button', text: 'Search', type: 'submit' },
      { id: 'cd-3', tag: 'a', role: 'link', text: 'Main page', href: '/wiki/Main_Page' }
    ]
  };

  const simulatedExecutedActions: any[] = [];
  const simulatedBrowserEngine = {
    perform: async (payload: any) => {
      simulatedExecutedActions.push(payload);
      return { success: true, message: `Simulated browser executed: ${payload.action}` };
    }
  };

  const harness = new PipelineHarness({
    initialSnapshot: mockSnapshot,
    browserEngine: simulatedBrowserEngine as any
  });

  const trace = await harness.run('search for WebGPU and click search');

  assert.strictEqual(trace.success, true);
  assert.strictEqual(trace.decomposed.length, 2);
  assert.strictEqual(trace.steps.length, 2);

  // Step 1: Type WebGPU into searchbox
  const step1 = trace.steps[0];
  assert.strictEqual(step1.action.action, 'type');
  assert.strictEqual(step1.action.targetId, 'cd-1');
  assert.ok(step1.decisionAnswers.actionType);
  assert.strictEqual(step1.risk.risk, 'low');

  // Step 2: Click search button
  const step2 = trace.steps[1];
  assert.strictEqual(step2.action.action, 'click');
  assert.strictEqual(step2.action.targetId, 'cd-2');
  assert.strictEqual(step2.risk.risk, 'low');
});

test('Browser Tab Pipeline Harness: assertion gate verifies passed expectations', async () => {
  const mockSnapshot = {
    url: 'https://store.local/item',
    title: 'Product Page',
    elements: [
      { id: 'cd-1', tag: 'button', role: 'button', text: 'Add to Cart', type: 'button' },
      { id: 'cd-2', tag: 'a', role: 'link', text: 'Checkout', href: '/checkout' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: mockSnapshot });

  const verification = await harness.verify('Click Add to Cart', {
    decomposed: ['Click Add to Cart'],
    actions: [{ action: 'click', targetId: 'cd-1' }],
    maxRisk: 'low'
  });

  assert.strictEqual(verification.passed, true);
  assert.strictEqual(verification.errors.length, 0);
});

test('Browser Tab Pipeline Harness: assertion gate catches risk and action mismatches', async () => {
  const mockSnapshot = {
    url: 'https://app.local/settings',
    title: 'Settings',
    elements: [
      { id: 'cd-1', tag: 'button', role: 'button', text: 'Delete Account Permanently', type: 'button' }
    ]
  };

  const harness = new PipelineHarness({ initialSnapshot: mockSnapshot });

  // Negative control: Expecting low risk for high-risk action should fail assertion gate
  const verification = await harness.verify('Delete my account permanently', {
    maxRisk: 'low'
  });

  assert.strictEqual(verification.passed, false);
  assert.ok(verification.errors.some((err) => err.includes('exceeded max risk')));
});
