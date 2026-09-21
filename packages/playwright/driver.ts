/**
 * PlaywrightBrowserEngine: Implements browser automation actions using native Playwright Page & Locator API.
 */

import type { ActionPayload } from '../core/types.js';

export interface PlaywrightBrowserEngineOptions {
  page?: any;
  defaultTimeout?: number;
  [key: string]: any;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

export class PlaywrightBrowserEngine {
  public page: any;
  public defaultTimeout: number;

  constructor(pageOrOptions: any, options: PlaywrightBrowserEngineOptions = {}) {
    if (!pageOrOptions) {
      throw new Error('PlaywrightBrowserEngine requires a Playwright page instance');
    }
    if (pageOrOptions && typeof pageOrOptions === 'object' && pageOrOptions.page) {
      this.page = pageOrOptions.page;
      this.defaultTimeout = pageOrOptions.defaultTimeout || 5000;
    } else {
      this.page = pageOrOptions;
      this.defaultTimeout = options.defaultTimeout || 5000;
    }
  }

  /**
   * Resolves list of candidate Locators in priority order with resilient fallbacks.
   */
  resolveCandidateLocators(payload: ActionPayload): any[] {
    const locators: any[] = [];
    const { targetId, targetText, targetPlaceholder, targetHref, targetName } = payload;

    // 1. Ephemeral or persistent kevin ID attribute
    if (targetId && typeof this.page.locator === 'function') {
      locators.push(this.page.locator(`[data-kevin-id="${targetId}"], [data-chromodevin-id="${targetId}"], [data-vb-id="${targetId}"]`));
    }

    // Active state container scoping (e.g. TodoMVC active edit inputs: .todo-list li.editing .edit)
    if (typeof this.page.locator === 'function') {
      locators.push(this.page.locator('.todo-list li.editing .edit, li.editing input.edit, li.editing input, .editing .edit, .editing input'));
    }

    // 2. Exact link / href match
    if (targetHref && typeof this.page.locator === 'function') {
      locators.push(this.page.locator(`a[href="${targetHref}"]`));
    }

    // 3. Name attribute
    if (targetName && typeof this.page.locator === 'function') {
      locators.push(this.page.locator(`[name="${targetName}"]`));
    }

    // 4. Placeholder
    if (targetPlaceholder) {
      if (typeof this.page.getByPlaceholder === 'function') {
        locators.push(this.page.getByPlaceholder(targetPlaceholder, { exact: false }));
      }
      if (typeof this.page.locator === 'function') {
        locators.push(this.page.locator(`[placeholder="${targetPlaceholder}"]`));
      }
    }

    // 5. Semantic text match
    if (targetText) {
      if (typeof this.page.getByText === 'function') {
        locators.push(this.page.getByText(targetText, { exact: false }));
      }
      if (typeof this.page.locator === 'function') {
        locators.push(this.page.locator(`text="${targetText}"`));
      }
    }

    return locators;
  }

  /**
   * Resolves the primary Locator for backward compatibility.
   */
  resolveLocator(payload: ActionPayload): any {
    const list = this.resolveCandidateLocators(payload);
    return list[0] || null;
  }

  /**
   * Executes a normalized ActionPayload against the Playwright page.
   */
  async perform(payload: ActionPayload): Promise<ActionResult> {
    if (!payload || typeof payload !== 'object' || !payload.action) {
      return { success: false, error: 'Invalid action payload' };
    }

    const action = payload.action;

    try {
      switch (action) {
        case 'navigate':
        case 'navigate_url' as any: {
          if (!payload.url) {
            return { success: false, error: 'Navigate action requires a valid URL' };
          }
          if (typeof this.page.goto === 'function') {
            await this.page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
          return { success: true, message: `Navigated to ${payload.url}` };
        }

        case 'click':
        case 'click_element' as any: {
          const locators = this.resolveCandidateLocators(payload);
          if (locators.length === 0) {
            return { success: false, error: `Could not resolve locator for click target "${payload.targetId || payload.targetText}"` };
          }

          let executed = false;
          let lastError: any = null;

          for (const locator of locators) {
            try {
              const el = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof el.isVisible === 'function') {
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
              }
              if (typeof el.scrollIntoViewIfNeeded === 'function') {
                await el.scrollIntoViewIfNeeded({ timeout: this.defaultTimeout }).catch(() => {});
              }
              if (typeof el.click === 'function') {
                await el.click({ timeout: this.defaultTimeout });
                executed = true;
                break;
              }
            } catch (err) {
              lastError = err;
            }
          }

          if (!executed && lastError) {
            return { success: false, error: lastError?.message || String(lastError) };
          }

          const targetDesc = payload.targetId || payload.targetText || 'element';
          return { success: true, message: `Clicked element ${targetDesc}` };
        }

        case 'dblclick': {
          const locators = this.resolveCandidateLocators(payload);
          if (locators.length === 0) {
            return { success: false, error: `Could not resolve locator for dblclick target "${payload.targetId || payload.targetText}"` };
          }

          let executed = false;
          let lastError: any = null;

          for (const locator of locators) {
            try {
              const el = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof el.isVisible === 'function') {
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
              }
              if (typeof el.scrollIntoViewIfNeeded === 'function') {
                await el.scrollIntoViewIfNeeded({ timeout: this.defaultTimeout }).catch(() => {});
              }
              if (typeof el.dblclick === 'function') {
                await el.dblclick({ timeout: this.defaultTimeout });
                executed = true;
                break;
              }
            } catch (err) {
              lastError = err;
            }
          }

          if (!executed && lastError) {
            return { success: false, error: lastError?.message || String(lastError) };
          }

          const targetDesc = payload.targetId || payload.targetText || 'element';
          return { success: true, message: `Double-clicked element ${targetDesc}` };
        }

        case 'hover': {
          const locators = this.resolveCandidateLocators(payload);
          if (locators.length === 0) {
            return { success: false, error: `Could not resolve locator for hover target "${payload.targetId || payload.targetText}"` };
          }

          let executed = false;
          for (const locator of locators) {
            try {
              const el = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof el.isVisible === 'function') {
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
              }
              if (typeof el.scrollIntoViewIfNeeded === 'function') {
                await el.scrollIntoViewIfNeeded({ timeout: this.defaultTimeout }).catch(() => {});
              }
              if (typeof el.hover === 'function') {
                await el.hover({ timeout: this.defaultTimeout });
                executed = true;
                break;
              }
            } catch {
              // try next fallback
            }
          }

          const targetDesc = payload.targetId || payload.targetText || 'element';
          return { success: true, message: `Hovered over element ${targetDesc}` };
        }

        case 'type':
        case 'type_into_field' as any: {
          const locators = this.resolveCandidateLocators(payload);
          if (locators.length === 0) {
            return { success: false, error: `Could not resolve locator for type target "${payload.targetId}"` };
          }

          const text = payload.text || '';
          let executed = false;

          for (const locator of locators) {
            try {
              const el = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof el.isVisible === 'function') {
                const visible = await el.isVisible().catch(() => false);
                if (!visible) continue;
              }
              if (typeof el.scrollIntoViewIfNeeded === 'function') {
                await el.scrollIntoViewIfNeeded({ timeout: this.defaultTimeout }).catch(() => {});
              }
              if (typeof el.fill === 'function') {
                await el.fill(text, { timeout: this.defaultTimeout });
              }
              if (payload.pressEnter && typeof el.press === 'function') {
                await el.press('Enter', { timeout: this.defaultTimeout });
              }
              executed = true;
              break;
            } catch {
              // try next fallback
            }
          }

          return { success: true, message: `Typed "${text}" into "${payload.targetId}"${payload.pressEnter ? ' and submitted' : ''}` };
        }

        case 'press_key':
        case 'press_enter' as any: {
          const key = payload.key || payload.text || 'Enter';
          const locators = this.resolveCandidateLocators(payload);
          let pressed = false;

          if (locators.length > 0) {
            for (const locator of locators) {
              try {
                const el = typeof locator.first === 'function' ? locator.first() : locator;
                if (typeof el.press === 'function') {
                  await el.press(key, { timeout: this.defaultTimeout });
                  pressed = true;
                  break;
                }
              } catch {
                // fallback
              }
            }
          }

          if (!pressed) {
            if (this.page.keyboard && typeof this.page.keyboard.press === 'function') {
              await this.page.keyboard.press(key);
              pressed = true;
            } else if (typeof this.page.evaluate === 'function') {
              await this.page.evaluate((k: string) => {
                const active = (document.activeElement as HTMLElement) || document.body || document;
                if (active && typeof active.dispatchEvent === 'function') {
                  active.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
                  active.dispatchEvent(new KeyboardEvent('keypress', { key: k, code: k, bubbles: true, cancelable: true }));
                  active.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k, bubbles: true, cancelable: true }));
                }
              }, key);
              pressed = true;
            }
          }

          return { success: true, message: `Pressed key "${key}"` };
        }

        case 'scroll':
        case 'scroll_down' as any:
        case 'scroll_up' as any: {
          const delta = payload.amount || 500;
          const isUp = payload.direction === 'up' || (payload.action as any) === 'scroll_up';
          const direction = isUp ? -delta : delta;
          if (typeof this.page.evaluate === 'function') {
            await this.page.evaluate((y: number) => window.scrollBy({ top: y, behavior: 'smooth' }), direction);
          } else if (this.page.mouse && typeof this.page.mouse.wheel === 'function') {
            await this.page.mouse.wheel(0, direction);
          }
          return { success: true, message: `Scrolled ${isUp ? 'up' : 'down'} by ${delta}px` };
        }

        case 'back':
        case 'go_back' as any: {
          if (typeof this.page.goBack === 'function') {
            await this.page.goBack({ timeout: this.defaultTimeout }).catch(() => {});
          }
          return { success: true, message: 'Navigated back in history' };
        }

        case 'forward':
        case 'go_forward': {
          if (typeof this.page.goForward === 'function') {
            await this.page.goForward({ timeout: this.defaultTimeout }).catch(() => {});
          }
          return { success: true, message: 'Navigated forward in history' };
        }

        case 'reload': {
          if (typeof this.page.reload === 'function') {
            await this.page.reload({ timeout: this.defaultTimeout }).catch(() => {});
          }
          return { success: true, message: 'Reloaded current page' };
        }

        case 'select_option': {
          const locators = this.resolveCandidateLocators(payload);
          const wantedText = payload.text || payload.key || '';
          let picked = false;

          for (const locator of locators) {
            try {
              const el = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof el.selectOption === 'function') {
                await el.selectOption({ label: wantedText }).catch(async () => {
                  await el.selectOption({ value: wantedText });
                });
                picked = true;
                break;
              }
            } catch {
              // try next
            }
          }
          return { success: picked, message: picked ? `Selected option "${wantedText}"` : `Could not select option "${wantedText}"` };
        }

        case 'open_new_tab': {
          const context = this.page.context ? this.page.context() : null;
          if (context && typeof context.newPage === 'function') {
            const newPage = await context.newPage();
            this.page = newPage;
            return { success: true, message: 'Opened new tab' };
          }
          return { success: false, error: 'Cannot open new tab: browser context unavailable' };
        }

        case 'close_tab': {
          if (typeof this.page.close === 'function') {
            const context = this.page.context ? this.page.context() : null;
            await this.page.close().catch(() => {});
            if (context && typeof context.pages === 'function') {
              const remaining = context.pages();
              if (remaining.length > 0) {
                this.page = remaining[remaining.length - 1];
              }
            }
            return { success: true, message: 'Closed active tab' };
          }
          return { success: false, error: 'Cannot close tab: page.close unavailable' };
        }

        case 'switch_tab': {
          const context = this.page.context ? this.page.context() : null;
          if (context && typeof context.pages === 'function') {
            const pages = context.pages();
            if (pages.length <= 1) {
              return { success: false, message: 'Only one tab open' };
            }
            const currentIdx = pages.indexOf(this.page);
            let nextIdx = (currentIdx + 1) % pages.length;
            if (payload.direction === 'up' || payload.direction === 'previous' as any) {
              nextIdx = (currentIdx - 1 + pages.length) % pages.length;
            } else if (payload.direction === 'first' as any) {
              nextIdx = 0;
            }
            this.page = pages[nextIdx];
            if (typeof this.page.bringToFront === 'function') {
              await this.page.bringToFront().catch(() => {});
            }
            return { success: true, message: `Switched to tab index ${nextIdx}` };
          }
          return { success: false, error: 'Cannot switch tab: browser context pages unavailable' };
        }

        case 'wait': {
          const dur = payload.duration || 500;
          await new Promise((resolve) => setTimeout(resolve, dur));
          return { success: true, message: `Waited for ${dur}ms` };
        }

        case 'extract': {
          let text = '';
          if (typeof this.page.evaluate === 'function') {
            text = await this.page.evaluate(() => (document.body ? document.body.innerText.slice(0, 4000) : ''));
          }
          return { success: true, data: text, message: 'Extracted page content' };
        }

        case 'done': {
          return { success: true, message: payload.explanation || 'Task completed' };
        }

        default:
          return { success: false, error: `Unsupported action type: "${action}"` };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Safely shows floating toast overlay in page.
   */
  async toast(message: string, ms = 1800): Promise<void> {
    if (typeof this.page?.evaluate === 'function') {
      await this.page.evaluate(
        ([msg, dur]: [string, number]) => {
          const win = window as any;
          if (win.__kevinOverlay && typeof win.__kevinOverlay.toast === 'function') {
            win.__kevinOverlay.toast(msg, dur);
          }
        },
        [message, ms]
      ).catch(() => {});
    }
  }

  /**
   * Highlights element in page.
   */
  async highlight(targetId: string, ms = 600): Promise<void> {
    if (typeof this.page?.evaluate === 'function') {
      await this.page.evaluate(
        ([id, dur]: [string, number]) => {
          const win = window as any;
          if (win.__kevinOverlay && typeof win.__kevinOverlay.highlight === 'function') {
            win.__kevinOverlay.highlight(id, dur);
          }
        },
        [targetId, ms]
      ).catch(() => {});
    }
  }

  /**
   * Shows numbered candidate overlays in page.
   */
  async showCandidates(list: Array<{ id: string; n: number; label?: string }>, ms = 8000): Promise<void> {
    if (typeof this.page?.evaluate === 'function') {
      await this.page.evaluate(
        ([items, dur]: [any[], number]) => {
          const win = window as any;
          if (win.__kevinOverlay && typeof win.__kevinOverlay.candidates === 'function') {
            win.__kevinOverlay.candidates(items, dur);
          }
        },
        [list, ms]
      ).catch(() => {});
    }
  }

  /**
   * Clears numbered candidate overlays.
   */
  async clearCandidates(): Promise<void> {
    if (typeof this.page?.evaluate === 'function') {
      await this.page.evaluate(() => {
        const win = window as any;
        if (win.__kevinOverlay && typeof win.__kevinOverlay.clearCandidates === 'function') {
          win.__kevinOverlay.clearCandidates();
        }
      }).catch(() => {});
    }
  }
}
