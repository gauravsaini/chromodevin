/**
 * Unit tests for Voice Policy Evaluator.
 * Validates deterministic gate evaluations and state transitions.
 */

import test from 'node:test';
import assert from 'node:assert';
import { evaluateVoicePolicy } from '../packages/core/agent/voice-policy.js';
import type { DOMSnapshot } from '../packages/core/types.js';

const mockSnapshot: DOMSnapshot & { searchBoxId?: string } = {
  url: 'https://en.wikipedia.org/wiki/Main_Page',
  title: 'Wikipedia',
  searchBoxId: 'e01',
  elements: [
    { id: 'e01', role: 'searchbox', text: 'Search Wikipedia', placeholder: 'Search Wikipedia' },
    { id: 'e02', role: 'link', text: 'Alan Turing' },
    { id: 'e03', role: 'link', text: 'Computer Science' }
  ]
};

test('evaluateVoicePolicy ignores non-browser chit-chat', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.1 },
      intent: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: {} }
    },
    snapshot: mockSnapshot
  });

  assert.strictEqual(res.decision, 'ignore');
  assert.ok(res.reasons.some((r) => r.name === 'is_command' && !r.pass));
});

test('evaluateVoicePolicy waits when command is incomplete', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'navigate_url', confidence: 0.9, probabilities: {} },
      complete: { type: 'noul', noul: 0.2 }
    },
    snapshot: mockSnapshot,
    silentMs: 100,
    isFinal: false
  });

  assert.strictEqual(res.decision, 'wait');
  assert.ok(res.reasons.some((r) => r.name === 'complete' && !r.pass));
});

test('evaluateVoicePolicy waits for payload silence on free text search', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'search_web', confidence: 0.9, probabilities: {} },
      complete: { type: 'noul', noul: 0.9 },
      text_span: { type: 'choice', choice: 'alan turing', confidence: 0.8, probabilities: {} }
    },
    snapshot: mockSnapshot,
    silentMs: 200, // < 600ms payload silence
    isFinal: false
  });

  assert.strictEqual(res.decision, 'wait');
  assert.ok(res.reasons.some((r) => r.name === 'payload_final' && !r.pass));
});

test('evaluateVoicePolicy acts when search query is followed by silence or marked final', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'search_web', confidence: 0.9, probabilities: {} },
      complete: { type: 'noul', noul: 0.9 },
      text_span: { type: 'choice', choice: 'alan turing', confidence: 0.8, probabilities: {} }
    },
    snapshot: mockSnapshot,
    silentMs: 700,
    isFinal: true
  });

  assert.strictEqual(res.decision, 'act');
  assert.strictEqual(res.action?.action, 'type');
  assert.strictEqual(res.action?.text, 'alan turing');
});

test('evaluateVoicePolicy triggers disambiguation on ambiguous click target', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'click_element', confidence: 0.9, probabilities: {} },
      complete: { type: 'noul', noul: 0.9 },
      target: {
        type: 'choice',
        choice: 'none',
        confidence: 0.2,
        probabilities: { e02: 0.4, e03: 0.35, none: 0.25 }
      }
    },
    snapshot: mockSnapshot,
    isFinal: true
  });

  assert.strictEqual(res.decision, 'disambiguate');
  assert.ok(Array.isArray(res.candidates));
  assert.strictEqual(res.candidates?.length, 2);
  assert.strictEqual(res.candidates?.[0].n, 1);
  assert.strictEqual(res.candidates?.[1].n, 2);
});

test('evaluateVoicePolicy requires confirmation for destructive actions', () => {
  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'click_element', confidence: 0.95, probabilities: {} },
      complete: { type: 'noul', noul: 0.95 },
      destructive: { type: 'noul', noul: 0.85 },
      target: {
        type: 'choice',
        choice: 'e02',
        confidence: 0.9,
        probabilities: { e02: 0.9 }
      }
    },
    snapshot: mockSnapshot,
    isFinal: true
  });

  assert.strictEqual(res.decision, 'confirm');
  assert.strictEqual(res.action?.risk?.risk, 'high');
});

test('evaluateVoicePolicy executes pending action on spoken confirm', () => {
  const pendingAction = {
    action: 'click' as const,
    targetId: 'e02',
    explanation: 'Click Delete Account'
  };

  const res = evaluateVoicePolicy({
    answers: {
      is_command: { type: 'noul', noul: 0.95 },
      intent: { type: 'choice', choice: 'confirm', confidence: 0.95, probabilities: {} },
      complete: { type: 'noul', noul: 0.9 }
    },
    snapshot: mockSnapshot,
    isFinal: true,
    pending: pendingAction
  });

  assert.strictEqual(res.decision, 'act');
  assert.strictEqual(res.action?.targetId, 'e02');
  assert.strictEqual(res.action?.risk?.requiresConfirmation, false);
});
