import { decomposeCommand } from '../agent/plan-decomposer.js';
import { resolveEntityReference } from '../agent/context-memory.js';
import { browserDecision } from '../ai/decision-model.js';
import { validateAction } from '../actions/action-schema.js';
import { classifyActionRisk } from '../security/risk-classifier.js';
import { BrowserEngine } from '../actions/browser-engine.js';
import { AgentRuntime } from '../agent/agent-runtime.js';
import { checkWebGPU, isModelLoaded } from '../ai/model-loader.js';
import type { ActionPayload, DOMSnapshot, RiskAssessment } from '../types.js';

export interface PipelineHarnessOptions {
  initialSnapshot?: DOMSnapshot;
  getSnapshot?: () => DOMSnapshot | Promise<DOMSnapshot>;
  model?: any;
  nanoClient?: any;
  decisionModel?: any;
  browserEngine?: any;
  executor?: (payload: ActionPayload | any) => Promise<any>;
  onAction?: (payload: ActionPayload | any) => Promise<any>;
  onDecompose?: (data: { userGoal: string; subGoals: string[] }) => Promise<void> | void;
  onPerception?: (data: any) => Promise<void> | void;
  onDecision?: (data: any) => Promise<void> | void;
  onSecurity?: (data: any) => Promise<void> | void;
  onBrowserAction?: (data: any) => Promise<void> | void;
}

export interface PipelineTrace {
  goal: string;
  decomposed: string[];
  steps: any[];
  payloads: ActionPayload[];
  results: any[];
  webGpuAvailable: boolean;
  modelLoaded: boolean;
  success: boolean;
}

export class PipelineHarness {
  public snapshot: DOMSnapshot;
  public getSnapshot: () => DOMSnapshot | Promise<DOMSnapshot>;
  public model: any;
  public nanoClient: any;
  public decisionModel: any;
  public browserEngine: BrowserEngine;
  public hooks: {
    onDecompose: (data: any) => Promise<void> | void;
    onPerception: (data: any) => Promise<void> | void;
    onDecision: (data: any) => Promise<void> | void;
    onSecurity: (data: any) => Promise<void> | void;
    onBrowserAction: (data: any) => Promise<void> | void;
  };

  constructor(options: PipelineHarnessOptions = {}) {
    this.snapshot = options.initialSnapshot || {
      url: 'https://test.local',
      title: 'Test Page',
      elements: []
    };

    this.getSnapshot = options.getSnapshot || (() => this.snapshot);
    this.model = options.model || null;
    this.nanoClient = options.nanoClient || null;
    this.decisionModel = options.decisionModel || null;

    this.browserEngine =
      options.browserEngine ||
      new BrowserEngine({
        executor:
          options.executor ||
          (async (payload: any) => {
            if (options.onAction) {
              return options.onAction(payload);
            }
            return { success: true, message: `Executed ${payload.action}` };
          })
      });

    this.hooks = {
      onDecompose: options.onDecompose || (() => {}),
      onPerception: options.onPerception || (() => {}),
      onDecision: options.onDecision || (() => {}),
      onSecurity: options.onSecurity || (() => {}),
      onBrowserAction: options.onBrowserAction || (() => {})
    };
  }

  setSnapshot(snapshot: DOMSnapshot): void {
    this.snapshot = snapshot;
  }

  async run(userGoal: string, options: any = {}): Promise<PipelineTrace> {
    const gpuStatus = await checkWebGPU();
    const trace: PipelineTrace = {
      goal: userGoal,
      decomposed: [],
      steps: [],
      payloads: [],
      results: [],
      webGpuAvailable: gpuStatus.available,
      modelLoaded: isModelLoaded() || this.model !== null,
      success: true
    };

    const subGoals = decomposeCommand(userGoal);
    trace.decomposed = [...subGoals];
    await this.hooks.onDecompose({ userGoal, subGoals });

    let lastTarget: any = null;

    for (let i = 0; i < subGoals.length; i++) {
      const subGoal = subGoals[i];
      const stepIndex = i + 1;

      const currentSnapshot: DOMSnapshot = await (options.getSnapshot
        ? options.getSnapshot(subGoal, i)
        : this.getSnapshot());
      const elements = currentSnapshot?.elements || [];
      const resolvedTarget = resolveEntityReference(subGoal, elements, lastTarget);

      const candidatePool = resolvedTarget
        ? [resolvedTarget, ...elements.filter((e) => e.id !== resolvedTarget.id)]
        : elements;

      await this.hooks.onPerception({
        stepIndex,
        subGoal,
        snapshot: currentSnapshot,
        resolvedTarget,
        candidateCount: candidatePool.length
      });

      let decisionResult: any;
      const decisionFn = options.decisionModel || this.decisionModel;
      if (typeof decisionFn === 'function') {
        decisionResult = decisionFn({
          state: {
            goal: subGoal,
            url: currentSnapshot?.url || '',
            title: currentSnapshot?.title || '',
            elements: candidatePool
          },
          questions: options.questions || null,
          model: this.model
        });
      } else if (this.nanoClient) {
        decisionResult = this.nanoClient.planDecision(
          subGoal,
          currentSnapshot,
          candidatePool,
          options.questions || null
        );
      } else {
        decisionResult = browserDecision({
          state: {
            goal: subGoal,
            url: currentSnapshot?.url || '',
            title: currentSnapshot?.title || '',
            elements: candidatePool
          },
          questions: options.questions || null,
          model: this.model
        });
      }

      const decisionPayload: ActionPayload = decisionResult.action;
      const decisionAnswers = decisionResult.answers;
      const decisionTelemetry = decisionResult.telemetry || null;

      await this.hooks.onDecision({
        stepIndex,
        subGoal,
        answers: decisionAnswers,
        action: decisionPayload,
        telemetry: decisionTelemetry
      });

      const validation = validateAction(decisionPayload);
      if (!validation.valid || !validation.action) {
        const stepRecord = {
          stepIndex,
          subGoal,
          error: `Action validation failed: ${validation.error}`,
          valid: false,
          success: false
        };
        trace.steps.push(stepRecord);
        trace.success = false;
        break;
      }

      const validatedAction = validation.action;
      const targetElement = validatedAction.targetId
        ? elements.find((e) => e.id === validatedAction.targetId) || null
        : null;

      const riskAssessment: RiskAssessment = classifyActionRisk(validatedAction, targetElement);

      await this.hooks.onSecurity({
        stepIndex,
        subGoal,
        action: validatedAction,
        risk: riskAssessment
      });

      if (riskAssessment.requiresConfirmation) {
        const approved = options.onConfirmationRequired
          ? await options.onConfirmationRequired({ action: validatedAction, targetElement, risk: riskAssessment })
          : true;

        if (!approved) {
          trace.steps.push({
            stepIndex,
            subGoal,
            aborted: true,
            reason: 'User rejected confirmation'
          });
          trace.success = false;
          break;
        }
      }

      let actionResult: any;
      try {
        actionResult = await this.browserEngine.perform(validatedAction);
      } catch (err: any) {
        actionResult = { success: false, error: err?.message || String(err) };
      }

      trace.payloads.push(validatedAction);
      trace.results.push(actionResult);

      await this.hooks.onBrowserAction({
        stepIndex,
        subGoal,
        payload: validatedAction,
        result: actionResult
      });

      trace.steps.push({
        stepIndex,
        subGoal,
        snapshot: currentSnapshot,
        decisionAnswers,
        decisionTelemetry,
        action: validatedAction,
        risk: riskAssessment,
        result: actionResult
      });

      if (validatedAction.targetId) {
        lastTarget = targetElement || { id: validatedAction.targetId };
      }

      if (!actionResult.success) {
        trace.success = false;
        break;
      }
    }

    return trace;
  }

  async verify(
    userGoal: string,
    expectations: {
      options?: any;
      decomposed?: string[];
      actions?: Array<Record<string, any>>;
      maxRisk?: 'low' | 'medium' | 'high';
    } = {}
  ): Promise<{ passed: boolean; errors: string[]; trace: PipelineTrace }> {
    const trace = await this.run(userGoal, expectations.options);
    const errors: string[] = [];

    if (expectations.decomposed) {
      if (trace.decomposed.length !== expectations.decomposed.length) {
        errors.push(
          `Expected ${expectations.decomposed.length} sub-goals, got ${trace.decomposed.length} (${JSON.stringify(trace.decomposed)})`
        );
      } else {
        for (let i = 0; i < expectations.decomposed.length; i++) {
          const expected = expectations.decomposed[i].toLowerCase().trim();
          const actual = trace.decomposed[i].toLowerCase().trim();
          if (actual !== expected) {
            errors.push(`Sub-goal [${i}]: expected "${expected}", got "${actual}"`);
          }
        }
      }
    }

    if (expectations.actions) {
      if (trace.payloads.length !== expectations.actions.length) {
        errors.push(`Expected ${expectations.actions.length} action payloads, got ${trace.payloads.length}`);
      }
      for (let i = 0; i < Math.min(trace.payloads.length, expectations.actions.length); i++) {
        const expected = expectations.actions[i];
        const actual = trace.payloads[i] as any;

        for (const [key, val] of Object.entries(expected)) {
          if (actual[key] !== val) {
            errors.push(`Action [${i}].${key}: expected "${val}", got "${actual[key]}"`);
          }
        }
      }
    }

    if (expectations.maxRisk) {
      const riskRanks: Record<string, number> = { low: 1, medium: 2, high: 3 };
      const maxAllowed = riskRanks[expectations.maxRisk] || 3;
      for (let i = 0; i < trace.steps.length; i++) {
        const stepRisk = trace.steps[i].risk?.risk || 'low';
        if ((riskRanks[stepRisk] || 1) > maxAllowed) {
          errors.push(`Step [${i}] exceeded max risk "${expectations.maxRisk}": got "${stepRisk}"`);
        }
      }
    }

    return {
      passed: errors.length === 0 && trace.success,
      errors,
      trace
    };
  }
}

export class AgentTestHarness {
  public currentSnapshot: DOMSnapshot;
  public executedPayloads: ActionPayload[];
  public pipelineHarness: PipelineHarness;
  public browserEngine: BrowserEngine;
  public runtime: AgentRuntime;

  constructor(options: any = {}) {
    this.currentSnapshot = options.initialSnapshot || {
      url: 'https://test.local',
      title: 'Test Page',
      elements: []
    };
    this.executedPayloads = [];

    this.pipelineHarness = new PipelineHarness({
      initialSnapshot: this.currentSnapshot,
      executor: async (payload: any) => {
        this.executedPayloads.push(payload);
        return options.onAction?.(payload) || { success: true, message: `Performed ${payload.action}` };
      }
    });

    this.browserEngine = this.pipelineHarness.browserEngine;

    this.runtime =
      options.runtime ||
      new AgentRuntime({
        browserEngine: this.browserEngine,
        maxSteps: options.maxSteps || 10,
        nanoClient: options.nanoClient,
        decisionEngine: options.decisionEngine
      });
  }

  setSnapshot(snapshot: DOMSnapshot): void {
    this.currentSnapshot = snapshot;
    this.pipelineHarness.setSnapshot(snapshot);
  }

  async plan(goal: string, snapshot: DOMSnapshot = this.currentSnapshot): Promise<ActionPayload> {
    return this.runtime.planNextAction(goal, snapshot);
  }

  async perform(payload: ActionPayload | any): Promise<any> {
    return this.browserEngine.perform(payload);
  }

  async run(goal: string, options: any = {}): Promise<{ result: { success: boolean; message: string }; payloads: ActionPayload[] }> {
    this.executedPayloads = [];
    const trace = await this.pipelineHarness.run(goal, {
      getSnapshot: options.getSnapshot || (() => this.currentSnapshot),
      onConfirmationRequired: options.onConfirmationRequired
    });

    return {
      result: { success: trace.success, message: trace.success ? 'Goal reached' : 'Failed' },
      payloads: [...trace.payloads]
    };
  }
}
