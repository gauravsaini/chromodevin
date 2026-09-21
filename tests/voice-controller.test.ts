/**
 * Unit tests for VoiceBrowserController.
 * Verifies debounced streaming, continuation breath, and zero-model candidate pick.
 */

import test from 'node:test';
import assert from 'node:assert';
import { VoiceBrowserController } from '../packages/playwright/voice-controller.js';
import type { ActionPayload } from '../packages/core/types.js';

function createMockPage() {
  return {
    url: () => 'https://example.com',
    evaluate: async (fn: any, ...args: any[]) => true,
    waitForLoadState: async () => {},
    locator: () => ({
      first: () => ({
        isVisible: async () => true,
        scrollIntoViewIfNeeded: async () => {},
        click: async () => {}
      })
    })
  };
}

test('VoiceBrowserController handles partial transcripts and debounces decision call', async () => {
  const page = createMockPage();
  let decideCalled = 0;

  const controller = new VoiceBrowserController({
    page,
    debounceMs: 50,
    decideFn: () => {
      decideCalled++;
      return {
        answers: {
          is_command: { type: 'noul', noul: 0.95 },
          intent: { type: 'choice', choice: 'scroll_down', confidence: 0.9, probabilities: {} },
          complete: { type: 'noul', noul: 0.9 },
          scroll_amount: { type: 'score', score: 1, confidence: 0.8, probabilities: [0.1, 0.8, 0.1] },
          tab_direction: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: {} }
        },
        candidates: { text: [], url: [] },
        latencyMs: 5,
        telemetry: { model: 'mock', family: 'mock', mode: 'test', forwardCalls: 1 }
      };
    }
  });

  await controller.start();

  // Stream word by word
  controller.handleTranscript({ text: 'scroll', final: false, utteranceId: 'utt-1' });
  controller.handleTranscript({ text: 'scroll down', final: false, utteranceId: 'utt-1' });

  assert.strictEqual(decideCalled, 0, 'Should not decide immediately before debounce window');

  await new Promise((r) => setTimeout(r, 80));

  assert.strictEqual(decideCalled, 1, 'Should call decide after debounce window expires');
  await controller.close();
});

test('VoiceBrowserController handles multi-command breath continuation', async () => {
  const page = createMockPage();
  const executedActions: ActionPayload[] = [];

  const controller = new VoiceBrowserController({
    page,
    debounceMs: 30,
    decideFn: (input) => {
      const lower = input.transcript.toLowerCase();
      const isGoTo = lower.includes('go to');
      return {
        answers: {
          is_command: { type: 'noul', noul: 0.95 },
          intent: { type: 'choice', choice: isGoTo ? 'navigate_url' : 'scroll_down', confidence: 0.95, probabilities: {} },
          site: { type: 'choice', choice: isGoTo ? 'wikipedia' : 'none', confidence: 0.9, probabilities: {} },
          complete: { type: 'noul', noul: 0.95 },
          scroll_amount: { type: 'score', score: 1, confidence: 0.8, probabilities: [0.1, 0.8, 0.1] },
          tab_direction: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: {} }
        },
        candidates: { text: [], url: [] },
        latencyMs: 4,
        telemetry: { model: 'mock', family: 'mock', mode: 'test', forwardCalls: 1 }
      };
    },
    executeFn: async (action) => {
      executedActions.push(action);
      return { success: true };
    }
  });

  await controller.start();

  // First command in breath
  controller.handleTranscript({ text: 'go to wikipedia', final: false, utteranceId: 'breath-1' });
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(executedActions.length, 1);
  assert.strictEqual(executedActions[0].action, 'navigate');

  // Continuation of speech in the exact same utterance breath
  controller.handleTranscript({ text: 'go to wikipedia and scroll down', final: false, utteranceId: 'breath-1' });
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(executedActions.length, 2);
  assert.strictEqual(executedActions[1].action, 'scroll');

  await controller.close();
});

test('VoiceBrowserController executes candidate by spoken number with zero model calls', async () => {
  const page = createMockPage();
  let modelCalls = 0;
  const executedActions: ActionPayload[] = [];

  const controller = new VoiceBrowserController({
    page,
    debounceMs: 30,
    decideFn: () => {
      modelCalls++;
      throw new Error('Model should NOT be called for candidate number pick');
    },
    executeFn: async (action) => {
      executedActions.push(action);
      return { success: true };
    }
  });

  await controller.start();

  // Pre-seed active disambiguation candidates
  controller.candidates = {
    list: [
      { id: 'e01', label: 'First Link', n: 1, p: 0.5 },
      { id: 'e02', label: 'Second Link', n: 2, p: 0.4 }
    ],
    intent: { intentName: 'click_element' },
    at: Date.now()
  };

  // User speaks "the second one"
  controller.handleTranscript({ text: 'the second one', final: true, utteranceId: 'pick-1' });
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(modelCalls, 0, 'Zero model calls made');
  assert.strictEqual(executedActions.length, 1, 'Action executed');
  assert.strictEqual(executedActions[0].targetId, 'e02', 'Targeted candidate 2');

  await controller.close();
});
