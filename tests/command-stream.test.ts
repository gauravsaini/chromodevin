import { test } from 'node:test';
import assert from 'node:assert';
import { CommandStream } from '../src/agent/command-stream.js';
import { AgentRuntime } from '../src/agent/agent-runtime.js';

test('CommandStream yields pushed items via async iterator', async () => {
  const stream = new CommandStream<string>();
  stream.push('step 1');
  stream.push('step 2');

  const iterator = stream[Symbol.asyncIterator]();

  const first = await iterator.next();
  assert.strictEqual(first.value, 'step 1');
  assert.strictEqual(first.done, false);

  const second = await iterator.next();
  assert.strictEqual(second.value, 'step 2');
  assert.strictEqual(second.done, false);

  stream.close();
  const third = await iterator.next();
  assert.strictEqual(third.done, true);
});

test('AgentRuntime runStream consumes async iterator of chained events', async () => {
  const stream = new CommandStream<string>();
  const executed: string[] = [];
  const started: string[] = [];
  const ended: Array<{ cmd: string; ok: boolean }> = [];

  const runtime = new AgentRuntime({ maxSteps: 10 });
  const streamPromise = runtime.runStream(stream, {
    getSnapshot: async () => ({
      url: 'https://example.com',
      title: 'Example',
      elements: [{ id: 'btn-1', tag: 'button', text: 'Submit' }]
    }),
    executeAction: async (action: any) => {
      executed.push(action.action);
      return { success: true, message: 'Executed ' + action.action };
    },
    onTaskStart: (cmd: string) => started.push(cmd),
    onTaskEnd: (cmd: string, res: any) => ended.push({ cmd, ok: res.success })
  });

  // Push sequential events into the stream
  stream.push('Scroll down');
  stream.push('Extract page');

  // Allow tasks to process in event loop
  await new Promise((r) => setTimeout(r, 1200));

  stream.close();
  await streamPromise;

  assert.ok(executed.includes('scroll'), 'Scroll was executed in stream');
  assert.ok(executed.includes('extract'), 'Extract was executed in stream');
  assert.deepStrictEqual(started, ['Scroll down', 'Extract page']);
  assert.strictEqual(ended.length, 2);
  assert.strictEqual(ended[0].ok, true);
});

test('CommandStream drains remaining queued events when close() is called before iteration completes', async () => {
  const stream = new CommandStream<string>();
  stream.push('queued 1');
  stream.push('queued 2');
  stream.close();

  const collected: string[] = [];
  for await (const cmd of stream) {
    collected.push(cmd);
  }

  assert.deepStrictEqual(collected, ['queued 1', 'queued 2']);
});
