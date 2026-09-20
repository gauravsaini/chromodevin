import { validateAction } from './action-schema.js';
import type { ActionPayload } from '../types.js';

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

/**
 * Safe action executor for Kevin.
 * Never executes arbitrary JS. Maps validated Action schema directly to DOM operations.
 */
export async function executeAction(actionPayload: ActionPayload | any): Promise<ActionResult> {
  const validation = validateAction(actionPayload);
  if (!validation.valid || !validation.action) {
    return { success: false, error: validation.error };
  }

  const action = validation.action;

  try {
    switch (action.action) {
      case 'click': {
        const el = document.querySelector<HTMLElement>(
          `[data-kevin-id="${action.targetId}"], [data-chromodevin-id="${action.targetId}"]`
        );
        if (!el) {
          return { success: false, error: `Target element ${action.targetId} not found on page` };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        // Dispatch synthetic mouse events for SPAs that listen to pointer/mouse
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
        return { success: true, message: `Clicked element ${action.targetId}` };
      }

      case 'type': {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[data-kevin-id="${action.targetId}"], [data-chromodevin-id="${action.targetId}"]`
        );
        if (!el) {
          return { success: false, error: `Target element ${action.targetId} not found on page` };
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.value = action.text ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: `Typed "${action.text}" into ${action.targetId}` };
      }

      case 'scroll': {
        const delta = action.amount || 400;
        const scrollAmount = action.direction === 'up' ? -delta : delta;
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        return { success: true, message: `Scrolled ${action.direction} by ${delta}px` };
      }

      case 'navigate': {
        if (action.url) {
          window.location.href = action.url;
        }
        return { success: true, message: `Navigating to ${action.url}` };
      }

      case 'back': {
        window.history.back();
        return { success: true, message: 'Navigated back in history' };
      }

      case 'forward': {
        window.history.forward();
        return { success: true, message: 'Navigated forward in history' };
      }

      case 'wait': {
        const dur = action.duration || 500;
        await new Promise((resolve) => setTimeout(resolve, dur));
        return { success: true, message: `Waited for ${dur}ms` };
      }

      case 'extract': {
        const docBody = typeof document !== 'undefined' && document.body ? document.body.innerText : '';
        const mainContent = (docBody || '').slice(0, 3000);
        return { success: true, data: mainContent, message: 'Extracted visible page content' };
      }

      case 'press_key': {
        const key = action.key || 'Enter';
        let targetEl: HTMLElement | null = null;
        if (action.targetId && typeof document !== 'undefined') {
          targetEl = document.querySelector<HTMLElement>(
            `[data-kevin-id="${action.targetId}"], [data-chromodevin-id="${action.targetId}"]`
          );
        }
        const active = targetEl || (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) || document.body || document : null);
        if (active && typeof (active as HTMLElement).focus === 'function') {
          (active as HTMLElement).focus();
        }
        if (active && typeof (active as any).dispatchEvent === 'function' && typeof KeyboardEvent !== 'undefined') {
          active.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
          active.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, bubbles: true, cancelable: true }));
          active.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
        }
        return { success: true, message: `Pressed key "${key}"` };
      }

      case 'done': {
        return { success: true, message: action.explanation || 'Task completed' };
      }

      default:
        return { success: false, error: `Unsupported action: ${(action as any).action}` };
    }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
