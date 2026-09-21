/**
 * Voice Policy Evaluator: Pure functional policy gate turning model answers into
 * deterministic execution decisions (act / wait / ignore / confirm / cancel / disambiguate).
 *
 * Strict explicit I/O contract: no side effects, no mutations.
 */

import { toHttpUrl } from './voice-spans.js';
import type { ActionPayload, DOMSnapshot, DecisionChoiceAnswer } from '../types.js';

export interface VoiceThresholds {
  intentConfidence: number;
  complete: number;
  isCommand: number;
  destructive: number;
  destructiveIntentConfidence: number;
  targetConfidence: number;
  targetTopProb: number;
  spanConfidence: number;
  candidateCount: number;
}

export const DEFAULT_THRESHOLDS: VoiceThresholds = {
  intentConfidence: 0.55,
  complete: 0.6,
  isCommand: 0.5,
  destructive: 0.5,
  destructiveIntentConfidence: 0.9,
  targetConfidence: 0.45,
  targetTopProb: 0.35,
  spanConfidence: 0.35,
  candidateCount: 3
};

export const SILENCE_COMPLETE_MS = 900;
export const PAYLOAD_SILENCE_MS = 600;
export const PAYLOAD_INTENTS = new Set(['search_web', 'type_into_field', 'select_option']);

export const KNOWN_SITE_HOMES: Record<string, string> = {
  google: 'https://www.google.com/',
  duckduckgo: 'https://duckduckgo.com/',
  youtube: 'https://www.youtube.com/',
  wikipedia: 'https://en.wikipedia.org/wiki/Main_Page',
  github: 'https://github.com/',
  amazon: 'https://www.amazon.com/',
  reddit: 'https://www.reddit.com/',
  twitter_x: 'https://x.com/',
  hacker_news: 'https://news.ycombinator.com/',
  example_com: 'https://example.com/'
};

export const SITE_SEARCH_TEMPLATES: Record<string, string> = {
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  the_web: 'https://duckduckgo.com/?q=%s',
  youtube: 'https://www.youtube.com/results?search_query=%s',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=%s',
  github: 'https://github.com/search?q=%s&type=repositories',
  amazon: 'https://www.amazon.com/s?k=%s',
  reddit: 'https://www.reddit.com/search/?q=%s',
  twitter_x: 'https://x.com/search?q=%s',
  hacker_news: 'https://hn.algolia.com/?q=%s'
};

export interface PolicyGateReason {
  name: string;
  value: any;
  threshold: any;
  pass: boolean;
  note: string;
}

export interface DisambiguationCandidate {
  id: string;
  label: string;
  p: number;
  n: number;
}

export interface VoicePolicyInput {
  answers: Record<string, any>;
  candidates?: { text?: string[]; url?: string[] };
  snapshot: DOMSnapshot & { searchBoxId?: string; site?: string };
  silentMs?: number;
  isFinal?: boolean;
  pending?: ActionPayload | null;
  thresholds?: Partial<VoiceThresholds>;
}

export interface VoicePolicyResult {
  decision: 'act' | 'wait' | 'ignore' | 'confirm' | 'cancel' | 'disambiguate';
  action?: ActionPayload;
  candidates?: DisambiguationCandidate[];
  pendingIntent?: any;
  reasons: PolicyGateReason[];
  summary: string;
  retryInMs?: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function check(
  reasons: PolicyGateReason[],
  name: string,
  value: any,
  threshold: any,
  pass: boolean,
  note: string
): boolean {
  reasons.push({
    name,
    value: typeof value === 'number' ? r2(value) : value,
    threshold,
    pass,
    note
  });
  return pass;
}

export function topChoices(choiceAnswer: DecisionChoiceAnswer | any, n = 3): Array<{ id: string; p: number }> {
  if (!choiceAnswer?.probabilities) return [];
  return Object.entries(choiceAnswer.probabilities)
    .filter(([k]) => k !== 'none')
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, n)
    .map(([id, p]) => ({ id, p: r2(p as number) }));
}

function pickSpan(answer: any, minConfidence: number, fallback: string | null = null): string | null {
  if (!answer) return fallback ?? null;
  if (answer.choice === 'none') return null;
  if ((answer.confidence ?? 1) < minConfidence) return fallback ?? answer.choice;
  return answer.choice;
}

function fillTemplate(tpl: string, q: string): string {
  return tpl.replace('%s', encodeURIComponent(q));
}

export function getElementLabel(elements: any[] = [], id: string): string {
  const el = elements.find((e) => e.id === id);
  if (!el) return id;
  const text = el.text || el.placeholder || el.title || el.name || '';
  return el.role ? `${el.role} "${text}"` : `"${text}"`;
}

export function describeAction(action?: ActionPayload): string {
  if (!action) return '';
  switch (action.action) {
    case 'navigate':
      return `navigate to ${action.url}`;
    case 'type':
      return `type "${action.text}" into ${action.targetId || 'field'}${action.pressEnter ? ' + enter' : ''}`;
    case 'click':
      return `click ${action.targetText || action.targetId || 'element'}`;
    case 'press_key':
      return `press key "${action.key}"`;
    case 'scroll':
      return `scroll ${action.direction || 'down'}`;
    default:
      return action.explanation || action.action;
  }
}

/**
 * Pure function: Evaluates decision gates against input state and thresholds.
 */
export function evaluateVoicePolicy(input: VoicePolicyInput): VoicePolicyResult {
  const {
    answers,
    candidates = { text: [], url: [] },
    snapshot,
    silentMs = 0,
    isFinal = false,
    pending = null
  } = input;

  const T: VoiceThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };
  const reasons: PolicyGateReason[] = [];

  const intent = answers.intent;
  const intentName = intent?.choice ?? 'none';

  // 0. Pending confirmation/cancel handling
  if (pending) {
    if (intentName === 'confirm' && (intent?.confidence ?? 1) >= T.intentConfidence) {
      check(reasons, 'intent', `confirm (${r2(intent.confidence)})`, T.intentConfidence, true, 'pending action confirmed');
      const confirmedAction: ActionPayload = { ...pending, risk: { risk: 'low', requiresConfirmation: false, reason: 'confirmed by user' } };
      return {
        decision: 'act',
        action: confirmedAction,
        reasons,
        summary: `confirmed: ${describeAction(pending)}`
      };
    }
    if (intentName === 'cancel' && (intent?.confidence ?? 1) >= T.intentConfidence) {
      check(reasons, 'intent', `cancel (${r2(intent.confidence)})`, T.intentConfidence, true, 'pending action cancelled');
      return { decision: 'cancel', reasons, summary: 'cancelled pending action' };
    }
  }

  // 1. Is user addressing the browser?
  const isCmd = answers.is_command?.noul ?? 1.0;
  if (!check(reasons, 'is_command', isCmd, T.isCommand, isCmd >= T.isCommand, 'user is addressing browser')) {
    return { decision: 'ignore', reasons, summary: 'not a browser command' };
  }

  // 2. Confident non-none intent?
  const conf = intent?.confidence ?? 1.0;
  const intentOk = intentName !== 'none' && conf >= T.intentConfidence;
  check(reasons, 'intent', `${intentName} (${r2(conf)})`, T.intentConfidence, intentOk, 'confident intent');
  if (!intentOk) {
    return {
      decision: 'wait',
      reasons,
      summary: intentName === 'none' ? 'no recognizable command yet' : 'intent not confident yet'
    };
  }

  // 3. Command completion check
  const complete = answers.complete?.noul ?? 1.0;
  const silent = silentMs >= SILENCE_COMPLETE_MS || isFinal;
  const completeOk = complete >= T.complete || silent;
  check(
    reasons,
    'complete',
    complete,
    T.complete,
    completeOk,
    silent ? (isFinal ? 'utterance marked final' : `silent for ${silentMs}ms`) : 'command has verb + object'
  );
  if (!completeOk) {
    return { decision: 'wait', reasons, summary: 'waiting for rest of command' };
  }

  // 3b. Free-text payload silence requirement
  if (PAYLOAD_INTENTS.has(intentName)) {
    const payloadOk = isFinal || silentMs >= PAYLOAD_SILENCE_MS;
    check(
      reasons,
      'payload_final',
      isFinal ? 'final' : `${silentMs}ms silence`,
      `final or ${PAYLOAD_SILENCE_MS}ms`,
      payloadOk,
      'free text payload waiting for pause'
    );
    if (!payloadOk) {
      return {
        decision: 'wait',
        reasons,
        summary: 'waiting for free text to complete',
        retryInMs: Math.max(50, PAYLOAD_SILENCE_MS - silentMs)
      };
    }
  }

  // 4. Build concrete action
  const built = buildVoiceAction({ intentName, answers, candidates, snapshot, reasons, thresholds: T });
  if (built.decision !== 'act') {
    return { ...built, summary: built.summary || '', reasons };
  }

  const action = built.action!;

  // 5. Destructive verification gate
  const destructive = answers.destructive?.noul ?? 0.0;
  const isDestructiveAction = ['click', 'press_key'].includes(action.action);
  if (isDestructiveAction) {
    const safe = destructive < T.destructive;
    check(reasons, 'destructive', destructive, T.destructive, safe, safe ? 'safe action' : 'requires spoken confirmation');
    if (!safe) {
      action.risk = {
        risk: 'high',
        requiresConfirmation: true,
        reason: 'high destructive score'
      };
      return {
        decision: 'confirm',
        action,
        reasons,
        summary: `Say "confirm" to ${describeAction(action)}`
      };
    }
  }

  return { decision: 'act', action, reasons, summary: describeAction(action) };
}

function buildVoiceAction({
  intentName,
  answers,
  candidates,
  snapshot,
  reasons,
  thresholds: T
}: {
  intentName: string;
  answers: Record<string, any>;
  candidates: { text?: string[]; url?: string[] };
  snapshot: DOMSnapshot & { searchBoxId?: string; site?: string };
  reasons: PolicyGateReason[];
  thresholds: VoiceThresholds;
}): { decision: 'act' | 'wait' | 'disambiguate'; action?: ActionPayload; candidates?: DisambiguationCandidate[]; pendingIntent?: any; summary?: string } {
  const site = answers.site?.choice ?? 'none';
  const elements = snapshot?.elements || [];

  switch (intentName) {
    case 'navigate_url': {
      const urlPick = pickSpan(answers.url_span, T.spanConfidence, candidates.url?.[0] || null);
      if (urlPick) {
        check(reasons, 'url_span', urlPick, T.spanConfidence, true, 'domain spoken verbatim');
        const url = toHttpUrl(urlPick);
        return { decision: 'act', action: { action: 'navigate', url, explanation: `Navigate to ${url}` } };
      }
      if (KNOWN_SITE_HOMES[site]) {
        check(reasons, 'site', `${site} (${r2(answers.site?.confidence ?? 1)})`, '-', true, 'known site destination');
        const url = KNOWN_SITE_HOMES[site];
        return { decision: 'act', action: { action: 'navigate', url, explanation: `Navigate to ${site}` } };
      }
      check(reasons, 'site', site, 'known site or spoken domain', false, 'no valid destination found');
      return { decision: 'wait', summary: 'destination website not recognized' };
    }

    case 'search_web': {
      const query = pickSpan(answers.text_span, T.spanConfidence, candidates.text?.[0] || null);
      if (!query) {
        check(reasons, 'text_span', 'none', T.spanConfidence, false, 'no query extracted');
        return { decision: 'wait', summary: 'search for what?' };
      }
      check(reasons, 'text_span', query, T.spanConfidence, true, 'query extracted verbatim');

      if (SITE_SEARCH_TEMPLATES[site]) {
        const url = fillTemplate(SITE_SEARCH_TEMPLATES[site], query);
        return { decision: 'act', action: { action: 'navigate', url, explanation: `Search ${site} for "${query}"` } };
      }
      if (snapshot?.searchBoxId) {
        return {
          decision: 'act',
          action: {
            action: 'type',
            targetId: snapshot.searchBoxId,
            text: query,
            pressEnter: true,
            explanation: `Type "${query}" into search box and press Enter`
          }
        };
      }
      const url = fillTemplate(SITE_SEARCH_TEMPLATES.duckduckgo, query);
      return { decision: 'act', action: { action: 'navigate', url, explanation: `Search web for "${query}"` } };
    }

    case 'click_element':
    case 'select_option':
    case 'type_into_field': {
      const target = answers.target;
      const top = topChoices(target, T.candidateCount);
      const chosen = target?.choice;
      const targetOk =
        chosen &&
        chosen !== 'none' &&
        (target.confidence ?? 1) >= T.targetConfidence &&
        ((target.probabilities?.[chosen] ?? 1) >= T.targetTopProb);

      const text = intentName === 'click_element' ? null : pickSpan(answers.text_span, T.spanConfidence, candidates.text?.[0] || null);

      if (intentName !== 'click_element' && !text) {
        check(reasons, 'text_span', 'none', T.spanConfidence, false, 'no text to enter');
        return { decision: 'wait', summary: 'what text to type?' };
      }

      if (targetOk) {
        const targetEl = elements.find((e) => e.id === chosen);
        check(reasons, 'target', `${chosen} (${r2(target.confidence ?? 1)})`, T.targetConfidence, true, getElementLabel(elements, chosen));

        if (intentName === 'click_element') {
          return {
            decision: 'act',
            action: {
              action: 'click',
              targetId: chosen,
              targetText: targetEl?.text || undefined,
              explanation: `Click ${getElementLabel(elements, chosen)}`
            }
          };
        } else {
          return {
            decision: 'act',
            action: {
              action: 'type',
              targetId: chosen,
              text: text || '',
              explanation: `Type "${text}" into ${getElementLabel(elements, chosen)}`
            }
          };
        }
      }

      // Typing fallback to page search box if target is not resolved
      if (intentName === 'type_into_field' && snapshot?.searchBoxId) {
        check(reasons, 'target', `${chosen || 'none'}`, T.targetConfidence, false, 'falling back to search box');
        return {
          decision: 'act',
          action: {
            action: 'type',
            targetId: snapshot.searchBoxId,
            text: text || '',
            explanation: `Type "${text}" into search box`
          }
        };
      }

      check(reasons, 'target', `${chosen ?? 'none'}`, T.targetConfidence, false, 'ambiguous target');

      let viable = top.filter((c) => c.p >= 0.08);
      if (viable.length === 1) viable = top.filter((c) => c.p >= 0.02).slice(0, 2);
      if (viable.length === 0) return { decision: 'wait', summary: 'no matching element found on page' };

      const candidateList: DisambiguationCandidate[] = viable.map((c, i) => ({
        id: c.id,
        label: getElementLabel(elements, c.id),
        p: c.p,
        n: i + 1
      }));

      return {
        decision: 'disambiguate',
        candidates: candidateList,
        pendingIntent: { intentName, text },
        summary: `Which one? ${candidateList.map((c) => `${c.n}: ${c.label}`).join(' | ')}`
      };
    }

    case 'scroll_down':
    case 'scroll_up': {
      const dir = intentName === 'scroll_down' ? 'down' : 'up';
      const lvl = Math.round(answers.scroll_amount?.score ?? 1);
      const amount = lvl === 0 ? 250 : (lvl === 2 ? 2000 : 600);
      return {
        decision: 'act',
        action: { action: 'scroll', direction: dir, amount, explanation: `Scroll ${dir}` }
      };
    }

    case 'press_enter':
      return { decision: 'act', action: { action: 'press_key', key: 'Enter', explanation: 'Press Enter' } };

    case 'go_back':
      return { decision: 'act', action: { action: 'back', explanation: 'Go back' } };

    case 'go_forward':
      return { decision: 'act', action: { action: 'forward', explanation: 'Go forward' } };

    case 'reload':
      return { decision: 'act', action: { action: 'navigate', url: snapshot?.url || '', explanation: 'Reload page' } };

    default:
      return { decision: 'act', action: { action: 'done', explanation: intentName } };
  }
}
