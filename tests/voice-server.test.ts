/**
 * Unit tests for KevinVoiceServer HTTP + WebSocket bridge.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import wsPkg, { WebSocket as WS } from 'ws';
import { KevinVoiceServer } from '../packages/daemon/voice-server.js';
import { VoiceBrowserController } from '../packages/playwright/voice-controller.js';

const WebSocketClient = WS || (wsPkg as any)?.WebSocket || wsPkg;

test('KevinVoiceServer serves control UI and accepts WebSocket connections', async () => {
  const mockPage = {
    url: () => 'https://example.com',
    evaluate: async () => true,
    waitForLoadState: async () => {}
  };

  const controller = new VoiceBrowserController({
    page: mockPage,
    debounceMs: 20,
    decideFn: () => ({
      answers: {
        is_command: { type: 'noul', noul: 0.95 },
        intent: { type: 'choice', choice: 'scroll_down', confidence: 0.95, probabilities: {} },
        complete: { type: 'noul', noul: 0.95 },
        scroll_amount: { type: 'score', score: 1, confidence: 0.8, probabilities: [0.1, 0.8, 0.1] },
        tab_direction: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: {} }
      },
      candidates: { text: [], url: [] },
      latencyMs: 3,
      telemetry: { model: 'mock', family: 'mock', mode: 'test', forwardCalls: 1 }
    })
  });

  const server = new KevinVoiceServer({
    port: 9876,
    controller
  });

  const { port, host } = await server.start();
  assert.strictEqual(port, 9876);

  // Test HTTP GET /
  const htmlContent: string = await new Promise((resolve, reject) => {
    http.get(`http://${host}:${port}/`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });

  assert.ok(htmlContent.includes('Kevin Voice Browser'), 'HTML contains app title');
  assert.ok(htmlContent.includes('Start Mic'), 'HTML contains mic button');

  // Test WebSocket connection
  const ws = new WebSocketClient(`ws://${host}:${port}`);
  const connectedMsg = await new Promise<string>((resolve) => {
    ws.on('message', (data: any) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'STATUS') resolve(parsed.msg);
    });
  });

  assert.ok(connectedMsg.includes('connected'));

  ws.close();
  await server.stop();
});
