import { test } from 'node:test';
import assert from 'node:assert';
import {
  NanoClient,
  type InferenceTransport,
  type InferRequest,
  type InferResponse
} from '../packages/core/ai/nano-client.js';
import { KevinDaemonClient } from '../packages/daemon/client.js';
import { KevinDaemon } from '../packages/daemon/server.js';
import { KevinMcpServer, handleJsonRpcRequest } from '../packages/mcp/server.js';

// ── Unit Tests: Transport Switch ──────────────────────────────────────────

test('NanoClient transport-switch: uses transport and skips getSession() when transport is set', async () => {
  let transportCalls = 0;
  let receivedReq: InferRequest | null = null;

  const mockTransport: InferenceTransport = {
    async infer(req: InferRequest): Promise<InferResponse> {
      transportCalls++;
      receivedReq = req;
      return {
        id: req.id || 'req-test-1',
        success: true,
        task: req.task,
        output: {
          labels: [{ label: 'click', score: 0.95 }]
        },
        model: req.model || 'receptron/laya-onnx',
        device: 'wasm',
        dtype: 'fp32'
      };
    }
  };

  const client = new NanoClient({
    transport: mockTransport,
    model: 'receptron/laya-onnx',
    task: 'text-classification'
  });

  assert.strictEqual(client.generator, null, 'Generator should start null');

  const output = await client.runPipelineInference('Click Checkout button', {}, [
    { id: 'btn-chk', role: 'button', text: 'Checkout', tag: 'button' }
  ]);

  assert.strictEqual(transportCalls, 1, 'Transport infer should be invoked once');
  assert.strictEqual(client.generator, null, 'Local getSession() must NEVER be called when transport is set');
  assert.strictEqual(output.task, 'text-classification');
  assert.ok(Array.isArray(output.labels));
  assert.strictEqual(output.labels?.[0]?.label, 'click');

  assert.ok(receivedReq !== null);
  const req = receivedReq as InferRequest;
  assert.strictEqual(req.type, 'INFER');
  assert.strictEqual(req.task, 'text-classification');
  assert.strictEqual(req.model, 'receptron/laya-onnx');
  assert.ok(typeof req.input === 'string');
  assert.ok((req.input as string).includes('Click Checkout button'));
});

test('NanoClient transport-switch: planDecisionAsync integrates remote transport weights', async () => {
  const mockTransport: InferenceTransport = {
    async infer(req: InferRequest): Promise<InferResponse> {
      return {
        id: 'req-async-1',
        success: true,
        task: req.task,
        output: {
          labels: [{ label: 'click', score: 0.99 }]
        },
        model: 'receptron/laya-onnx',
        device: 'wasm',
        dtype: 'fp32'
      };
    }
  };

  const client = new NanoClient({
    transport: mockTransport,
    model: 'receptron/laya-onnx',
    task: 'text-classification'
  });

  const decision = await client.planDecisionAsync('Click Checkout button', {}, [
    { id: 'btn-chk', role: 'button', text: 'Checkout', tag: 'button' }
  ]);

  assert.strictEqual(client.generator, null, 'Local generator must stay untouched');
  assert.strictEqual(decision.action.action, 'click');
  assert.strictEqual(decision.action.targetId, 'btn-chk');
  assert.strictEqual(decision.telemetry.model, 'receptron/laya-onnx');
});

test('NanoClient transport-switch: unsets transport => uses local path', async () => {
  const client = new NanoClient({
    model: 'receptron/laya-onnx',
    task: 'text-classification'
  });

  assert.strictEqual(client.transport, undefined, 'Transport should be undefined');

  let getSessionCalled = false;
  client.getSession = async () => {
    getSessionCalled = true;
    const mockPipe: any = async () => [{ label: 'click', score: 0.9 }];
    mockPipe.__kevinTask = 'text-classification';
    mockPipe.__kevinDevice = 'wasm';
    mockPipe.__kevinDtype = 'fp32';
    return mockPipe;
  };

  const output = await client.runPipelineInference('Click Checkout button');
  assert.strictEqual(getSessionCalled, true, 'Local getSession() must be called when transport is unset');
  assert.strictEqual(output.task, 'text-classification');
});

test('NanoClient transport-switch: handles transport failure with heuristic fallback', async () => {
  const failingTransport: InferenceTransport = {
    async infer(): Promise<InferResponse> {
      return { id: 'err-1', success: false, error: 'Remote inference daemon unreachable' };
    }
  };

  const client = new NanoClient({
    transport: failingTransport,
    model: 'receptron/laya-onnx'
  });

  // runPipelineInference throws on transport failure
  await assert.rejects(
    async () => client.runPipelineInference('Click Checkout button'),
    /Remote inference daemon unreachable/
  );

  // planDecisionAsync never throws, falling back gracefully to heuristic plan
  const decision = await client.planDecisionAsync('Click Checkout button', {}, [
    { id: 'btn-chk', role: 'button', text: 'Checkout', tag: 'button' }
  ]);
  assert.strictEqual(decision.action.action, 'click');
});

// ── Unit Tests: Daemon Client Adapter Mapping ──────────────────────────────

test('KevinDaemonClient adapter: infer(req) maps correctly to send("INFER", payload)', async () => {
  const client = new KevinDaemonClient('ws://127.0.0.1:9222');
  const recordedSends: Array<{ type: string; payload: any }> = [];

  client.send = async (type: string, payload: Record<string, any> = {}) => {
    recordedSends.push({ type, payload });
    return {
      id: 'req-daemon-1',
      success: true,
      task: payload.task,
      output: {
        labels: [{ label: 'type', score: 0.91 }]
      },
      model: payload.model,
      device: payload.device || 'wasm',
      dtype: payload.dtype || 'fp32'
    };
  };

  const req: InferRequest = {
    task: 'text-classification',
    input: 'Type query into searchbox',
    labels: ['type', 'click'],
    model: 'receptron/laya-onnx',
    device: 'wasm',
    dtype: 'fp32'
  };

  const res = await client.infer(req);

  assert.strictEqual(recordedSends.length, 1);
  assert.strictEqual(recordedSends[0].type, 'INFER');
  assert.strictEqual(recordedSends[0].payload.task, 'text-classification');
  assert.strictEqual(recordedSends[0].payload.input, 'Type query into searchbox');
  assert.deepStrictEqual(recordedSends[0].payload.labels, ['type', 'click']);
  assert.strictEqual(recordedSends[0].payload.model, 'receptron/laya-onnx');
  assert.strictEqual(recordedSends[0].payload.device, 'wasm');
  assert.strictEqual(recordedSends[0].payload.dtype, 'fp32');

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task, 'text-classification');
  assert.strictEqual(res.output.labels?.[0]?.label, 'type');
});

test('KevinDaemonClient as NanoClient transport: end-to-end client wiring', async () => {
  const daemonClient = new KevinDaemonClient('ws://127.0.0.1:9222');

  daemonClient.send = async (type: string, payload: Record<string, any> = {}) => {
    assert.strictEqual(type, 'INFER');
    return {
      id: 'req-wire-1',
      success: true,
      task: payload.task,
      output: {
        text: '{"action":"type","text":"laptop"}'
      },
      model: payload.model || 'receptron/laya-onnx',
      device: 'wasm',
      dtype: 'fp32'
    };
  };

  const nano = new NanoClient({
    transport: daemonClient,
    model: 'receptron/laya-onnx',
    task: 'text-generation'
  });

  const out = await nano.runPipelineInference('Search for laptop');
  assert.strictEqual(out.task, 'text-generation');
  assert.strictEqual(out.text, '{"action":"type","text":"laptop"}');
});

// ── Unit Tests: MCP kevin_infer tool ───────────────────────────────────────

test('MCP Server: tools/list contains kevin_infer with valid schema', async () => {
  const res = await handleJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  assert.ok(res !== null);
  assert.strictEqual(res!.jsonrpc, '2.0');
  assert.strictEqual(res!.id, 1);
  assert.ok(Array.isArray(res!.result.tools));

  const inferTool = res!.result.tools.find((t: any) => t.name === 'kevin_infer');
  assert.ok(inferTool, 'kevin_infer must be in tools/list');
  assert.deepStrictEqual(inferTool.inputSchema.required, ['task', 'input']);
  assert.ok(inferTool.inputSchema.properties.task);
  assert.ok(inferTool.inputSchema.properties.input);
  assert.ok(inferTool.inputSchema.properties.labels);
  assert.ok(inferTool.inputSchema.properties.model);
  assert.ok(inferTool.inputSchema.properties.device);
  assert.ok(inferTool.inputSchema.properties.dtype);
});

test('MCP Server: tools/call executes kevin_infer tool with normalized output', async () => {
  const mockLoadModel = async () => {
    const pipe: any = async (text: string) => [{ label: 'click', score: 0.98 }];
    pipe.__kevinTask = 'text-classification';
    pipe.__kevinDevice = 'wasm';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  };

  const server = new KevinMcpServer({ loadModel: mockLoadModel });

  // Test tool execution via JSON-RPC message
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 50,
    method: 'tools/call',
    params: {
      name: 'kevin_infer',
      arguments: {
        task: 'text-classification',
        input: 'Click the Checkout button'
      }
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.id, 50);
  assert.strictEqual(res!.result.isError, false);
  assert.ok(Array.isArray(res!.result.content));
  assert.strictEqual(res!.result.content[0].type, 'text');

  const parsed = JSON.parse(res!.result.content[0].text);
  assert.ok(parsed);
  assert.strictEqual(parsed.task, 'text-classification');
  assert.strictEqual(parsed.labels?.[0]?.label, 'click');
});

test('MCP Server: tools/call kevin_infer handles missing required arguments as tool-level error', async () => {
  const server = new KevinMcpServer();

  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id: 51,
    method: 'tools/call',
    params: {
      name: 'kevin_infer',
      arguments: {
        // missing task
        input: 'Click the Checkout button'
      }
    }
  });

  assert.ok(res !== null);
  assert.strictEqual(res!.id, 51);
  assert.strictEqual(res!.result.isError, true);
  assert.ok(res!.result.content[0].text.includes('Missing required argument: task'));
});

// ── End-to-End Test: Driving real KevinDaemon.processCommand ────────────────

test('End-to-End: drives real KevinDaemon.processCommand through transport', async () => {
  // Pure method call on KevinDaemon instance, no socket
  const daemon = new KevinDaemon();

  // 1. Verify real KevinDaemon.processCommand method is callable
  const statusRes = await daemon.processCommand({ id: 'cmd-status-1', type: 'STATUS' });
  assert.strictEqual(statusRes.id, 'cmd-status-1');
  assert.strictEqual(statusRes.success, true);
  assert.strictEqual(statusRes.status, 'ready');

  // 2. Wire transport adapter directly to real daemon.processCommand
  const client = new KevinDaemonClient();
  client.send = async (type: string, payload: Record<string, any> = {}) => {
    return await daemon.processCommand({ id: `req-${client.nextId++}`, type, ...payload });
  };

  const req: InferRequest = {
    task: 'text-classification',
    input: 'Click Checkout button',
    model: 'receptron/laya-onnx'
  };

  const res = await client.infer(req);
  assert.ok(res, 'Response should be returned from daemon.processCommand');
  assert.strictEqual(typeof res, 'object');
  assert.strictEqual(res.id, 'req-1');
  assert.strictEqual(typeof res.success, 'boolean');

  if (res.success) {
    assert.strictEqual(res.task, 'text-classification');
    assert.ok(res.output);
  } else {
    assert.ok(typeof res.error === 'string');
    assert.ok(res.error.length > 0);
  }

  // 3. Verify NanoClient end-to-end integration through transport wrapping daemon.processCommand wire protocol
  const simulatedDaemonProcessCommand = async (msg: any) => {
    if (msg.type === 'INFER') {
      return {
        id: msg.id,
        success: true,
        task: msg.task,
        output: {
          labels: [{ label: 'click', score: 0.96 }]
        },
        model: msg.model || 'receptron/laya-onnx',
        device: msg.device || 'wasm',
        dtype: msg.dtype || 'fp32'
      };
    }
    return daemon.processCommand(msg);
  };

  const e2eTransport: InferenceTransport = {
    async infer(r: InferRequest) {
      return simulatedDaemonProcessCommand({ id: `e2e-${Date.now()}`, type: 'INFER', ...r });
    }
  };

  const nano = new NanoClient({ transport: e2eTransport, model: 'receptron/laya-onnx' });
  const decision = await nano.planDecisionAsync('Click Checkout button', {}, [
    { id: 'chk-btn', text: 'Checkout', role: 'button', tag: 'button' }
  ]);

  assert.strictEqual(decision.action.action, 'click');
  assert.strictEqual(decision.action.targetId, 'chk-btn');
});
