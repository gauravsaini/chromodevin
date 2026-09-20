/**
 * Onyx Parallel Decision Engine for Kevin.
 * High-throughput local perception engine that scores and filters 300+ DOM candidates
 * down to Top-K relevant items before passing them to Gemini Nano.
 */

import type { DOMElementCandidate } from '../types.js';

const INTENT_MAPPINGS: Record<string, string[]> = {
  search: ['search', 'find', 'query', 'lookup', 'filter', 'input', 'go'],
  submit: ['submit', 'send', 'confirm', 'enter', 'ok', 'apply', 'save'],
  click: ['click', 'open', 'tap', 'select', 'choose', 'press'],
  auth: ['login', 'signin', 'sign-in', 'log-in', 'register', 'signup', 'account'],
  commerce: ['cart', 'buy', 'checkout', 'purchase', 'order', 'pay', 'shop'],
  navigation: ['home', 'back', 'next', 'menu', 'nav', 'more', 'about']
};

function tokenize(text: any): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function getTermFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = Object.create(null);
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

function computeSimilarity(tf1: Record<string, number>, tf2: Record<string, number>): number {
  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const k in tf1) {
    const v1 = tf1[k];
    mag1 += v1 * v1;
    if (tf2[k]) {
      dot += v1 * tf2[k];
    }
  }
  for (const k in tf2) {
    const v2 = tf2[k];
    mag2 += v2 * v2;
  }

  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

export interface RankCandidatesParams {
  context?: { url?: string; title?: string };
  candidates?: DOMElementCandidate[];
  question?: string;
  topK?: number;
}

export interface CandidateRank {
  candidate: DOMElementCandidate;
  score: number;
}

export interface RankCandidatesResult {
  ranked: CandidateRank[];
  topCandidates: DOMElementCandidate[];
}

/**
 * Evaluates question intent and scores candidate elements in parallel.
 * Pure function with strict input/output contract.
 */
export function rankCandidates({
  context = {},
  candidates = [],
  question = '',
  topK = 15
}: RankCandidatesParams = {}): RankCandidatesResult {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ranked: [], topCandidates: [] };
  }

  const questionTokens = tokenize(question);
  const questionTf = getTermFreq(questionTokens);
  const qLower = (question || '').toLowerCase();

  const activeIntents = new Set<string>();
  for (const [category, keywords] of Object.entries(INTENT_MAPPINGS)) {
    for (const kw of keywords) {
      if (qLower.includes(kw)) {
        activeIntents.add(category);
        break;
      }
    }
  }

  const scores: CandidateRank[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    let score = 0;

    const elTokens = tokenize(`${el.text} ${el.role} ${el.placeholder || ''} ${el.name || ''} ${el.type || ''}`);
    const elTf = getTermFreq(elTokens);
    const sim = computeSimilarity(questionTf, elTf);
    score += sim * 3.0;

    const elTextLower = String(el.text || '').toLowerCase();
    if (elTextLower && qLower.includes(elTextLower)) {
      score += 2.5;
    }
    for (const token of questionTokens) {
      if (token.length > 2 && elTextLower.includes(token)) {
        score += 1.0;
      }
    }

    if (activeIntents.has('search')) {
      if (el.type === 'search' || el.role === 'searchbox' || /search/i.test(el.placeholder || el.name || '')) {
        score += 2.0;
      }
    }
    if (activeIntents.has('commerce')) {
      if (/checkout|cart|buy|order|pay/i.test(el.text || el.ariaLabel || '')) {
        score += 2.5;
      }
    }
    if (activeIntents.has('submit')) {
      if (el.type === 'submit' || el.role === 'button') {
        score += 1.0;
      }
    }

    if (
      el.role === 'checkbox' ||
      el.role === 'button' ||
      el.type === 'checkbox' ||
      el.type === 'radio' ||
      el.tag === 'input' ||
      el.tag === 'button'
    ) {
      score += 0.6;
    }

    if (el.rect && el.rect.y >= 0 && el.rect.y <= 900) {
      score += 0.5;
    }

    if (el.disabled) {
      score -= 2.0;
    }

    scores.push({
      candidate: el,
      score: Math.max(0, Math.round(score * 100) / 100)
    });
  }

  scores.sort((a, b) => b.score - a.score);

  return {
    ranked: scores,
    topCandidates: scores.slice(0, topK).map((s) => s.candidate)
  };
}

export interface DecisionEngineOptions {
  useWebGPU?: boolean;
}

export class DecisionEngine {
  public useWebGPU: boolean;
  public hasWebGPU: boolean;

  constructor(options: DecisionEngineOptions = {}) {
    this.useWebGPU = options.useWebGPU ?? false;
    this.hasWebGPU = typeof navigator !== 'undefined' && !!(navigator as any).gpu;
  }

  async decide(params: RankCandidatesParams = {}): Promise<RankCandidatesResult> {
    return rankCandidates(params);
  }
}

export const defaultDecisionEngine = new DecisionEngine();
