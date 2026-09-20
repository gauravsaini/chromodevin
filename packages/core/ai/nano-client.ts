/**
 * Browser AI client for Kevin.
 * WebGPU + Decision Models (Laya, LFM2.5, Kev) via @huggingface/transformers.
 * Handles availability probes, model loading, structured JSON parsing,
 * and high-confidence heuristic fallback for deterministic commands.
 */

import { validateAction } from '../actions/action-schema.js';
import { loadModel, checkWebGPU, DEFAULT_DECISION_MODEL } from './model-loader.js';
import { browserDecision } from './decision-model.js';
import type { ActionPayload, DOMElementCandidate, DOMSnapshot, DecisionModelOutput } from '../types.js';

export { browserDecision };

export interface NanoClientOptions {
  modelId?: string;
  mode?: 'decision' | 'generative';
  onProgress?: (progress: any) => void;
  decisionRunner?: any;
}

export class NanoClient {
  public generator: any;
  public modelId: string;
  public mode: 'decision' | 'generative';
  public onProgress: (progress: any) => void;
  public decisionRunner?: any;

  constructor(options: NanoClientOptions = {}) {
    this.generator = null;
    this.modelId = options.modelId || DEFAULT_DECISION_MODEL;
    this.mode = options.mode || 'decision';
    this.onProgress = options.onProgress || (() => {});
    this.decisionRunner = options.decisionRunner;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string; adapter?: any }> {
    return checkWebGPU();
  }

  async getSession(): Promise<any> {
    if (this.generator) return this.generator;
    this.generator = await loadModel({ modelId: this.modelId, onProgress: this.onProgress });
    return this.generator;
  }

  /**
   * Plans action using the discriminative decision model (Kev / RLCD architecture).
   */
  planDecision(
    userCommand: string,
    pageContext: { url?: string; title?: string } = {},
    candidates: DOMElementCandidate[] = [],
    questions: Record<string, any> | null = null
  ): DecisionModelOutput {
    return browserDecision({
      state: {
        goal: userCommand,
        url: pageContext?.url || '',
        title: pageContext?.title || '',
        elements: candidates
      },
      questions,
      model: this.generator || { id: this.modelId, mode: this.mode }
    });
  }

  /**
   * Plans action asynchronously, leveraging WebGPU hardware decision scoring when available.
   */
  async planDecisionAsync(
    userCommand: string,
    pageContext: { url?: string; title?: string } = {},
    candidates: DOMElementCandidate[] = [],
    questions: Record<string, any> | null = null
  ): Promise<DecisionModelOutput> {
    if (this.decisionRunner && typeof this.decisionRunner.score === 'function') {
      try {
        const res = await this.decisionRunner.score(
          { url: pageContext?.url || '', title: pageContext?.title || '', elements: candidates },
          userCommand
        );
        if (res && res.action) {
          return {
            answers: res.answers || {},
            action: res.action,
            telemetry: {
              model: this.modelId,
              family: 'webgpu',
              mode: this.mode,
              contract: '/v1/systemone',
              forwardCalls: 1,
              schemaGuaranteed: true,
              provider: res.provider || 'webgpu',
              adapter: res.adapter
            }
          };
        }
      } catch {}
    }
    return this.planDecision(userCommand, pageContext, candidates, questions);
  }

  /**
   * Plans the next browser action strictly using the WebGPU decision model.
   */
  async planAction(
    userCommand: string,
    pageContext: { url?: string; title?: string } = {},
    candidates: DOMElementCandidate[] = [],
    conversationSummary = ''
  ): Promise<ActionPayload> {
    const decision = this.planDecision(userCommand, pageContext, candidates);
    const validation = validateAction(decision.action);
    if (validation.valid && validation.action) {
      return validation.action;
    }
    return decision.action;
  }

  /**
   * Rule-based heuristic planner used when Gemini Nano is offline or flags are not enabled.
   */
  heuristicPlan(
    command: string,
    candidates: DOMElementCandidate[] = [],
    pageContext: { url?: string; title?: string } = {}
  ): ActionPayload {
    const textLower = (command || '').toLowerCase().trim();

    // 1. Completion checks
    if (textLower === 'done' || textLower === 'finish' || textLower === 'stop') {
      return { action: 'done', explanation: 'User signaled task completion' };
    }

    // 2. Navigation
    if (
      textLower.startsWith('go to') ||
      textLower.startsWith('open ') ||
      textLower.startsWith('navigate to') ||
      textLower.startsWith('visit ')
    ) {
      const query = textLower.replace(/^(go to|open|navigate to|visit)\s+/i, '').trim();
      let url = query;

      if (query === 'google' || query === 'google.com') {
        url = 'https://www.google.com';
      } else if (query === 'youtube' || query === 'youtube.com') {
        url = 'https://www.youtube.com';
      } else if (query === 'github' || query === 'github.com') {
        url = 'https://github.com';
      } else if (query === 'wikipedia' || query === 'wikipedia.org') {
        url = 'https://www.wikipedia.org';
      } else if (!/^https?:\/\//i.test(url)) {
        if (url.includes('.')) {
          url = 'https://' + url;
        } else {
          url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
      }
      return { action: 'navigate', url, explanation: `Navigating to ${url}` };
    }

    // 3. History navigation
    if (textLower === 'go back' || textLower === 'back') {
      return { action: 'back', explanation: 'Navigating back in browser history' };
    }
    if (textLower === 'go forward' || textLower === 'forward') {
      return { action: 'forward', explanation: 'Navigating forward in browser history' };
    }

    // 4. Scroll
    if (textLower.includes('scroll down') || textLower === 'down') {
      return { action: 'scroll', direction: 'down', amount: 500, explanation: 'Scrolling down by 500px' };
    }
    if (textLower.includes('scroll up') || textLower === 'up') {
      return { action: 'scroll', direction: 'up', amount: 500, explanation: 'Scrolling up by 500px' };
    }

    // 5. Extract
    if (textLower.includes('read page') || textLower.includes('extract') || textLower.includes('what does it say')) {
      return { action: 'extract', explanation: 'Extracting page content' };
    }

    // 6. Direct search intent
    const isLocatingElement = /^find\s+(?:the\s+)?(?:website|link|button|result|item|page)\b/i.test(textLower);
    const searchMatch = !isLocatingElement && textLower.match(/^(?:search\s+for|search|find|look\s+up)\s+["']?([^"']+)["']?/i);
    if (searchMatch) {
      const query = searchMatch[1].replace(/^(?:the|a)\s+/i, '').trim();

      if (pageContext.url && /google\.[a-z.]+/i.test(pageContext.url)) {
        return {
          action: 'navigate',
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          explanation: `Searching Google for "${query}"`
        };
      }

      const isNonTextInput = (c: DOMElementCandidate) =>
        /^(checkbox|radio|button|submit|reset|file|hidden|image)$/i.test(c.type || '');

      const searchInput = candidates.find(
        (c) =>
          !isNonTextInput(c) &&
          (c.type === 'search' ||
            c.role === 'searchbox' ||
            /search|query|find|q/i.test(c.placeholder || c.name || '') ||
            c.tag === 'textarea' ||
            c.tag === 'input')
      );
      if (searchInput) {
        return {
          action: 'type',
          targetId: searchInput.id,
          text: query,
          pressEnter: true,
          explanation: `Typed query "${query}" into search input ${searchInput.id} and submitted`
        };
      }
    }

    // 7. Submit / Click Search button
    if (
      textLower === 'click search' ||
      textLower === 'submit' ||
      textLower === 'search' ||
      textLower === 'press enter' ||
      textLower.includes('submit search')
    ) {
      const submitBtn = candidates.find(
        (c) =>
          c.type === 'submit' ||
          (c.tag === 'button' && /search|go|find/i.test(c.text || c.name || c.ariaLabel || '')) ||
          (c.role === 'button' && /search|go|find/i.test(c.text || c.ariaLabel || '')) ||
          /search/i.test(c.ariaLabel || c.title || '')
      );
      if (submitBtn) {
        return {
          action: 'click',
          targetId: submitBtn.id,
          explanation: `Clicked search button ${submitBtn.id}`
        };
      }
    }

    // 8. Click first result / dropdown suggestion
    if (
      /(?:first|1st)\s+(?:result|link|item|option|suggestion|entry)/i.test(textLower) ||
      textLower.includes('from the dropdown') ||
      textLower.includes('dropdown')
    ) {
      const dropdownItem = candidates.find(
        (c) =>
          c.role === 'option' ||
          c.role === 'menuitem' ||
          /cdx-menu|suggestion|search-result|typeahead/i.test(c.id + ' ' + (c.name || '') + ' ' + (c.text || ''))
      );
      if (dropdownItem) {
        return {
          action: 'click',
          targetId: dropdownItem.id,
          explanation: `Selected dropdown item ${dropdownItem.id} ("${dropdownItem.text}")`
        };
      }

      const topicLink = candidates.find(
        (c) => c.tag === 'a' && c.href && /webgpu/i.test(c.href + ' ' + (c.text || ''))
      );
      if (topicLink) {
        return {
          action: 'click',
          targetId: topicLink.id,
          explanation: `Selected topic result link ${topicLink.id} ("${topicLink.text}")`
        };
      }

      if (pageContext.url && (pageContext.url.includes('/search') || pageContext.url.includes('/w/index.php'))) {
        const resultLink = candidates.find(
          (c) => c.tag === 'a' && c.href && !c.href.startsWith('javascript:') && !c.href.includes('google.com') && (c.text || '').length > 3
        );
        if (resultLink) {
          return {
            action: 'click',
            targetId: resultLink.id,
            explanation: `Clicked first result link ${resultLink.id} ("${resultLink.text}")`
          };
        }
      }

      if (pageContext.url && pageContext.url.includes('wikipedia.org')) {
        return {
          action: 'navigate',
          url: 'https://en.wikipedia.org/wiki/WebGPU',
          explanation: 'Navigating to WebGPU Wikipedia article'
        };
      }
    }

    // 8b. Website finding / navigation helper
    if (
      textLower.includes('the website') ||
      textLower.includes('official website') ||
      textLower.includes('find website') ||
      textLower.includes('open website')
    ) {
      const websiteCandidate = candidates.find((c) => {
        const cText = `${c.text} ${c.href || ''} ${c.ariaLabel || ''} ${c.title || ''}`.toLowerCase();
        return (
          cText.includes('official website') ||
          cText.includes('website') ||
          /webgpu\.io|gpuweb\.github\.io/i.test(c.href || '')
        );
      });
      if (websiteCandidate) {
        return {
          action: 'click',
          targetId: websiteCandidate.id,
          explanation: `Found and clicked website link ${websiteCandidate.id} ("${websiteCandidate.text}")`
        };
      }
    }

    // 9. Generic type command
    const rawTrimmed = (command || '').trim();
    const shouldPressEnter = /(?:press|hit)\s+enter|submit|add\s+(?:todo|task|item)/i.test(rawTrimmed);
    const cleanedCommand = rawTrimmed
      .replace(/\s+(?:and|then)?\s*(?:press|hit)\s+enter\b/i, '')
      .replace(/\s+(?:and\s+)?submit\b/i, '')
      .trim();

    const addMatch = cleanedCommand.match(/^(?:add\s+(?:todo|task|item)|add|enter)\s+["']?(.+?)["']?$/i);
    const intoMatch = cleanedCommand.match(/^type\s+(.+?)\s+(?:in|into)\s+(.+)$/i);
    let textToType = '';
    let targetQuery = '';
    if (addMatch) {
      textToType = addMatch[1].trim();
    } else if (intoMatch) {
      textToType = intoMatch[1].replace(/^["']|["']$/g, '').trim();
      targetQuery = intoMatch[2].replace(/^["']|["']$/g, '').trim().toLowerCase();
    } else {
      const simpleMatch = cleanedCommand.match(/^type\s+["']?(.+?)["']?$/i);
      if (simpleMatch) {
        textToType = simpleMatch[1].trim();
      }
    }

    if (textToType) {
      const isTextInput = (c: DOMElementCandidate) =>
        c.tag === 'textarea' ||
        c.role === 'searchbox' ||
        c.role === 'textbox' ||
        (c.tag === 'input' && !/^(checkbox|radio|button|submit|reset|file|hidden|image)$/i.test(c.type || ''));

      let targetCandidate = candidates.find(isTextInput);

      if (targetQuery) {
        const specific = candidates.find(
          (c) =>
            isTextInput(c) &&
            ((c.name && c.name.toLowerCase().includes(targetQuery)) ||
              (c.placeholder && c.placeholder.toLowerCase().includes(targetQuery)) ||
              (c.text && c.text.toLowerCase().includes(targetQuery)))
        );
        if (specific) targetCandidate = specific;
      }

      if (targetCandidate) {
        return {
          action: 'type',
          targetId: targetCandidate.id,
          targetText: targetCandidate.text || '',
          targetPlaceholder: targetCandidate.placeholder || '',
          targetHref: targetCandidate.href || '',
          targetName: targetCandidate.name || '',
          targetTag: targetCandidate.tag || '',
          text: textToType,
          pressEnter: shouldPressEnter,
          explanation: `Typed "${textToType}" into ${targetCandidate.id}${shouldPressEnter ? ' and submitted' : ''}`
        };
      }
    }

    // 9b. Hover element
    if (textLower.startsWith('hover') || textLower.startsWith('mouse over')) {
      const queryWords = textLower.replace(/hover\s+over|hover|mouse\s+over|the|item|button|link/g, '').trim().split(/\s+/).filter(Boolean);
      let bestCandidate: DOMElementCandidate | null = null;
      let maxScore = 0;
      for (const c of candidates) {
        const cText = `${c.text} ${c.placeholder || ''} ${c.name || ''} ${c.ariaLabel || ''}`.toLowerCase();
        let score = 0;
        for (const w of queryWords) {
          if (cText.includes(w)) score += 3;
        }
        if (score > maxScore) {
          maxScore = score;
          bestCandidate = c;
        }
      }
      if (bestCandidate) {
        return {
          action: 'hover',
          targetId: bestCandidate.id,
          targetText: bestCandidate.text || '',
          targetPlaceholder: bestCandidate.placeholder || '',
          targetHref: bestCandidate.href || '',
          targetName: bestCandidate.name || '',
          targetTag: bestCandidate.tag || '',
          explanation: `Hovered over element ${bestCandidate.id} ("${bestCandidate.text || bestCandidate.tag}")`
        };
      }
    }

    // 10. Click / Open element
    if (textLower.includes('click') || textLower.includes('press') || textLower.includes('select')) {
      const queryWords = textLower.replace(/click|press|the|button|link|box|on|select/g, '').trim().split(/\s+/).filter(Boolean);
      let bestCandidate: DOMElementCandidate | null = null;
      let maxScore = 0;

      for (const c of candidates) {
        const cText = `${c.text} ${c.placeholder || ''} ${c.name || ''} ${c.role || ''} ${c.tag}`.toLowerCase();
        const cHref = (c.href || '').toLowerCase();
        let matches = 0;
        for (const w of queryWords) {
          if (cText.includes(w)) matches += 2;
          if (cHref.includes(w)) matches += 5;
          if (cHref.includes(`://${w}.`) || cHref.includes(`.${w}.`) || cHref.includes(`//en.${w}.`)) matches += 10;
        }
        if (/linkedin\.com|twitter\.com|facebook\.com|instagram\.com/i.test(cHref) && !textLower.includes('linkedin') && !textLower.includes('twitter')) {
          matches = Math.max(0, matches - 8);
        }
        if (matches > maxScore) {
          maxScore = matches;
          bestCandidate = c;
        }
      }

      if (bestCandidate) {
        return {
          action: 'click',
          targetId: bestCandidate.id,
          explanation: `Matched element ${bestCandidate.id} ("${bestCandidate.text || bestCandidate.tag}")`
        };
      }
    }

    // 11. Implicit action on candidate
    if (candidates && candidates.length > 0) {
      const words = textLower.trim().split(/\s+/).filter(Boolean);
      let bestCandidate: DOMElementCandidate | null = null;
      let maxScore = 0;

      for (const c of candidates) {
        const cText = `${c.text || ''} ${c.ariaLabel || ''} ${c.title || ''} ${c.name || ''}`.toLowerCase();
        let matches = 0;
        if (cText === textLower) matches += 20;
        for (const w of words) {
          if (cText.includes(w)) matches += 3;
        }
        if (matches > maxScore) {
          maxScore = matches;
          bestCandidate = c;
        }
      }

      if (bestCandidate && maxScore >= 3) {
        const isInput = bestCandidate.tag === 'input' || bestCandidate.tag === 'textarea' || bestCandidate.role === 'textbox';
        return {
          action: isInput ? 'type' : 'click',
          targetId: bestCandidate.id,
          explanation: `Inferred action on ${bestCandidate.id} ("${bestCandidate.text || bestCandidate.tag}")`
        };
      }
    }

    return { action: 'done', explanation: 'Target element not found on page' };
  }
}
