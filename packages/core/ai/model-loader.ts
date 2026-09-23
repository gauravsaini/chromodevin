/**
 * HF-compatible Decision Model Loader for Kevin.
 *
 * Any Hugging Face model ID can be used directly — the old
 * SUPPORTED_DECISION_MODELS table is now a registry of known-good
 * presets, NOT a blocklist. Unknown IDs load straight from HF
 * (with a console warning) after pipeline_tag auto-detection via
 * the HF Hub API.
 *
 * Shorthand ref format: "org/name:revision#dtype@device"
 *   e.g. "onnx-community/Qwen2.5-0.5B-ONNX#q4@webgpu"
 *   e.g. "Xenova/bge-small-en-v1.5:main#q8@auto"
 *
 * Env overrides (also accepted via kevin.config.json `model` block,
 * passed explicitly through LoadModelOptions.config):
 *   KEVIN_MODEL, KEVIN_REVISION, KEVIN_TASK, KEVIN_DTYPE, KEVIN_DEVICE,
 *   KEVIN_LOCAL_MODEL_PATH, KEVIN_ALLOW_LOCAL_MODELS
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

// ── Generic model config ─────────────────────────────────────────────

export type KevinModelTask =
  | 'auto'
  | 'text-classification'
  | 'text-generation'
  | 'feature-extraction'
  | 'zero-shot-classification';

export type KevinModelDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'auto';
export type KevinModelDevice = 'webgpu' | 'wasm' | 'cpu' | 'auto';

export interface KevinModelConfig {
  /** Full HF repo id, e.g. "onnx-community/Qwen2.5-0.5B-ONNX" */
  id: string;
  /** Branch/tag/commit. Default 'main'. */
  revision?: string;
  /** Pipeline task. Default 'auto' (HF API detect → fallback list). */
  task?: KevinModelTask;
  /** Weight precision. Default 'auto' (q4 browser / fp32 node). */
  dtype?: KevinModelDtype | string;
  /** Execution device. Default 'webgpu' (strict, back-compat). Use 'auto' for fallback. */
  device?: KevinModelDevice | string;
  /** Optional pre-downloaded local bundle dir. */
  localBundle?: string;
  /** Optional local model path for transformers env cache. */
  localModelPath?: string;
}

export type ModelRef = string | KevinModelConfig;

export interface KevinFileConfig {
  model?: ModelRef;
  revision?: string;
  task?: KevinModelTask;
  dtype?: KevinModelDtype | string;
  device?: KevinModelDevice | string;
  localBundle?: string;
  localModelPath?: string;
  allowLocalModels?: boolean;
}

// ── Env / file config ────────────────────────────────────────────────

function readEnv(key: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && (process as any)?.env) {
      const v = (process as any).env[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Env-level defaults. Browser-safe (no-ops where process is undefined). */
export function getModelEnvDefaults(): {
  model?: string; revision?: string; task?: string; dtype?: string; device?: string;
  localModelPath?: string; allowLocalModels?: boolean;
} {
  const allowRaw = readEnv('KEVIN_ALLOW_LOCAL_MODELS');
  return {
    model: readEnv('KEVIN_MODEL'),
    revision: readEnv('KEVIN_REVISION'),
    task: readEnv('KEVIN_TASK'),
    dtype: readEnv('KEVIN_DTYPE'),
    device: readEnv('KEVIN_DEVICE'),
    localModelPath: readEnv('KEVIN_LOCAL_MODEL_PATH'),
    allowLocalModels: allowRaw === undefined ? undefined : /^(1|true|yes)$/i.test(allowRaw)
  };
}

/**
 * Parse "org/name:revision#dtype@device" shorthand (plus plain IDs).
 * Later segments win over earlier ones; explicit object fields win over
 * parsed segments; env/file config fills whatever is still unset.
 */
export function parseModelRef(
  ref: ModelRef,
  defaults: { revision?: string; task?: KevinModelTask; dtype?: KevinModelDtype | string; device?: KevinModelDevice | string; localBundle?: string; localModelPath?: string } = {}
): KevinModelConfig {
  const env = getModelEnvDefaults();
  const base: KevinModelConfig = {
    id: '',
    revision: defaults.revision ?? env.revision ?? 'main',
    task: (defaults.task ?? (env.task as KevinModelTask) ?? 'auto') as KevinModelTask,
    dtype: (defaults.dtype ?? env.dtype ?? 'auto') as KevinModelDtype | string,
    device: (defaults.device ?? env.device ?? 'webgpu') as KevinModelDevice | string,
    localBundle: defaults.localBundle,
    localModelPath: defaults.localModelPath ?? env.localModelPath
  };

  if (typeof ref === 'string') {
    let rest = ref.trim();
    // @device (last @ after the final / so org scoping is safe)
    const atIdx = rest.lastIndexOf('@');
    const slashIdx = rest.lastIndexOf('/');
    if (atIdx > slashIdx && atIdx !== -1) {
      const dev = rest.slice(atIdx + 1).trim();
      if (dev) base.device = dev as KevinModelDevice;
      rest = rest.slice(0, atIdx);
    }
    // #dtype
    const hashIdx = rest.lastIndexOf('#');
    if (hashIdx !== -1) {
      const dt = rest.slice(hashIdx + 1).trim();
      if (dt) base.dtype = dt as KevinModelDtype;
      rest = rest.slice(0, hashIdx);
    }
    // :revision (only the part after the final / may carry :revision)
    const lastSlash = rest.lastIndexOf('/');
    const colonIdx = rest.indexOf(':', lastSlash === -1 ? 0 : lastSlash);
    if (colonIdx !== -1) {
      const rev = rest.slice(colonIdx + 1).trim();
      if (rev) base.revision = rev;
      rest = rest.slice(0, colonIdx);
    }
    base.id = rest || env.model || DEFAULT_DECISION_MODEL;
  } else if (ref && typeof ref === 'object') {
    base.id = (ref.id || env.model || DEFAULT_DECISION_MODEL).trim();
    if (ref.revision) base.revision = ref.revision;
    if (ref.task) base.task = ref.task;
    if (ref.dtype) base.dtype = ref.dtype;
    if (ref.device) base.device = ref.device;
    if (ref.localBundle) base.localBundle = ref.localBundle;
    if (ref.localModelPath) base.localModelPath = ref.localModelPath;
  } else {
    base.id = env.model || DEFAULT_DECISION_MODEL;
  }

  if (!base.id || !base.id.includes('/')) {
    // Allow bare registry keys ("laya-onnx") and short names.
    const spec = lookupDecisionModel(base.id || DEFAULT_DECISION_MODEL);
    if (spec) base.id = spec.id;
  }
  return base;
}

/** Registry lookup by short key OR full "org/name" id. Null when unknown. */
export function lookupDecisionModel(idOrKey: string): DecisionModelSpec | null {
  if (!idOrKey) return null;
  if (SUPPORTED_DECISION_MODELS[idOrKey]) return SUPPORTED_DECISION_MODELS[idOrKey];
  const lower = idOrKey.toLowerCase();
  for (const spec of Object.values(SUPPORTED_DECISION_MODELS)) {
    if (spec.id.toLowerCase() === lower) return spec;
  }
  return null;
}

// ── HF Hub auto-detect ───────────────────────────────────────────────

export interface ModelCardInfo {
  pipelineTag: string | null;
  hasOnnx: boolean;
  hasTokenizer: boolean;
  hasConfig: boolean;
  siblings: string[];
}

const _cardCache = new Map<string, ModelCardInfo | null>();

function mapPipelineTag(tag: string | null | undefined): KevinModelTask | null {
  if (!tag) return null;
  const t = tag.toLowerCase().trim();
  if (t === 'text-classification' || t === 'token-classification') return 'text-classification';
  if (t === 'text-generation' || t === 'text2text-generation') return 'text-generation';
  if (t === 'feature-extraction' || t === 'sentence-similarity') return 'feature-extraction';
  if (t === 'zero-shot-classification') return 'zero-shot-classification';
  return null;
}

/**
 * Fetch https://huggingface.co/api/models/{id} and extract pipeline_tag +
 * sibling file presence. Never throws — returns null offline / on 404 so
 * callers fall back to the task candidate list.
 */
export async function detectModelTask(
  modelId: string,
  fetchImpl: typeof fetch | null = typeof fetch !== 'undefined' ? fetch : null
): Promise<ModelCardInfo | null> {
  if (!modelId || !modelId.includes('/')) return null;
  if (_cardCache.has(modelId)) return _cardCache.get(modelId) ?? null;
  if (!fetchImpl) return null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch {} }, 6000) : null;
    const res = await fetchImpl(`https://huggingface.co/api/models/${modelId}`, ctrl ? { signal: ctrl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res || !res.ok) {
      _cardCache.set(modelId, null);
      return null;
    }
    const data: any = await res.json();
    const siblings: string[] = Array.isArray(data?.siblings)
      ? data.siblings.map((s: any) => String(s?.rfilename || '')).filter(Boolean)
      : [];
    const lower = siblings.map((s) => s.toLowerCase());
    const info: ModelCardInfo = {
      pipelineTag: typeof data?.pipeline_tag === 'string' ? data.pipeline_tag : null,
      hasOnnx: lower.some((s) => s.endsWith('.onnx') || s.includes('/model.onnx') || s === 'model.onnx' || s.includes('onnx/')),
      hasTokenizer: lower.some((s) => s.endsWith('tokenizer.json')),
      hasConfig: lower.some((s) => s.endsWith('config.json')),
      siblings
    };
    _cardCache.set(modelId, info);
    return info;
  } catch {
    _cardCache.set(modelId, null);
    return null;
  }
}

/** @internal Test-only: clear HF card cache */
export function _resetCardCacheForTest(): void {
  _cardCache.clear();
}

export const DEFAULT_TASK_CANDIDATES: KevinModelTask[] = [
  'text-classification',
  'text-generation',
  'feature-extraction'
];

/** Resolve ordered task candidates for a config (auto-detect aware). */
export async function resolveTaskCandidates(config: KevinModelConfig): Promise<string[]> {
  if (config.task && config.task !== 'auto') return [config.task];
  const known = lookupDecisionModel(config.id);
  if (known?.pipelineTag) return [known.pipelineTag];
  const card = await detectModelTask(config.id);
  const mapped = mapPipelineTag(card?.pipelineTag);
  if (mapped) return [mapped];
  return [...DEFAULT_TASK_CANDIDATES];
}

// ── Device / dtype fallback ──────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof (window as any)?.document !== 'undefined';
}

export async function resolveDeviceOrder(device: KevinModelDevice | string | undefined): Promise<string[]> {
  const d = (device || 'webgpu').toLowerCase();
  if (d !== 'auto') return [d];
  // auto: webgpu → wasm → cpu, filtered by availability
  try {
    const gpu = await checkWebGPU();
    if (gpu.available) return ['webgpu', 'wasm', 'cpu'];
  } catch { /* fall through */ }
  return ['wasm', 'cpu'];
}

export function resolveDtypeCandidates(dtype: KevinModelDtype | string | undefined): string[] {
  const d = (dtype || 'auto').toLowerCase();
  if (d !== 'auto') return [d];
  return isBrowser() ? ['q4', 'q8', 'fp16', 'fp32'] : ['fp32', 'fp16', 'q8', 'q4'];
}

function isOomError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return /out of memory|oom|memory|allocation|buffer/.test(msg);
}

// ── Loader ───────────────────────────────────────────────────────────

let _pipeline: any = null;
let _pipelineKey: string | null = null;
let _loading: Promise<any> | null = null;

export class WebGPURequiredError extends Error {
  constructor(message = 'WebGPU is strictly required for Kevin decision modeling. No fallback allowed.') {
    super(message);
    this.name = 'WebGPURequiredError';
  }
}

export interface LoadModelOptions {
  /** Preferred: full config or shorthand string. Wins over modelId. */
  model?: ModelRef;
  /** Legacy: bare model id string. */
  modelId?: string;
  revision?: string;
  task?: KevinModelTask;
  dtype?: KevinModelDtype | string;
  device?: KevinModelDevice | string;
  localBundle?: string;
  localModelPath?: string;
  allowLocalModels?: boolean;
  /** kevin.config.json `model` block (already parsed by caller). */
  config?: KevinFileConfig;
  /** Override fetch impl (tests). */
  fetchImpl?: typeof fetch | null;
  onProgress?: (progress: { status: string; progress?: number; file?: string; device?: string; modelId?: string; task?: string }) => void;
}

function pipelineCacheKey(config: KevinModelConfig, task: string, dtype: string, device: string): string {
  return `${config.id}@${config.revision || 'main'}#${task}:${dtype}@${device}`;
}

/**
 * Loads any HF decision model. Known registry IDs use their preset
 * pipeline tag; unknown IDs warn once and load directly from HF after
 * pipeline_tag auto-detection. device:'auto' falls back
 * webgpu → wasm → cpu; dtype:'auto' retries on OOM.
 *
 * Back-compat: default device is still 'webgpu' (strict) unless the
 * caller passes device:'auto' or sets KEVIN_DEVICE=auto.
 */
export async function loadModel({
  model,
  modelId,
  revision,
  task,
  dtype,
  device,
  localBundle,
  localModelPath,
  allowLocalModels,
  config,
  fetchImpl,
  onProgress = () => {}
}: LoadModelOptions = {}): Promise<any> {
  const env = getModelEnvDefaults();
  const ref: ModelRef =
    model ??
    modelId ??
    config?.model ??
    env.model ??
    DEFAULT_DECISION_MODEL;

  const resolved: KevinModelConfig = parseModelRef(ref, {
    revision: revision ?? config?.revision,
    task: task ?? (config?.task as KevinModelTask | undefined),
    dtype: dtype ?? config?.dtype,
    device: device ?? (config?.device as KevinModelDevice | undefined),
    localBundle: localBundle ?? config?.localBundle,
    localModelPath: localModelPath ?? config?.localModelPath
  });

  const known = lookupDecisionModel(resolved.id);
  if (!known && typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[kevin] Unknown model "${resolved.id}" — not in SUPPORTED_DECISION_MODELS registry. ` +
      `Loading directly from Hugging Face (auto task-detect).`
    );
  }
  if (known?.localBundle && !resolved.localBundle) resolved.localBundle = known.localBundle;

  const tasks = await resolveTaskCandidates(resolved);
  const devices = await resolveDeviceOrder(resolved.device);
  const dtypes = resolveDtypeCandidates(resolved.dtype);

  if (resolved.device && resolved.device !== 'auto' && resolved.device !== 'webgpu') {
    // explicit non-webgpu device: no GPU probe needed
  } else if (devices.length === 1 && devices[0] === 'webgpu') {
    const gpu = await checkWebGPU();
    if (!gpu.available) {
      throw new WebGPURequiredError(
        `WebGPU is strictly required to load ${resolved.id}. Reason: ${gpu.reason || 'WebGPU unavailable'}`
      );
    }
  }

  const cacheKeyPrefix = `${resolved.id}@${resolved.revision || 'main'}`;
  if (_pipeline && _pipelineKey && _pipelineKey.startsWith(cacheKeyPrefix)) return _pipeline;
  if (_loading) return _loading;

  _loading = (async () => {
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
    const { pipeline, env: tEnv } = pipelineModule;

    const allowLocal = allowLocalModels ?? config?.allowLocalModels ?? env.allowLocalModels ?? true;
    tEnv.allowLocalModels = allowLocal;
    tEnv.useBrowserCache = true;
    const resolvedLocalPath = resolved.localModelPath || (allowLocal ? resolved.localBundle : undefined);
    if (resolvedLocalPath) tEnv.localModelPath = resolvedLocalPath;

    onProgress({ status: 'init', progress: 0, device: devices[0], modelId: resolved.id });

    let lastError: any = null;

    for (const targetDevice of devices) {
      for (const tryTask of tasks) {
        for (const tryDtype of dtypes) {
          try {
            const pipe = await pipeline(tryTask, resolved.id, {
              dtype: tryDtype,
              device: targetDevice,
              revision: resolved.revision || 'main',
              progress_callback: (data: any) => {
                if (data.status === 'progress') {
                  onProgress({ status: 'downloading', progress: data.progress, file: data.file, device: targetDevice, modelId: resolved.id, task: tryTask });
                } else if (data.status === 'ready' || data.status === 'done') {
                  onProgress({ status: 'ready', progress: 100, device: targetDevice, modelId: resolved.id, task: tryTask });
                }
              }
            });
            if (pipe) {
              (pipe as any).__kevinTask = tryTask;
              (pipe as any).__kevinDevice = targetDevice;
              (pipe as any).__kevinDtype = tryDtype;
              (pipe as any).__kevinModelId = resolved.id;
              _pipeline = pipe;
              _pipelineKey = pipelineCacheKey(resolved, tryTask, tryDtype, targetDevice);
              _loading = null;
              return _pipeline;
            }
          } catch (err) {
            lastError = err;
            // OOM → keep retrying smaller dtypes; task/device mismatch → next candidate
            if (!isOomError(err) && dtypes.length > 1) {
              // still continue the loops; cheapest is to keep going
            }
            void fetchImpl; // reserved for future authenticated Hub fetches
          }
        }
      }
    }

    _loading = null;
    throw new WebGPURequiredError(
      `Failed to load ${resolved.id} (tried tasks [${tasks.join(', ')}] on devices [${devices.join(', ')}] with dtypes [${dtypes.join(', ')}]): ${lastError?.message || 'Pipeline initialization failed'}`
    );
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

/** @internal Test-only: inspect resolved pipeline metadata */
export function _pipelineMetaForTest(): { key: string | null; task?: string; device?: string; dtype?: string; modelId?: string } {
  return {
    key: _pipelineKey,
    task: _pipeline?.__kevinTask,
    device: _pipeline?.__kevinDevice,
    dtype: _pipeline?.__kevinDtype,
    modelId: _pipeline?.__kevinModelId
  };
}

/** @internal Test-only: reset singleton for test isolation */
export function _resetForTest(): void {
  _pipeline = null;
  _pipelineKey = null;
  _loading = null;
}
