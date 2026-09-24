import { test } from 'node:test';
import assert from 'node:assert';
import { PlaywrightBrowserEngine } from '../packages/playwright/driver.js';

test('PlaywrightBrowserEngine: executes click action via locator', async () => {
  let clickedSelector: string | null = null;
  const mockPage = {
    locator(sel: string) {
      return {
        first() {
          return {
            async scrollIntoViewIfNeeded() {},
            async click() {
              clickedSelector = sel;
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'click', targetId: 'cd-1' });

  assert.strictEqual(res.success, true);
  assert.ok(clickedSelector !== null && (clickedSelector as string).includes('cd-1'));
  assert.strictEqual(res.message, 'Clicked element cd-1');
});

test('PlaywrightBrowserEngine: executes type action with enter key', async () => {
  let filledText: string | null = null;
  let pressedKey: string | null = null;

  const mockPage = {
    locator(sel: string) {
      return {
        first() {
          return {
            async scrollIntoViewIfNeeded() {},
            async fill(text: string) {
              filledText = text;
            },
            async press(key: string) {
              pressedKey = key;
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({
    action: 'type',
    targetId: 'cd-2',
    text: 'Sony WH-1000XM5',
    pressEnter: true
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(filledText, 'Sony WH-1000XM5');
  assert.strictEqual(pressedKey, 'Enter');
});

test('PlaywrightBrowserEngine: executes scroll action via page.mouse.wheel', async () => {
  let wheelY = 0;
  const mockPage = {
    mouse: {
      async wheel(x: number, y: number) {
        wheelY = y;
      }
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'scroll', direction: 'down', amount: 500 });

  assert.strictEqual(res.success, true);
  assert.strictEqual(wheelY, 500);
});

test('PlaywrightBrowserEngine: executes navigate action via page.goto', async () => {
  let visitedUrl: string | null = null;
  const mockPage = {
    async goto(url: string) {
      visitedUrl = url;
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'navigate', url: 'https://example.com' });

  assert.strictEqual(res.success, true);
  assert.strictEqual(visitedUrl, 'https://example.com');
});

test('PlaywrightBrowserEngine: executes extract action via evaluate', async () => {
  const mockPage = {
    async evaluate() {
      return 'Sony Headphones $299 - In Stock';
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'extract' });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.data, 'Sony Headphones $299 - In Stock');
});

test('PlaywrightBrowserEngine: executes back and forward history actions', async () => {
  let historyAction: string | null = null;
  const mockPage = {
    async goBack() {
      historyAction = 'back';
    },
    async goForward() {
      historyAction = 'forward';
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const resBack = await engine.perform({ action: 'back' });
  assert.strictEqual(resBack.success, true);
  assert.strictEqual(historyAction, 'back');

  const resFwd = await engine.perform({ action: 'forward' });
  assert.strictEqual(resFwd.success, true);
  assert.strictEqual(historyAction, 'forward');
});

test('PlaywrightBrowserEngine: handles invalid action payload gracefully', async () => {
  const mockPage = {};
  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform(null as any);
  assert.strictEqual(res.success, false);
  assert.ok(res.error);
});

test('PlaywrightBrowserEngine: returns failure when candidate locators are invisible', async () => {
  const mockPage = {
    locator() {
      return {
        first() {
          return {
            async isVisible() {
              return false;
            },
            async scrollIntoViewIfNeeded() {},
            async click() {
              throw new Error('Should not be called for invisible element');
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'click', targetId: 'hidden-elem' });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'No usable locator executed');
});

test('PlaywrightBrowserEngine: returns failure when all fallback locators throw', async () => {
  const mockPage = {
    locator() {
      return {
        first() {
          return {
            async isVisible() {
              return true;
            },
            async scrollIntoViewIfNeeded() {},
            async click() {
              throw new Error('Element detached from DOM');
            }
          };
        }
      };
    }
  };

  const engine = new PlaywrightBrowserEngine(mockPage);
  const res = await engine.perform({ action: 'click', targetId: 'stale-elem' });

  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Element detached from DOM');
});

test('PlaywrightBrowserEngine: returns failure when page capability is missing', async () => {
  const emptyPage = {};
  const engine = new PlaywrightBrowserEngine(emptyPage);

  const resScroll = await engine.perform({ action: 'scroll', direction: 'down' });
  assert.strictEqual(resScroll.success, false);
  assert.strictEqual(resScroll.error, 'No usable locator executed');

  const resBack = await engine.perform({ action: 'back' });
  assert.strictEqual(resBack.success, false);
  assert.strictEqual(resBack.error, 'No usable locator executed');

  const resForward = await engine.perform({ action: 'forward' });
  assert.strictEqual(resForward.success, false);
  assert.strictEqual(resForward.error, 'No usable locator executed');

  const resPress = await engine.perform({ action: 'press_key', key: 'Enter' });
  assert.strictEqual(resPress.success, false);
  assert.strictEqual(resPress.error, 'No usable locator executed');

  const resNavigate = await engine.perform({ action: 'navigate', url: 'https://example.com' });
  assert.strictEqual(resNavigate.success, false);
  assert.strictEqual(resNavigate.error, 'No usable locator executed');
});

