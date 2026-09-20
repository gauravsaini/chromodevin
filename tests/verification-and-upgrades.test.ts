import { test } from 'node:test';
import assert from 'node:assert';
import {
  verifyCondition,
  resolveEntityReference,
  decomposeCommand,
  validateAction,
  executeAction,
  browserDecision,
  extractInteractiveSnapshot
} from '../packages/core/index.js';
import { createKevin } from '../packages/playwright/index.js';

test('Upgrade 1: Natural Language Assertion API (verifyCondition & kevin.verify)', async () => {
  const mockSnapshot = {
    url: 'https://todomvc.com/app',
    title: 'TodoMVC React',
    bodyText: '2 items left. All Active Completed',
    elements: [
      { id: 'cd-1', role: 'checkbox', type: 'checkbox', text: 'Buy milk Toggle Todo', checked: true, ariaChecked: true },
      { id: 'cd-2', role: 'checkbox', type: 'checkbox', text: 'Walk dog Toggle Todo', checked: false, ariaChecked: false },
      { id: 'cd-3', role: 'checkbox', type: 'checkbox', text: 'Read book Toggle Todo', checked: false, ariaChecked: false },
      { id: 'cd-4', tag: 'span', text: '2 items left' }
    ]
  };

  // 1. Count assertions
  const resCount2 = verifyCondition('2 items left', mockSnapshot);
  assert.strictEqual(resCount2.satisfied, true);
  assert.strictEqual(resCount2.actual, 2);

  const resCount3 = verifyCondition('3 items left', mockSnapshot);
  assert.strictEqual(resCount3.satisfied, false);

  // 2. Item completed state
  const resCompleted = verifyCondition('Buy milk is completed', mockSnapshot);
  assert.strictEqual(resCompleted.satisfied, true);

  const resNotCompleted = verifyCondition('Walk dog is completed', mockSnapshot);
  assert.strictEqual(resNotCompleted.satisfied, false);

  // 3. Item active state
  const resActive = verifyCondition('Walk dog is active', mockSnapshot);
  assert.strictEqual(resActive.satisfied, true);

  // 4. Element absence / deletion
  const resDeleted = verifyCondition('Clean garage is deleted', mockSnapshot);
  assert.strictEqual(resDeleted.satisfied, true);

  const resNotDeleted = verifyCondition('Buy milk is deleted', mockSnapshot);
  assert.strictEqual(resNotDeleted.satisfied, false);

  // 5. Text visibility (should see / contains)
  const resSee = verifyCondition("should see 'Read book'", mockSnapshot);
  assert.strictEqual(resSee.satisfied, true);

  const resNotSee = verifyCondition("should not see 'Hidden Secret'", mockSnapshot);
  assert.strictEqual(resNotSee.satisfied, true);

  // 6. Title and URL assertions
  const resTitle = verifyCondition('TodoMVC', mockSnapshot);
  assert.strictEqual(resTitle.satisfied, true);

  const resUrl = verifyCondition('todomvc.com', mockSnapshot);
  assert.strictEqual(resUrl.satisfied, true);
});

test('Upgrade 1 [Agent Integration]: kevin.verify and kevin.shouldSee work on agent instance', async () => {
  const mockPage: any = {
    evaluate: async () => ({
      url: 'https://app.test',
      title: 'Dashboard',
      elements: [
        { id: 'cd-1', role: 'checkbox', text: 'Task 1', checked: true, ariaChecked: true },
        { id: 'cd-2', role: 'checkbox', text: 'Task 2', checked: false, ariaChecked: false }
      ]
    })
  };

  const kevin = await createKevin(mockPage, { headless: true });

  const check1 = await kevin.verify('Task 1 is completed');
  assert.strictEqual(check1.satisfied, true);

  const check2 = await kevin.shouldSee('Task 2');
  assert.strictEqual(check2, true);

  const expectRes = await kevin.expect('Task 2 is active');
  assert.strictEqual(expectRes.satisfied, true);
});

test('Upgrade 2: Keyboard Interaction & press_key Action', async () => {
  // 1. Schema validation
  const validKey = validateAction({ action: 'press_key', key: 'Escape' });
  assert.strictEqual(validKey.valid, true);
  assert.strictEqual(validKey.action?.action, 'press_key');
  assert.strictEqual(validKey.action?.key, 'Escape');

  // 2. Decision model maps "Press Escape" to press_key action, not click
  const decisionEsc = browserDecision({
    state: {
      goal: 'Press Escape',
      url: 'https://test.local',
      title: 'Modal Dialog',
      elements: [
        { id: 'btn-close', text: 'Escape', role: 'button' }
      ]
    }
  });
  assert.strictEqual(decisionEsc.action.action, 'press_key');
  assert.strictEqual(decisionEsc.action.key, 'Escape');

  // 3. Decision model maps "Press Tab", "Hit Enter", "Press ArrowDown"
  const decisionTab = browserDecision({
    state: { goal: 'Press Tab', url: 'https://test.local', title: 'Form', elements: [] }
  });
  assert.strictEqual(decisionTab.action.action, 'press_key');
  assert.strictEqual(decisionTab.action.key, 'Tab');

  const decisionArrow = browserDecision({
    state: { goal: 'Press ArrowDown', url: 'https://test.local', title: 'Menu', elements: [] }
  });
  assert.strictEqual(decisionArrow.action.action, 'press_key');
  assert.strictEqual(decisionArrow.action.key, 'ArrowDown');

  // 4. In-DOM Execution of press_key
  const execRes = await executeAction({ action: 'press_key', key: 'Escape' });
  assert.strictEqual(execRes.success, true);
  assert.strictEqual(execRes.message, 'Pressed key "Escape"');
});

test('Upgrade 3: Ordinal & Positional Entity Resolution', () => {
  const candidates: any[] = [
    { id: 'cd-chk1', role: 'checkbox', type: 'checkbox', text: 'Buy groceries', checked: true },
    { id: 'cd-chk2', role: 'checkbox', type: 'checkbox', text: 'Walk dog', checked: false },
    { id: 'cd-chk3', role: 'checkbox', type: 'checkbox', text: 'Read book', checked: false },
    { id: 'cd-del1', role: 'button', text: 'Delete Buy groceries' },
    { id: 'cd-del2', role: 'button', text: 'Delete Walk dog' },
    { id: 'cd-del3', role: 'button', text: 'Delete Read book' }
  ];

  // Specific ordinal with role filter: "second checkbox"
  const res2ndChk = resolveEntityReference('click second checkbox', candidates);
  assert.strictEqual(res2ndChk?.id, 'cd-chk2');

  // Specific ordinal with role filter: "last delete button"
  const resLastDel = resolveEntityReference('click last delete button', candidates);
  assert.strictEqual(resLastDel?.id, 'cd-del3');

  // Direct state resolution: "the completed item"
  const resCompleted = resolveEntityReference('click the completed item', candidates);
  assert.strictEqual(resCompleted?.id, 'cd-chk1');

  // Direct state resolution: "the active item"
  const resActive = resolveEntityReference('click the active item', candidates);
  assert.strictEqual(resActive?.id, 'cd-chk2');

  // Numbered selector: "checkbox #3"
  const resNum = resolveEntityReference('click checkbox #3', candidates);
  assert.strictEqual(resNum?.id, 'cd-chk3');
});

test('Gap 5: Plan Decomposer handles "and press enter" without accidental split', () => {
  // 1. Compound type command with "and press enter" should remain a single goal
  const p1 = decomposeCommand('Type Buy milk and press enter');
  assert.deepStrictEqual(p1, ['Type Buy milk and press enter']);

  const p2 = decomposeCommand('Type cheese and crackers and press enter');
  assert.deepStrictEqual(p2, ['Type cheese and crackers and press enter']);

  // 2. Chained actions should split correctly
  const p3 = decomposeCommand('Open wikipedia.org and search for WebGPU then click first result');
  assert.deepStrictEqual(p3, ['Open wikipedia.org', 'search for WebGPU', 'click first result']);

  // 3. Hover and delete decomposition
  const p4 = decomposeCommand('Click delete for "Buy milk"');
  assert.deepStrictEqual(p4, ['hover "Buy milk"', 'click delete']);
});

test('Perception: Checkbox state & Form Extraction', () => {
  // Mock DOM structure
  const container = {
    title: 'Form Test',
    querySelectorAll: () => [
      {
        tagName: 'INPUT',
        getAttribute: (attr: string) => (attr === 'type' ? 'checkbox' : null),
        type: 'checkbox',
        checked: true,
        getBoundingClientRect: () => ({ x: 10, y: 10, width: 20, height: 20 }),
        parentElement: {
          querySelector: () => ({ textContent: 'Accept Terms' })
        }
      }
    ]
  };

  const snapshot = extractInteractiveSnapshot(container as any);
  assert.strictEqual(snapshot.elements.length, 1);
  assert.strictEqual(snapshot.elements[0].checked, true);
  assert.strictEqual(snapshot.elements[0].ariaChecked, true);
  assert.ok(snapshot.elements[0].text?.includes('Accept Terms'));
});
