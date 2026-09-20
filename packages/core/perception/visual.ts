/**
 * Visual Perception helper for Kevin.
 * Bridges spatial element coordinates with viewport captures.
 */

import type { DOMElementCandidate, DOMElementRect } from '../types.js';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface NormalizedBoundingBox {
  top: number;
  left: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function normalizeBoundingBox(
  rect: DOMElementRect | null | undefined,
  viewport: ViewportSize = { width: 1280, height: 800 }
): NormalizedBoundingBox | null {
  if (!rect) return null;
  const vw = viewport.width || 1280;
  const vh = viewport.height || 800;

  return {
    top: Math.max(0, Math.min(1, rect.y / vh)),
    left: Math.max(0, Math.min(1, rect.x / vw)),
    width: Math.max(0, Math.min(1, rect.width / vw)),
    height: Math.max(0, Math.min(1, rect.height / vh)),
    centerX: Math.max(0, Math.min(1, (rect.x + rect.width / 2) / vw)),
    centerY: Math.max(0, Math.min(1, (rect.y + rect.height / 2) / vh))
  };
}

export function findElementAtPoint(
  candidates: DOMElementCandidate[] = [],
  x: number,
  y: number
): DOMElementCandidate | null {
  if (!Array.isArray(candidates)) return null;

  for (const c of candidates) {
    if (!c.rect) continue;
    const { x: rx, y: ry, width: rw, height: rh } = c.rect;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
      return c;
    }
  }
  return null;
}
