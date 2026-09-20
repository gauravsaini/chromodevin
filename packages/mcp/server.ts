/**
 * Kevin MCP Server: Model Context Protocol implementation for high-speed browser automation.
 * Exposes kevin_act, kevin_observe, kevin_plan, and kevin_navigate over JSON-RPC 2.0.
 */

import { createKevin, type KevinPlaywrightAgent } from '../playwright/index.js';

export const MCP_TOOLS = [
  {
    name: 'kevin_act',
    description: 'Execute a natural language browser action or compound goal using Kevin System 1 decision engine and Playwright.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: "Instruction, e.g. 'Click the Checkout button', 'Search for headphones'"
        },
        url: {
          type: 'string',
          description: 'Optional URL to navigate to before performing the action'
        }
      },
      required: ['goal']
    }
  },
  {
    name: 'kevin_observe',
    description: 'Observe current page state, returning interactive candidate elements, accessibility tree, and title.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to navigate to before observing'
        }
      }
    }
  },
  {
    name: 'kevin_plan',
    description: 'Plan the next action payload for a goal without executing side-effects.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'The natural language goal to plan next action for'
        },
        url: {
          type: 'string',
          description: 'Optional URL to navigate to before planning'
        }
      },
      required: ['goal']
    }
  },
  {
    name: 'kevin_navigate',
    description: 'Navigate browser to a specified destination URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Destination URL'
        }
      },
      required: ['url']
    }
  }
];

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpContext {
  executeTool: (name: string, args?: Record<string, any>) => Promise<any>;
}

export async function handleJsonRpcRequest(
  message: JsonRpcRequest | any,
  context: McpContext | any = {}
): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid message payload' }
    };
  }

  const { id, method, params } = message;

  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      return null;
    }
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'kevin-mcp', version: '0.1.0' }
          }
        };

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: MCP_TOOLS }
        };

      case 'tools/call': {
        const { name, arguments: toolArgs = {} } = params || {};
        if (!name) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing required tool name' }
          };
        }

        const toolResult = await context.executeTool(name, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)
              }
            ],
            isError: false
          }
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${err?.message || String(err)}`
          }
        ],
        isError: true
      }
    };
  }
}

export class KevinMcpServer {
  public options: any;
  public page: any;
  public browser: any;
  public kevin: KevinPlaywrightAgent | null;

  constructor(options: any = {}) {
    this.options = options;
    this.page = options.page || null;
    this.browser = options.browser || null;
    this.kevin = null;
  }

  async getPage(): Promise<any> {
    if (this.page) return this.page;

    const { chromium } = await import('playwright');
    const launchOptions = {
      headless: this.options.headless !== false,
      ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {})
    };

    this.browser = await chromium.launch(launchOptions);
    this.page = await this.browser.newPage();
    return this.page;
  }

  async getKevin(): Promise<KevinPlaywrightAgent> {
    if (this.kevin) return this.kevin;
    const page = await this.getPage();
    this.kevin = await createKevin(page, this.options);
    return this.kevin;
  }

  async executeTool(name: string, args: Record<string, any> = {}): Promise<any> {
    const page = await this.getPage();
    const kevin = await this.getKevin();

    if (args.url && (name !== 'kevin_navigate' || typeof page.goto === 'function')) {
      if (typeof page.goto === 'function') {
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
    }

    switch (name) {
      case 'kevin_act': {
        if (!args.goal) throw new Error('Missing required argument: goal');
        return await kevin.act(args.goal);
      }

      case 'kevin_observe': {
        return await kevin.observe();
      }

      case 'kevin_plan': {
        if (!args.goal) throw new Error('Missing required argument: goal');
        return await kevin.plan(args.goal);
      }

      case 'kevin_navigate': {
        if (!args.url) throw new Error('Missing required argument: url');
        if (typeof page.goto === 'function') {
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        return { success: true, url: args.url, message: `Navigated to ${args.url}` };
      }

      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }

  async handleMessage(message: JsonRpcRequest | any): Promise<JsonRpcResponse | null> {
    return handleJsonRpcRequest(message, {
      executeTool: (name: string, args?: Record<string, any>) => this.executeTool(name, args)
    });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.page = null;
    this.kevin = null;
  }
}
