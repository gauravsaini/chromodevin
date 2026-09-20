import { test } from 'node:test';
import assert from 'node:assert';
import { createKevin, extractPlaywrightSnapshot, extractFromAccessibilityTree } from '../packages/playwright/index.js';

function createMockPlaywrightPage(elements: any[] = []): any {
  const state = {
    url: 'https://store.example.com',
    title: 'Electronics Store',
    elements: [...elements] as any[],
    clicks: [] as string[],
    types: [] as any[]
  };

  return {
    state,
    url() {
      return state.url;
    },
    async title() {
      return state.title;
    },
    async evaluate(fn: any, arg?: any) {
      if (typeof fn === 'string') {
        return {
          url: state.url,
          title: state.title,
          elements: state.elements
        };
      }
      if (typeof fn === 'function') {
        return fn(arg);
      }
      return null;
    },
    locator(sel: string) {
      return {
        first() {
          return {
            async scrollIntoViewIfNeeded() {},
            async click() {
              state.clicks.push(sel);
            },
            async fill(text: string) {
              state.types.push({ sel, text });
            },
            async press(key: string) {
              state.types.push({ sel, key });
            }
          };
        }
      };
    },
    async goto(url: string) {
      state.url = url;
    },
    mouse: {
      async wheel() {}
    }
  };
}

test('extractFromAccessibilityTree: parses accessibility tree into interactive candidates', () => {
  const axTree = {
    role: 'WebArea',
    name: 'Test Page',
    children: [
      {
        role: 'searchbox',
        name: 'Search electronics'
      },
      {
        role: 'button',
        name: 'Search'
      },
      {
        role: 'link',
        name: 'Cart (0)'
      }
    ]
  };

  const candidates = extractFromAccessibilityTree(axTree);
  assert.strictEqual(candidates.length, 3);
  assert.strictEqual(candidates[0].role, 'searchbox');
  assert.strictEqual(candidates[0].text, 'Search electronics');
  assert.strictEqual(candidates[1].role, 'button');
  assert.strictEqual(candidates[2].role, 'link');
});

test('createKevin: observes page and extracts snapshot', async () => {
  const mockPage = createMockPlaywrightPage([
    { id: 'cd-1', role: 'button', text: 'Add to Cart', tag: 'button' }
  ]);

  const kevin = await createKevin(mockPage);
  const obs = await kevin.observe();

  assert.strictEqual(obs.url, 'https://store.example.com');
  assert.strictEqual(obs.elements.length, 1);
  assert.strictEqual(obs.elements[0].text, 'Add to Cart');
});

test('createKevin: plans next action without side-effects', async () => {
  const mockPage = createMockPlaywrightPage([
    { id: 'cd-1', role: 'button', text: 'Checkout Now', tag: 'button' }
  ]);

  const kevin = await createKevin(mockPage);
  const plan = await kevin.plan('Click the Checkout Now button');

  assert.strictEqual(plan.action, 'click');
  assert.strictEqual(plan.targetId, 'cd-1');
  assert.strictEqual(mockPage.state.clicks.length, 0);
});

test('createKevin: executes single-step act on Playwright page', async () => {
  const mockPage = createMockPlaywrightPage([
    { id: 'cd-1', role: 'button', text: 'Search', tag: 'button' }
  ]);

  const kevin = await createKevin(mockPage);
  const result = await kevin.act('Click Search');

  assert.strictEqual(result.success, true);
  assert.strictEqual(mockPage.state.clicks.length, 1);
  assert.ok(mockPage.state.clicks[0].includes('cd-1'));
});

test('createKevin: executes typing and form input on Playwright page', async () => {
  const mockPage = createMockPlaywrightPage([
    { id: 'cd-1', role: 'searchbox', text: 'Search products', tag: 'input', placeholder: 'Search products' }
  ]);

  const kevin = await createKevin(mockPage);
  const result = await kevin.act('Type Sony WH-1000XM5 into search');

  assert.strictEqual(result.success, true);
  assert.ok(mockPage.state.types.length >= 1);
  assert.strictEqual(mockPage.state.types[0].text, 'Sony WH-1000XM5');
});

test('createKevin: supports step() single step execution', async () => {
  const mockPage = createMockPlaywrightPage([
    { id: 'cd-5', role: 'button', text: 'Submit Order', tag: 'button' }
  ]);

  const kevin = await createKevin(mockPage);
  const { action, result } = await kevin.step('Click Submit Order');

  assert.strictEqual(action.action, 'click');
  assert.strictEqual(result.success, true);
  assert.strictEqual(mockPage.state.clicks.length, 1);
});
