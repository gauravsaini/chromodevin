/**
 * Agent Runtime for Kevin.
 * Orchestrates multi-step perception-planning-action loop:
 * Snapshot -> WebMCP / Onyx Perception -> Risk Gate -> Gemini Nano -> Execution -> Verification.
 * Supports natural language compound goals decomposed into sequential sub-tasks.
 */

import { DecisionEngine, rankCandidates } from '../perception/decision-engine.js';
import { NanoClient } from '../ai/nano-client.js';
import { WebMcpClient } from '../mcp/webmcp.js';
import { ContextMemory, resolveEntityReference } from './context-memory.js';
import { classifyActionRisk } from '../security/risk-classifier.js';
import { validateAction } from '../actions/action-schema.js';
import { decomposeCommand } from './plan-decomposer.js';
import { BrowserEngine } from '../actions/browser-engine.js';
import type { ActionPayload, DOMSnapshot, VerificationResult } from '../types.js';

export const AgentState = Object.freeze({
  IDLE: 'IDLE',
  PERCEIVING: 'PERCEIVING',
  DECIDING: 'DECIDING',
  CONFIRMING: 'CONFIRMING',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED'
} as const);

export type AgentStateType = (typeof AgentState)[keyof typeof AgentState];

export interface AgentRuntimeOptions {
  maxSteps?: number;
  decisionEngine?: DecisionEngine | any;
  nanoClient?: NanoClient | any;
  webMcpClient?: WebMcpClient | any;
  memory?: ContextMemory | any;
  browserEngine?: BrowserEngine | any;
}

export interface RunTaskOptions {
  requireVerify?: boolean;
  maxAttempts?: number;
}

export interface RunTaskHandlers extends RunTaskOptions {
  getSnapshot?: () => Promise<DOMSnapshot | any>;
  executeAction?: (payload: ActionPayload | any) => Promise<any>;
  onLog?: (msg: string, level?: string) => void;
  onStateChange?: (state: AgentStateType) => void;
  onConfirmationRequired?: (details: { action: ActionPayload; candidate?: any; reason: string }) => Promise<boolean>;
  onStep?: (stepInfo: { step: number; action: ActionPayload; subGoal: string; stage: number; totalStages: number }) => void;
  onTaskStart?: (goal: string) => void;
  onTaskEnd?: (goal: string, result: any) => void;
}

export class AgentRuntime {
  public maxSteps: number;
  public decisionEngine: DecisionEngine | any;
  public nanoClient: NanoClient | any;
  public webMcpClient: WebMcpClient | any;
  public memory: ContextMemory | any;
  public browserEngine: BrowserEngine | any;
  public state: AgentStateType;
  public aborted: boolean;
  public currentStep: number;

  constructor(options: AgentRuntimeOptions = {}) {
    this.maxSteps = options.maxSteps || 10;
    this.decisionEngine = options.decisionEngine || new DecisionEngine();
    this.nanoClient = options.nanoClient || new NanoClient();
    this.webMcpClient = options.webMcpClient || new WebMcpClient();
    this.memory = options.memory || new ContextMemory();
    this.browserEngine = options.browserEngine || new BrowserEngine();
    this.state = AgentState.IDLE;
    this.aborted = false;
    this.currentStep = 0;
  }

  setState(newState: AgentStateType, onStateChange?: (state: AgentStateType) => void): void {
    this.state = newState;
    if (typeof onStateChange === 'function') {
      onStateChange(this.state);
    }
  }

  abort(): void {
    this.aborted = true;
    this.state = AgentState.ABORTED;
  }

  /**
   * Generates a validated action payload for a goal and snapshot without executing it.
   */
  async planNextAction(
    currentGoal: string,
    snapshot: DOMSnapshot = { url: '', title: '', elements: [] },
    context: Record<string, any> = {}
  ): Promise<ActionPayload> {
    return planActionStep({
      goal: currentGoal,
      snapshot,
      decisionEngine: this.decisionEngine,
      nanoClient: this.nanoClient,
      webMcpClient: this.webMcpClient,
      context: {
        lastTarget: this.memory?.lastTarget,
        conversationSummary: this.memory?.getConversationSummary?.() || '',
        ...context
      }
    });
  }

  /**
   * Consumes an async iterator of commands continuously.
   */
  async runStream(stream: AsyncIterable<string>, handlers: RunTaskHandlers = {}): Promise<any> {
    const { onLog = () => {}, onTaskStart = () => {}, onTaskEnd = () => {} } = handlers;
    onLog('Continuous command stream active. Listening for events...', 'system');
    let lastResult: any = null;

    for await (const command of stream) {
      if (this.aborted) break;
      if (!command) continue;
      this.aborted = false;
      onTaskStart(command);
      lastResult = await this.runTask(command, handlers);
      onTaskEnd(command, lastResult);
    }

    return lastResult || { success: true, message: 'Stream finished' };
  }

  /**
   * Executes a multi-step user goal to completion.
   */
  async runTask(
    userGoal: any,
    handlers: RunTaskHandlers = {},
    options: RunTaskOptions = {}
  ): Promise<any> {
    if (userGoal && typeof userGoal === 'object' && Symbol.asyncIterator in userGoal) {
      return this.runStream(userGoal, handlers);
    }

    const requireVerify = options.requireVerify ?? handlers.requireVerify ?? false;
    const maxAttempts = options.maxAttempts ?? handlers.maxAttempts ?? 3;

    const {
      getSnapshot,
      executeAction,
      onLog = () => {},
      onStateChange = () => {},
      onConfirmationRequired = async () => true,
      onStep = () => {}
    } = handlers;

    this.aborted = false;
    this.currentStep = 0;
    this.memory.addTurn('user', String(userGoal));
    this.setState(AgentState.PERCEIVING, onStateChange);

    const subGoals = decomposeCommand(userGoal);
    let subGoalIndex = 0;

    if (subGoals.length > 1) {
      onLog(`Decomposed into ${subGoals.length} stages:`, 'system');
      subGoals.forEach((sg, idx) => onLog(`  ${idx + 1}. "${sg}"`, 'system'));
    } else {
      onLog(`Starting task: "${userGoal}"`, 'system');
    }

    let previousUrl = '';

    // If verification retry is NOT required, execute the standard byte-identical path
    if (!requireVerify) {
      while (this.currentStep < this.maxSteps && subGoalIndex < subGoals.length && !this.aborted) {
        this.currentStep++;
        const currentGoal = subGoals[subGoalIndex];
        onLog(`--- Step ${this.currentStep} [Stage ${subGoalIndex + 1}/${subGoals.length}: "${currentGoal}"] ---`, 'system');

        // 1. Perception: fetch active tab snapshot
        this.setState(AgentState.PERCEIVING, onStateChange);
        let snapshot: DOMSnapshot | null = null;
        try {
          if (getSnapshot) {
            snapshot = await getSnapshot();
          }
        } catch (err: any) {
          onLog(`Notice observing tab: ${err?.message}`, 'system');
        }

        const cleanSnapshot: DOMSnapshot = snapshot?.elements
          ? snapshot
          : { url: snapshot?.url || '', title: snapshot?.title || '', elements: [] };

        if (previousUrl && cleanSnapshot.url && cleanSnapshot.url !== previousUrl) {
          onLog(`Page context updated: ${cleanSnapshot.url}`, 'system');
        }
        if (cleanSnapshot.url) {
          previousUrl = cleanSnapshot.url;
        }

        // 2. Plan Action: generate pure action payload
        this.setState(AgentState.DECIDING, onStateChange);
        const payload = await this.planNextAction(currentGoal, cleanSnapshot);
        const targetElement = payload.targetElement;

        // Handle direct WebMCP tool invocation
        if (payload.action === 'webmcp' && payload.tool) {
          onLog(`Found WebMCP tool "${payload.tool.name}". Invoking directly.`, 'action');
          const toolResult = await this.webMcpClient.invokeTool(payload.tool, { goal: payload.goal });
          if (toolResult.success) {
            onLog(`WebMCP tool executed successfully.`, 'success');
            subGoalIndex++;
            if (subGoalIndex >= subGoals.length) {
              this.setState(AgentState.COMPLETED, onStateChange);
              return { success: true, message: `Completed all ${subGoals.length} sub-tasks` };
            }
            continue;
          }
        }

        onLog(
          `Decided: ${payload.action} ${payload.url || payload.targetId || ''} (${payload.explanation || ''})`,
          'action'
        );
        onStep({
          step: this.currentStep,
          action: payload,
          subGoal: currentGoal,
          stage: subGoalIndex + 1,
          totalStages: subGoals.length
        });

        // 3. Check for Task Completion
        if (payload.action === 'done') {
          subGoalIndex++;
          if (subGoalIndex >= subGoals.length) {
            onLog(`All stages finished: ${payload.explanation || 'Done'}`, 'success');
            this.memory.addTurn('agent', payload.explanation || 'Task complete');
            this.setState(AgentState.COMPLETED, onStateChange);
            return { success: true, message: payload.explanation || 'Goal reached' };
          }
          continue;
        }

        // 4. Security / Risk Gate
        if (payload.risk?.requiresConfirmation) {
          this.setState(AgentState.CONFIRMING, onStateChange);
          onLog(`⚠️ Confirmation required: ${payload.risk.reason}`, 'error');
          const approved = await onConfirmationRequired({
            action: payload,
            candidate: targetElement,
            reason: payload.risk.reason
          });

          if (!approved) {
            onLog('Action rejected by user. Aborting task.', 'error');
            this.setState(AgentState.ABORTED, onStateChange);
            return { success: false, error: 'User rejected high-risk confirmation' };
          }
        }

        // 5. Final Browser Action Execution
        this.setState(AgentState.EXECUTING, onStateChange);
        if (this.aborted) break;

        let result: any;
        try {
          result = executeAction ? await executeAction(payload) : await this.browserEngine.perform(payload);
        } catch (err: any) {
          result = { success: false, error: err?.message || String(err) };
        }

        // 6. Verification & recording
        this.setState(AgentState.VERIFYING, onStateChange);
        this.memory.recordAction(payload, result);

        if (result.success) {
          onLog(`Step ${this.currentStep} executed: ${result.message || 'OK'}`, 'success');
          subGoalIndex++;

          if (
            payload.action === 'navigate' ||
            payload.pressEnter ||
            (payload.action === 'click' && (targetElement?.tag === 'a' || targetElement?.href))
          ) {
            await new Promise((r) => setTimeout(r, 1400));
          } else {
            await new Promise((r) => setTimeout(r, 600));
          }
        } else {
          onLog(`Step ${this.currentStep} execution issue: ${result.error}`, 'error');
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      if (this.aborted) {
        onLog('Task aborted by user.', 'system');
        this.setState(AgentState.ABORTED, onStateChange);
        return { success: false, aborted: true };
      }

      if (subGoalIndex >= subGoals.length) {
        onLog(`Completed all ${subGoals.length} stages successfully!`, 'success');
        this.setState(AgentState.COMPLETED, onStateChange);
        return { success: true, message: `Completed all ${subGoals.length} stages` };
      }

      onLog(`Reached maximum step limit (${this.maxSteps}).`, 'system');
      this.setState(AgentState.COMPLETED, onStateChange);
      return { success: true, message: 'Reached step limit' };
    }

    // Verify-retry loop path (requireVerify: true)
    let lastActionResult: any = null;

    while (this.currentStep < this.maxSteps && subGoalIndex < subGoals.length && !this.aborted) {
      const currentGoal = subGoals[subGoalIndex];
      let attempt = 0;
      let failureNote: string | undefined = undefined;
      let stageVerified = false;

      while (attempt < maxAttempts && this.currentStep < this.maxSteps && !this.aborted) {
        attempt++;
        this.currentStep++;
        onLog(`--- Step ${this.currentStep} [Stage ${subGoalIndex + 1}/${subGoals.length} Attempt ${attempt}/${maxAttempts}: "${currentGoal}"] ---`, 'system');

        // 1. Perception: fetch active tab snapshot
        this.setState(AgentState.PERCEIVING, onStateChange);
        let snapshot: DOMSnapshot | null = null;
        try {
          if (getSnapshot) {
            snapshot = await getSnapshot();
          }
        } catch (err: any) {
          onLog(`Notice observing tab: ${err?.message}`, 'system');
        }

        const cleanSnapshot: DOMSnapshot = snapshot?.elements
          ? snapshot
          : { url: snapshot?.url || '', title: snapshot?.title || '', elements: [] };

        if (previousUrl && cleanSnapshot.url && cleanSnapshot.url !== previousUrl) {
          onLog(`Page context updated: ${cleanSnapshot.url}`, 'system');
        }
        if (cleanSnapshot.url) {
          previousUrl = cleanSnapshot.url;
        }

        // 2. Plan Action: replan with failure note appended to goal & context on retry
        this.setState(AgentState.DECIDING, onStateChange);
        const planGoal = failureNote ? `${currentGoal} (Note: previous attempt failed: ${failureNote})` : currentGoal;
        const planContext = {
          ...(failureNote ? { failureNote, lastFailure: failureNote } : {}),
          attempt
        };
        const payload = await this.planNextAction(planGoal, cleanSnapshot, planContext);
        const targetElement = payload.targetElement;

        // Handle direct WebMCP tool invocation
        if (payload.action === 'webmcp' && payload.tool) {
          onLog(`Found WebMCP tool "${payload.tool.name}". Invoking directly.`, 'action');
          const toolResult = await this.webMcpClient.invokeTool(payload.tool, { goal: payload.goal });
          if (toolResult.success) {
            onLog(`WebMCP tool executed successfully.`, 'success');
            let freshSnapshot: DOMSnapshot = cleanSnapshot;
            if (getSnapshot) {
              try {
                const fresh = await getSnapshot();
                if (fresh) freshSnapshot = fresh;
              } catch (_) {}
            }
            const verifyRes = verifyCondition(currentGoal, freshSnapshot);
            if (verifyRes.satisfied) {
              stageVerified = true;
              lastActionResult = toolResult;
              break;
            } else {
              failureNote = verifyRes.reason;
              continue;
            }
          }
        }

        onLog(
          `Decided: ${payload.action} ${payload.url || payload.targetId || ''} (${payload.explanation || ''})`,
          'action'
        );
        onStep({
          step: this.currentStep,
          action: payload,
          subGoal: currentGoal,
          stage: subGoalIndex + 1,
          totalStages: subGoals.length
        });

        // 3. Check for Task Completion
        if (payload.action === 'done') {
          const verifyRes = verifyCondition(currentGoal, cleanSnapshot);
          if (verifyRes.satisfied) {
            stageVerified = true;
            lastActionResult = { success: true, message: payload.explanation || 'Done' };
            break;
          } else {
            failureNote = verifyRes.reason;
            onLog(`Verification failed on 'done' (attempt ${attempt}/${maxAttempts}): ${failureNote}`, 'warn');
            continue;
          }
        }

        // 4. Security / Risk Gate
        if (payload.risk?.requiresConfirmation) {
          this.setState(AgentState.CONFIRMING, onStateChange);
          onLog(`⚠️ Confirmation required: ${payload.risk.reason}`, 'error');
          const approved = await onConfirmationRequired({
            action: payload,
            candidate: targetElement,
            reason: payload.risk.reason
          });

          if (!approved) {
            onLog('Action rejected by user. Aborting task.', 'error');
            this.setState(AgentState.ABORTED, onStateChange);
            return { success: false, verified: false, error: 'User rejected high-risk confirmation' };
          }
        }

        // 5. Final Browser Action Execution
        this.setState(AgentState.EXECUTING, onStateChange);
        if (this.aborted) break;

        let result: any;
        try {
          result = executeAction ? await executeAction(payload) : await this.browserEngine.perform(payload);
        } catch (err: any) {
          result = { success: false, error: err?.message || String(err) };
        }
        lastActionResult = result;

        // 6. Verification & recording
        this.setState(AgentState.VERIFYING, onStateChange);
        this.memory.recordAction(payload, result);

        // Fetch fresh snapshot after act to verify
        let freshSnapshot: DOMSnapshot = cleanSnapshot;
        if (getSnapshot) {
          try {
            const fresh = await getSnapshot();
            if (fresh) freshSnapshot = fresh;
          } catch (err: any) {
            onLog(`Notice observing tab after act: ${err?.message}`, 'system');
          }
        }

        const verifyRes = verifyCondition(currentGoal, freshSnapshot);
        if (verifyRes.satisfied) {
          onLog(`Step ${this.currentStep} verified on attempt ${attempt}: ${verifyRes.reason}`, 'success');
          stageVerified = true;
          break;
        } else {
          failureNote = verifyRes.reason || 'Verification condition not met';
          onLog(`Step ${this.currentStep} verify failed (attempt ${attempt}/${maxAttempts}): ${failureNote}`, 'warn');
        }
      }

      if (this.aborted) {
        onLog('Task aborted by user.', 'system');
        this.setState(AgentState.ABORTED, onStateChange);
        return { success: false, aborted: true, verified: false };
      }

      if (!stageVerified) {
        onLog(`Stage ${subGoalIndex + 1} exhausted ${maxAttempts} attempts without passing verification.`, 'error');
        this.setState(AgentState.FAILED, onStateChange);
        return {
          ...(lastActionResult || {}),
          success: false,
          verified: false,
          attempts: attempt,
          error: lastActionResult?.error || failureNote || 'Verification condition not satisfied'
        };
      }

      subGoalIndex++;
    }

    if (this.aborted) {
      onLog('Task aborted by user.', 'system');
      this.setState(AgentState.ABORTED, onStateChange);
      return { success: false, aborted: true, verified: false };
    }

    if (subGoalIndex >= subGoals.length) {
      onLog(`Completed all ${subGoals.length} stages successfully!`, 'success');
      this.setState(AgentState.COMPLETED, onStateChange);
      return {
        ...(lastActionResult || {}),
        success: true,
        verified: true,
        message: `Completed all ${subGoals.length} stages`
      };
    }

    onLog(`Reached maximum step limit (${this.maxSteps}).`, 'system');
    this.setState(AgentState.COMPLETED, onStateChange);
    return {
      ...(lastActionResult || {}),
      success: false,
      verified: false,
      message: 'Reached step limit without completing all verification stages'
    };
  }
}

export interface PlanActionStepParams {
  goal: string;
  snapshot?: DOMSnapshot;
  decisionEngine?: any;
  nanoClient?: any;
  webMcpClient?: any;
  context?: {
    lastTarget?: any;
    conversationSummary?: string;
    [key: string]: any;
  };
}

/**
 * Pure decision step function with strict input/output contract:
 * WebMCP -> Entity Resolution -> Candidate Ranking -> AI/Heuristic Plan -> Validation -> Risk Assessment.
 */
export async function planActionStep({
  goal,
  snapshot = { url: '', title: '', elements: [] },
  decisionEngine = null,
  nanoClient = null,
  webMcpClient = null,
  context = {}
}: PlanActionStepParams): Promise<ActionPayload> {
  const cleanSnapshot: DOMSnapshot = snapshot?.elements
    ? snapshot
    : { url: snapshot?.url || '', title: snapshot?.title || '', elements: [] };

  // 1. WebMCP detection
  if (webMcpClient) {
    const webTools = webMcpClient.detectTools(typeof window !== 'undefined' ? window : null);
    const matchedMcpTool = webMcpClient.findToolForGoal(webTools, goal);
    if (matchedMcpTool) {
      return {
        action: 'webmcp',
        tool: matchedMcpTool,
        goal,
        explanation: `Invoke WebMCP tool ${matchedMcpTool.name}`
      };
    }
  }

  // 2. Resolve relative entity references (pure function)
  const resolvedFromMemory = resolveEntityReference(goal, cleanSnapshot.elements, context.lastTarget);

  // 3. Parallel perception ranking (pure function)
  const rankingResult = decisionEngine?.decide
    ? await decisionEngine.decide({
        context: { url: cleanSnapshot.url, title: cleanSnapshot.title },
        candidates: cleanSnapshot.elements,
        question: goal,
        topK: 15
      })
    : rankCandidates({
        context: { url: cleanSnapshot.url, title: cleanSnapshot.title },
        candidates: cleanSnapshot.elements,
        question: goal,
        topK: 15
      });

  const topCandidates = rankingResult.topCandidates || [];
  const candidatesForModel = resolvedFromMemory
    ? [resolvedFromMemory, ...topCandidates.filter((c: any) => c.id !== resolvedFromMemory.id)]
    : topCandidates;

  // 4. Plan action via WebGPU Decision Model
  const client = nanoClient || new NanoClient();
  const decisionResult = client.planDecisionAsync
    ? await client.planDecisionAsync(goal, cleanSnapshot, candidatesForModel)
    : client.planDecision(goal, cleanSnapshot, candidatesForModel);
  let chosenAction: ActionPayload = decisionResult.action;

  // 5. Validate planned action schema
  const validated = validateAction(chosenAction);
  if (!validated.valid || !validated.action) {
    return { action: 'done', error: validated.error, explanation: `Invalid action: ${validated.error}` };
  }
  chosenAction = validated.action;

  // 6. Attach target element reference and security risk classification
  const targetElement = chosenAction.targetId
    ? cleanSnapshot.elements.find((e) => e.id === chosenAction.targetId) || null
    : null;
  const riskAssessment = classifyActionRisk(chosenAction, targetElement);

  return {
    ...chosenAction,
    targetElement,
    risk: riskAssessment
  };
}

/**
 * Evaluates a natural language condition or assertion against a DOMSnapshot.
 * Pure unit contract with strict input/output boundaries.
 */
export function verifyCondition(
  condition: string,
  snapshot: DOMSnapshot = { url: '', title: '', elements: [] }
): VerificationResult {
  if (!condition || typeof condition !== 'string') {
    return { satisfied: false, reason: 'Condition must be a non-empty string' };
  }

  const cond = condition.trim();
  const lowerCond = cond.toLowerCase();
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  const bodyText = snapshot?.bodyText || '';
  const pageTitle = snapshot?.title || '';
  const pageUrl = snapshot?.url || '';

  // 1. Check item state: "Task A is completed" / "Task A is checked" / "Task A is done" / "Task A is active" / "Task A is unchecked"
  const stateMatch = cond.match(/^["']?(.+?)["']?\s+is\s+(completed|checked|done|finished|active|unchecked|uncompleted|present|visible|gone|deleted|removed)$/i);
  if (stateMatch) {
    const itemQuery = stateMatch[1].trim().toLowerCase();
    const expectedState = stateMatch[2].trim().toLowerCase();

    const matchingEl = elements.find((el) => {
      const elText = `${el.text || ''} ${el.ariaLabel || ''} ${el.title || ''} ${el.name || ''} ${el.value || ''}`.toLowerCase();
      return elText.includes(itemQuery);
    });

    if (['gone', 'deleted', 'removed', 'not visible'].includes(expectedState)) {
      const satisfied = !matchingEl;
      return {
        satisfied,
        reason: satisfied
          ? `Element "${itemQuery}" is not present on page (as expected)`
          : `Element "${itemQuery}" was found on page but expected to be ${expectedState}`
      };
    }

    if (!matchingEl) {
      return {
        satisfied: false,
        reason: `Element matching "${itemQuery}" was not found in DOM snapshot`
      };
    }

    if (['completed', 'checked', 'done', 'finished'].includes(expectedState)) {
      const isChecked = matchingEl.checked === true || matchingEl.ariaChecked === true;
      return {
        satisfied: isChecked,
        reason: isChecked
          ? `"${itemQuery}" is completed/checked`
          : `"${itemQuery}" is unchecked/not completed`
      };
    }

    if (['active', 'unchecked', 'uncompleted'].includes(expectedState)) {
      const isUnchecked = matchingEl.checked === false || matchingEl.ariaChecked === false || (!matchingEl.checked && !matchingEl.ariaChecked);
      return {
        satisfied: isUnchecked,
        reason: isUnchecked
          ? `"${itemQuery}" is active/unchecked`
          : `"${itemQuery}" is checked/completed`
      };
    }

    if (['present', 'visible'].includes(expectedState)) {
      return { satisfied: true, reason: `"${itemQuery}" is visible on page` };
    }
  }

  // 2. Count assertions: "2 items left", "0 items left", "no items left", "3 todos"
  const itemsLeftMatch = cond.match(/^(\d+|no|zero)\s+(?:items?|todos?|tasks?)\s+(?:left|remaining)$/i);
  if (itemsLeftMatch) {
    const expectedCountStr = itemsLeftMatch[1].toLowerCase();
    const expectedCount = (expectedCountStr === 'no' || expectedCountStr === 'zero') ? 0 : parseInt(expectedCountStr, 10);

    // Look for counter text in bodyText first (e.g. "1 item left" in non-interactive spans)
    const bodyCounterMatch = (bodyText || '').match(/(\d+|no|zero)\s+(?:items?|todos?|tasks?)\s+(?:left|remaining)/i);
    if (bodyCounterMatch) {
      const actualCount = (bodyCounterMatch[1].toLowerCase() === 'no' || bodyCounterMatch[1].toLowerCase() === 'zero')
        ? 0
        : parseInt(bodyCounterMatch[1], 10);
      return {
        satisfied: actualCount === expectedCount,
        reason: actualCount === expectedCount
          ? `Counter text matched "${bodyCounterMatch[0]}"`
          : `Expected ${expectedCount} items left, but found ${actualCount} ("${bodyCounterMatch[0]}")`,
        actual: actualCount,
        expected: expectedCount
      };
    }

    // Look for counter element or text in snapshot elements
    const counterEl = elements.find((el) => /\d+\s+(?:items?|todos?|tasks?)\s+(?:left|remaining)/i.test(el.text || ''));
    if (counterEl && counterEl.text) {
      const numMatch = counterEl.text.match(/(\d+)\s+(?:items?|todos?|tasks?)\s+(?:left|remaining)/i);
      if (numMatch) {
        const actualCount = parseInt(numMatch[1], 10);
        return {
          satisfied: actualCount === expectedCount,
          reason: actualCount === expectedCount
            ? `Counter text matched "${counterEl.text}"`
            : `Expected ${expectedCount} items left, but found ${actualCount} ("${counterEl.text}")`,
          actual: actualCount,
          expected: expectedCount
        };
      }
    }

    // Direct active todos count from checkboxes (excluding global toggle / master control checkboxes)
    const checkboxes = elements.filter((el) => {
      if (el.role !== 'checkbox' && el.type !== 'checkbox') return false;
      const desc = `${el.id} ${el.name || ''} ${el.ariaLabel || ''} ${el.title || ''} ${el.text || ''}`.toLowerCase();
      if (/toggle-all|mark[\s-_]*all|select[\s-_]*all/i.test(desc)) return false;
      return true;
    });
    const activeCount = checkboxes.filter((c) => !c.checked && !c.ariaChecked).length;
    return {
      satisfied: activeCount === expectedCount,
      reason: activeCount === expectedCount
        ? `Active item count is ${activeCount}`
        : `Expected ${expectedCount} active items, but found ${activeCount}`,
      actual: activeCount,
      expected: expectedCount
    };
  }

  // 3. Negative assertions: "should not see 'X'", "not visible: 'X'", "does not contain 'X'"
  const notSeeMatch = cond.match(/^(?:should\s+not\s+see|do\s+not\s+see|not\s+visible|no)\s+["']?(.+?)["']?$/i);
  if (notSeeMatch) {
    const targetText = notSeeMatch[1].trim().toLowerCase();
    const found = elements.some((el) => (el.text || '').toLowerCase().includes(targetText)) ||
      bodyText.toLowerCase().includes(targetText);
    return {
      satisfied: !found,
      reason: !found ? `"${targetText}" is not visible on page` : `Found unexpected text "${targetText}" on page`
    };
  }

  // 4. Positive visibility assertions: "should see 'X'", "see 'X'", "'X' is visible", "contains 'X'"
  const seeMatch = cond.match(/^(?:should\s+see|see|contains?|has\s+text|visible:?)\s+["']?(.+?)["']?$/i);
  const targetQuery = seeMatch ? seeMatch[1].trim().toLowerCase() : lowerCond;

  // Check elements text, page title, URL, and bodyText
  const matchingEl = elements.find((el) => {
    const txt = `${el.text || ''} ${el.ariaLabel || ''} ${el.placeholder || ''} ${el.title || ''} ${el.value || ''}`.toLowerCase();
    return txt.includes(targetQuery);
  });

  if (matchingEl) {
    return { satisfied: true, reason: `Found matching element with text "${matchingEl.text}"` };
  }

  if (pageTitle.toLowerCase().includes(targetQuery)) {
    return { satisfied: true, reason: `Page title matches "${pageTitle}"` };
  }

  if (pageUrl.toLowerCase().includes(targetQuery)) {
    return { satisfied: true, reason: `Page URL matches "${pageUrl}"` };
  }

  if (bodyText.toLowerCase().includes(targetQuery)) {
    return { satisfied: true, reason: `Found text "${targetQuery}" in page content` };
  }

  return {
    satisfied: false,
    reason: `Condition "${cond}" was not satisfied by page state`
  };
}

export interface PlanActVerifyParams {
  goal: string;
  condition?: string;
  snapshot?: DOMSnapshot;
  getSnapshot?: () => Promise<DOMSnapshot | any>;
  executeAction?: (payload: ActionPayload | any) => Promise<any>;
  browserEngine?: any;
  decisionEngine?: any;
  nanoClient?: any;
  webMcpClient?: any;
  memory?: any;
  context?: Record<string, any>;
  maxAttempts?: number;
  onLog?: (msg: string, level?: string) => void;
  onStep?: (stepInfo: any) => void;
}

export interface PlanActVerifyResult {
  success: boolean;
  verified: boolean;
  attempts: number;
  lastAction?: ActionPayload;
  lastResult?: any;
  lastSnapshot?: DOMSnapshot;
  verification?: VerificationResult;
  message?: string;
  error?: string;
}

/**
 * Executes a plan-act-verify step with bounded retries and failure context feedback.
 */
export async function planActVerifyStep(params: PlanActVerifyParams): Promise<PlanActVerifyResult> {
  const maxAttempts = params.maxAttempts ?? 3;
  const condition = params.condition || params.goal;
  const onLog = params.onLog || (() => {});
  const onStep = params.onStep || (() => {});

  let attempt = 0;
  let failureNote: string | undefined = undefined;
  let lastResult: any = null;
  let lastAction: ActionPayload | undefined = undefined;
  let currentSnapshot: DOMSnapshot = params.snapshot?.elements
    ? params.snapshot
    : { url: params.snapshot?.url || '', title: params.snapshot?.title || '', elements: [] };
  let verification: VerificationResult = { satisfied: false, reason: 'Not verified yet' };

  while (attempt < maxAttempts) {
    attempt++;
    if (params.getSnapshot) {
      try {
        const fresh = await params.getSnapshot();
        if (fresh) currentSnapshot = fresh;
      } catch (err: any) {
        onLog(`Notice fetching snapshot: ${err?.message}`, 'system');
      }
    }

    const planGoal = failureNote ? `${params.goal} (Note: previous attempt failed: ${failureNote})` : params.goal;
    const planContext = {
      ...params.context,
      ...(failureNote ? { failureNote, lastFailure: failureNote } : {}),
      attempt
    };

    lastAction = await planActionStep({
      goal: planGoal,
      snapshot: currentSnapshot,
      decisionEngine: params.decisionEngine,
      nanoClient: params.nanoClient,
      webMcpClient: params.webMcpClient,
      context: planContext
    });

    onStep({ attempt, action: lastAction, goal: planGoal });

    if (lastAction.action === 'done') {
      verification = verifyCondition(condition, currentSnapshot);
      if (verification.satisfied) {
        return {
          success: true,
          verified: true,
          attempts: attempt,
          lastAction,
          lastResult: { success: true, message: lastAction.explanation || 'Done' },
          lastSnapshot: currentSnapshot,
          verification,
          message: lastAction.explanation || 'Done'
        };
      }
      failureNote = verification.reason;
      continue;
    }

    try {
      if (params.executeAction) {
        lastResult = await params.executeAction(lastAction);
      } else if (params.browserEngine?.perform) {
        lastResult = await params.browserEngine.perform(lastAction);
      } else {
        lastResult = { success: true };
      }
    } catch (err: any) {
      lastResult = { success: false, error: err?.message || String(err) };
    }

    if (params.memory?.recordAction) {
      params.memory.recordAction(lastAction, lastResult);
    }

    if (params.getSnapshot) {
      try {
        const fresh = await params.getSnapshot();
        if (fresh) currentSnapshot = fresh;
      } catch (err: any) {
        onLog(`Notice fetching fresh snapshot after act: ${err?.message}`, 'system');
      }
    }

    verification = verifyCondition(condition, currentSnapshot);
    if (verification.satisfied) {
      return {
        success: lastResult?.success ?? true,
        verified: true,
        attempts: attempt,
        lastAction,
        lastResult,
        lastSnapshot: currentSnapshot,
        verification,
        message: lastResult?.message || verification.reason
      };
    }

    failureNote = verification.reason || 'Verification condition not met';
    onLog(`Attempt ${attempt}/${maxAttempts} failed verification: ${failureNote}`, 'warn');
  }

  return {
    success: false,
    verified: false,
    attempts: attempt,
    lastAction,
    lastResult,
    lastSnapshot: currentSnapshot,
    verification,
    message: `Verification failed after ${attempt} attempts: ${failureNote}`,
    error: lastResult?.error || failureNote
  };
}

