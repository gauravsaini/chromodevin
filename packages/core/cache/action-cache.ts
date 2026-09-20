/**
 * ActionCache: Local, self-healing selector and action cache for sub-1ms repeat execution.
 * Strict pure contract: deterministic cache keys computed from (URL, DOM fingerprint, instruction).
 */

import { createHash } from 'node:crypto';
import type { DOMSnapshot, ActionPayload } from '../types.js';

export interface CacheEntry {
  payload: ActionPayload;
  hits: number;
  createdAt: number;
  lastAccessed: number;
}

export interface ActionCacheOptions {
  maxSize?: number;
}

/**
 * Computes a deterministic, lightweight fingerprint of a page snapshot's DOM structure.
 * Pure function: (snapshot) -> string
 */
export function computeDomFingerprint(snapshot: DOMSnapshot | any): string {
  if (!snapshot || !Array.isArray(snapshot.elements) || snapshot.elements.length === 0) {
    return 'empty';
  }

  const signatureTokens = snapshot.elements.slice(0, 30).map((el: any) => {
    const tag = el.tag || 'div';
    const role = el.role || '';
    const textLen = (el.text || '').length;
    return `${tag}:${role}:${textLen}`;
  });

  return createHash('sha256')
    .update(signatureTokens.join('|'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Computes normalized cache key.
 * Pure function: (url, domFingerprint, instruction) -> string
 */
export function computeCacheKey(url: string, domFingerprint: string, instruction: string): string {
  let normUrl = '';
  try {
    const parsed = new URL(url || 'http://localhost');
    const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
    const hash = parsed.hash || '';
    normUrl = `${parsed.origin}${pathname}${hash}`.toLowerCase();
  } catch {
    normUrl = (url || '').split('?')[0].toLowerCase();
  }

  const normInstr = (instruction || '').trim().toLowerCase();
  const normFp = domFingerprint || 'empty';

  return `${normUrl}::${normFp}::${normInstr}`;
}

/**
 * ActionCache class: LRU cache for self-healing action targets.
 */
export class ActionCache {
  public maxSize: number;
  public cache: Map<string, CacheEntry>;

  constructor(options: ActionCacheOptions = {}) {
    this.maxSize = options.maxSize || 500;
    this.cache = new Map();
  }

  get(url: string, domFingerprint: string, instruction: string): (ActionPayload & { hits?: number }) | null {
    const key = computeCacheKey(url, domFingerprint, instruction);
    const entry = this.cache.get(key);
    if (!entry) return null;

    this.cache.delete(key);
    entry.hits = (entry.hits || 0) + 1;
    entry.lastAccessed = Date.now();
    this.cache.set(key, entry);

    return { ...entry.payload, hits: entry.hits };
  }

  set(url: string, domFingerprint: string, instruction: string, payload: any): void {
    if (!payload || !payload.targetId) return;

    const key = computeCacheKey(url, domFingerprint, instruction);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      payload: { ...payload },
      hits: 1,
      createdAt: Date.now(),
      lastAccessed: Date.now()
    });
  }

  invalidate(url: string, instruction?: string): number {
    let count = 0;
    const normUrl = (url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
    const normInstr = instruction ? instruction.trim().toLowerCase() : null;

    for (const [key] of this.cache.entries()) {
      const [keyUrl, , keyInstr] = key.split('::');
      const urlMatches = !normUrl || keyUrl === normUrl;
      const instrMatches = !normInstr || keyInstr === normInstr;

      if (urlMatches && instrMatches) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
