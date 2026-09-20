import { test } from 'node:test';
import assert from 'node:assert';
import { ContextMemory } from '../src/agent/context-memory.js';

test('Tab Memory: maintains registry of open tabs and tracks active status', () => {
  const memory = new ContextMemory();

  // Add 3 open tabs
  memory.rememberTab({ id: 1, url: 'https://news.ycombinator.com', title: 'Hacker News', active: false });
  memory.rememberTab({ id: 2, url: 'https://github.com/trending', title: 'GitHub Trending', active: true });
  memory.rememberTab({ id: 3, url: 'https://docs.anthropic.com', title: 'Anthropic Docs', active: false });

  const openTabs = memory.getOpenTabs();
  assert.strictEqual(openTabs.length, 3);
  assert.strictEqual(memory.getActiveTab()?.id, 2);
  assert.strictEqual(memory.getActiveTab()?.title, 'GitHub Trending');
});

test('Tab Memory: switching active tab updates active state and candidate tracking', () => {
  const memory = new ContextMemory();
  memory.rememberTab({ id: 10, url: 'https://wikipedia.org', title: 'Wikipedia', active: true });
  memory.rememberTab({ id: 20, url: 'https://google.com', title: 'Google', active: false });

  memory.switchActiveTab(20);
  assert.strictEqual(memory.getActiveTab()?.id, 20);
  assert.strictEqual(memory.getActiveTab()?.active, true);

  const tabs = memory.getOpenTabs();
  const tab10 = tabs.find((t) => t.id === 10);
  const tab20 = tabs.find((t) => t.id === 20);
  assert.strictEqual(tab10?.active, false);
  assert.strictEqual(tab20?.active, true);
});

test('Tab Memory (Bug 1 & 2): active tab context is preserved when active tab is closed', () => {
  const memory = new ContextMemory();

  // User had 3 tabs open and was active on Tab 100
  memory.rememberTab({ id: 100, url: 'https://reddit.com/r/technology', title: 'Reddit Tech', active: true });
  memory.rememberTab({ id: 200, url: 'https://stackoverflow.com/questions', title: 'StackOverflow', active: false });
  memory.rememberTab({ id: 300, url: 'https://huggingface.co/models', title: 'Hugging Face', active: false });

  assert.strictEqual(memory.getActiveTab()?.id, 100);

  // User closes Tab 100
  const newActiveTab = memory.forgetTab(100);

  // 1. Memory must not crash or lose active context
  assert.ok(newActiveTab, 'New active tab should be elected');
  assert.notStrictEqual(newActiveTab?.id, 100, 'Closed tab should no longer be active');
  assert.strictEqual(memory.getOpenTabs().length, 2, 'Remaining open tabs count should be 2');

  // 2. Closed tab is remembered in tabHistory for reference
  const history = memory.getTabHistory();
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0]?.id, 100);
  assert.strictEqual(history[0]?.title, 'Reddit Tech');
  assert.ok(history[0]?.closedAt && history[0].closedAt > 0);
});

test('Tab Memory: closing all tabs leaves clean null state without errors', () => {
  const memory = new ContextMemory();
  memory.rememberTab({ id: 50, url: 'https://example.com', title: 'Example', active: true });

  const active = memory.forgetTab(50);
  assert.strictEqual(active, null);
  assert.strictEqual(memory.getActiveTab(), null);
  assert.strictEqual(memory.getOpenTabs().length, 0);
  assert.strictEqual(memory.getTabHistory().length, 1);
});
