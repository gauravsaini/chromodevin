/**
 * Playwright & CDP Perception Adapter for Kevin.
 * Extracts accessible interactive candidates, assigns stable ephemeral IDs,
 * and leverages CDP / Accessibility trees for ultra-fast snapshotting.
 */

import { sanitizeText } from '../core/perception/dom-extractor.js';
import type { DOMElementCandidate, DOMSnapshot } from '../core/types.js';

const IN_PAGE_EXTRACTOR_SCRIPT = `(() => {
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

  function sanitize(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\\`\\\`\\\`/g, "'''")
      .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '')
      .replace(/[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]/g, '')
      .trim()
      .slice(0, 150);
  }

  function collect(root, acc = []) {
    if (!root) return acc;
    const els = root.querySelectorAll ? root.querySelectorAll(INTERACTIVE_SELECTORS.join(', ')) : [];
    for (const el of els) acc.push(el);
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const node of all) {
      if (node.shadowRoot) collect(node.shadowRoot, acc);
      if (node.tagName === 'IFRAME') {
        try {
          if (node.contentDocument) collect(node.contentDocument, acc);
        } catch (_) {}
      }
    }
    return acc;
  }

  const staleIds = document.querySelectorAll('[data-kevin-id]');
  for (const node of staleIds) node.removeAttribute('data-kevin-id');

  const elements = collect(document);
  const items = [];
  let nextId = 1;

  for (const el of elements) {
    if (typeof el.getBoundingClientRect !== 'function') continue;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style) {
      const elTag = (el.tagName || '').toLowerCase();
      const isFormInput = elTag === 'input' && /^(checkbox|radio|file)$/i.test(el.getAttribute('type') || '');
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        (style.opacity === '0' && !isFormInput) ||
        style.pointerEvents === 'none'
      ) continue;
    }
    if (rect.width <= 0 || rect.height <= 0) continue;

    const targetId = 'cd-' + (nextId++);
    el.setAttribute('data-kevin-id', targetId);

    const tag = (el.tagName || '').toLowerCase();
    const role = el.getAttribute('role') || tag;
    const rawText = el.innerText || el.textContent || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const type = el.getAttribute('type') || '';
    const value = el.value || '';
    const ariaExpanded = el.getAttribute('aria-expanded');
    const ariaChecked = el.getAttribute('aria-checked');
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';

    const isCheckboxOrRadio = tag === 'input' && /^(checkbox|radio)$/i.test(type || '');
    const isChecked = isCheckboxOrRadio
      ? Boolean(el.checked)
      : (ariaChecked !== null ? ariaChecked === 'true' : undefined);

    let labelText = '';
    if (isCheckboxOrRadio || !rawText) {
      const id = el.getAttribute('id');
      if (id) {
        const linked = document.querySelector('label[for="' + id + '"]');
        if (linked) labelText = sanitize(linked.textContent || '');
      }
      if (!labelText) {
        const parentLabel = el.closest('label');
        if (parentLabel) labelText = sanitize(parentLabel.textContent || '');
      }
      if (!labelText && isCheckboxOrRadio && el.parentElement) {
        const siblingLabel = el.parentElement.querySelector('label, [data-title], .title, .todo-title, .item-title, span, p');
        if (siblingLabel && siblingLabel !== el) {
          labelText = sanitize(siblingLabel.textContent || '');
        }
      }
    }

    let textParts = [];
    if (ariaLabel) textParts.push(ariaLabel);
    if (title && title !== ariaLabel) textParts.push(title);
    if (rawText && !textParts.length) textParts.push(rawText);
    if (labelText && !textParts.length) textParts.push(labelText);
    else if (labelText && isCheckboxOrRadio) textParts.unshift(labelText);
    if (placeholder && !textParts.length) textParts.push(placeholder);
    if (name && !textParts.length) textParts.push(name);
    if (value && !textParts.length && !isCheckboxOrRadio) textParts.push(value);

    const primaryText = sanitize(textParts.join(' ').trim() || rawText || placeholder || name || value);

    items.push({
      id: targetId,
      tag,
      role: isCheckboxOrRadio ? 'checkbox' : role,
      text: primaryText,
      placeholder: sanitize(placeholder),
      type,
      name: sanitize(name),
      value: sanitize(value),
      disabled: Boolean(disabled),
      checked: isChecked,
      ariaExpanded: ariaExpanded !== null ? ariaExpanded === 'true' : undefined,
      ariaChecked: isChecked,
      href: tag === 'a' ? (el.getAttribute('href') || '') : undefined,
      rect: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0)
      }
    });
  }

  return {
    url: window.location.href || '',
    title: sanitize(document.title || ''),
    bodyText: (document.body ? (document.body.innerText || document.body.textContent || '') : '').slice(0, 10000),
    elements: items
  };
})()`;

export async function waitForDomSettle(
  page: any,
  options: { timeout?: number; idleWindow?: number } = {}
): Promise<boolean> {
  if (!page || typeof page.evaluate !== 'function') return true;

  const timeout = options.timeout || 1500;
  const idleWindow = options.idleWindow || 100;

  try {
    return await page.evaluate(
      ({ timeout, idleWindow }: { timeout: number; idleWindow: number }) => {
        return new Promise((resolve) => {
          let timer: any;
          const maxTimer = setTimeout(() => {
            if (observer) observer.disconnect();
            resolve(false);
          }, timeout);

          const observer =
            typeof MutationObserver !== 'undefined'
              ? new MutationObserver(() => {
                  clearTimeout(timer);
                  timer = setTimeout(() => {
                    if (observer) observer.disconnect();
                    clearTimeout(maxTimer);
                    resolve(true);
                  }, idleWindow);
                })
              : null;

          if (observer && document.body) {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true
            });
            timer = setTimeout(() => {
              observer.disconnect();
              clearTimeout(maxTimer);
              resolve(true);
            }, idleWindow);
          } else {
            clearTimeout(maxTimer);
            resolve(true);
          }
        });
      },
      { timeout, idleWindow }
    );
  } catch {
    return false;
  }
}

export async function extractPlaywrightSnapshot(page: any): Promise<DOMSnapshot> {
  if (!page) {
    return { url: '', title: '', elements: [] };
  }

  if (typeof page.evaluate === 'function') {
    try {
      const snapshot = await page.evaluate(IN_PAGE_EXTRACTOR_SCRIPT);
      let elements = snapshot?.elements || [];

      if (page.frames && typeof page.frames === 'function') {
        try {
          const frames = page.frames();
          if (frames && frames.length > 1) {
            const childFrames = frames.slice(1);
            for (let i = 0; i < childFrames.length; i++) {
              const frame = childFrames[i];
              if (typeof frame.evaluate === 'function') {
                const frameSnapshot = await frame.evaluate(IN_PAGE_EXTRACTOR_SCRIPT).catch(() => null);
                if (frameSnapshot && Array.isArray(frameSnapshot.elements)) {
                  const prefixed = frameSnapshot.elements.map((el: any) => ({
                    ...el,
                    id: `cd-f${i + 1}-${el.id}`,
                    isIframe: true
                  }));
                  elements = elements.concat(prefixed);
                }
              }
            }
          }
        } catch (_) {}
      }

      return {
        url: snapshot?.url || (typeof page.url === 'function' ? page.url() : ''),
        title: snapshot?.title || (typeof page.title === 'function' ? await page.title() : ''),
        bodyText: snapshot?.bodyText || '',
        elements
      };
    } catch (err) {
      // Fallback
    }
  }

  const url = typeof page.url === 'function' ? page.url() : page.url || '';
  const title = typeof page.title === 'function' ? await page.title() : page.title || '';
  const bodyText = page.bodyText || '';
  const elements = page.elements || [];

  return {
    url,
    title: sanitizeText(title),
    bodyText,
    elements
  };
}

export function extractFromAccessibilityTree(
  axTree: any,
  nextIdRef: { count: number } = { count: 1 }
): DOMElementCandidate[] {
  if (!axTree) return [];
  const candidates: DOMElementCandidate[] = [];

  function walk(node: any) {
    if (!node) return;
    const isInteractive = [
      'button',
      'link',
      'textbox',
      'searchbox',
      'checkbox',
      'radio',
      'combobox',
      'menuitem',
      'tab'
    ].includes(node.role);

    if (isInteractive && (node.name || node.value)) {
      candidates.push({
        id: `cd-${nextIdRef.count++}`,
        role: node.role,
        text: sanitizeText(node.name || node.value || ''),
        tag: node.role === 'link' ? 'a' : node.role === 'textbox' ? 'input' : 'button',
        disabled: Boolean(node.disabled),
        rect: { x: 0, y: 0, width: 100, height: 30 }
      });
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(axTree);
  return candidates;
}
