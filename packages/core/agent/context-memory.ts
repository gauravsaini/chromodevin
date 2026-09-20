/**
 * Short-term Conversational and Task Memory for Kevin.
 * Manages conversation turns, resolves entity references ("this", "second one", "that button"),
 * and maintains task/tab state across multi-step execution.
 */

import type { DOMElementCandidate } from '../types.js';

export interface Turn {
  timestamp: number;
  role: 'user' | 'agent' | 'system' | string;
  text: string;
  metadata: Record<string, any>;
}

export interface TabInfo {
  id: number | string;
  url?: string;
  title?: string;
  favIconUrl?: string;
  active?: boolean;
  windowId?: number;
  lastActiveAt?: number;
  closedAt?: number;
}

/**
 * Resolves relative natural language references ("first", "second", "third", "last", "this", "that")
 * to candidate element IDs. Pure function with strict input/output contract.
 */
export function resolveEntityReference(
  phrase: string,
  candidates: DOMElementCandidate[] = [],
  lastTarget: { id?: string } | null = null
): DOMElementCandidate | null {
  if (!phrase || typeof phrase !== 'string' || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const lower = phrase.toLowerCase().trim();

  // Determine subset of candidates based on semantic qualifier in phrase
  let pool = candidates;

  if (/\b(?:completed|done|checked)\b/.test(lower)) {
    const subset = candidates.filter(
      (c) => c.checked === true || c.ariaChecked === true || /\b(completed|done|checked)\b/i.test(c.text || '')
    );
    if (subset.length > 0) pool = subset;
  } else if (/\b(?:active|unchecked|uncompleted|todo)\b/.test(lower)) {
    const subset = candidates.filter(
      (c) => c.checked === false || c.ariaChecked === false || /\b(active|todo)\b/i.test(c.text || '')
    );
    if (subset.length > 0) pool = subset;
  } else if (/\b(?:checkbox|check box|toggle)\b/.test(lower)) {
    const subset = candidates.filter(
      (c) => c.role === 'checkbox' || c.type === 'checkbox' || /checkbox|toggle/i.test(c.text || '')
    );
    if (subset.length > 0) pool = subset;
  } else if (/\b(?:delete|destroy|remove|trash|close)\b/.test(lower)) {
    const subset = candidates.filter(
      (c) => /delete|destroy|remove|trash|close/i.test(`${c.text || ''} ${c.ariaLabel || ''} ${c.name || ''} ${c.id || ''}`)
    );
    if (subset.length > 0) pool = subset;
  } else if (/\b(?:button|btn)\b/.test(lower)) {
    const subset = candidates.filter((c) => c.role === 'button' || c.tag === 'button');
    if (subset.length > 0) pool = subset;
  } else if (/\b(?:link)\b/.test(lower)) {
    const subset = candidates.filter((c) => c.role === 'link' || c.tag === 'a');
    if (subset.length > 0) pool = subset;
  }

  // Ordinal / Positional mapping
  const ordinals: Array<[RegExp, (len: number) => number]> = [
    [/\b(?:first|1st|initial|top)\b/, () => 0],
    [/\b(?:second|2nd)\b/, () => 1],
    [/\b(?:third|3rd)\b/, () => 2],
    [/\b(?:fourth|4th)\b/, () => 3],
    [/\b(?:fifth|5th)\b/, () => 4],
    [/\b(?:sixth|6th)\b/, () => 5],
    [/\b(?:seventh|7th)\b/, () => 6],
    [/\b(?:eighth|8th)\b/, () => 7],
    [/\b(?:ninth|9th)\b/, () => 8],
    [/\b(?:tenth|10th)\b/, () => 9],
    [/\b(?:second to last|penultimate)\b/, (len) => len - 2],
    [/\b(?:last|final|bottom)\b/, (len) => len - 1]
  ];

  for (const [regex, getIdx] of ordinals) {
    if (regex.test(lower)) {
      const idx = getIdx(pool.length);
      if (idx >= 0 && idx < pool.length && pool[idx]) {
        return pool[idx];
      }
    }
  }

  // Numbered item: "item #2", "item 2", "result 3"
  const itemNumMatch = lower.match(/\b(?:item|result|todo|row|task|option|checkbox)\s+(?:#|no\.?\s*)?(\d+)\b/);
  if (itemNumMatch) {
    const numIdx = parseInt(itemNumMatch[1], 10) - 1;
    if (numIdx >= 0 && numIdx < pool.length && pool[numIdx]) {
      return pool[numIdx];
    }
  }

  // Direct state-based selection without explicit ordinal ("click the completed item", "the active filter")
  if (/\b(?:the|that)?\s*(?:completed|checked)\s+(?:item|todo|task|checkbox|filter)?\b/.test(lower)) {
    const completed = candidates.find((c) => c.checked === true || c.ariaChecked === true);
    if (completed) return completed;
  }
  if (/\b(?:the|that)?\s*(?:active|unchecked)\s+(?:item|todo|task|checkbox|filter)?\b/.test(lower)) {
    const active = candidates.find((c) => c.checked === false || c.ariaChecked === false);
    if (active) return active;
  }

  // Pronouns referring to previously focused/clicked element
  if (/\b(this|that|it)\b/.test(lower) && lastTarget?.id) {
    const match = candidates.find((c) => c.id === lastTarget.id);
    if (match) return match;
  }

  return null;
}

export interface ContextMemoryOptions {
  maxTurns?: number;
}

export class ContextMemory {
  public maxTurns: number;
  public turns: Turn[];
  public recentCandidates: DOMElementCandidate[];
  public lastTarget: { id: string; action?: string; timestamp: number } | null;
  public activeTabInfo: TabInfo | null;
  public openTabs: Map<string | number, TabInfo>;
  public tabHistory: TabInfo[];

  constructor(options: ContextMemoryOptions = {}) {
    this.maxTurns = options.maxTurns || 10;
    this.turns = [];
    this.recentCandidates = [];
    this.lastTarget = null;
    this.activeTabInfo = null;
    this.openTabs = new Map();
    this.tabHistory = [];
  }

  addTurn(role: string, text: string, metadata: Record<string, any> = {}): Turn {
    const turn: Turn = {
      timestamp: Date.now(),
      role,
      text,
      metadata
    };
    this.turns.push(turn);
    if (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }
    return turn;
  }

  updateCandidates(candidates: DOMElementCandidate[]): void {
    this.recentCandidates = Array.isArray(candidates) ? candidates.slice(0, 30) : [];
  }

  recordAction(action: any, result: any = null): void {
    if (action?.targetId) {
      this.lastTarget = {
        id: action.targetId,
        action: action.action,
        timestamp: Date.now()
      };
    }
  }

  rememberTab(tab: TabInfo): TabInfo | undefined {
    if (!tab || tab.id === undefined) return;
    const existing = this.openTabs.get(tab.id);
    const updated: TabInfo = {
      ...(existing || {}),
      ...tab,
      lastActiveAt: tab.active ? Date.now() : (existing?.lastActiveAt || Date.now())
    };
    this.openTabs.set(tab.id, updated);
    if (tab.active) {
      this.activeTabInfo = updated;
    }
    return updated;
  }

  forgetTab(tabId: string | number): TabInfo | null {
    const closedTab = this.openTabs.get(tabId);
    if (closedTab) {
      this.tabHistory.unshift({
        ...closedTab,
        closedAt: Date.now()
      });
      if (this.tabHistory.length > 20) {
        this.tabHistory.pop();
      }
      this.openTabs.delete(tabId);
    }

    if (this.activeTabInfo?.id === tabId) {
      const remaining = Array.from(this.openTabs.values())
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
      this.activeTabInfo = remaining[0] || null;
    }

    return this.activeTabInfo;
  }

  getOpenTabs(): TabInfo[] {
    return Array.from(this.openTabs.values());
  }

  getActiveTab(): TabInfo | null {
    return this.activeTabInfo;
  }

  switchActiveTab(tabId: string | number): TabInfo | null {
    const tab = this.openTabs.get(tabId);
    if (tab) {
      tab.active = true;
      tab.lastActiveAt = Date.now();
      this.activeTabInfo = tab;
      for (const [id, t] of this.openTabs.entries()) {
        if (id !== tabId) t.active = false;
      }
    }
    return this.activeTabInfo;
  }

  getTabHistory(): TabInfo[] {
    return [...this.tabHistory];
  }

  resolveEntityReference(
    phrase: string,
    candidates: DOMElementCandidate[] = this.recentCandidates
  ): DOMElementCandidate | null {
    return resolveEntityReference(phrase, candidates, this.lastTarget);
  }

  getConversationSummary(): string {
    return this.turns
      .slice(-4)
      .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
      .join('\n');
  }

  clear(): void {
    this.turns = [];
    this.recentCandidates = [];
    this.lastTarget = null;
    this.activeTabInfo = null;
    this.openTabs.clear();
    this.tabHistory = [];
  }
}
