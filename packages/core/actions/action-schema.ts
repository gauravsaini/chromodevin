/**
 * Action Schema Validator for Kevin.
 * Validates and normalizes structured actions produced by planners or heuristics.
 */

import type { ActionPayload, ActionType, ActionValidationResult } from '../types.js';
import { isAllowedNavigationUrl } from '../security/url-policy.js';

export const SUPPORTED_ACTIONS: readonly ActionType[] = Object.freeze([
  'click',
  'dblclick',
  'hover',
  'type',
  'press_key',
  'scroll',
  'navigate',
  'back',
  'forward',
  'extract',
  'wait',
  'done',
  'webmcp'
] as const);

export const ACTION_TYPES = SUPPORTED_ACTIONS;

export function validateAction(action: any): ActionValidationResult {
  if (!action || typeof action !== 'object') {
    return { valid: false, error: 'Action must be an object' };
  }

  const type = String(action.action || action.type || '').trim().toLowerCase() as ActionType;
  if (!SUPPORTED_ACTIONS.includes(type)) {
    return { valid: false, error: `Unsupported action type: "${type}"` };
  }

  const normalized: ActionPayload = {
    action: type,
    targetId: action.targetId ? String(action.targetId).trim() : null,
    targetText: action.targetText ? String(action.targetText).trim() : null,
    targetPlaceholder: action.targetPlaceholder ? String(action.targetPlaceholder).trim() : null,
    targetHref: action.targetHref ? String(action.targetHref).trim() : null,
    targetName: action.targetName ? String(action.targetName).trim() : null,
    targetTag: action.targetTag ? String(action.targetTag).trim() : null,
    text: action.text != null ? String(action.text) : null,
    key: action.key ? String(action.key).trim() : (type === 'press_key' && action.text ? String(action.text).trim() : null),
    url: action.url ? String(action.url).trim() : null,
    direction: action.direction === 'up' ? 'up' : 'down',
    amount: Number.isFinite(action.amount) ? Math.max(1, Math.min(2000, Number(action.amount))) : 400,
    duration: Number.isFinite(action.duration) ? Math.max(50, Math.min(10000, Number(action.duration))) : 1000,
    pressEnter: Boolean(action.pressEnter),
    explanation: action.explanation ? String(action.explanation).trim() : ''
  };

  // Specific validation per action
  switch (type) {
    case 'click':
    case 'dblclick':
    case 'hover':
      if (!normalized.targetId && !normalized.targetText && !normalized.targetPlaceholder) {
        return { valid: false, error: `${type} action requires targetId or semantic target` };
      }
      break;

    case 'type':
      if (!normalized.targetId) {
        return { valid: false, error: 'Type action requires targetId' };
      }
      if (normalized.text == null) {
        return { valid: false, error: 'Type action requires text payload' };
      }
      break;

    case 'press_key':
      if (!normalized.key) {
        return { valid: false, error: 'press_key action requires a key (e.g. "Escape", "Tab", "Enter", "ArrowDown")' };
      }
      break;

    case 'navigate':
      if (!normalized.url) {
        return { valid: false, error: 'Navigate action requires url' };
      }
      const navCheck = isAllowedNavigationUrl(normalized.url);
      if (!navCheck.allowed) {
        return { valid: false, error: navCheck.reason || 'Navigation URL is not allowed' };
      }
      break;

    case 'scroll':
      // direction and amount defaulted above
      break;

    case 'wait':
      // duration defaulted above
      break;

    case 'back':
    case 'forward':
    case 'extract':
    case 'done':
    case 'webmcp':
      break;
  }

  return { valid: true, action: normalized };
}
