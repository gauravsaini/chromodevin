import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { KevinDaemon } from '../packages/daemon/server.js';
import {
  setModelLoader,
  resetModelLoader,
  clearInferSessions,
  inferSessions
} from '../packages/daemon/infer.js';

beforeEach(() => {
  clearInferSessions();
  resetModelLoader();
});

test('KevinDaemon INFER: text-classification returns normalized labels', async () => {
  let loaderCalls = 0;
  setModelLoader(async (opts: any) => {
    loaderCalls++;
    const pipe: any = async (input: any) => {
      assert.strictEqual(input, 'This browser agent is fast');
      return [
        { label: 'POSITIVE', score: 0.982 },
        { label: 'NEGATIVE', score: 0.018 }
      ];
    };
    pipe.__kevinModelId = opts.model?.id || 'receptron/laya-onnx';
    pipe.__kevinTask = opts.task;
    pipe.__kevinDevice = 'wasm';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-classify-1',
    type: 'INFER',
    task: 'text-classification',
    input: 'This browser agent is fast',
    model: 'receptron/laya-onnx'
  });

  assert.strictEqual(res.id, 'req-classify-1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task, 'text-classification');
  assert.strictEqual(res.model, 'receptron/laya-onnx');
  assert.strictEqual(res.device, 'wasm');
  assert.strictEqual(res.dtype, 'fp32');
  assert.ok(Array.isArray(res.output?.labels));
  assert.strictEqual(res.output.labels.length, 2);
  assert.strictEqual(res.output.labels[0].label, 'POSITIVE');
  assert.strictEqual(res.output.labels[0].score, 0.982);
  assert.strictEqual(loaderCalls, 1);
});

test('KevinDaemon INFER: text-generation returns generated text (max 128 tokens)', async () => {
  let passedGenOptions: any = null;
  setModelLoader(async (opts: any) => {
    const pipe: any = async (input: any, genOpts: any) => {
      passedGenOptions = genOpts;
      return [{ generated_text: `Completed: ${input}` }];
    };
    pipe.__kevinModelId = opts.model?.id || 'onnx-community/Qwen2.5-0.5B-ONNX';
    pipe.__kevinTask = opts.task;
    pipe.__kevinDevice = 'cpu';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-gen-1',
    type: 'INFER',
    task: 'text-generation',
    input: 'Summarize page content',
    model: 'onnx-community/Qwen2.5-0.5B-ONNX'
  });

  assert.strictEqual(res.id, 'req-gen-1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task, 'text-generation');
  assert.strictEqual(res.output?.text, 'Completed: Summarize page content');
  assert.ok(passedGenOptions);
  assert.strictEqual(passedGenOptions.max_new_tokens, 128);
});

test('KevinDaemon INFER: feature-extraction returns candidateScores via cosine similarity', async () => {
  setModelLoader(async (opts: any) => {
    const pipe: any = async (input: any) => {
      assert.ok(Array.isArray(input));
      // Input: [query, cand1, cand2]
      // Vector 0 (query): [1, 0]
      // Vector 1 (identical): [1, 0] -> cosine = 1.0
      // Vector 2 (orthogonal): [0, 1] -> cosine = 0.0
      return [
        [1, 0],
        [1, 0],
        [0, 1]
      ];
    };
    pipe.__kevinModelId = opts.model?.id || 'Xenova/all-MiniLM-L6-v2';
    pipe.__kevinTask = opts.task;
    pipe.__kevinDevice = 'wasm';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-feat-1',
    type: 'INFER',
    task: 'feature-extraction',
    input: ['find search box', 'search input field', 'footer copyright notice'],
    model: 'Xenova/all-MiniLM-L6-v2'
  });

  assert.strictEqual(res.id, 'req-feat-1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task, 'feature-extraction');
  assert.ok(Array.isArray(res.output?.candidateScores));
  assert.strictEqual(res.output.candidateScores.length, 2);
  assert.strictEqual(Math.round(res.output.candidateScores[0] * 100) / 100, 1);
  assert.strictEqual(Math.round(res.output.candidateScores[1] * 100) / 100, 0);
});

test('KevinDaemon INFER: zero-shot-classification returns labels and scores', async () => {
  let passedLabels: any = null;
  setModelLoader(async (opts: any) => {
    const pipe: any = async (input: any, labels: any) => {
      passedLabels = labels;
      return {
        sequence: input,
        labels: ['click', 'navigate', 'type'],
        scores: [0.85, 0.10, 0.05]
      };
    };
    pipe.__kevinModelId = opts.model?.id || 'Xenova/mobilebert-uncased-mnli';
    pipe.__kevinTask = opts.task;
    pipe.__kevinDevice = 'wasm';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-zero-1',
    type: 'INFER',
    task: 'zero-shot-classification',
    input: 'click the login button',
    labels: ['click', 'navigate', 'type'],
    model: 'Xenova/mobilebert-uncased-mnli'
  });

  assert.strictEqual(res.id, 'req-zero-1');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.task, 'zero-shot-classification');
  assert.deepStrictEqual(passedLabels, ['click', 'navigate', 'type']);
  assert.ok(Array.isArray(res.output?.labels));
  assert.strictEqual(res.output.labels.length, 3);
  assert.strictEqual(res.output.labels[0].label, 'click');
  assert.strictEqual(res.output.labels[0].score, 0.85);
});

test('KevinDaemon INFER: lazy session caching reuses pipeline for same model id', async () => {
  let loadCount = 0;
  setModelLoader(async (opts: any) => {
    loadCount++;
    const pipe: any = async () => [{ label: 'OK', score: 1.0 }];
    pipe.__kevinModelId = opts.model?.id || 'test/cache-model';
    pipe.__kevinTask = opts.task;
    pipe.__kevinDevice = 'wasm';
    pipe.__kevinDtype = 'fp32';
    return pipe;
  });

  const daemon = new KevinDaemon();

  // First call: loads model
  const res1 = await daemon.processCommand({
    id: 'req-cache-1',
    type: 'INFER',
    task: 'text-classification',
    input: 'test 1',
    model: 'test/cache-model'
  });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(loadCount, 1);
  assert.strictEqual(inferSessions.size, 1);

  // Second call with same model: reuses session
  const res2 = await daemon.processCommand({
    id: 'req-cache-2',
    type: 'INFER',
    task: 'text-classification',
    input: 'test 2',
    model: 'test/cache-model'
  });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(loadCount, 1);
  assert.strictEqual(inferSessions.size, 1);
});

test('KevinDaemon INFER: defaults device to auto and dtype to auto', async () => {
  let capturedOpts: any = null;
  setModelLoader(async (opts: any) => {
    capturedOpts = opts;
    const pipe: any = async () => [{ label: 'OK', score: 1.0 }];
    return pipe;
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-defaults-1',
    type: 'INFER',
    task: 'text-classification',
    input: 'test default devices'
  });

  assert.strictEqual(res.success, true);
  assert.ok(capturedOpts);
  assert.strictEqual(capturedOpts.device, 'auto');
  assert.strictEqual(capturedOpts.dtype, 'auto');
  assert.strictEqual(res.device, 'auto');
  assert.strictEqual(res.dtype, 'auto');
});

test('KevinDaemon INFER: unknown model / loadModel failure returns graceful { success: false, error } without throwing', async () => {
  setModelLoader(async () => {
    throw new Error('HF Hub Model Not Found: invalid/nonexistent-model');
  });

  const daemon = new KevinDaemon();
  const res = await daemon.processCommand({
    id: 'req-err-1',
    type: 'INFER',
    task: 'text-classification',
    input: 'test input',
    model: 'invalid/nonexistent-model'
  });

  assert.strictEqual(res.id, 'req-err-1');
  assert.strictEqual(res.success, false);
  assert.ok(typeof res.error === 'string');
  assert.ok(res.error.includes('HF Hub Model Not Found'));
});

test('KevinDaemon INFER: malformed payloads return graceful { success: false, error }', async () => {
  const daemon = new KevinDaemon();

  // Missing task
  const res1 = await daemon.processCommand({
    id: 'malformed-1',
    type: 'INFER',
    input: 'hello'
  });
  assert.strictEqual(res1.id, 'malformed-1');
  assert.strictEqual(res1.success, false);
  assert.ok(res1.error.includes('task'));

  // Invalid task
  const res2 = await daemon.processCommand({
    id: 'malformed-2',
    type: 'INFER',
    task: 'unsupported-audio-task',
    input: 'hello'
  });
  assert.strictEqual(res2.id, 'malformed-2');
  assert.strictEqual(res2.success, false);
  assert.ok(res2.error.includes('unsupported'));

  // Missing input
  const res3 = await daemon.processCommand({
    id: 'malformed-3',
    type: 'INFER',
    task: 'text-classification'
  });
  assert.strictEqual(res3.id, 'malformed-3');
  assert.strictEqual(res3.success, false);
  assert.ok(res3.error.includes('input'));

  // Invalid input type (number)
  const res4 = await daemon.processCommand({
    id: 'malformed-4',
    type: 'INFER',
    task: 'text-classification',
    input: 12345
  });
  assert.strictEqual(res4.id, 'malformed-4');
  assert.strictEqual(res4.success, false);
  assert.ok(res4.error.includes('input'));

  // Invalid elements in input array
  const res5 = await daemon.processCommand({
    id: 'malformed-5',
    type: 'INFER',
    task: 'feature-extraction',
    input: ['valid', 42 as any]
  });
  assert.strictEqual(res5.id, 'malformed-5');
  assert.strictEqual(res5.success, false);
  assert.ok(res5.error.includes('input'));

  // Invalid zero-shot labels
  const res6 = await daemon.processCommand({
    id: 'malformed-6',
    type: 'INFER',
    task: 'zero-shot-classification',
    input: 'test',
    labels: []
  });
  assert.strictEqual(res6.id, 'malformed-6');
  assert.strictEqual(res6.success, false);
  assert.ok(res6.error.includes('labels'));
});
