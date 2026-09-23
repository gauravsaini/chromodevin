import { test } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime, planActVerifyStep, verifyCondition } from '../src/agent/agent-runtime.js';
import type { ActionPayload, DOMSnapshot } from '../packages/core/types.js';

test('verify-fail triggers replan plus react (a)', async () => {
  const planGoals: string[] = [];
  const planContexts: any[] = [];
  const executedActions: ActionPayload[] = [];
  let snapshotCallCount = 0;

  // Mock NanoClient that plans based on goal/context
  const mockNanoClient = {
    planDecision: (goal: string, snapshot: DOMSnapshot, candidates: any[]) => {
      planGoals.push(goal);
      return {
        action: { action: 'click', targetId: 'chk-1', explanation: `Clicking chk-1 for: ${goal}` },
        answers: {}
      };
    }
  };

  // Mock Memory
  const recordedActions: Array<{ action: any; result: any }> = [];
  const mockMemory = {
    addTurn: () => {},
    recordAction: (action: any, result: any) => {
      recordedActions.push({ action, result });
    },
    getConversationSummary: () => ''
  };

  // Mock BrowserEngine
  const mockBrowserEngine = {
    perform: async (payload: ActionPayload) => {
      executedActions.push(payload);
      return { success: true, message: `Executed ${payload.action}` };
    }
  };

  const runtime = new AgentRuntime({
    nanoClient: mockNanoClient,
    memory: mockMemory,
    browserEngine: mockBrowserEngine,
    maxSteps: 10
  });

  // Snapshot transitions:
  // Initial: Task A unchecked
  // After act 1: Task A still unchecked (verify fails)
  // After act 2: Task A checked (verify succeeds)
  const getSnapshot = async (): Promise<DOMSnapshot> => {
    snapshotCallCount++;
    if (snapshotCallCount <= 2) {
      return {
        url: 'https://app.local',
        title: 'Todos',
        elements: [
          { id: 'chk-1', text: 'Task A', role: 'checkbox', checked: false }
        ]
      };
    }
    return {
      url: 'https://app.local',
      title: 'Todos',
      elements: [
        { id: 'chk-1', text: 'Task A', role: 'checkbox', checked: true }
      ]
    };
  };

  const result = await runtime.runTask('Task A is completed', {
    getSnapshot,
    requireVerify: true,
    maxAttempts: 3
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(executedActions.length, 2, 'Should execute 2 acts: initial act and react after failed verification');
  assert.strictEqual(recordedActions.length, 2);
  assert.strictEqual(planGoals.length, 2);
  assert.ok(planGoals[1].includes('Previous attempt failed') || planGoals[1].includes('Note: previous attempt failed'), 'Replan should include failure note');
});

test('first-try success short-circuits with verified:true (b)', async () => {
  const executedActions: ActionPayload[] = [];
  const planGoals: string[] = [];

  const mockNanoClient = {
    planDecision: (goal: string) => {
      planGoals.push(goal);
      return {
        action: { action: 'click', targetId: 'btn-search', explanation: 'Click search' },
        answers: {}
      };
    }
  };

  const mockMemory = {
    addTurn: () => {},
    recordAction: () => {},
    getConversationSummary: () => ''
  };

  const runtime = new AgentRuntime({
    nanoClient: mockNanoClient,
    memory: mockMemory,
    maxSteps: 10
  });

  // Snapshot immediately satisfies the condition
  const mockSnapshot: DOMSnapshot = {
    url: 'https://test.local',
    title: 'Test Page',
    elements: [
      { id: 'btn-item', text: 'Item', role: 'button' }
    ]
  };

  const result = await runtime.runTask('Item is visible', {
    getSnapshot: async () => mockSnapshot,
    executeAction: async (action) => {
      executedActions.push(action);
      return { success: true };
    },
    requireVerify: true,
    maxAttempts: 3
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(executedActions.length, 1, 'Should only execute once and short-circuit');
  assert.strictEqual(planGoals.length, 1);
});

test('persistent failure exhausts attempts and returns verified:false with bounded act count (c)', async () => {
  const executedActions: ActionPayload[] = [];
  const planGoals: string[] = [];

  const mockNanoClient = {
    planDecision: (goal: string) => {
      planGoals.push(goal);
      return {
        action: { action: 'click', targetId: 'chk-x', explanation: 'Attempting toggle' },
        answers: {}
      };
    }
  };

  const mockMemory = {
    addTurn: () => {},
    recordAction: () => {},
    getConversationSummary: () => ''
  };

  const runtime = new AgentRuntime({
    nanoClient: mockNanoClient,
    memory: mockMemory,
    maxSteps: 10
  });

  // Snapshot persistently fails verification (Task X remains unchecked)
  const mockSnapshot: DOMSnapshot = {
    url: 'https://app.local',
    title: 'Todos',
    elements: [
      { id: 'chk-x', text: 'Task X', role: 'checkbox', checked: false }
    ]
  };

  const maxAttempts = 3;
  const result = await runtime.runTask('Task X is completed', {
    getSnapshot: async () => mockSnapshot,
    executeAction: async (action) => {
      executedActions.push(action);
      return { success: true };
    },
    requireVerify: true,
    maxAttempts
  });

  assert.strictEqual(result.verified, false, 'Should report verified: false on exhaustion');
  assert.strictEqual(result.success, false, 'Should report success: false when verification is unsatisfied');
  assert.strictEqual(executedActions.length, maxAttempts, `Act count must be bounded exactly to maxAttempts (${maxAttempts})`);
  assert.strictEqual(planGoals.length, maxAttempts);
});

test('planActVerifyStep handles verify retry loop with mock dependencies', async () => {
  let actCount = 0;
  let snapshotPhase = 0;

  const res = await planActVerifyStep({
    goal: 'Task B is completed',
    condition: 'Task B is completed',
    maxAttempts: 3,
    nanoClient: {
      planDecision: (goal: string) => ({
        action: { action: 'click', targetId: 'chk-b' },
        answers: {}
      })
    },
    executeAction: async (action) => {
      actCount++;
      return { success: true };
    },
    getSnapshot: async () => {
      snapshotPhase++;
      return {
        url: 'https://app.local',
        title: 'App',
        elements: [
          { id: 'chk-b', text: 'Task B', role: 'checkbox', checked: snapshotPhase >= 2 }
        ]
      };
    }
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.verified, true);
  assert.strictEqual(actCount, 1);
});

test('planActVerifyStep bounded persistent failure returns verified:false', async () => {
  let actCount = 0;

  const res = await planActVerifyStep({
    goal: 'Task Never is completed',
    condition: 'Task Never is completed',
    maxAttempts: 2,
    nanoClient: {
      planDecision: () => ({
        action: { action: 'click', targetId: 'chk-never' },
        answers: {}
      })
    },
    executeAction: async () => {
      actCount++;
      return { success: true };
    },
    getSnapshot: async () => ({
      url: 'https://app.local',
      title: 'App',
      elements: [
        { id: 'chk-never', text: 'Task Never', role: 'checkbox', checked: false }
      ]
    })
  });

  assert.strictEqual(res.verified, false);
  assert.strictEqual(res.success, false);
  assert.strictEqual(actCount, 2);
  assert.strictEqual(res.attempts, 2);
});
