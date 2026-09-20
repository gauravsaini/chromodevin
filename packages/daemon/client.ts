/**
 * KevinDaemonClient: WebSocket client bridge for Chrome MV3 Extension and external tools.
 * Works seamlessly in both Node.js (via globalThis.WebSocket or ws) and browser environments.
 */

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeoutId: any;
}

export class KevinDaemonClient {
  public url: string;
  public options: any;
  public ws: any;
  public pending: Map<string, PendingRequest>;
  public nextId: number;
  public connected: boolean;

  constructor(url = 'ws://127.0.0.1:9222', options: any = {}) {
    this.url = url;
    this.options = options;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
  }

  async connect(timeout = 3000): Promise<boolean> {
    if (this.connected && this.ws && this.ws.readyState === 1) {
      return true;
    }

    const WebSocketImpl = globalThis.WebSocket || (await import('ws')).WebSocket;

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

        this.ws.onclose = () => {
          this.connected = false;
          for (const [id, { reject, timeoutId }] of this.pending.entries()) {
            clearTimeout(timeoutId);
            reject(new Error('WebSocket connection closed'));
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
    const msg = { id, type, ...payload };

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

  close(): void {
    this.connected = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
