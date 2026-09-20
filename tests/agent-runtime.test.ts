import { test } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime, AgentState } from '../src/agent/agent-runtime.js';

test('AgentRuntime completes task with heuristic planner', async () => {
  const runtime = new AgentRuntime({ maxSteps: 4 });

  const mockSnapshot = {
    url: 'https://test.local',
    title: 'Test Page',
    elements: [
      { id: 'cd-1', tag: 'button', role: 'button', text: 'Search Now', rect: { x: 10, y: 10, width: 80, height: 30 } }
    ]
  };

  const executedActions: any[] = [];

  const result = await runtime.runTask('Click the search button', {
    getSnapshot: async () => mockSnapshot,
    executeAction: async (action: any) => {
      executedActions.push(action);
      return { success: true, message: `Executed ${action.action}` };
    },
    onStateChange: () => {},
    onLog: () => {}
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(executedActions.length > 0, true);
  assert.strictEqual(executedActions[0].action, 'click');
  assert.strictEqual(executedActions[0].targetId, 'cd-1');
});

test('AgentRuntime pauses for high-risk confirmation and aborts when denied', async () => {
  const runtime = new AgentRuntime({ maxSteps: 2 });

  const mockSnapshot = {
    url: 'https://shop.local',
    title: 'Checkout',
    elements: [
      { id: 'cd-9', tag: 'button', role: 'button', text: 'Confirm Purchase $500', rect: { x: 10, y: 10, width: 100, height: 40 } }
    ]
  };

  let confirmationRequested = false;

  const result = await runtime.runTask('Click confirm purchase', {
    getSnapshot: async () => mockSnapshot,
    executeAction: async () => ({ success: true }),
    onConfirmationRequired: async () => {
      confirmationRequested = true;
      return false; // User denies
    }
  });

  assert.strictEqual(confirmationRequested, true);
  assert.strictEqual(result.success, false);
  assert.strictEqual(runtime.state, AgentState.ABORTED);
});

test('AgentRuntime abort() cleanly stops execution loop', async () => {
  const runtime = new AgentRuntime({ maxSteps: 10 });
  runtime.abort();

  assert.strictEqual(runtime.aborted, true);
  assert.strictEqual(runtime.state, AgentState.ABORTED);
});
