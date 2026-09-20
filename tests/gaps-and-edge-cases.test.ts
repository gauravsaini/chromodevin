import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaywrightBrowserEngine } from '../packages/playwright/driver.js';
import { validateAction } from '../packages/core/actions/action-schema.js';
import { browserDecision } from '../packages/core/ai/decision-model.js';
import { NanoClient } from '../packages/core/ai/nano-client.js';
import { extractSchema } from '../packages/core/actions/schema-extractor.js';
import { decomposeCommand } from '../packages/core/agent/plan-decomposer.js';
import { computeCacheKey } from '../packages/core/cache/action-cache.js';
import { classifyActionRisk } from '../packages/core/security/risk-classifier.js';
import type { ActionPayload } from '../packages/core/types.js';

// ── Gap 1: Perception Filtering on Custom-Styled Form Elements (opacity: 0) ──
test('Gap 1: Schema & element extraction retains interactive inputs with labels', () => {
  // Verifies that opacity:0 inputs paired with sibling or parent labels produce identifiable targets
  const snapshot = {
    url: 'https://todomvc.com/app',
    title: 'TodoMVC',
    elements: [
      { id: 'cd-1', tag: 'input', type: 'checkbox', text: 'Buy milk', role: 'checkbox' },
      { id: 'cd-2', tag: 'label', text: 'Buy milk' }
    ]
  };

  const decision = browserDecision({
    state: {
      goal: 'click Buy milk',
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements
    }
  });

  assert.equal(decision.action.action, 'click');
  assert.equal(decision.action.targetId, 'cd-1');
});

// ── Gap 2: Stale data-kevin-id Collision & Semantic Fallback Locators ──
test('Gap 2: PlaywrightBrowserEngine resolves semantic fallback when data-kevin-id is stale', async () => {
  let attemptedPrimary = false;
  let clickedFallback = false;

  const mockPage = {
    locator(sel: string) {
      if (sel.includes('data-kevin-id="stale-id"')) {
        return {
          first() {
            return {
              async isVisible() {
                attemptedPrimary = true;
                return false; // Stale node from unmounted React component
              },
              async scrollIntoViewIfNeeded() { },
              async click() {
                throw new Error('Node is detached from DOM');
              }
            };
          }
        };
      }
      // Fallback by placeholder
      if (sel.includes('What needs to be done?')) {
        return {
          first() {
            return {
              async isVisible() {
                return true;
              },
              async scrollIntoViewIfNeeded() { },
              async click() {
                clickedFallback = true;
              }
            };
          }
        };
      }
      return {
        first() {
          return {
            async isVisible() { return false; },
            async scrollIntoViewIfNeeded() { },
            async click() { }
          };
        }
      };
    },
    getByText(text: string) {
      return {
        first() {
          return {
            async isVisible() { return true; },
            async scrollIntoViewIfNeeded() { },
            async click() {
              clickedFallback = true;
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const action: ActionPayload = {
    action: 'click',
    targetId: 'stale-id',
    targetPlaceholder: 'What needs to be done?',
    targetText: 'What needs to be done?'
  };

  const res = await engine.perform(action);
  assert.equal(res.success, true);
  assert.equal(attemptedPrimary, true);
  assert.equal(clickedFallback, true);
});

// ── Gap 3: Natural Language Form Submission & Key Press Intents (Enter / Submit) ──
test('Gap 3: browserDecision and NanoClient set pressEnter on type and add todo intents', async () => {
  const snapshot = {
    url: 'https://todomvc.com/app',
    title: 'TodoMVC',
    elements: [
      { id: 'cd-1', tag: 'input', type: 'text', placeholder: 'What needs to be done?', role: 'textbox' }
    ]
  };

  // Case A: "type 'Buy groceries' and press enter"
  const decisionA = browserDecision({
    state: {
      goal: 'type "Buy groceries" and press enter',
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements
    }
  });

  assert.equal(decisionA.action.action, 'type');
  assert.equal(decisionA.action.text, 'Buy groceries');
  assert.equal(decisionA.action.pressEnter, true);
  assert.equal(decisionA.action.targetId, 'cd-1');

  // Case B: "add todo 'Pick up laundry'"
  const decisionB = browserDecision({
    state: {
      goal: 'add todo "Pick up laundry"',
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements
    }
  });

  assert.equal(decisionB.action.action, 'type');
  assert.equal(decisionB.action.text, 'Pick up laundry');
  assert.equal(decisionB.action.pressEnter, true);
  assert.equal(decisionB.action.targetId, 'cd-1');

  // Case C: NanoClient heuristic plan
  const nano = new NanoClient();
  const plan = nano.heuristicPlan('add todo "Call mom"', snapshot.elements, { url: snapshot.url });
  assert.equal(plan.action, 'type');
  assert.equal(plan.text, 'Call mom');
  assert.equal(plan.pressEnter, true);
  assert.equal(plan.targetId, 'cd-1');
});

// ── Gap 4: Schema Extractor Semantic Prioritization Overlap ──
test('Gap 4: Schema extractor prioritizes counter heuristics over generic items array fallback', () => {
  const snapshot = {
    url: 'https://todomvc.com/app',
    title: 'TodoMVC',
    elements: [
      { id: 'cd-1', tag: 'li', text: 'Buy milk' },
      { id: 'cd-2', tag: 'li', text: 'Clean kitchen' },
      { id: 'cd-3', tag: 'span', text: '3 items left' }
    ],
    bodyText: '3 items left\nAll Active Completed'
  };

  // Extract schema where itemsLeft should be parsed as string counter, NOT as item array
  const schema = {
    itemsLeft: 'string'
  };

  const extracted = extractSchema(snapshot, 'todo summary', schema);
  assert.equal(extracted.success, true);
  assert.equal(typeof extracted.data.itemsLeft, 'string');
  assert.equal(extracted.data.itemsLeft, '3 items left');

  // Extract number counter
  const numSchema = {
    itemsLeft: 'number'
  };
  const numExtracted = extractSchema(snapshot, 'todo summary', numSchema);
  assert.equal(numExtracted.success, true);
  assert.equal(numExtracted.data.itemsLeft, 3);
});

// ── Gap 5: Hover-Dependent Interactive Elements (Composite Action Planning) ──
test('Gap 5: plan-decomposer generates composite hover-then-click actions for delete targets', () => {
  // Case A: "delete todo 'Buy milk'"
  const stepsA = decomposeCommand('delete todo "Buy milk"');
  assert.deepStrictEqual(stepsA, ['hover "Buy milk"', 'click delete']);

  // Case B: "click delete button on 'Clean kitchen'"
  const stepsB = decomposeCommand('click delete button on "Clean kitchen"');
  assert.deepStrictEqual(stepsB, ['hover "Clean kitchen"', 'click delete']);

  // Case C: "remove 'Finish taxes'"
  const stepsC = decomposeCommand("remove 'Finish taxes'");
  assert.deepStrictEqual(stepsC, ['hover "Finish taxes"', 'click delete']);

  // Case D: Compound sequence with add and delete
  const stepsD = decomposeCommand('add todo "Buy coffee" and then delete todo "Buy coffee"');
  assert.deepStrictEqual(stepsD, ['add todo "Buy coffee"', 'hover "Buy coffee"', 'click delete']);
});

test('Gap 5: PlaywrightBrowserEngine executes validated hover action', async () => {
  let hoveredId: string | null = null;
  const mockPage = {
    locator(sel: string) {
      return {
        first() {
          return {
            async isVisible() { return true; },
            async scrollIntoViewIfNeeded() { },
            async hover() {
              hoveredId = sel;
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const action: ActionPayload = { action: 'hover', targetId: 'cd-10', targetText: 'Buy groceries' };

  const validation = validateAction(action);
  assert.equal(validation.valid, true);

  const res = await engine.perform(action);
  assert.equal(res.success, true);
  assert.ok(hoveredId !== null && (hoveredId as string).includes('cd-10'));
});

test('Gap 1: findSearchInput ignores checkboxes with aria-labels and selects text input', () => {
  const snapshot = {
    url: 'https://todomvc.com/app',
    title: 'TodoMVC',
    elements: [
      { id: 'cd-checkbox', tag: 'input', type: 'checkbox', ariaLabel: 'Toggle Todo', text: 'Toggle Todo' },
      { id: 'cd-new-todo', tag: 'input', type: 'text', placeholder: 'What needs to be done?', role: 'textbox' }
    ]
  };

  const decision = browserDecision({
    state: {
      goal: 'type "Buy groceries" and press enter',
      url: snapshot.url,
      title: snapshot.title,
      elements: snapshot.elements
    }
  });

  assert.equal(decision.action.action, 'type');
  assert.equal(decision.action.targetId, 'cd-new-todo');
  assert.notEqual(decision.action.targetId, 'cd-checkbox');
});

test('Gap 3: computeCacheKey preserves hash routes without collision', () => {
  const keyAll = computeCacheKey('https://todomvc.com/app/#/', 'fp1', 'click toggle');
  const keyActive = computeCacheKey('https://todomvc.com/app/#/active', 'fp1', 'click toggle');
  const keyCompleted = computeCacheKey('https://todomvc.com/app/#/completed', 'fp1', 'click toggle');

  assert.notEqual(keyAll, keyActive);
  assert.notEqual(keyActive, keyCompleted);
  assert.notEqual(keyAll, keyCompleted);
});

test('Gap 4: classifyActionRisk does not mark benign text entry as high risk', () => {
  const typeAction = { action: 'type', targetId: 'cd-1', text: 'Buy organic milk' };
  const inputEl = { id: 'cd-1', tag: 'input', placeholder: 'What needs to be done?' };

  const res = classifyActionRisk(typeAction, inputEl);
  assert.equal(res.risk, 'low');
  assert.equal(res.requiresConfirmation, false);
});

test('Gap 5: PlaywrightBrowserEngine executes validated dblclick action', async () => {
  let dblclickedId: string | null = null;
  const mockPage = {
    locator(sel: string) {
      return {
        first() {
          return {
            async isVisible() { return true; },
            async scrollIntoViewIfNeeded() { },
            async dblclick() {
              dblclickedId = sel;
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const action: ActionPayload = { action: 'dblclick', targetId: 'cd-todo-1', targetText: 'Buy groceries' };

  const validation = validateAction(action);
  assert.equal(validation.valid, true);

  const res = await engine.perform(action);
  assert.equal(res.success, true);
  assert.ok(dblclickedId !== null && (dblclickedId as string).includes('cd-todo-1'));
});

