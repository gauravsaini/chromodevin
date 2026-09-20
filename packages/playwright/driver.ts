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
      locators.push(this.page.locator(`[data-kevin-id="${targetId}"], [data-chromodevin-id="${targetId}"]`));
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
        case 'navigate': {
          if (!payload.url) {
            return { success: false, error: 'Navigate action requires a valid URL' };
          }
          if (typeof this.page.goto === 'function') {
            await this.page.goto(payload.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
          return { success: true, message: `Navigated to ${payload.url}` };
        }

        case 'click': {
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

        case 'type': {
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

        case 'press_key': {
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

        case 'scroll': {
          const delta = payload.amount || 500;
          const direction = payload.direction === 'up' ? -delta : delta;
          if (typeof this.page.evaluate === 'function') {
            await this.page.evaluate((y: number) => window.scrollBy({ top: y, behavior: 'smooth' }), direction);
          } else if (this.page.mouse && typeof this.page.mouse.wheel === 'function') {
            await this.page.mouse.wheel(0, direction);
          }
          return { success: true, message: `Scrolled ${payload.direction || 'down'} by ${delta}px` };
        }

        case 'back': {
          if (typeof this.page.goBack === 'function') {
            await this.page.goBack({ timeout: this.defaultTimeout }).catch(() => {});
          }
          return { success: true, message: 'Navigated back in history' };
        }

        case 'forward': {
          if (typeof this.page.goForward === 'function') {
            await this.page.goForward({ timeout: this.defaultTimeout }).catch(() => {});
          }
          return { success: true, message: 'Navigated forward in history' };
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
}
