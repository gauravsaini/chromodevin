/**
 * WebMCP Integration Module for Kevin.
 * Detects website-declared structured MCP tools on web pages.
 * Prioritizes direct tool invocation (e.g. searchProducts, addToCart)
 * over heuristic DOM clicking when sites expose them.
 */

import type { WebMcpTool } from '../types.js';

export class WebMcpClient {
  /**
   * Scans document/window for exposed WebMCP declarations.
   */
  detectTools(win: any = typeof window !== 'undefined' ? window : null): WebMcpTool[] {
    if (!win) return [];

    // 1. In-memory window tools
    if (Array.isArray(win.__webMcpTools)) {
      return this.normalizeTools(win.__webMcpTools);
    }

    // 2. Embedded JSON-LD/schema script tags
    if (win.document?.querySelectorAll) {
      const scriptTags = win.document.querySelectorAll('script[type="application/webmcp+json"]');
      for (const script of scriptTags) {
        try {
          const parsed = JSON.parse(script.textContent || '{}');
          if (Array.isArray(parsed.tools)) {
            return this.normalizeTools(parsed.tools);
          }
        } catch (e) {
          // invalid json, ignore
        }
      }
    }

    return [];
  }

  normalizeTools(rawTools: any[]): WebMcpTool[] {
    return rawTools
      .map((t) => ({
        name: String(t.name || ''),
        description: String(t.description || ''),
        parameters: t.parameters || {},
        handler: typeof t.handler === 'function' ? t.handler : undefined
      }))
      .filter((t) => t.name.length > 0);
  }

  findToolForGoal(tools: WebMcpTool[], userGoal: string, minMatches: number = 2): WebMcpTool | null {
    if (!tools || !tools.length || !userGoal) return null;
    const goalTokens = userGoal
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (!goalTokens.length) return null;

    let bestTool: WebMcpTool | null = null;
    let maxMatches = 0;

    for (const tool of tools) {
      const toolText = `${tool.name} ${tool.description || ''}`.toLowerCase();
      const nameLower = tool.name.toLowerCase();
      const nameTokens = tool.name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1);

      let matches = 0;
      let hasNameMatch = false;

      for (const token of goalTokens) {
        if (toolText.includes(token)) {
          matches++;
        }
        if (
          nameTokens.includes(token) ||
          nameLower === token ||
          (token.length > 2 && nameLower.includes(token))
        ) {
          hasNameMatch = true;
        }
      }

      const qualifies = matches >= minMatches || hasNameMatch;
      if (qualifies && matches > maxMatches) {
        maxMatches = matches;
        bestTool = tool;
      }
    }

    return bestTool;
  }

  async invokeTool(tool: WebMcpTool, args: any = {}): Promise<{ success: boolean; result?: any; error?: string }> {
    if (!tool || typeof tool.handler !== 'function') {
      return { success: false, error: 'Tool handler is not executable' };
    }
    try {
      const result = await tool.handler(args);
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }
}

export const webMcpClient = new WebMcpClient();
