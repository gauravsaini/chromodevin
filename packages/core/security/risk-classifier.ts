/**
 * Security Risk Classifier and Guardrails for Kevin.
 * Enforces human-in-the-loop confirmation for high-risk actions
 * (purchases, data deletion, financial transactions, password/account changes).
 */

import type { ActionPayload, DOMElementCandidate, RiskAssessment } from '../types.js';

const HIGH_RISK_KEYWORDS = [
  'buy',
  'purchase',
  'pay',
  'payment',
  'place order',
  'checkout',
  'confirm purchase',
  'delete',
  'remove account',
  'destroy',
  'unsubscribe',
  'transfer',
  'wire',
  'send money',
  'change password',
  'reset password'
];

const MEDIUM_RISK_KEYWORDS = [
  'submit',
  'send',
  'publish',
  'post',
  'apply',
  'sign in',
  'login',
  'subscribe'
];

export function classifyActionRisk(
  action: ActionPayload | any,
  candidateElement: DOMElementCandidate | any = null
): RiskAssessment {
  if (!action || typeof action !== 'object') {
    return { risk: 'low', requiresConfirmation: false, reason: 'No action' };
  }

  const type = String(action.action || action.type || '').toLowerCase();

  // Read-only / navigation actions are intrinsically low risk
  if (['scroll', 'wait', 'extract', 'back', 'forward', 'done'].includes(type)) {
    return { risk: 'low', requiresConfirmation: false, reason: 'Safe read/scroll operation' };
  }

  // Password / credential field inputs are always high risk
  if (candidateElement?.type === 'password') {
    return {
      risk: 'high',
      requiresConfirmation: true,
      reason: 'Action inputs into sensitive password field'
    };
  }

  // Inspect text context of element or action.
  // For 'type' actions, we inspect the target element semantics (e.g. credit card field, auth field),
  // not the arbitrary user-entered text payload (e.g. typing "Buy milk" into a todo list).
  const textsToInspect = [
    action.explanation || '',
    candidateElement?.text || '',
    candidateElement?.ariaLabel || '',
    candidateElement?.name || '',
    candidateElement?.placeholder || ''
  ];
  if (type !== 'type') {
    textsToInspect.push(action.text || '');
  }

  const combinedText = textsToInspect.join(' ').toLowerCase();

  // Check high risk
  for (const kw of HIGH_RISK_KEYWORDS) {
    if (combinedText.includes(kw)) {
      return {
        risk: 'high',
        requiresConfirmation: true,
        reason: `Action involves high-risk operation matching "${kw}"`
      };
    }
  }

  // Check medium risk
  for (const kw of MEDIUM_RISK_KEYWORDS) {
    if (combinedText.includes(kw)) {
      return {
        risk: 'medium',
        requiresConfirmation: false,
        reason: `Action performs form submission or update matching "${kw}"`
      };
    }
  }

  return {
    risk: 'low',
    requiresConfirmation: false,
    reason: 'Standard interactive operation'
  };
}

/**
 * Sanitizes untrusted user/page prompts to prevent delimiter breakout
 * and prompt injection attacks.
 */
export function sanitizePrompt(promptText: any): string {
  if (!promptText) return '';
  return String(promptText)
    .replace(/system\s*prompt/gi, 'system_instruction')
    .replace(/ignore\s+all\s+previous\s+instructions/gi, '[ignored_suspicious_directive]')
    .trim();
}

export {
  isAllowedNavigationUrl,
  assertAllowedNavigationUrl,
  isPrivateHostname
} from './url-policy.js';
export type {
  NavigationUrlPolicyOptions,
  NavigationUrlPolicyResult
} from './url-policy.js';

