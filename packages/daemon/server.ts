/**
 * KevinDaemon: WebSocket Server orchestrating local Playwright automation.
 * Bridges Chrome MV3 Extension or external clients to headless Playwright pages.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createKevin } from '../playwright/index.js';
import { handleInferCommand } from './infer.js';
import { isAllowedNavigationUrl } from '../core/security/url-policy.js';

export interface KevinDaemonOptions {
  port?: number;
  host?: string;
  headless?: boolean;
  executablePath?: string;
  browser?: any;
  mockPage?: any;
  authToken?: string;
  rateLimit?: number;
  maxPayloadSize?: number;
  [key: string]: any;
}

function constantTimeCompare(provided: any, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const hashA = createHash('sha256').update(provided).digest();
  const hashB = createHash('sha256').update(expected).digest();
  return timingSafeEqual(hashA, hashB);
}

export class KevinDaemon {
  public options: KevinDaemonOptions;
  public wss: any;
  public browser: any;
  public tabs: Map<string, { page: any; kevin: any }>;
  public tabQueues: Map<string, Promise<any>>;
  public startTime: number;
  public port?: number;

  constructor(options: KevinDaemonOptions = {}) {
    this.options = {
      port: options.port !== undefined ? options.port : 9222,
      host: options.host || '127.0.0.1',
      headless: options.headless !== false,
      rateLimit: options.rateLimit !== undefined ? options.rateLimit : 60,
      maxPayloadSize: options.maxPayloadSize !== undefined ? options.maxPayloadSize : 256 * 1024,
      ...options
    };

    this.wss = null;
    this.browser = options.browser || null;
    this.tabs = new Map();
    this.tabQueues = new Map();
    this.startTime = Date.now();
  }

  getAuthToken(): string | null {
    return this.options.authToken || process.env.KEVIN_DAEMON_TOKEN || null;
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

  async executeTabCommand(msg: any): Promise<any> {
    const { id, type, tabId = 'default' } = msg;
    switch (type) {
      case 'NAVIGATE': {
        if (!msg.url) return { id, success: false, error: 'Missing destination url' };
        const check = isAllowedNavigationUrl(msg.url);
        if (!check.allowed) {
          return { id, success: false, error: check.reason || 'Navigation URL is not allowed' };
        }
        const { page } = await this.getTab(tabId);
        if (typeof page.goto === 'function') {
          await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
        return { id, success: true, url: msg.url };
      }

      case 'OBSERVE': {
        if (msg.url) {
          const check = isAllowedNavigationUrl(msg.url);
          if (!check.allowed) {
            return { id, success: false, error: check.reason || 'Navigation URL is not allowed' };
          }
        }
        const { page, kevin } = await this.getTab(tabId);
        if (msg.url && typeof page.goto === 'function') {
          await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        const snapshot = await kevin.observe();
        return { id, success: true, snapshot };
      }

      case 'PLAN': {
        if (!msg.goal) return { id, success: false, error: 'Missing goal string' };
        if (msg.url) {
          const check = isAllowedNavigationUrl(msg.url);
          if (!check.allowed) {
            return { id, success: false, error: check.reason || 'Navigation URL is not allowed' };
          }
        }
        const { page, kevin } = await this.getTab(tabId);
        if (msg.url && typeof page.goto === 'function') {
          await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        const plan = await kevin.plan(msg.goal);
        return { id, success: true, plan };
      }

      case 'ACT': {
        if (!msg.goal) return { id, success: false, error: 'Missing goal string' };
        if (msg.url) {
          const check = isAllowedNavigationUrl(msg.url);
          if (!check.allowed) {
            return { id, success: false, error: check.reason || 'Navigation URL is not allowed' };
          }
        }
        const { page, kevin } = await this.getTab(tabId);
        if (msg.url && typeof page.goto === 'function') {
          await page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
        const result = await kevin.act(msg.goal);
        return { id, success: true, result };
      }

      default:
        return { id, success: false, error: `Unknown command type: ${type}` };
    }
  }

  /**
   * Process a single JSON-RPC / WebSocket command message.
   * Pure request/response dispatcher.
   */
  async processCommand(msg: any): Promise<any> {
    const maxPayloadSize = this.options.maxPayloadSize ?? 256 * 1024;
    if (typeof msg === 'string') {
      if (Buffer.byteLength(msg, 'utf8') > maxPayloadSize) {
        return { success: false, error: `Payload exceeds maximum limit of ${Math.round(maxPayloadSize / 1024)}KB` };
      }
      try {
        msg = JSON.parse(msg);
      } catch (err: any) {
        return { success: false, error: `Malformed JSON: ${err.message}` };
      }
    } else if (msg && typeof msg === 'object') {
      try {
        if (JSON.stringify(msg).length > maxPayloadSize) {
          return { id: msg.id, success: false, error: `Payload exceeds maximum limit of ${Math.round(maxPayloadSize / 1024)}KB` };
        }
      } catch {}
    }

    if (!msg || typeof msg !== 'object') {
      return { success: false, error: 'Invalid command payload' };
    }

    const { id, type, tabId = 'default' } = msg;

    // Opt-in authentication check with constant-time compare
    const requiredToken = this.getAuthToken();
    if (requiredToken) {
      if (!constantTimeCompare(msg.token, requiredToken)) {
        return {
          id,
          success: false,
          error: 'Unauthorized: invalid or missing auth token'
        };
      }
    }

    try {
      // STATUS and PING execute concurrently
      if (type === 'STATUS' || type === 'PING') {
        return {
          id,
          success: true,
          status: 'ready',
          tabsCount: this.tabs.size,
          uptime: Math.round((Date.now() - this.startTime) / 1000)
        };
      }

      // INFER executes directly
      if (type === 'INFER') {
        return await handleInferCommand(msg);
      }

      // NAVIGATE, ACT, OBSERVE, PLAN serialize per tab
      const tabCommands = new Set(['NAVIGATE', 'OBSERVE', 'PLAN', 'ACT']);
      if (tabCommands.has(type)) {
        const prev = this.tabQueues.get(tabId) || Promise.resolve();
        const runTabCmd = async () => {
          return await this.executeTabCommand(msg);
        };
        const current = prev.catch(() => {}).then(runTabCmd);
        this.tabQueues.set(tabId, current);

        try {
          return await current;
        } finally {
          if (this.tabQueues.get(tabId) === current) {
            this.tabQueues.delete(tabId);
          }
        }
      }

      return { id, success: false, error: `Unknown command type: ${type}` };
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
        const wss = new WebSocketServer({
          port: this.options.port,
          host: this.options.host
        });
        this.wss = wss;

        const cleanupOnFailure = (err: any) => {
          wss.removeListener('listening', onListening);
          try {
            wss.close();
          } catch {}
          this.wss = null;
          reject(err);
        };

        const onError = (err: any) => {
          cleanupOnFailure(err);
        };

        const onListening = () => {
          wss.removeListener('error', onError);
          wss.on('error', () => {});

          const addr = wss.address();
          this.port = typeof addr === 'object' && addr !== null ? addr.port : this.options.port;

          const maxPayloadSize = this.options.maxPayloadSize ?? 256 * 1024;
          const rateLimit = this.options.rateLimit !== undefined ? this.options.rateLimit : 60;

          wss.on('connection', (ws: any) => {
            const messageTimestamps: number[] = [];

            ws.on('message', async (data: any) => {
              const raw = typeof data === 'string' ? data : data.toString();
              const byteLength = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(raw, 'utf8');

              let parsedId: string | undefined;
              const idMatch = raw.slice(0, 1024).match(/"id"\s*:\s*"([^"]+)"/);
              if (idMatch) {
                parsedId = idMatch[1];
              }

              // Per-connection message rate limit
              if (rateLimit > 0) {
                const now = Date.now();
                while (messageTimestamps.length > 0 && messageTimestamps[0] <= now - 60000) {
                  messageTimestamps.shift();
                }
                if (messageTimestamps.length >= rateLimit) {
                  ws.send(
                    JSON.stringify({
                      id: parsedId,
                      success: false,
                      error: `Rate limit exceeded: maximum ${rateLimit} messages per minute`
                    })
                  );
                  return;
                }
                messageTimestamps.push(now);
              }

              // Request size guard (>256KB reject)
              if (byteLength > maxPayloadSize) {
                ws.send(
                  JSON.stringify({
                    id: parsedId,
                    success: false,
                    error: `Payload exceeds maximum limit of ${Math.round(maxPayloadSize / 1024)}KB`
                  })
                );
                return;
              }

              try {
                const msg = JSON.parse(raw);
                const response = await this.processCommand(msg);
                ws.send(JSON.stringify(response));
              } catch (parseErr: any) {
                ws.send(
                  JSON.stringify({
                    id: parsedId,
                    success: false,
                    error: `Malformed JSON: ${parseErr.message}`
                  })
                );
              }
            });
          });

          resolve({ port: this.port || 9222, address: this.options.host || '127.0.0.1' });
        };

        wss.once('error', onError);
        wss.once('listening', onListening);
      } catch (err) {
        this.wss = null;
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
    this.tabQueues.clear();
  }
}
