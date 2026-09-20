// Content script for Kevin
// Manages normalized DOM extraction, Shadow DOM traversal, in-page WebMCP detection, and action execution

(() => {
  if (window.__kevin_injected || window.__chromodevin_injected) return;
  window.__kevin_injected = true;

  const INTERACTIVE_SELECTORS = [
    'button',
    'a[href]',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]'
  ];

  function sanitizeText(text) {
    if (!text) return '';
    return String(text)
      .replace(/```/g, "'''")
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
      .trim()
      .slice(0, 150);
  }

  function collectElements(root, list = []) {
    if (!root) return list;

    const matched = root.querySelectorAll ? root.querySelectorAll(INTERACTIVE_SELECTORS.join(', ')) : [];
    for (const el of matched) {
      list.push(el);
    }

    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of all) {
      if (el.shadowRoot) {
        collectElements(el.shadowRoot, list);
      }
    }
    return list;
  }

  function extractInteractiveSnapshot() {
    const rawElements = collectElements(document);
    const snapshot = [];
    let nextId = 1;

    for (const el of rawElements) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.pointerEvents === 'none' ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      const targetId = `cd-${nextId++}`;
      el.setAttribute('data-kevin-id', targetId);

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tag;
      const text = (el.innerText || el.textContent || '').trim();
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const type = el.getAttribute('type') || '';
      const value = el.value || '';
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || false;

      const primaryText = sanitizeText(ariaLabel || title || text || placeholder || name || value);

      snapshot.push({
        id: targetId,
        tag,
        role,
        text: primaryText,
        placeholder: sanitizeText(placeholder),
        name: sanitizeText(name),
        type,
        disabled,
        href: tag === 'a' ? (el.getAttribute('href') || '') : undefined,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    }

    // Detect in-page WebMCP declarations
    let webMcpTools = [];
    if (Array.isArray(window.__webMcpTools)) {
      webMcpTools = window.__webMcpTools.map(t => ({ name: t.name, description: t.description }));
    }

    return {
      url: window.location.href,
      title: document.title,
      elements: snapshot,
      webMcpTools
    };
  }

  async function executeAction(action) {
    if (!action) return { success: false, error: 'Empty action' };

    const { action: actionType, type, targetId, text, direction, amount, duration, url } = action;
    const kind = (actionType || type || '').toLowerCase();

    try {
      switch (kind) {
        case 'click': {
          const el = document.querySelector(`[data-kevin-id="${targetId}"], [data-chromodevin-id="${targetId}"]`);
          if (!el) return { success: false, error: `Element ${targetId} not found` };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
          return { success: true, message: `Clicked ${targetId}` };
        }

        case 'type': {
          const el = document.querySelector(`[data-kevin-id="${targetId}"], [data-chromodevin-id="${targetId}"]`);
          if (!el) return { success: false, error: `Element ${targetId} not found` };
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
          el.value = text || '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));

          if (action.pressEnter) {
            const enterEvt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            el.dispatchEvent(new KeyboardEvent('keydown', enterEvt));
            el.dispatchEvent(new KeyboardEvent('keypress', enterEvt));
            el.dispatchEvent(new KeyboardEvent('keyup', enterEvt));
            if (el.form) {
              try {
                if (typeof el.form.requestSubmit === 'function') {
                  el.form.requestSubmit();
                } else {
                  el.form.submit();
                }
              } catch (e) {}
            }
          }
          return { success: true, message: `Typed "${text}" into ${targetId}` };
        }

        case 'scroll': {
          const delta = amount || 400;
          const scrollAmount = direction === 'up' ? -delta : delta;
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          return { success: true, message: `Scrolled ${direction || 'down'} by ${delta}px` };
        }

        case 'navigate': {
          if (url) {
            window.location.href = url;
            return { success: true, message: `Navigating to ${url}` };
          }
          return { success: false, error: 'Missing URL for navigate' };
        }

        case 'back': {
          window.history.back();
          return { success: true, message: 'Navigated back' };
        }

        case 'forward': {
          window.history.forward();
          return { success: true, message: 'Navigated forward' };
        }

        case 'wait': {
          const ms = duration || 1000;
          await new Promise(r => setTimeout(r, ms));
          return { success: true, message: `Waited ${ms}ms` };
        }

        case 'extract': {
          const bodyText = (document.body ? document.body.innerText : '').slice(0, 3000);
          return { success: true, data: bodyText, message: 'Extracted page content' };
        }

        case 'done': {
          return { success: true, message: action.explanation || 'Task finished' };
        }

        default:
          return { success: false, error: `Unknown action: ${kind}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'KEVIN_GET_SNAPSHOT' || request.type === 'CHROMODEVIN_GET_SNAPSHOT') {
      sendResponse(extractInteractiveSnapshot());
      return true;
    }
    if (request.type === 'KEVIN_EXECUTE_ACTION' || request.type === 'CHROMODEVIN_EXECUTE_ACTION') {
      executeAction(request.action).then(sendResponse);
      return true;
    }
  });
})();
