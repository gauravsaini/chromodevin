import { test } from 'node:test';
import assert from 'node:assert';
import { ContextMemory } from '../src/agent/context-memory.js';

test('ContextMemory records turns and retains sliding window', () => {
  const memory = new ContextMemory({ maxTurns: 3 });
  memory.addTurn('user', 'turn 1');
  memory.addTurn('agent', 'turn 2');
  memory.addTurn('user', 'turn 3');
  memory.addTurn('agent', 'turn 4');

  assert.strictEqual(memory.turns.length, 3);
  assert.strictEqual(memory.turns[0].text, 'turn 2');
  assert.strictEqual(memory.turns[2].text, 'turn 4');
});

test('ContextMemory resolves relative entity references', () => {
  const memory = new ContextMemory();
  const candidates: any[] = [
    { id: 'cd-10', text: 'Hotel Alpha' },
    { id: 'cd-20', text: 'Hotel Beta' },
    { id: 'cd-30', text: 'Hotel Gamma' }
  ];
  memory.updateCandidates(candidates);

  const first = memory.resolveEntityReference('Click the first one');
  assert.ok(first !== null);
  assert.strictEqual(first!.id, 'cd-10');

  const second = memory.resolveEntityReference('Open the second option');
  assert.ok(second !== null);
  assert.strictEqual(second!.id, 'cd-20');

  const last = memory.resolveEntityReference('Select the last link');
  assert.ok(last !== null);
  assert.strictEqual(last!.id, 'cd-30');
});

test('ContextMemory resolves pronouns referencing previous target', () => {
  const memory = new ContextMemory();
  const candidates: any[] = [
    { id: 'cd-10', text: 'Button A' },
    { id: 'cd-20', text: 'Button B' }
  ];
  memory.updateCandidates(candidates);
  memory.recordAction({ action: 'click', targetId: 'cd-20' });

  const resolved = memory.resolveEntityReference('Click that again', candidates);
  assert.ok(resolved !== null);
  assert.strictEqual(resolved!.id, 'cd-20');
});

test('ContextMemory remembers open tabs and switches active tab context seamlessly', () => {
  const memory = new ContextMemory();
  memory.rememberTab({ id: 101, url: 'https://en.wikipedia.org', title: 'Wikipedia', active: true });
  memory.rememberTab({ id: 102, url: 'https://github.com', title: 'GitHub', active: false });

  assert.strictEqual(memory.getOpenTabs().length, 2);
  assert.strictEqual(memory.getActiveTab()?.id, 101);

  memory.switchActiveTab(102);
  assert.strictEqual(memory.getActiveTab()?.id, 102);
  assert.strictEqual(memory.getActiveTab()?.url, 'https://github.com');
});

test('ContextMemory retains context when active tab is closed and elects remaining tab', () => {
  const memory = new ContextMemory();
  memory.rememberTab({ id: 201, url: 'https://docs.anthropic.com', title: 'Docs', active: true });
  memory.rememberTab({ id: 202, url: 'https://google.com', title: 'Google', active: false });

  // Close active tab 201
  const newActive = memory.forgetTab(201);
  assert.ok(newActive !== null);
  assert.strictEqual(newActive!.id, 202);
  assert.strictEqual(memory.getOpenTabs().length, 1);
  assert.strictEqual(memory.getTabHistory().length, 1);
  assert.strictEqual(memory.getTabHistory()[0].id, 201);
});
