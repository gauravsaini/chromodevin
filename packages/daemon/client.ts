import type { InferenceTransport, InferRequest, InferResponse } from '../core/ai/nano-client.js';

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeoutId: any;
}

export interface KevinDaemonClientOptions {
  token?: string;
  authToken?: string;
  [key: string]: any;
}

export type { InferenceTransport, InferRequest, InferResponse };

export class KevinDaemonClient implements InferenceTransport {
  public url: string;
  public options: KevinDaemonClientOptions;
  public ws: any;
  public pending: Map<string, PendingRequest>;
  public nextId: number;
  public connected: boolean;

  constructor(url = 'ws://127.0.0.1:9222', options: KevinDaemonClientOptions = {}) {
    this.url = url;
    this.options = { ...options };
    if (options.authToken && !this.options.token) {
      this.options.token = options.authToken;
    }
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
  }

  async connect(timeout = 3000): Promise<boolean> {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      return true;
    }

    const WebSocketImpl = globalThis.WebSocket || (await (import('ws') as Promise<any>)).WebSocket;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection to Kevin Daemon timed out at ${this.url}`));
      }, timeout);

      try {
        this.ws = new (WebSocketImpl as any)(this.url);

        this.ws.onopen = () => {
          clearTimeout(timer);
          this.connected = true;
          resolve(true);
        };

        this.ws.onmessage = (event: any) => {
          try {
            const data = typeof event.data === 'string' ? event.data : event.data.toString();
            const msg = JSON.parse(data);
            if (msg.id && this.pending.has(msg.id)) {
              const { resolve, timeoutId } = this.pending.get(msg.id)!;
              clearTimeout(timeoutId);
              this.pending.delete(msg.id);
              resolve(msg);
            } else if (!msg.id && msg.success === false && msg.error) {
              for (const [id, { reject, timeoutId }] of this.pending.entries()) {
                clearTimeout(timeoutId);
                reject(new Error(msg.error));
              }
              this.pending.clear();
            }
          } catch {
            // Ignore parse errors on broadcast
          }
        };

        this.ws.onerror = (err: any) => {
          clearTimeout(timer);
          this.connected = false;
          reject(err);
        };

        this.ws.onclose = (event: any) => {
          this.connected = false;
          const reason = event?.reason ? `: ${event.reason}` : '';
          for (const [id, { reject, timeoutId }] of this.pending.entries()) {
            clearTimeout(timeoutId);
            reject(new Error(`WebSocket connection closed${reason}`));
          }
          this.pending.clear();
        };
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async send(type: string, payload: Record<string, any> = {}, timeout = 10000): Promise<any> {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      await this.connect();
    }

    const id = `req-${this.nextId++}`;
    const msg: Record<string, any> = { id, type, ...payload };
    const token = this.options.token || this.options.authToken;
    if (token && msg.token === undefined) {
      msg.token = token;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Daemon request ${type} [${id}] timed out after ${timeout}ms`));
        }
      }, timeout);

      this.pending.set(id, { resolve, reject, timeoutId });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async status(): Promise<any> {
    return this.send('STATUS');
  }

  async navigate(url: string, tabId?: string): Promise<any> {
    return this.send('NAVIGATE', { url, tabId });
  }

  async observe(tabId?: string, url?: string): Promise<any> {
    return this.send('OBSERVE', { tabId, url });
  }

  async plan(goal: string, tabId?: string, url?: string): Promise<any> {
    return this.send('PLAN', { goal, tabId, url });
  }

  async act(goal: string, tabId?: string, url?: string): Promise<any> {
    return this.send('ACT', { goal, tabId, url });
  }

  async infer(req: InferRequest): Promise<InferResponse> {
    const { id: _id, type: _type, ...payload } = req;
    return this.send('INFER', payload);
  }

  close(): void {
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
