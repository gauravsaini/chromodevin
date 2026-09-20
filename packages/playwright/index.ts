/**
 * @kevin/playwright — High-speed on-device browser automation for Playwright.
 * Sub-60ms action loops using System 1 discriminative models and native CDP execution.
 * Augmented with resilient automation primitives: 3-verb API, self-healing cache,
 * DOM settlement observer, and Playwright Page proxying.
 */

import { PlaywrightBrowserEngine } from './driver.js';
import {
  extractPlaywrightSnapshot,
  extractFromAccessibilityTree,
  waitForDomSettle
} from './cdp-perception.js';
import {
  WebGPUDecisionRunner,
  NodeDecisionRunner,
  DEFAULT_WEBGPU_CHROMIUM_ARGS
} from './webgpu-runner.js';
import { AgentRuntime, verifyCondition } from '../core/agent/agent-runtime.js';
import { ContextMemory } from '../core/agent/context-memory.js';
import { DecisionEngine } from '../core/perception/decision-engine.js';
import { NanoClient } from '../core/ai/nano-client.js';
import {
  ActionCache,
  computeDomFingerprint,
  computeCacheKey
} from '../core/cache/action-cache.js';
import { extractSchema } from '../core/actions/schema-extractor.js';
import type { ActionPayload, DOMSnapshot, VerificationResult } from '../core/types.js';

export {
  PlaywrightBrowserEngine,
  extractPlaywrightSnapshot,
  extractFromAccessibilityTree,
  waitForDomSettle,
  WebGPUDecisionRunner,
  NodeDecisionRunner,
  DEFAULT_WEBGPU_CHROMIUM_ARGS,
  ActionCache,
  computeDomFingerprint,
  computeCacheKey,
  extractSchema,
  verifyCondition
};

export interface KevinPlaywrightOptions {
  model?: string;
  maxSteps?: number;
  headless?: boolean;
  cache?: ActionCache;
  cacheSize?: number;
  memory?: ContextMemory;
  decisionEngine?: DecisionEngine;
  nanoClient?: NanoClient;
  webgpuRunner?: WebGPUDecisionRunner;
  [key: string]: any;
}

export interface KevinActOptions {
  multiStep?: boolean;
  waitForSettle?: boolean;
  settleOptions?: { timeout?: number; idleWindow?: number };
  useCache?: boolean;
  onConfirmationRequired?: (details: any) => Promise<boolean>;
  onLog?: (msg: string, level?: string) => void;
  onStep?: (info: any) => void;
  onStateChange?: (state: any) => void;
}

export interface KevinPlaywrightAgent {
  page: any;
  engine: PlaywrightBrowserEngine;
  runtime: AgentRuntime;
  memory: ContextMemory;
  webgpuRunner: WebGPUDecisionRunner;
  nodeRunner: WebGPUDecisionRunner; // alias
  cache: ActionCache;
  act(goalOrProposal: string | ActionPayload | any, handlersOrOptions?: KevinActOptions): Promise<any>;
  observe(goal?: string, options?: any): Promise<DOMSnapshot & { proposals?: ActionPayload[]; suggestedAction?: ActionPayload }>;
  extract(params?: { instruction?: string; schema?: any }, options?: any): Promise<any>;
  plan(goal: string): Promise<ActionPayload>;
  step(goal: string, handlers?: any): Promise<{ action: ActionPayload; result: any }>;
  verify(condition: string, options?: any): Promise<VerificationResult>;
  shouldSee(condition: string, options?: any): Promise<boolean>;
  expect(condition: string, options?: any): Promise<VerificationResult>;
  [key: string]: any;
}

/**
 * Creates an autonomous Kevin agent bound to a Playwright Page.
 * Returns an augmented Page proxy seamlessly blending native Playwright methods
 * with Kevin AI primitives (act, observe, extract) and in-page WebGPU decision execution.
 */
export async function createKevin(page: any, options: KevinPlaywrightOptions = {}): Promise<KevinPlaywrightAgent> {
  const modelName = options.model || 'receptron/laya-onnx';
  const webgpuRunner = options.webgpuRunner || new WebGPUDecisionRunner({ page, model: modelName, ...options });
  await webgpuRunner.init();

  const engine = new PlaywrightBrowserEngine({ page, ...options });
  const memory = options.memory || new ContextMemory();
  const decisionEngine = options.decisionEngine || new DecisionEngine();
  const actionCache = options.cache || new ActionCache({ maxSize: options.cacheSize || 500 });

  const nanoClient =
    options.nanoClient ||
    new NanoClient({
      mode: 'decision',
      modelId: modelName,
      decisionRunner: webgpuRunner
    });

  const runtime = new AgentRuntime({
    browserEngine: engine,
    memory,
    decisionEngine,
    nanoClient,
    maxSteps: options.maxSteps || 10
  });

  const agent: KevinPlaywrightAgent = {
    page,
    engine,
    runtime,
    memory,
    webgpuRunner,
    nodeRunner: webgpuRunner,
    cache: actionCache,

    async act(goalOrProposal: string | ActionPayload | any, handlersOrOptions: KevinActOptions = {}) {
      if (typeof goalOrProposal === 'object' && goalOrProposal !== null && goalOrProposal.action) {
        const result = await engine.perform(goalOrProposal);
        return {
          success: result.success,
          cached: false,
          targetId: goalOrProposal.targetId,
          action: goalOrProposal,
          message: result.message,
          error: result.error
        };
      }

      const goal = String(goalOrProposal || '');

      if (handlersOrOptions.multiStep === true) {
        return runtime.runTask(goal, {
          getSnapshot: () => extractPlaywrightSnapshot(page),
          executeAction: (payload) => engine.perform(payload),
          onConfirmationRequired: handlersOrOptions.onConfirmationRequired || (async () => true),
          onLog: handlersOrOptions.onLog || (() => {}),
          onStep: handlersOrOptions.onStep || (() => {}),
          onStateChange: handlersOrOptions.onStateChange || (() => {})
        });
      }

      if (handlersOrOptions.waitForSettle !== false && typeof page?.evaluate === 'function') {
        await waitForDomSettle(page, handlersOrOptions.settleOptions);
      }

      const snapshot = await extractPlaywrightSnapshot(page);
      const domFingerprint = computeDomFingerprint(snapshot);

      if (handlersOrOptions.useCache !== false) {
        const cached = actionCache.get(snapshot.url, domFingerprint, goal);
        if (cached && cached.targetId) {
          const result = await engine.perform(cached);
          if (result.success) {
            return {
              success: true,
              cached: true,
              targetId: cached.targetId,
              action: cached,
              message: result.message
            };
          }
          actionCache.invalidate(snapshot.url, goal);
        }
      }

      const action = await runtime.planNextAction(goal, snapshot);
      const result = await engine.perform(action);

      if (result.success && action && action.targetId && handlersOrOptions.useCache !== false) {
        actionCache.set(snapshot.url, domFingerprint, goal, action);
      }

      return {
        success: result.success,
        cached: false,
        action,
        result,
        targetId: action?.targetId,
        message: result.message,
        error: result.error
      };
    },

    async observe(goal?: string, options: any = {}) {
      if (options.waitForSettle !== false && typeof page?.evaluate === 'function') {
        await waitForDomSettle(page, options.settleOptions);
      }
      const snapshot = await extractPlaywrightSnapshot(page);

      if (goal) {
        const plan = await runtime.planNextAction(goal, snapshot);
        const proposals = plan && plan.action !== 'done' ? [plan] : [];
        return {
          ...snapshot,
          proposals,
          suggestedAction: plan
        };
      }

      return snapshot;
    },

    async extract({ instruction = '', schema = {} }: { instruction?: string; schema?: any } = {}, options: any = {}) {
      if (options.waitForSettle !== false && typeof page?.evaluate === 'function') {
        await waitForDomSettle(page, options.settleOptions);
      }
      const snapshot = await extractPlaywrightSnapshot(page);
      return extractSchema(snapshot, instruction, schema);
    },

    async plan(goal: string) {
      const snapshot = await extractPlaywrightSnapshot(page);
      return runtime.planNextAction(goal, snapshot);
    },

    async step(goal: string, handlers: any = {}) {
      const snapshot = await extractPlaywrightSnapshot(page);
      const action = await runtime.planNextAction(goal, snapshot);
      const result = await engine.perform(action);
      return { action, result };
    },

    async verify(condition: string, options: any = {}): Promise<VerificationResult> {
      if (options.waitForSettle !== false && typeof page?.evaluate === 'function') {
        await waitForDomSettle(page, options.settleOptions);
      }
      const snapshot = await extractPlaywrightSnapshot(page);
      return verifyCondition(condition, snapshot);
    },

    async shouldSee(condition: string, options: any = {}): Promise<boolean> {
      const res = await (this as any).verify(condition, options);
      return res.satisfied;
    },

    async expect(condition: string, options: any = {}): Promise<VerificationResult> {
      return (this as any).verify(condition, options);
    }
  };

  return new Proxy(agent, {
    get(target: any, prop: string | symbol, receiver: any) {
      if (prop in target) {
        return target[prop];
      }
      if (page && prop in page) {
        const value = page[prop];
        return typeof value === 'function' ? value.bind(page) : value;
      }
      return undefined;
    }
  });
}

export default createKevin;
