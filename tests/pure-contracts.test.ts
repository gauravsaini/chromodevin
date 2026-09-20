import { test } from 'node:test';
import assert from 'node:assert';

import { decomposeCommand } from '../src/agent/plan-decomposer.js';
import { resolveEntityReference } from '../src/agent/context-memory.js';
import { rankCandidates } from '../src/perception/decision-engine.js';
import { validateAction } from '../src/actions/action-schema.js';
import { classifyActionRisk } from '../src/security/risk-classifier.js';
import { planActionStep } from '../src/agent/agent-runtime.js';
import { BrowserEngine } from '../src/actions/browser-engine.js';
import { browserDecision } from '../src/ai/decision-model.js';

test('LLD Box 1 [Decomposer]: pure input/output contract', () => {
  const input = 'Open wikipedia.org and search for WebGPU then click first result';
  const out1 = decomposeCommand(input);
  const out2 = decomposeCommand(input);

  assert.deepStrictEqual(out1, ['Open wikipedia.org', 'search for WebGPU', 'click first result']);
  assert.deepStrictEqual(out1, out2, 'Idempotent and pure');
});

test('LLD Box 2 [Entity Resolver]: pure input/output contract without hidden state', () => {
  const candidates: any[] = [
    { id: 'cd-1', text: 'First Article' },
    { id: 'cd-2', text: 'Second Article' },
    { id: 'cd-3', text: 'Third Article' }
  ];

  // Ordinal resolution
  const res1 = resolveEntityReference('Click the second article', candidates, null);
  assert.strictEqual(res1?.id, 'cd-2');

  // Pronoun resolution with explicit lastTarget contract
  const res2 = resolveEntityReference('Click it', candidates, { id: 'cd-3' });
  assert.strictEqual(res2?.id, 'cd-3');

  // No match
  const res3 = resolveEntityReference('Click tenth item', candidates, null);
  assert.strictEqual(res3, null);
});

test('LLD Box 3 [Candidate Ranker]: pure input/output contract', () => {
  const candidates: any[] = [
    { id: 'btn-search', role: 'button', text: 'Search', type: 'submit' },
    { id: 'link-home', role: 'link', text: 'Home', href: '/' }
  ];

  const res1 = rankCandidates({
    context: { url: 'https://test.local', title: 'Home' },
    candidates,
    question: 'Search website',
    topK: 1
  });

  assert.strictEqual(res1.topCandidates.length, 1);
  assert.strictEqual(res1.topCandidates[0].id, 'btn-search');
  assert.ok(res1.ranked[0].score > res1.ranked[1].score);
});

test('LLD Box 4 [Action Validator]: pure schema validation contract', () => {
  const valid = validateAction({ action: 'click', targetId: 'cd-5' });
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.action?.action, 'click');
  assert.strictEqual(valid.action?.targetId, 'cd-5');

  const invalid = validateAction({ action: 'click' });
  assert.strictEqual(invalid.valid, false);
  assert.ok(invalid.error);
});

test('LLD Box 5 [Risk Classifier]: pure security gate contract', () => {
  const safeAction = { action: 'scroll' as const, direction: 'down' as const };
  const safeRes = classifyActionRisk(safeAction, null);
  assert.strictEqual(safeRes.requiresConfirmation, false);
  assert.strictEqual(safeRes.risk, 'low');

  const highRiskAction = { action: 'click' as const, text: 'Confirm purchase $299' };
  const highRiskRes = classifyActionRisk(highRiskAction, { text: 'Confirm purchase $299' });
  assert.strictEqual(highRiskRes.requiresConfirmation, true);
  assert.strictEqual(highRiskRes.risk, 'high');
});

test('LLD Box 6 [Action Planner]: pure step payload generation', async () => {
  const snapshot = {
    url: 'https://docs.local',
    title: 'Documentation',
    elements: [
      { id: 'btn-search', role: 'searchbox', text: 'Search docs', type: 'search' }
    ]
  };

  const payload = await planActionStep({
    goal: 'Type WebGPU into search docs',
    snapshot
  });

  assert.strictEqual(payload.action, 'type');
  assert.strictEqual(payload.targetId, 'btn-search');
  assert.strictEqual(payload.text, 'WebGPU');
  assert.strictEqual(payload.risk?.requiresConfirmation, false);
});

test('LLD Box 7 [Browser Engine]: strict payload execution boundary', async () => {
  const executed: any[] = [];
  const engine = new BrowserEngine({
    executor: async (payload: any) => {
      executed.push(payload);
      return { success: true, message: `Executed ${payload.action}` };
    }
  });

  const res = await engine.perform({ action: 'click', targetId: 'btn-1' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(executed.length, 1);
  assert.strictEqual(executed[0].targetId, 'btn-1');

  // Rejects invalid payload
  const errRes = await engine.perform(null as any);
  assert.strictEqual(errRes.success, false);
});

test('LLD Box 8 [Decision Model]: pure input/output contract (Kev / RLCD System 1 scoring)', () => {
  const state = {
    goal: 'Click Download Link',
    url: 'https://download.local',
    title: 'Download Page',
    elements: [
      { id: 'btn-dl', tag: 'a', role: 'button', text: 'Download Now' },
      { id: 'btn-back', tag: 'button', role: 'button', text: 'Cancel' }
    ]
  };

  const res1 = browserDecision({ state });
  const res2 = browserDecision({ state });

  // Pure function contract: identical outputs for identical inputs
  assert.deepStrictEqual(res1, res2);

  // Contract: typed answers with probabilities + validated action
  assert.strictEqual(res1.action.action, 'click');
  assert.strictEqual(res1.action.targetId, 'btn-dl');
  assert.strictEqual(res1.answers.actionType.type, 'choice');
  assert.strictEqual(res1.answers.actionType.choice, 'click');
  assert.ok(res1.answers.actionType.confidence > 0);
  const targetAnswer = res1.answers.targetElement as any;
  assert.ok(targetAnswer.probabilities['btn-dl'] > targetAnswer.probabilities['btn-back']);
});
