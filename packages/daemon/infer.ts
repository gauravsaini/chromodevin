/**
 * Daemon inference handler and session manager for Kevin.
 * Executes on-device / local decision models with lazy session caching.
 */

import {
  loadModel,
  parseModelRef,
  DEFAULT_DECISION_MODEL,
  type KevinModelConfig
} from '../core/ai/model-loader.js';
import {
  normalizePipelineOutput,
  cosineSimilarity
} from '../core/ai/decision-model.js';

export const VALID_INFER_TASKS = [
  'text-classification',
  'text-generation',
  'feature-extraction',
  'zero-shot-classification'
] as const;

export type InferTask = (typeof VALID_INFER_TASKS)[number];

export interface InferCommandRequest {
  id?: string;
  type: 'INFER';
  task: InferTask;
  input: string | string[];
  labels?: string[];
  model?: string | Record<string, any>;
  [key: string]: any;
}

export interface InferOutput {
  labels?: Array<{ label: string; score: number }>;
  text?: string;
  candidateScores?: number[];
}

export interface InferSuccessResponse {
  id?: string;
  success: true;
  task: string;
  output: InferOutput;
  model: string;
  device: string;
  dtype: string;
}

export interface InferErrorResponse {
  id?: string;
  success: false;
  error: string;
}

export type InferCommandResponse = InferSuccessResponse | InferErrorResponse;

// Daemon-owned lazy pipeline sessions (Map keyed by resolved model id)
export const inferSessions = new Map<string, any>();

let _loadModel: typeof loadModel = loadModel;

/**
 * Set a custom model loader implementation (primarily for unit tests).
 */
export function setModelLoader(loader: any): void {
  _loadModel = loader || loadModel;
}

/**
 * Reset model loader to default loadModel implementation.
 */
export function resetModelLoader(): void {
  _loadModel = loadModel;
}

/**
 * Clear cached inference sessions.
 */
export function clearInferSessions(): void {
  inferSessions.clear();
}

/**
 * Helper to extract array from tensor or raw output.
 */
function toList(t: any): any {
  if (t && typeof t.tolist === 'function') {
    return t.tolist();
  }
  return t;
}

/**
 * Handles INFER command from KevinDaemon.processCommand.
 * Never throws — always returns either success response or error response.
 */
export async function handleInferCommand(msg: any): Promise<InferCommandResponse> {
  const id = msg?.id;

  try {
    if (!msg || typeof msg !== 'object') {
      return { id, success: false, error: 'Invalid INFER command payload' };
    }

    const { task, input, labels, model } = msg;

    if (!task || !VALID_INFER_TASKS.includes(task as InferTask)) {
      return {
        id,
        success: false,
        error: `Invalid or unsupported task: "${task}". Supported tasks: ${VALID_INFER_TASKS.join(', ')}`
      };
    }

    if (input === undefined || input === null) {
      return { id, success: false, error: 'Missing input: input is required' };
    }

    if (typeof input !== 'string' && !Array.isArray(input)) {
      return { id, success: false, error: 'Invalid input: must be a string or string array' };
    }

    if (Array.isArray(input) && input.some((item) => typeof item !== 'string')) {
      return { id, success: false, error: 'Invalid input: all elements of input array must be strings' };
    }

    if (task === 'zero-shot-classification' && labels !== undefined) {
      if (!Array.isArray(labels) || labels.length === 0 || labels.some((l) => typeof l !== 'string')) {
        return { id, success: false, error: 'Invalid labels: must be a non-empty array of strings' };
      }
    }

    // Resolve model config with Node-safe defaults (device:'auto', dtype:'auto')
    const config: KevinModelConfig = parseModelRef(model ?? DEFAULT_DECISION_MODEL, {
      device: 'auto',
      dtype: 'auto',
      task
    });

    const modelId = config.id;
    let pipe = inferSessions.get(modelId);

    if (!pipe) {
      pipe = await _loadModel({
        model: config,
        task,
        device: config.device || 'auto',
        dtype: config.dtype || 'auto'
      });
      inferSessions.set(modelId, pipe);
    }

    const resolvedDevice = pipe?.__kevinDevice || config.device || 'auto';
    const resolvedDtype = pipe?.__kevinDtype || config.dtype || 'auto';
    const resolvedModel = pipe?.__kevinModelId || modelId;

    let output: InferOutput = {};

    switch (task) {
      case 'text-classification': {
        const raw = await pipe(input);
        const norm = normalizePipelineOutput('text-classification', raw);
        output = { labels: norm.labels || [] };
        break;
      }

      case 'text-generation': {
        const raw = await pipe(input, { max_new_tokens: 128 });
        const norm = normalizePipelineOutput('text-generation', raw);
        output = { text: norm.text || '' };
        break;
      }

      case 'feature-extraction': {
        const raw = toList(await pipe(input, { pooling: 'mean', normalize: true }));
        if (Array.isArray(input) && input.length > 1 && Array.isArray(raw) && raw.length > 1) {
          const queryVec: number[] = Array.isArray(raw[0]) ? raw[0] : [raw[0]];
          const candidateRows: any[] = raw.slice(1);
          const candidateScores: number[] = candidateRows.map((row) =>
            cosineSimilarity(queryVec, Array.isArray(row) ? row : [row])
          );
          output = { candidateScores };
        } else {
          const norm = normalizePipelineOutput('feature-extraction', raw);
          output = { candidateScores: norm.candidateScores || [] };
        }
        break;
      }

      case 'zero-shot-classification': {
        const candidateLabels = Array.isArray(labels) && labels.length > 0
          ? labels
          : ['click', 'type', 'navigate', 'scroll', 'extract', 'press_key', 'hover', 'back', 'done'];
        const raw = await pipe(input, candidateLabels);
        // Use 'zero-shot' tag so normalizePipelineOutput dispatches to zero-shot extractor
        const norm = normalizePipelineOutput('zero-shot', raw);
        const labelsList = norm.labels && norm.labels.length > 0
          ? norm.labels
          : normalizePipelineOutput('text-classification', raw).labels;
        output = { labels: labelsList || [] };
        break;
      }

      default: {
        return { id, success: false, error: `Unhandled task: ${task}` };
      }
    }

    return {
      id,
      success: true,
      task,
      output,
      model: resolvedModel,
      device: resolvedDevice,
      dtype: resolvedDtype
    };
  } catch (err: any) {
    return {
      id,
      success: false,
      error: err?.message || String(err)
    };
  }
}
