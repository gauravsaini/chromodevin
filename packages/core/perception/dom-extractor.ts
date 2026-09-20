/**
 * Normalized Interactive DOM Extractor for Kevin.
 * Extracts accessible interactive snapshot, traverses shadow DOM roots,
 * filters invisible/collapsed nodes, assigns stable ephemeral IDs, and sanitizes untrusted text.
 */

import type { DOMElementCandidate, DOMSnapshot } from '../types.js';

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

export function sanitizeText(text: any): string {
  if (!text) return '';
  return String(text)
    .replace(/```/g, "'''")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, 150);
}

function collectInteractiveNodes(root: any, collected: any[] = []): any[] {
  if (!root) return collected;

  const elements = root.querySelectorAll ? root.querySelectorAll(INTERACTIVE_SELECTORS.join(', ')) : [];
  for (const el of elements) {
    collected.push(el);
  }

  const allNodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const node of allNodes) {
    if (node.shadowRoot) {
      collectInteractiveNodes(node.shadowRoot, collected);
    }
  }

  return collected;
}

export function extractInteractiveSnapshot(doc: any = typeof document !== 'undefined' ? document : null): DOMSnapshot {
  if (!doc) {
    return { url: '', title: '', elements: [] };
  }

  const elements = collectInteractiveNodes(doc);
  const snapshot: DOMElementCandidate[] = [];
  let nextId = 1;

  for (const el of elements) {
    if (typeof el.getBoundingClientRect !== 'function') continue;
    const rect = el.getBoundingClientRect();
    const style = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(el) : null;

    if (style) {
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.pointerEvents === 'none'
      ) {
        continue;
      }
    }

    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }

    const targetId = `cd-${nextId++}`;
    if (typeof el.setAttribute === 'function') {
      el.setAttribute('data-kevin-id', targetId);
      el.setAttribute('data-chromodevin-id', targetId);
    }

    const tag = (el.tagName || '').toLowerCase();
    const role = el.getAttribute ? el.getAttribute('role') || tag : tag;
    const rawText = el.innerText || el.textContent || '';
    const ariaLabel = el.getAttribute ? el.getAttribute('aria-label') || '' : '';
    const title = el.getAttribute ? el.getAttribute('title') || '' : '';
    const placeholder = el.getAttribute ? el.getAttribute('placeholder') || '' : '';
    const name = el.getAttribute ? el.getAttribute('name') || '' : '';
    const type = el.getAttribute ? el.getAttribute('type') || '' : '';
    const value = el.value || '';
    const ariaExpanded = el.getAttribute ? el.getAttribute('aria-expanded') : null;
    const ariaChecked = el.getAttribute ? el.getAttribute('aria-checked') : null;
    const disabled = el.disabled || el.getAttribute?.('aria-disabled') === 'true' || false;

    const isCheckboxOrRadio = tag === 'input' && /^(checkbox|radio)$/i.test(type || '');
    const isChecked = isCheckboxOrRadio
      ? Boolean(el.checked)
      : (ariaChecked !== null ? ariaChecked === 'true' : undefined);

    let labelText = '';
    if (isCheckboxOrRadio || !rawText) {
      const id = el.getAttribute ? el.getAttribute('id') : '';
      if (id && doc.querySelector) {
        const linked = doc.querySelector(`label[for="${id}"]`);
        if (linked) labelText = sanitizeText(linked.textContent || '');
      }
      if (!labelText && typeof el.closest === 'function') {
        const parentLabel = el.closest('label');
        if (parentLabel) labelText = sanitizeText(parentLabel.textContent || '');
      }
      if (!labelText && isCheckboxOrRadio && el.parentElement?.querySelector) {
        const siblingLabel = el.parentElement.querySelector('label, [data-title], .title, .todo-title, .item-title, span, p');
        if (siblingLabel && siblingLabel !== el) {
          labelText = sanitizeText(siblingLabel.textContent || '');
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

    const primaryText = sanitizeText(textParts.join(' ').trim() || rawText || placeholder || name || value);

    snapshot.push({
      id: targetId,
      tag,
      role: isCheckboxOrRadio ? 'checkbox' : role,
      text: primaryText,
      placeholder: sanitizeText(placeholder),
      type,
      name: sanitizeText(name),
      value: sanitizeText(value),
      disabled,
      checked: isChecked,
      ariaExpanded: ariaExpanded !== null ? ariaExpanded === 'true' : undefined,
      ariaChecked: isChecked,
      href: tag === 'a' && el.getAttribute ? el.getAttribute('href') || '' : undefined,
      rect: {
        x: Math.round(rect.x || 0),
        y: Math.round(rect.y || 0),
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0)
      }
    });
  }

  return {
    url: typeof window !== 'undefined' ? window.location?.href || '' : '',
    title: doc.title ? sanitizeText(doc.title) : '',
    elements: snapshot
  };
}
