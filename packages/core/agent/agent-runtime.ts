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

export interface RunTaskHandlers {
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
  async runTask(userGoal: any, handlers: RunTaskHandlers = {}): Promise<any> {
    if (userGoal && typeof userGoal === 'object' && Symbol.asyncIterator in userGoal) {
      return this.runStream(userGoal, handlers);
    }

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

    // Look for counter element or text in snapshot
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

    // Direct active todos count from checkboxes
    const checkboxes = elements.filter((el) => el.role === 'checkbox' || el.type === 'checkbox');
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
