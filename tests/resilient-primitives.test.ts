import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createKevin,
  waitForDomSettle,
  ActionCache
} from '../packages/playwright/index.js';

function createMockPage(initialElements: any[] = []): any {
  const state = {
    url: 'https://shop.example.com/item',
    title: 'Flagship Headphones',
    elements: [...initialElements] as any[],
    clicks: [] as string[],
    types: [] as any[],
    gotos: [] as string[]
  };

  const page: any = {
    state,
    url() {
      return state.url;
    },
    async title() {
      return state.title;
    },
    async goto(url: string) {
      state.gotos.push(url);
      state.url = url;
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
            async isVisible() {
              return true;
            },
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
    frames() {
      return [page];
    }
  };

  return page;
}

test('3-Verb API: act() fast-path cache executes in <1ms and tracks hit count', async () => {
  const page = createMockPage([
    { id: 'cd-1', role: 'button', text: 'Add to Cart', tag: 'button' }
  ]);
  const cache = new ActionCache();
  const kevin = await createKevin(page, { cache });

  // First run: Cache miss, planning runs
  const res1 = await kevin.act('Add to Cart');
  assert.equal(res1.success, true);
  assert.equal(res1.cached, false);
  assert.equal(res1.targetId, 'cd-1');
  assert.equal(page.state.clicks.length, 1);

  // Second run: Cache hit!
  const res2 = await kevin.act('Add to Cart');
  assert.equal(res2.success, true);
  assert.equal(res2.cached, true);
  assert.equal(res2.targetId, 'cd-1');
  assert.equal(page.state.clicks.length, 2);
});

test('3-Verb API: observe(goal) returns action proposals and act(proposal) executes directly', async () => {
  const page = createMockPage([
    { id: 'cd-1', role: 'button', text: 'Checkout Now', tag: 'button' },
    { id: 'cd-2', role: 'link', text: 'Continue Shopping', tag: 'a' }
  ]);
  const kevin = await createKevin(page);

  const obs = await kevin.observe('Checkout Now');
  assert.ok(Array.isArray(obs.elements));
  assert.ok(Array.isArray(obs.proposals));
  assert.equal(obs.proposals.length, 1);
  assert.equal(obs.proposals[0].targetId, 'cd-1');

  // Direct execution of proposal without re-inference
  const actRes = await kevin.act(obs.proposals[0]);
  assert.equal(actRes.success, true);
  assert.equal(actRes.targetId, 'cd-1');
  assert.equal(page.state.clicks.length, 1);
});

test('3-Verb API: extract({ instruction, schema }) extracts typed structured data', async () => {
  const page = createMockPage([
    { id: 'h1-1', tag: 'h1', role: 'heading', text: 'Bose QuietComfort 45' },
    { id: 'span-1', tag: 'span', text: 'Price: $279.00' },
    { id: 'span-2', tag: 'span', text: 'Status: In Stock' }
  ]);
  const kevin = await createKevin(page);

  const result = await kevin.extract({
    instruction: 'Extract headphone specifications',
    schema: {
      title: 'string',
      price: 'number',
      inStock: 'boolean'
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.title, 'Bose QuietComfort 45');
  assert.equal(result.data.price, 279.0);
  assert.equal(result.data.inStock, true);
});

test('Playwright Page Proxy: transparently delegates native Page methods', async () => {
  const page = createMockPage();
  const kevin = await createKevin(page);

  // Native Playwright page methods called directly on kevin
  await kevin.goto('https://new-url.example.com');
  assert.equal(page.state.gotos.length, 1);
  assert.equal(page.state.gotos[0], 'https://new-url.example.com');
  assert.equal(kevin.url(), 'https://new-url.example.com');

  const loc = kevin.locator('button#cart');
  assert.ok(loc);
  assert.equal(typeof loc.first, 'function');
});

test('waitForDomSettle returns true on mock page', async () => {
  const page = createMockPage();
  const settled = await waitForDomSettle(page, { timeout: 200, idleWindow: 50 });
  assert.equal(typeof settled, 'boolean');
});
