/**
 * @kevin/core - Autonomous In-Browser AI Agent Engine
 */

export * from './types.js';

// Agent
export { AgentRuntime, AgentState, planActionStep, verifyCondition } from './agent/agent-runtime.js';
export { ContextMemory, resolveEntityReference } from './agent/context-memory.js';
export { decomposeCommand } from './agent/plan-decomposer.js';
export { CommandStream } from './agent/command-stream.js';
export { VoiceStateMachine, InteractionState, VoiceAgentState } from './agent/voice-state-machine.js';
export {
  cleanTranscript,
  extractTextCandidates,
  normalizeSpokenUrl,
  extractUrlCandidates,
  toHttpUrl,
  parseCandidatePick
} from './agent/voice-spans.js';
export {
  evaluateVoicePolicy,
  describeAction,
  DEFAULT_THRESHOLDS,
  SILENCE_COMPLETE_MS,
  PAYLOAD_SILENCE_MS,
  type VoiceThresholds,
  type VoicePolicyInput,
  type VoicePolicyResult,
  type DisambiguationCandidate
} from './agent/voice-policy.js';
export {
  voiceDecision,
  scoreIntents,
  scoreSites,
  type VoiceDecisionInput,
  type VoiceDecisionResult
} from './ai/voice-decision.js';

// Perception
export { DecisionEngine, rankCandidates, defaultDecisionEngine } from './perception/decision-engine.js';
export { extractInteractiveSnapshot, sanitizeText } from './perception/dom-extractor.js';
export { normalizeBoundingBox, findElementAtPoint } from './perception/visual.js';

// AI
export { NanoClient } from './ai/nano-client.js';
export { browserDecision } from './ai/decision-model.js';
export {
  loadModel,
  checkWebGPU,
  isModelLoaded,
  WebGPURequiredError,
  SUPPORTED_DECISION_MODELS,
  DEFAULT_DECISION_MODEL
} from './ai/model-loader.js';

// Actions
export { validateAction, SUPPORTED_ACTIONS, ACTION_TYPES } from './actions/action-schema.js';
export { executeAction } from './actions/action-executor.js';
export { BrowserEngine } from './actions/browser-engine.js';
export { extractSchema, normalizeSchema, coerceValue } from './actions/schema-extractor.js';

// Security
export { classifyActionRisk, sanitizePrompt } from './security/risk-classifier.js';

// MCP
export { WebMcpClient, webMcpClient } from './mcp/webmcp.js';

// Cache
export { ActionCache, computeDomFingerprint, computeCacheKey } from './cache/action-cache.js';

// Testing
export { PipelineHarness, AgentTestHarness } from './testing/agent-harness.js';
