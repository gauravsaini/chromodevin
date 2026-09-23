/**
 * Onyx Decision Model — kev-inspired browser action decision engine.
 *
 * Like kev: state in → typed decisions out. No text generation, no JSON parsing.
 * One forward pass through scoring functions produces calibrated probabilities.
 *
 * Contract (mirrors kev's systemone):
 *   Input:  { state: DOMSnapshot, questions: { [id]: TypedQuestion } }
 *   Output: { answers: { [id]: TypedAnswer } }
 */

import { rankCandidates } from '../perception/decision-engine.js';
import { lookupDecisionModel } from './model-loader.js';
import type {
  DOMSnapshot,
  DOMElementCandidate,
  ActionPayload,
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
  DecisionScoreAnswer,
  DecisionModelOutput
} from '../types.js';

// ── Scoring primitives ─────────────────────────────────────────────

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function confidence(probs: number[]): number {
  const K = probs.length;
  if (K <= 1) return 1;
  const pMax = Math.max(...probs);
  return (pMax - 1 / K) / (1 - 1 / K);
}

// ── Action type scoring ────────────────────────────────────────────

const KEY_MAP: Record<string, string> = {
  escape: 'Escape',
  esc: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowdown: 'ArrowDown',
  'down arrow': 'ArrowDown',
  arrowup: 'ArrowUp',
  'up arrow': 'ArrowUp',
  arrowleft: 'ArrowLeft',
  'left arrow': 'ArrowLeft',
  arrowright: 'ArrowRight',
  'right arrow': 'ArrowRight',
  space: 'Space',
  spacebar: 'Space',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown'
};

const ACTION_SIGNALS: Record<string, string[]> = {
  navigate: ['open', 'go to', 'navigate', 'visit', 'go', 'load'],
  press_key: [
    'press escape', 'press esc', 'press enter', 'press return', 'press tab',
    'press backspace', 'press delete', 'press arrow', 'press down', 'press up',
    'hit escape', 'hit enter', 'hit tab', 'hit backspace', 'hit delete',
    'send key', 'press key'
  ],
  click: ['click', 'select', 'tap', 'choose', 'pick'],
  hover: ['hover', 'hover over', 'mouse over'],
  type: ['type', 'enter', 'write', 'input', 'fill', 'search for', 'add todo', 'add task', 'add item'],
  scroll: ['scroll', 'down', 'up', 'page down', 'page up'],
  extract: ['read', 'extract', 'what does', 'get text', 'summarize'],
  back: ['go back', 'back', 'previous'],
  done: ['done', 'finish', 'stop', 'complete']
};

export function extractKeyTarget(goal: string): string {
  const lower = (goal || '').toLowerCase().trim();
  const match = lower.match(/(?:press|hit|send\s+key)\s+["']?([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)["']?/i);
  if (match) {
    const rawKey = match[1].trim().toLowerCase();
    if (KEY_MAP[rawKey]) return KEY_MAP[rawKey];
    return match[1].trim();
  }
  for (const [k, v] of Object.entries(KEY_MAP)) {
    if (lower.includes(k)) return v;
  }
  return 'Enter';
}

function scoreActionTypes(goal: string, snapshot: DOMSnapshot | null = null): Record<string, number> {
  const lower = (goal || '').toLowerCase().trim();
  const scores: Record<string, number> = {};

  const isTypingIntent = /^(?:type|add\s+(?:todo|task|item)|add|write|input|fill|search)\b/i.test(lower);
  const isKeyIntent = !isTypingIntent && (
    /^(?:press|hit|send\s+key)\s+(?:escape|esc|enter|return|tab|backspace|delete|arrow|down|up|left|right|space|key)\b/i.test(lower) ||
    /^(?:escape|esc|enter|tab|backspace)$/i.test(lower) ||
    /^(?:press|hit)\s+[a-z0-9_-]+$/i.test(lower)
  );

  for (const [action, signals] of Object.entries(ACTION_SIGNALS)) {
    let s = 0;
    for (const signal of signals) {
      if (lower.startsWith(signal)) s += 5;
      else if (lower.includes(signal) && (action !== 'press_key' || isKeyIntent)) s += 2;
    }
    scores[action] = s;
  }

  if (isKeyIntent) {
    scores.press_key = (scores.press_key || 0) + 10;
    scores.click = 0.1;
  }

  const hasStrongVerb = Object.values(scores).some((score) => score >= 5);
  if (!hasStrongVerb && snapshot && Array.isArray(snapshot.elements) && snapshot.elements.length > 0) {
    const hasCandidateMatch = snapshot.elements.some((el) => {
      const elText = `${el.text || ''} ${el.ariaLabel || ''} ${el.title || ''} ${el.name || ''}`.toLowerCase().trim();
      return elText && (elText === lower || lower.includes(elText) || elText.includes(lower));
    });
    if (hasCandidateMatch) {
      scores.click = (scores.click || 0) + 6;
    }
  }

  for (const a of Object.keys(scores)) {
    scores[a] += 0.1;
  }

  return scores;
}

function scoreCandidateElements(
  goal: string,
  snapshot: DOMSnapshot
): Array<{ id: string; text: string; score: number }> {
  if (!snapshot?.elements?.length) return [];

  const result = rankCandidates({
    context: { url: snapshot.url, title: snapshot.title },
    candidates: snapshot.elements,
    question: goal,
    topK: snapshot.elements.length
  });

  return result.ranked.map((r) => ({
    id: r.candidate.id,
    text: r.candidate.text || r.candidate.tag || '',
    score: r.score
  }));
}

// ── URL detection for navigate actions ─────────────────────────────

function extractNavigationTarget(goal: string): string {
  const lower = (goal || '').toLowerCase().trim();
  const query = lower.replace(/^(go to|open|navigate to|visit)\s+/i, '').trim();

  const shortcuts: Record<string, string> = {
    google: 'https://www.google.com',
    'google.com': 'https://www.google.com',
    youtube: 'https://www.youtube.com',
    'youtube.com': 'https://www.youtube.com',
    github: 'https://github.com',
    'github.com': 'https://github.com',
    wikipedia: 'https://www.wikipedia.org',
    'wikipedia.org': 'https://www.wikipedia.org'
  };

  if (shortcuts[query]) return shortcuts[query];
  if (/^https?:\/\//i.test(query)) return query;
  if (query.includes('.')) return 'https://' + query;
  return 'https://www.google.com/search?q=' + encodeURIComponent(query);
}

// ── Text extraction for type actions ───────────────────────────────

function extractTypeText(goal: string): string {
  const raw = (goal || '').trim();
  const cleanGoal = raw
    .replace(/\s+(?:and|then)?\s*(?:press|hit)\s+enter\b/i, '')
    .replace(/\s+(?:and\s+)?submit\b/i, '')
    .trim();

  const addMatch = cleanGoal.match(/^(?:add\s+(?:todo|task|item)|add|enter)\s+["']?(.*?)["']?$/i);
  if (addMatch) return addMatch[1];

  const intoMatch = cleanGoal.match(/^type\s+(.*?)\s+(?:in|into)\s+/i);
  if (intoMatch) return intoMatch[1].replace(/^["']|["']$/g, '');

  const simpleMatch = cleanGoal.match(/^type\s+["']?(.*?)["']?$/i);
  if (simpleMatch) return simpleMatch[1];

  const searchMatch = cleanGoal.match(/^(?:search\s+for|search|find|look\s+up)\s+["']?(.*?)["']?$/i);
  if (searchMatch) return searchMatch[1].replace(/^(?:the|a)\s+/i, '');
  return '';
}

// ── Search input detection for typed questions ──���──────────────────

function findSearchInput(candidates: DOMElementCandidate[], pageContext: { url?: string }): string | null {
  if (pageContext?.url && /google\.[a-z.]+/i.test(pageContext.url)) {
    return null;
  }
  const isNonTextInput = (c: DOMElementCandidate) =>
    /^(checkbox|radio|button|submit|reset|file|hidden|image)$/i.test(c.type || '');

  const input = candidates.find(
    (c) =>
      !isNonTextInput(c) &&
      (c.type === 'search' ||
        c.role === 'searchbox' ||
        /search|query|find|q/i.test(c.placeholder || c.name || '') ||
        c.tag === 'textarea' ||
        c.tag === 'input')
  );
  return input?.id || null;
}

export interface BrowserDecisionParams {
  state?: {
    goal?: string;
    url?: string;
    title?: string;
    elements?: DOMElementCandidate[];
  };
  questions?: Record<string, any> | null;
  model?: any;
  /**
   * Real pipeline output fused on top of heuristic scores.
   * Lets any HF model steer the decision instead of heuristics alone:
   * - text-classification: { labels: [{ label, score }] } → ACTION_SIGNALS boost
   * - text-generation: { text } → JSON action parse + boost
   * - feature-extraction: { candidateScores } → per-candidate logit boost
   */
  modelOutput?: ModelOutputForDecision | null;
  modelTask?: string | null;
}

export interface ModelOutputForDecision {
  task?: string;
  /** text-classification / zero-shot: label distribution */
  labels?: Array<{ label: string; score: number }>;
  /** text-generation: decoded text (JSON action payload preferred) */
  text?: string;
  /** feature-extraction: per-candidate scores aligned with state.elements order */
  candidateScores?: number[];
  raw?: any;
}

export interface DescribedModel {
  model: string;
  family: string;
  contract: string;
  pipelineTag: string;
}

/**
 * Generic model description. Registry hits return their preset
 * family/contract; any other HF id derives a slug family so telemetry
 * never breaks on unknown models.
 */
export function describeModel(model: any): DescribedModel {
  const modelId = typeof model === 'string'
    ? model
    : (model?.modelId || model?.id || model?.__kevinModelId || 'onnx-community/LFM2.5-350M-ONNX');
  const known = lookupDecisionModel(modelId);
  if (known) {
    return { model: known.id, family: known.family, contract: known.contract, pipelineTag: known.pipelineTag };
  }
  const slug = modelId.includes('/') ? modelId.split('/').slice(1).join('/').toLowerCase() : modelId.toLowerCase();
  // Preserve legacy substring telemetry for ad-hoc refs.
  if (slug.includes('laya')) return { model: modelId, family: 'laya', contract: '/v1/systemone', pipelineTag: 'text-classification' };
  if (slug.includes('rlcd') || slug.includes('lfm2.5') || slug.includes('lfm')) {
    return { model: modelId, family: 'rlcd-decision', contract: 'constrained-likelihood', pipelineTag: 'text-classification' };
  }
  if (slug.includes('kev') || slug.includes('qwen')) {
    return { model: modelId, family: 'kev', contract: '/v1/systemone', pipelineTag: 'text-classification' };
  }
  const family = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'generic';
  const task = typeof model === 'object' && model?.task ? String(model.task) : 'text-classification';
  return { model: modelId, family, contract: `generic:${task}`, pipelineTag: task };
}

/**
 * Normalize raw @huggingface/transformers pipeline output into
 * ModelOutputForDecision by task.
 */
export function normalizePipelineOutput(task: string, raw: any): ModelOutputForDecision {
  const t = (task || '').toLowerCase();
  if (t.includes('classif')) {
    const flat = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
    const labels = (Array.isArray(flat) ? flat : [])
      .filter((o: any) => o && typeof o.label === 'string')
      .map((o: any) => ({ label: String(o.label), score: Number(o.score) || 0 }));
    return { task, labels, raw };
  }
  if (t.includes('generat')) {
    const first = Array.isArray(raw) ? raw[0] : raw;
    const text = typeof first === 'string' ? first : String(first?.generated_text ?? first?.text ?? '');
    return { task, text, raw };
  }
  if (t.includes('feature') || t.includes('embed')) {
    const arr = raw && typeof raw.tolist === 'function' ? raw.tolist() : raw;
    const flat: number[] = Array.isArray(arr) && Array.isArray(arr[0]) && typeof arr[0][0] === 'number'
      ? (arr as number[][]).map((row) => row.reduce((a, b) => a + b, 0) / Math.max(1, row.length))
      : (Array.isArray(arr) ? (arr as number[]).map(Number) : []);
    return { task, candidateScores: flat.filter((n) => Number.isFinite(n)), raw };
  }
  if (t.includes('zero-shot')) {
    const obj = Array.isArray(raw) ? raw[0] : raw;
    const labels = Array.isArray(obj?.labels)
      ? obj.labels.map((label: string, i: number) => ({ label: String(label), score: Number(obj.scores?.[i]) || 0 }))
      : [];
    return { task, labels, raw };
  }
  return { task, raw };
}

/** Cosine similarity for embedding-based candidate ranking. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank candidates by cosine of goal embedding vs per-candidate embeddings. */
export function rankWithEmbeddings(
  goalEmbedding: number[],
  candidateEmbeddings: number[][],
  candidateIds: string[]
): Array<{ id: string; score: number }> {
  return candidateIds.map((id, i) => ({
    id,
    score: cosineSimilarity(goalEmbedding, candidateEmbeddings[i] || [])
  })).sort((a, b) => b.score - a.score);
}

function parseGeneratedAction(text: string): Record<string, any> | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * Fuse classification label distribution into heuristic action scores.
 * Labels hit ACTION_SIGNALS (or the action name itself) proportionally.
 */
export function applyClassificationBias(
  scores: Record<string, number>,
  labels: Array<{ label: string; score: number }> | undefined,
  weight = 10
): Record<string, number> {
  if (!labels?.length) return scores;
  const out = { ...scores };
  for (const { label, score } of labels) {
    const l = String(label || '').toLowerCase();
    if (!l || !(score > 0)) continue;
    for (const [action, signals] of Object.entries(ACTION_SIGNALS)) {
      if (l === action || l.includes(action) || action.includes(l)) {
        out[action] = (out[action] || 0) + score * weight;
        continue;
      }
      for (const signal of signals) {
        if (l.includes(signal) || signal.includes(l)) {
          out[action] = (out[action] || 0) + score * weight * 0.5;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Browser decision model inspired by Jared Palmer's Kev and notnotsamuel's RLCD.
 * State + typed questions → calibrated candidate probabilities.
 * No text generation; pure scoring in one pass.
 */
export function browserDecision({
  state,
  questions = null,
  model = null,
  modelOutput = null,
  modelTask = null
}: BrowserDecisionParams = {}): DecisionModelOutput {
  const goal = state?.goal || '';
  const snapshot: DOMSnapshot = {
    url: state?.url || '',
    title: state?.title || '',
    elements: state?.elements || []
  };

  // ── Question 1: What action type? (choice) ───────────────────
  // Heuristic baseline first (deterministic, offline-safe), then fuse
  // real model weights when modelOutput is provided (task-router path).
  let actionScores = scoreActionTypes(goal, snapshot);
  const fusedTask = modelOutput?.task || modelTask || null;
  if (modelOutput?.labels?.length) {
    actionScores = applyClassificationBias(actionScores, modelOutput.labels);
  }
  let generatedAction: Record<string, any> | null = null;
  if (modelOutput?.text) {
    generatedAction = parseGeneratedAction(modelOutput.text);
    if (generatedAction && typeof generatedAction.action === 'string' && actionScores[generatedAction.action] !== undefined) {
      actionScores[generatedAction.action] += 12;
    }
  }
  const actionKeys = Object.keys(actionScores);
  const actionLogits = actionKeys.map((k) => actionScores[k]);
  const actionProbs = softmax(actionLogits);

  const actionProbMap: Record<string, number> = {};
  actionKeys.forEach((k, i) => {
    actionProbMap[k] = Math.round(actionProbs[i] * 1000) / 1000;
  });
  const chosenActionIdx = actionProbs.indexOf(Math.max(...actionProbs));
  const chosenAction = actionKeys[chosenActionIdx] as any;

  const actionAnswer: DecisionChoiceAnswer = {
    type: 'choice',
    choice: chosenAction,
    confidence: Math.round(confidence(actionProbs) * 1000) / 1000,
    probabilities: actionProbMap
  };

  // ── Question 2: Which element? (choice) ─
  let targetAnswer: DecisionChoiceAnswer | null = null;
  const candidateScores = scoreCandidateElements(goal, snapshot);

  // Fuse feature-extraction candidate scores (aligned with elements order).
  // Cosine deltas are small ([-1, 1]) vs heuristic logits (~0-10), so scale
  // up to let real weights steer when present (same strength as generation).
  if (modelOutput?.candidateScores?.length && candidateScores.length > 0) {
    const emb = modelOutput.candidateScores;
    const scale = 8;
    for (let i = 0; i < candidateScores.length && i < emb.length; i++) {
      if (Number.isFinite(emb[i])) candidateScores[i].score += emb[i] * scale;
    }
    candidateScores.sort((a, b) => b.score - a.score);
  }
  // A generated JSON payload naming a real candidate id outranks heuristics.
  if (generatedAction && typeof generatedAction.targetId === 'string') {
    const genIdx = candidateScores.findIndex((c) => c.id === generatedAction!.targetId);
    if (genIdx > 0) {
      const [gen] = candidateScores.splice(genIdx, 1);
      gen.score += 8;
      candidateScores.unshift(gen);
    } else if (genIdx === 0) {
      candidateScores[0].score += 8;
    }
  }

  if (candidateScores.length > 0 && ['click', 'type', 'hover', 'press_key'].includes(chosenAction)) {
    const topN = candidateScores.slice(0, 10);
    const targetLogits = topN.map((c) => c.score + 0.1);
    const targetProbs = softmax(targetLogits);

    const targetProbMap: Record<string, number> = {};
    topN.forEach((c, i) => {
      targetProbMap[c.id] = Math.round(targetProbs[i] * 1000) / 1000;
    });
    const chosenTargetIdx = targetProbs.indexOf(Math.max(...targetProbs));

    targetAnswer = {
      type: 'choice',
      choice: topN[chosenTargetIdx]?.id || null,
      confidence: Math.round(confidence(targetProbs) * 1000) / 1000,
      probabilities: targetProbMap
    };
  }

  // ── Question 3: Is this a search-on-page action? (noul) ──────
  const lower = (goal || '').toLowerCase();
  const isSearchIntent = /search|find|look up|query/i.test(lower) && !/the website|the link|the button/i.test(lower);
  const isSubmitIntent = isSearchIntent || /(?:press|hit)\s+enter|submit|add\s+(?:todo|task|item)/i.test(lower);
  const searchNoul = isSearchIntent ? 0.9 : 0.1;

  // ── Assemble the action payload ──────────────────────────────
  const payload: ActionPayload = { action: chosenAction };

  if (chosenAction === 'navigate') {
    payload.url = extractNavigationTarget(goal);
    payload.explanation = `Navigate to ${payload.url}`;
  } else if (chosenAction === 'press_key') {
    const key = extractKeyTarget(goal);
    payload.key = key;
    payload.targetId = targetAnswer?.choice || null;
    payload.explanation = `Press key "${key}"`;
  } else if (chosenAction === 'type') {
    const text = extractTypeText(goal);
    const searchInputId = findSearchInput(snapshot.elements, snapshot);
    if (isSearchIntent && !searchInputId && snapshot.url && /google\.[a-z.]+/i.test(snapshot.url)) {
      payload.action = 'navigate';
      payload.url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
      payload.explanation = `Search Google for "${text}"`;
    } else {
      payload.targetId = searchInputId || targetAnswer?.choice || null;
      payload.text = text;
      payload.pressEnter = isSubmitIntent;
      payload.explanation = `Type "${text}" into ${payload.targetId}`;
    }
  } else if (chosenAction === 'click') {
    payload.targetId = targetAnswer?.choice || null;
    const targetEl = snapshot.elements.find((e) => e.id === payload.targetId);
    payload.explanation = `Click ${payload.targetId} ("${targetEl?.text || ''}")`;
  } else if (chosenAction === 'hover') {
    payload.targetId = targetAnswer?.choice || null;
    const targetEl = snapshot.elements.find((e) => e.id === payload.targetId);
    payload.explanation = `Hover over ${payload.targetId} ("${targetEl?.text || ''}")`;
  } else if (chosenAction === 'scroll') {
    payload.direction = lower.includes('up') ? 'up' : 'down';
    payload.amount = 500;
    payload.explanation = `Scroll ${payload.direction}`;
  } else if (chosenAction === 'extract') {
    payload.explanation = 'Extract page content';
  } else if (chosenAction === 'back') {
    payload.explanation = 'Navigate back';
  } else {
    payload.explanation = 'Task complete';
  }

  if (payload.targetId && Array.isArray(snapshot.elements)) {
    const targetEl = snapshot.elements.find((e) => e.id === payload.targetId);
    if (targetEl) {
      if (targetEl.text) payload.targetText = targetEl.text;
      if (targetEl.placeholder) payload.targetPlaceholder = targetEl.placeholder;
      if (targetEl.href) payload.targetHref = targetEl.href;
      if (targetEl.name) payload.targetName = targetEl.name;
      if (targetEl.tag) payload.targetTag = targetEl.tag;
    }
  }

  const answers: Record<string, any> = {
    actionType: actionAnswer,
    targetElement: targetAnswer,
    searchIntent: { type: 'noul', noul: Math.round(searchNoul * 100) / 100 }
  };

  if (questions && typeof questions === 'object') {
    for (const [qid, q] of Object.entries(questions)) {
      if (answers[qid]) continue;
      if (q.type === 'choice' && Array.isArray(q.options)) {
        const scores = q.options.map((opt: any) => {
          const optLower = String(opt).toLowerCase();
          return lower.includes(optLower) ? 3.0 : 0.2;
        });
        const probs = softmax(scores);
        const probMap: Record<string, number> = {};
        q.options.forEach((opt: any, idx: number) => {
          probMap[opt] = Math.round(probs[idx] * 1000) / 1000;
        });
        const maxIdx = probs.indexOf(Math.max(...probs));
        answers[qid] = {
          type: 'choice',
          choice: q.options[maxIdx],
          confidence: Math.round(confidence(probs) * 1000) / 1000,
          probabilities: probMap
        };
      } else if (q.type === 'noul') {
        const isMatch = q.prompt ? lower.includes(String(q.prompt).toLowerCase()) : false;
        answers[qid] = { type: 'noul', noul: isMatch ? 0.85 : 0.15 };
      } else if (q.type === 'score') {
        const levels = q.levels || 5;
        const probs = new Array(levels).fill(Math.round((1 / levels) * 1000) / 1000);
        answers[qid] = { type: 'score', score: 0, confidence: 0, probabilities: probs };
      }
    }
  }

  // Generated-text field overrides (text wins over heuristics on ties).
  if (generatedAction) {
    if (typeof generatedAction.text === 'string' && (payload.action === 'type')) {
      payload.text = generatedAction.text;
    }
    if (typeof generatedAction.url === 'string' && payload.action === 'navigate') {
      payload.url = generatedAction.url;
    }
  }

  const described = describeModel(model);
  const telemetry = {
    model: described.model,
    family: described.family,
    mode: 'decision',
    contract: described.contract,
    forwardCalls: modelOutput ? 2 : 1,
    schemaGuaranteed: true,
    task: fusedTask || described.pipelineTag,
    weightsFused: Boolean(modelOutput)
  };

  return {
    answers,
    action: payload,
    telemetry
  };
}
