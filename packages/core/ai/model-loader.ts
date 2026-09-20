/**
 * WebGPU Decision Model Loader for Kevin.
 * Loads Laya (receptron/laya-onnx), Kev (jaredpalmer/kev-0.6b), and RLCD (notnotsamuel/LFM2.5-350M-RLCD)
 * decision models for single-pass discriminative browser action planning.
 */

export interface DecisionModelSpec {
  id: string;
  name: string;
  family: string;
  baseModel: string;
  contract: string;
  pipelineTag: string;
  localBundle?: string;
  onnxFile?: string;
}

export const SUPPORTED_DECISION_MODELS: Record<string, DecisionModelSpec> = {
  'laya-onnx': {
    id: 'receptron/laya-onnx',
    name: 'laya-onnx',
    family: 'laya',
    baseModel: 'convaiinnovations/laya',
    contract: '/v1/systemone',
    pipelineTag: 'text-classification',
    localBundle: 'models/laya-onnx',
    onnxFile: 'laya.onnx'
  },
  'lfm2.5-350m-onnx': {
    id: 'onnx-community/LFM2.5-350M-ONNX',
    name: 'LFM2.5-350M-ONNX',
    family: 'rlcd-decision',
    baseModel: 'LiquidAI/LFM2.5-350M',
    contract: 'constrained-likelihood',
    pipelineTag: 'text-classification',
    localBundle: 'models/lfm2.5-350m-onnx'
  },
  'lfm2.5-rlcd': {
    id: 'notnotsamuel/LFM2.5-350M-RLCD',
    name: 'LFM2.5-350M-RLCD',
    family: 'rlcd',
    baseModel: 'LiquidAI/LFM2.5-350M',
    contract: 'constrained-likelihood',
    pipelineTag: 'text-classification',
    localBundle: 'models/lfm2.5-350m-rlcd-onnx'
  },
  'kev-0.6b': {
    id: 'jaredpalmer/kev-0.6b',
    name: 'kev-0.6b',
    family: 'kev',
    baseModel: 'Qwen/Qwen3-0.6B-Base',
    contract: '/v1/systemone',
    pipelineTag: 'text-classification',
    localBundle: 'models/jaredpalmer_kev-0.6b_onnx'
  }
};

export const DEFAULT_DECISION_MODEL = 'receptron/laya-onnx';

let _pipeline: any = null;
let _loading: Promise<any> | null = null;

export class WebGPURequiredError extends Error {
  constructor(message = 'WebGPU is strictly required for Kevin decision modeling. No fallback allowed.') {
    super(message);
    this.name = 'WebGPURequiredError';
  }
}

export interface LoadModelOptions {
  modelId?: string;
  dtype?: string;
  device?: 'webgpu' | string;
  onProgress?: (progress: { status: string; progress?: number; file?: string; device?: string; modelId?: string }) => void;
}

/**
 * Loads the decision model for browser inference strictly via WebGPU.
 */
export async function loadModel({
  modelId = DEFAULT_DECISION_MODEL,
  dtype = 'q4',
  device = 'webgpu',
  onProgress = () => {}
}: LoadModelOptions = {}): Promise<any> {
  if (_pipeline) return _pipeline;

  if (_loading) return _loading;

  _loading = (async () => {
    const gpu = await checkWebGPU();
    if (!gpu.available) {
      throw new WebGPURequiredError(`WebGPU is strictly required to load ${modelId}. Reason: ${gpu.reason || 'WebGPU unavailable'}`);
    }

    let pipelineModule: any;
    try {
      pipelineModule = await import('@huggingface/transformers');
    } catch (e) {
      if (typeof window !== 'undefined') {
        pipelineModule = await (Function('return import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm")')());
      } else {
        throw e;
      }
    }
    const { pipeline, env } = pipelineModule;

    env.allowLocalModels = true;
    env.useBrowserCache = true;

    const targetDevice = 'webgpu';
    onProgress({ status: 'init', progress: 0, device: targetDevice, modelId });

    const tryTasks = ['text-classification', 'text-generation'];
    let lastError: any = null;

    for (const task of tryTasks) {
      try {
        _pipeline = await pipeline(task, modelId, {
          dtype,
          device: targetDevice,
          progress_callback: (data: any) => {
            if (data.status === 'progress') {
              onProgress({ status: 'downloading', progress: data.progress, file: data.file });
            } else if (data.status === 'ready') {
              onProgress({ status: 'ready', progress: 100 });
            }
          }
        });
        if (_pipeline) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!_pipeline) {
      throw new WebGPURequiredError(`Failed to load ${modelId} on WebGPU: ${lastError?.message || 'Pipeline initialization failed'}`);
    }

    _loading = null;
    return _pipeline;
  })();

  return _loading;
}

/**
 * Check if WebGPU is available in this browser.
 */
export async function checkWebGPU(): Promise<{ available: boolean; reason?: string; adapter?: any }> {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
    return { available: false, reason: 'WebGPU API not available in this browser' };
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      return { available: false, reason: 'No WebGPU adapter found (no compatible GPU)' };
    }
    return { available: true, adapter };
  } catch (err: any) {
    return { available: false, reason: err?.message || String(err) };
  }
}

/**
 * Returns whether the model is already loaded.
 */
export function isModelLoaded(): boolean {
  return _pipeline !== null;
}

/** @internal Test-only: reset singleton for test isolation */
export function _resetForTest(): void {
  _pipeline = null;
  _loading = null;
}
