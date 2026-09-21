/**
 * Voice Decision Model: Pure functional System 1 decision head for voice browser automation.
 * Generates calibrated probabilities across all typed voice questions in one pass.
 *
 * Strict explicit I/O contract:
 *   Input:  VoiceDecisionInput { transcript, snapshot, pendingConfirmation, tabs, model }
 *   Output: VoiceDecisionResult { answers, candidates, telemetry }
 */

import { extractTextCandidates, extractUrlCandidates } from '../agent/voice-spans.js';
import { rankCandidates } from '../perception/decision-engine.js';
import type {
  DOMSnapshot,
  DecisionChoiceAnswer,
  DecisionNoulAnswer,
  DecisionScoreAnswer
} from '../types.js';

export interface VoiceDecisionInput {
  transcript: string;
  snapshot: DOMSnapshot;
  pendingConfirmation?: string | null;
  tabs?: Array<{ index: number; url: string; active: boolean }>;
  model?: string;
}

export interface VoiceDecisionResult {
  answers: {
    intent: DecisionChoiceAnswer;
    target?: DecisionChoiceAnswer;
    site?: DecisionChoiceAnswer;
    complete?: DecisionNoulAnswer;
    is_command?: DecisionNoulAnswer;
    destructive?: DecisionNoulAnswer;
    scroll_amount?: DecisionScoreAnswer;
    text_span?: DecisionChoiceAnswer;
    url_span?: DecisionChoiceAnswer;
    tab_direction?: DecisionChoiceAnswer;
    [key: string]: any;
  };
  candidates: {
    text: string[];
    url: string[];
  };
  latencyMs: number;
  telemetry: {
    model: string;
    family: string;
    mode: string;
    forwardCalls: number;
  };
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / (sum || 1));
}

function confidence(probs: number[]): number {
  const K = probs.length;
  if (K <= 1) return 1;
  const pMax = Math.max(...probs);
  return Math.max(0, (pMax - 1 / K) / (1 - 1 / K));
}

const INTENT_PATTERNS: Record<string, RegExp[]> = {
  navigate_url: [
    /^(?:go\s+to|open|visit|take\s+me\s+to|navigate\s+to)\s+/i,
    /\.(?:com|org|net|io|ai|dev|co|edu|gov)\b/i
  ],
  search_web: [
    /^(?:search\s+for|search|look\s+up|google|find)\s+/i,
    /\bsearch\s+(?:on\s+)?(?:google|duckduckgo|wikipedia|youtube|github)\s+for\s+/i
  ],
  click_element: [
    /^(?:click|press|tap|select|open|choose)\s+(?:the\s+)?/i,
    /\b(?:first|second|third|top|bottom)\s+(?:link|result|button|item)\b/i
  ],
  type_into_field: [
    /^(?:type|enter|write|input|fill\s+in)\s+/i,
    /\b(?:in|into)\s+(?:the\s+)?(?:search\s+box|input|field|textbox)\b/i
  ],
  select_option: [
    /^(?:select|choose)\s+.*?\s+from\s+(?:the\s+)?dropdown\b/i
  ],
  press_enter: [
    /^(?:press\s+enter|hit\s+enter|submit)\b/i
  ],
  scroll_down: [
    /^(?:scroll\s+down|down\s+a\s+bit|page\s+down|to\s+the\s+bottom)\b/i
  ],
  scroll_up: [
    /^(?:scroll\s+up|back\s+to\s+the\s+top|page\s+up)\b/i
  ],
  go_back: [
    /^(?:go\s+back|back|previous\s+page|undo)\b/i
  ],
  go_forward: [
    /^(?:go\s+forward|forward)\b/i
  ],
  reload: [
    /^(?:reload|refresh|refresh\s+the\s+page)\b/i
  ],
  open_new_tab: [
    /^(?:open\s+(?:a\s+)?new\s+tab|new\s+tab)\b/i
  ],
  close_tab: [
    /^(?:close\s+(?:this\s+)?tab|close\s+tab)\b/i
  ],
  switch_tab: [
    /^(?:switch\s+tab|next\s+tab|previous\s+tab|other\s+tab)\b/i
  ],
  confirm: [
    /^(?:yes|confirm|do\s+it|go\s+ahead|proceed)\b/i
  ],
  cancel: [
    /^(?:cancel|never\s+mind|stop|abort)\b/i
  ]
};

const SITE_KEYWORDS: Record<string, string[]> = {
  google: ['google'],
  duckduckgo: ['duckduckgo'],
  youtube: ['youtube'],
  wikipedia: ['wikipedia', 'wiki'],
  github: ['github'],
  amazon: ['amazon'],
  reddit: ['reddit'],
  twitter_x: ['twitter', ' x '],
  hacker_news: ['hacker news', 'hn'],
  example_com: ['example.com', 'example dot com']
};

/**
 * Pure function: Scores intent logits from transcript text.
 */
export function scoreIntents(transcript: string): Record<string, number> {
  const lower = transcript.toLowerCase().trim();
  const scores: Record<string, number> = {};

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    let s = 0.05;
    for (const pat of patterns) {
      if (pat.test(lower)) s += 4.5;
    }
    scores[intent] = s;
  }

  // Fallback / chit-chat detection
  const isChitChat = /^(?:um|uh|hello|hi|what\s+do\s+you\s+think|weather|how\s+are\s+you)\b/i.test(lower);
  scores.none = isChitChat || Object.values(scores).every((v) => v < 1.0) ? 3.5 : 0.05;

  return scores;
}

/**
 * Pure function: Scores destination sites from transcript text.
 */
export function scoreSites(transcript: string): Record<string, number> {
  const lower = transcript.toLowerCase();
  const scores: Record<string, number> = {
    the_web: 0.1,
    other_named_site: 0.1,
    none: 0.5
  };

  for (const [site, keywords] of Object.entries(SITE_KEYWORDS)) {
    let s = 0.05;
    for (const kw of keywords) {
      if (lower.includes(kw)) s += 6.0;
    }
    scores[site] = s;
  }

  if (Object.values(scores).some((v) => v > 1.0)) {
    scores.none = 0.01;
  }

  return scores;
}

/**
 * Pure function: Generates calibrated answers for voice browser questions.
 */
export function voiceDecision(input: VoiceDecisionInput): VoiceDecisionResult {
  const t0 = performance.now();
  const text = String(input.transcript || '').trim();
  const textCandidates = extractTextCandidates(text);
  const urlCandidates = extractUrlCandidates(text);
  const elements = input.snapshot?.elements || [];

  // 1. Intent Question
  const intentScores = scoreIntents(text);
  const intentKeys = Object.keys(intentScores);
  const intentProbs = softmax(intentKeys.map((k) => intentScores[k]));
  const intentProbMap: Record<string, number> = {};
  intentKeys.forEach((k, i) => (intentProbMap[k] = Math.round(intentProbs[i] * 1000) / 1000));
  const maxIntentIdx = intentProbs.indexOf(Math.max(...intentProbs));
  const chosenIntent = intentKeys[maxIntentIdx];

  const intentAnswer: DecisionChoiceAnswer = {
    type: 'choice',
    choice: chosenIntent,
    confidence: Math.round(confidence(intentProbs) * 1000) / 1000,
    probabilities: intentProbMap
  };

  // 2. Site Question
  const siteScores = scoreSites(text);
  const siteKeys = Object.keys(siteScores);
  const siteProbs = softmax(siteKeys.map((k) => siteScores[k]));
  const siteProbMap: Record<string, number> = {};
  siteKeys.forEach((k, i) => (siteProbMap[k] = Math.round(siteProbs[i] * 1000) / 1000));
  const maxSiteIdx = siteProbs.indexOf(Math.max(...siteProbs));

  const siteAnswer: DecisionChoiceAnswer = {
    type: 'choice',
    choice: siteKeys[maxSiteIdx],
    confidence: Math.round(confidence(siteProbs) * 1000) / 1000,
    probabilities: siteProbMap
  };

  // 3. Target Element Question
  const targetProbMap: Record<string, number> = {};
  let chosenTarget: string = 'none';
  let targetConf = 0.5;

  if (elements.length > 0) {
    const rankResult = rankCandidates({
      context: { url: input.snapshot.url, title: input.snapshot.title },
      candidates: elements,
      question: text,
      topK: Math.min(elements.length, 12)
    });

    const ranked = rankResult.ranked;
    if (ranked.length > 0) {
      const topIds = ranked.map((r) => r.candidate.id);
      topIds.push('none');

      const scores = ranked.map((r) => r.score + 0.1);
      scores.push(0.3); // none baseline
      const probs = softmax(scores);

      topIds.forEach((id, i) => {
        targetProbMap[id] = Math.round(probs[i] * 1000) / 1000;
      });

      const maxTgtIdx = probs.indexOf(Math.max(...probs));
      chosenTarget = topIds[maxTgtIdx];
      targetConf = Math.round(confidence(probs) * 1000) / 1000;
    }
  } else {
    targetProbMap.none = 1.0;
  }

  const targetAnswer: DecisionChoiceAnswer = {
    type: 'choice',
    choice: chosenTarget,
    confidence: targetConf,
    probabilities: targetProbMap
  };

  // 4. Complete Question (Noul)
  // Has the user completed the command? Check verb + object presence
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const isCutOff =
    /^(?:go\s+to|search\s+for|click\s+the|type|open\s+the|visit)$/i.test(lower) ||
    words.length <= 1;
  const completeNoul = isCutOff ? 0.2 : 0.92;

  // 5. Is Command Question (Noul)
  // Is user addressing the browser?
  const isBrowserCmd = chosenIntent !== 'none' && !/^(?:um|uh|the\s+weather|what\s+do\s+you\s+think)/i.test(lower);
  const isCommandNoul = isBrowserCmd ? 0.95 : 0.05;

  // 6. Destructive Question (Noul)
  const isDestructive = /\b(?:delete|remove|destroy|purge|buy|purchase|pay|place\s+order|checkout|cancel\s+subscription)\b/i.test(lower);
  const destructiveNoul = isDestructive ? 0.88 : 0.05;

  // 7. Scroll Amount Question (Score)
  let scrollLvl = 1; // page by default
  if (/\b(?:a\s+bit|little|slightly|few\s+lines)\b/i.test(lower)) scrollLvl = 0;
  else if (/\b(?:all\s+the\s+way|bottom|end|top)\b/i.test(lower)) scrollLvl = 2;

  const scrollProbs = [0.1, 0.1, 0.1];
  scrollProbs[scrollLvl] = 0.8;
  const scrollAnswer: DecisionScoreAnswer = {
    type: 'score',
    score: scrollLvl,
    confidence: 0.8,
    probabilities: scrollProbs
  };

  // 8. Tab Direction (Choice)
  const tabDir = /\b(?:previous|last|back)\b/i.test(lower)
    ? 'previous'
    : (/\b(?:first)\b/i.test(lower) ? 'first' : 'next');

  const tabAnswer: DecisionChoiceAnswer = {
    type: 'choice',
    choice: chosenIntent === 'switch_tab' ? tabDir : 'none',
    confidence: 0.9,
    probabilities: { next: 0.5, previous: 0.3, first: 0.1, none: 0.1 }
  };

  const answers: Record<string, any> = {
    intent: intentAnswer,
    target: targetAnswer,
    site: siteAnswer,
    complete: { type: 'noul', noul: completeNoul },
    is_command: { type: 'noul', noul: isCommandNoul },
    destructive: { type: 'noul', noul: destructiveNoul },
    scroll_amount: scrollAnswer,
    tab_direction: tabAnswer
  };

  // 9. Text Span Choice
  if (textCandidates.length > 0) {
    const textProbs = softmax(textCandidates.map((_, i) => (i === 0 ? 3.0 : 1.0)));
    const textProbMap: Record<string, number> = {};
    textCandidates.forEach((c, i) => (textProbMap[c] = Math.round(textProbs[i] * 1000) / 1000));
    answers.text_span = {
      type: 'choice',
      choice: textCandidates[0],
      confidence: Math.round(confidence(textProbs) * 1000) / 1000,
      probabilities: textProbMap
    };
  }

  // 10. URL Span Choice
  if (urlCandidates.length > 0) {
    const urlProbs = softmax(urlCandidates.map((_, i) => (i === 0 ? 3.0 : 1.0)));
    const urlProbMap: Record<string, number> = {};
    urlCandidates.forEach((c, i) => (urlProbMap[c] = Math.round(urlProbs[i] * 1000) / 1000));
    answers.url_span = {
      type: 'choice',
      choice: urlCandidates[0],
      confidence: Math.round(confidence(urlProbs) * 1000) / 1000,
      probabilities: urlProbMap
    };
  }

  const latencyMs = Math.round(performance.now() - t0);

  return {
    answers: answers as any,
    candidates: {
      text: textCandidates,
      url: urlCandidates
    },
    latencyMs,
    telemetry: {
      model: input.model || 'onnx-community/LFM2.5-350M-RLCD',
      family: 'rlcd-decision',
      mode: 'voice-decision',
      forwardCalls: 1
    }
  };
}
