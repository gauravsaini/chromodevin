import { test } from 'node:test';
import assert from 'node:assert';
import { VoiceStateMachine, InteractionState } from '../src/agent/voice-state-machine.js';

test('VoiceStateMachine transitions IDLE -> LISTENING -> ACTIONING -> LISTENING in continuous mode', () => {
  const log: string[] = [];
  const sm = new VoiceStateMachine({
    onEnterListening: () => log.push('enter_listening'),
    onEnterActioning: () => log.push('enter_actioning'),
    onEnterIdle: () => log.push('enter_idle')
  });

  assert.strictEqual(sm.current, InteractionState.IDLE);
  assert.strictEqual(sm.isIdle(), true);

  // 1. Start continuous listening
  sm.startListening(true);
  assert.strictEqual(sm.current, InteractionState.LISTENING);
  assert.strictEqual(sm.isListening(), true);
  assert.strictEqual(sm.isActioning(), false);

  // 2. Command received -> transitions to ACTIONING
  const accepted = sm.commandReceived('Search for Wikipedia');
  assert.strictEqual(accepted, true);
  assert.strictEqual(sm.current, InteractionState.ACTIONING);
  assert.strictEqual(sm.isListening(), false);
  assert.strictEqual(sm.isActioning(), true);

  // 3. Action completed -> toggles back to LISTENING because continuous is true
  sm.actionCompleted({ success: true });
  assert.strictEqual(sm.current, InteractionState.LISTENING);
  assert.strictEqual(sm.isListening(), true);

  // 4. Second command received -> transitions to ACTIONING again
  sm.commandReceived('Click link');
  assert.strictEqual(sm.current, InteractionState.ACTIONING);

  // 5. User clicks Stop -> returns to IDLE
  sm.stop();
  assert.strictEqual(sm.current, InteractionState.IDLE);
  assert.strictEqual(sm.isIdle(), true);

  assert.deepStrictEqual(log, [
    'enter_listening',
    'enter_actioning',
    'enter_listening',
    'enter_actioning',
    'enter_idle'
  ]);
});

test('VoiceStateMachine transitions to IDLE after action in non-continuous mode', () => {
  const sm = new VoiceStateMachine();
  sm.startListening(false);
  assert.strictEqual(sm.current, InteractionState.LISTENING);

  sm.commandReceived('Single command');
  assert.strictEqual(sm.current, InteractionState.ACTIONING);

  sm.actionCompleted({ success: true });
  assert.strictEqual(sm.current, InteractionState.IDLE);
});
