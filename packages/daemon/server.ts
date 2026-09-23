/**
 * KevinDaemon: WebSocket Server orchestrating local Playwright automation.
 * Bridges Chrome MV3 Extension or external clients to headless Playwright pages.
 */

import { WebSocketServer } from 'ws';
import { createKevin } from '../playwright/index.js';
import { handleInferCommand } from './infer.js';

export interface KevinDaemonOptions {
  port?: number;
  host?: string;
  headless?: boolean;
  executablePath?: string;
  browser?: any;
  mockPage?: any;
  [key: string]: any;
}

export class KevinDaemon {
  public options: KevinDaemonOptions;
  public wss: any;
  public browser: any;
  public tabs: Map<string, { page: any; kevin: any }>;
  public startTime: number;
  public port?: number;

  constructor(options: KevinDaemonOptions = {}) {
    this.options = {
      port: options.port !== undefined ? options.port : 9222,
      host: options.host || '127.0.0.1',
      headless: options.headless !== false,
      ...options
    };

    this.wss = null;
    this.browser = options.browser || null;
    this.tabs = new Map();
    this.startTime = Date.now();
  }

  async getBrowser(): Promise<any> {
    if (this.browser) return this.browser;

    const { chromium } = await import('playwright');
    const launchOptions = {
      headless: this.options.headless,
      ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {})
    };

    this.browser = await chromium.launch(launchOptions);
    return this.browser;
  }

  async getTab(tabId = 'default'): Promise<{ page: any; kevin: any }> {
    if (this.tabs.has(tabId)) {
      return this.tabs.get(tabId)!;
    }

    if (this.options.mockPage) {
      const page = this.options.mockPage;
      const kevin = await createKevin(page, this.options);
      const entry = { page, kevin };
      this.tabs.set(tabId, entry);
      return entry;
    }

    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const kevin = await createKevin(page, this.options);
    const entry = { page, kevin };
    this.tabs.set(tabId, entry);
    return entry;
  }

  /**
   * Process a single JSON-RPC / WebSocket command message.
   * Pure request/response dispatcher.
   */
  async processCommand(msg: any): Promise<any> {
    if (!msg || typeof msg !== 'object') {
      return { success: false, error: 'Invalid command payload' };
    }

    const { id, type, tabId = 'default' } = msg;

    try {
      switch (type) {
        case 'STATUS':
        case 'PING': {
          return {
            id,
            success: true,
            status: 'ready',
            tabsCount: this.tabs.size,
            uptime: Math.round((Date.now() - this.startTime) / 1000)
          };
        }

        case 'NAVIGATE': {
          if (!msg.url) return { id, success: false, error: 'Missing destination url' };
          const { page } = await this.getTab(tabId);
          if (typeof page.goto === 'function') {
            await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
          return { id, success: true, url: msg.url };
        }

        case 'OBSERVE': {
          const { page, kevin } = await this.getTab(tabId);
          if (msg.url && typeof page.goto === 'function') {
            await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          }
          const snapshot = await kevin.observe();
          return { id, success: true, snapshot };
        }

        case 'PLAN': {
          if (!msg.goal) return { id, success: false, error: 'Missing goal string' };
          const { page, kevin } = await this.getTab(tabId);
          if (msg.url && typeof page.goto === 'function') {
            await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          }
          const plan = await kevin.plan(msg.goal);
          return { id, success: true, plan };
        }

        case 'ACT': {
          if (!msg.goal) return { id, success: false, error: 'Missing goal string' };
          const { page, kevin } = await this.getTab(tabId);
          if (msg.url && typeof page.goto === 'function') {
            await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          }
          const result = await kevin.act(msg.goal);
          return { id, success: true, result };
        }

        case 'INFER': {
          return await handleInferCommand(msg);
        }

        default:
          return { id, success: false, error: `Unknown command type: ${type}` };
      }
    } catch (err: any) {
      return { id, success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Starts the WebSocket server.
   */
  async start(): Promise<{ port: number; address: string }> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.options.port,
          host: this.options.host
        });

        this.wss.on('error', (err: any) => reject(err));

        this.wss.on('listening', () => {
          const addr = this.wss.address();
          this.port = typeof addr === 'object' && addr !== null ? addr.port : this.options.port;

          this.wss.on('connection', (ws: any) => {
            ws.on('message', async (data: any) => {
              try {
                const msg = JSON.parse(data.toString());
                const response = await this.processCommand(msg);
                ws.send(JSON.stringify(response));
              } catch (parseErr: any) {
                ws.send(
                  JSON.stringify({
                    success: false,
                    error: `Malformed JSON: ${parseErr.message}`
                  })
                );
              }
            });
          });

          resolve({ port: this.port || 9222, address: this.options.host || '127.0.0.1' });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stops the WebSocket server and closes browser resources.
   */
  async stop(): Promise<void> {
    if (this.wss) {
      await new Promise((r) => this.wss.close(r));
      this.wss = null;
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.tabs.clear();
  }
}
