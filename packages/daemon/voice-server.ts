/**
 * Kevin Voice Browser Server: HTTP + WebSocket server connecting Web Speech API
 * in any standard browser to Kevin's high-speed, on-device Playwright automation.
 */

import http from 'node:http';
import wsPkg, { WebSocketServer as WSS } from 'ws';
import { VoiceBrowserController } from '../playwright/voice-controller.js';
import { PlaywrightBrowserEngine } from '../playwright/driver.js';

const WebSocketServer = WSS || (wsPkg as any)?.WebSocketServer || (wsPkg as any)?.Server;

export interface VoiceServerOptions {
  port?: number;
  host?: string;
  page?: any;
  controller?: VoiceBrowserController;
  mockPage?: any;
}

export const CONTROL_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kevin Voice Browser</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --sub: #9ca3af;
      --primary: #3b82f6;
      --accent: #10b981;
      --amber: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .badge { font-size: 11px; background: rgba(59, 130, 246, 0.2); color: var(--primary); padding: 3px 8px; border-radius: 999px; }
    .mic-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      align-items: center;
    }
    button.mic-btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    button.mic-btn.active {
      background: #ef4444;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    input.cmd-input {
      flex: 1;
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 12px 16px;
      border-radius: 8px;
      outline: none;
    }
    input.cmd-input:focus { border-color: var(--primary); }
    .transcript-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      min-height: 64px;
      margin-bottom: 24px;
      font-size: 16px;
    }
    .transcript-box .interim { color: var(--sub); font-style: italic; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .stat-val { font-size: 20px; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 12px; color: var(--sub); text-transform: uppercase; }
    .log-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      max-height: 320px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 13px;
    }
    .log-line { margin-bottom: 4px; }
    .log-line.act { color: #60a5fa; }
    .log-line.warn { color: var(--amber); }
    .log-line.error { color: #f87171; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Kevin Voice Browser <span class="badge">ON-DEVICE / SUB-60MS</span></h1>
      <div id="status" style="font-size: 13px; color: var(--sub);">Connecting...</div>
    </header>

    <div class="mic-bar">
      <button id="mic-toggle" class="mic-btn">
        <span id="mic-icon">🎙️</span>
        <span id="mic-label">Start Mic</span>
      </button>
      <input id="cmd-input" class="cmd-input" type="text" placeholder="Or type a command (e.g. go to wikipedia, search for alan turing)..." />
    </div>

    <div class="transcript-box">
      <span id="transcript-final"></span>
      <span id="transcript-interim" class="interim">Waiting for speech...</span>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val" id="stat-latency">&lt;15ms</div>
        <div class="stat-label">Model Forward</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-actions">0</div>
        <div class="stat-label">Actions Executed</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-cost">$0.00</div>
        <div class="stat-label">Local Token Cost</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="stat-model">LFM2.5</div>
        <div class="stat-label">Local ONNX Head</div>
      </div>
    </div>

    <div class="log-card" id="log-container">
      <div class="log-line">System ready. Click Start Mic or enter a command above.</div>
    </div>
  </div>

  <script>
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(\`\${wsProto}//\${location.host}\`);
    const statusEl = document.getElementById('status');
    const micBtn = document.getElementById('mic-toggle');
    const micLabel = document.getElementById('mic-label');
    const cmdInput = document.getElementById('cmd-input');
    const finalSpan = document.getElementById('transcript-final');
    const interimSpan = document.getElementById('transcript-interim');
    const logEl = document.getElementById('log-container');
    const actCountEl = document.getElementById('stat-actions');

    let actionsCount = 0;
    let recognition = null;
    let isListening = false;
    let utteranceGen = 0;

    ws.onopen = () => { statusEl.textContent = 'Connected (127.0.0.1)'; statusEl.style.color = '#10b981'; };
    ws.onclose = () => { statusEl.textContent = 'Disconnected'; statusEl.style.color = '#ef4444'; };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'ACTION') {
        actionsCount++;
        actCountEl.textContent = actionsCount;
        appendLog('act', \`✓ \${msg.detail || msg.action?.action}\`);
      } else if (msg.type === 'LOG') {
        appendLog(msg.level, msg.msg);
      }
    };

    function appendLog(level, text) {
      const line = document.createElement('div');
      line.className = \`log-line \${level}\`;
      line.textContent = \`[\${new Date().toLocaleTimeString()}] \${text}\`;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && cmdInput.value.trim()) {
        const text = cmdInput.value.trim();
        ws.send(JSON.stringify({ type: 'TRANSCRIPT', text, final: true, utteranceId: 'typed-' + Date.now() }));
        finalSpan.textContent = text;
        interimSpan.textContent = '';
        cmdInput.value = '';
      }
    });

    // Web Speech API
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += trans;
          } else {
            interim += trans;
          }
        }
        finalSpan.textContent = final;
        interimSpan.textContent = interim;
        const sendText = final || interim;
        if (sendText.trim()) {
          ws.send(JSON.stringify({
            type: 'TRANSCRIPT',
            text: sendText.trim(),
            final: Boolean(final),
            utteranceId: 'utt-' + utteranceGen
          }));
          if (final) utteranceGen++;
        }
      };

      recognition.onerror = (err) => {
        appendLog('warn', 'Speech recognizer: ' + (err.error || err));
      };

      recognition.onend = () => {
        if (isListening) recognition.start();
      };

      micBtn.onclick = () => {
        if (!isListening) {
          recognition.start();
          isListening = true;
          micBtn.classList.add('active');
          micLabel.textContent = 'Listening...';
        } else {
          isListening = false;
          recognition.stop();
          micBtn.classList.remove('active');
          micLabel.textContent = 'Start Mic';
        }
      };
    } else {
      micBtn.disabled = true;
      micLabel.textContent = 'Speech API Unavailable';
      appendLog('warn', 'Web Speech API not supported in this browser. Use Chrome or Edge, or type in the box above.');
    }
  </script>
</body>
</html>`;

export class KevinVoiceServer {
  public options: VoiceServerOptions;
  public server: http.Server | null;
  public wss: any;
  public controller: VoiceBrowserController | null;

  constructor(options: VoiceServerOptions = {}) {
    this.options = {
      port: options.port || 8787,
      host: options.host || '127.0.0.1',
      ...options
    };
    this.server = null;
    this.wss = null;
    this.controller = options.controller || null;
  }

  async start(): Promise<{ port: number; host: string; url: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(CONTROL_HTML);
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws: any) => {
        ws.send(JSON.stringify({ type: 'STATUS', msg: 'Kevin voice server connected' }));

        ws.on('message', (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'TRANSCRIPT' && this.controller) {
              this.controller.handleTranscript({
                text: msg.text,
                final: Boolean(msg.final),
                utteranceId: msg.utteranceId || 'default'
              });
            }
          } catch {
            // ignore parse errors
          }
        });
      });

      if (this.controller) {
        this.controller.on('action', (entry) => {
          this._broadcast({ type: 'ACTION', ...entry });
        });
        this.controller.on('decision', (decision) => {
          this._broadcast({ type: 'DECISION', ...decision });
        });
        this.controller.on('log', (entry) => {
          this._broadcast({ type: 'LOG', ...entry });
        });
      }

      this.server.listen(this.options.port, this.options.host, () => {
        const port = this.options.port || 8787;
        const host = this.options.host || '127.0.0.1';
        resolve({ port, host, url: `http://${host}:${port}` });
      });

      this.server.on('error', (err) => reject(err));
    });
  }

  _broadcast(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  async stop(): Promise<void> {
    if (this.wss) {
      await new Promise((r) => this.wss.close(r));
      this.wss = null;
    }
    if (this.server) {
      await new Promise((r) => this.server?.close(r));
      this.server = null;
    }
    if (this.controller) {
      await this.controller.close();
    }
  }
}
