/**
 * VoiceBrowserController: Streaming voice browser automation orchestrator for Kevin.
 * Connects streaming partial speech recognizer transcripts to Kevin's System 1
 * local decision head, pure policy evaluator, and native Playwright browser engine.
 *
 * Controlled scope boundary: manages timers, in-flight cancellation, and event dispatch.
 */

import { EventEmitter } from 'node:events';
import { cleanTranscript, parseCandidatePick } from '../core/agent/voice-spans.js';
import { evaluateVoicePolicy, describeAction, type DisambiguationCandidate, type VoiceThresholds } from '../core/agent/voice-policy.js';
import { voiceDecision, type VoiceDecisionResult } from '../core/ai/voice-decision.js';
import { PlaywrightBrowserEngine } from './driver.js';
import { extractPlaywrightSnapshot } from './cdp-perception.js';
import { installOverlay } from './overlay.js';
import type { ActionPayload, DOMSnapshot } from '../core/types.js';

export interface VoiceControllerOptions {
  page: any;
  engine?: PlaywrightBrowserEngine;
  model?: string;
  thresholds?: Partial<VoiceThresholds>;
  debounceMs?: number;
  silenceCompleteMs?: number;
  candidateTtlMs?: number;
  maxInflight?: number;
  decideFn?: (input: any) => Promise<VoiceDecisionResult> | VoiceDecisionResult;
  executeFn?: (action: ActionPayload, engine: PlaywrightBrowserEngine) => Promise<any>;
}

export interface VoiceUtterance {
  id: string;
  physicalId: string | number;
  prefix: string;
  gen: number;
  text: string;
  final: boolean;
  startedAt: number;
  updatedAt: number;
  actedOn: boolean;
  actedText: string | null;
}

export class VoiceBrowserController extends EventEmitter {
  public page: any;
  public engine: PlaywrightBrowserEngine;
  public model: string;
  public thresholds?: Partial<VoiceThresholds>;
  public debounceMs: number;
  public silenceCompleteMs: number;
  public candidateTtlMs: number;
  public maxInflight: number;

  private _decide: (input: any) => Promise<VoiceDecisionResult> | VoiceDecisionResult;
  private _execute: (action: ActionPayload, engine: PlaywrightBrowserEngine) => Promise<any>;

  public snapshot: DOMSnapshot | null = null;
  public snapshotAt = 0;
  public utterance: VoiceUtterance | null = null;
  public consumed: { id: string | number; prefix: string; gen: number } | null = null;
  public pending: ActionPayload | null = null;
  public candidates: { list: DisambiguationCandidate[]; intent: any; at: number } | null = null;
  public lastDecision: any = null;
  public debounceTimer: any = null;
  public silenceTimer: any = null;
  public inflight: Array<{ ac: AbortController; text: string; at: number }> = [];
  public busy = false;
  public log: Array<{ t: number; level: string; msg: string; [key: string]: any }> = [];
  public stats = {
    calls: 0,
    actions: 0,
    latencies: [] as number[],
    commandToActionMs: [] as number[],
    decisionMs: [] as number[],
    model: 'onnx-community/LFM2.5-350M-RLCD'
  };

  constructor(options: VoiceControllerOptions) {
    super();
    this.page = options.page;
    this.engine = options.engine || new PlaywrightBrowserEngine(options.page);
    this.model = options.model || 'onnx-community/LFM2.5-350M-RLCD';
    this.thresholds = options.thresholds;
    this.debounceMs = options.debounceMs ?? 200;
    this.silenceCompleteMs = options.silenceCompleteMs ?? 900;
    this.candidateTtlMs = options.candidateTtlMs ?? 8000;
    this.maxInflight = options.maxInflight ?? 2;

    this._decide = options.decideFn || ((input) => voiceDecision(input));
    this._execute = options.executeFn || (async (action, engine) => engine.perform(action));
  }

  async start(): Promise<void> {
    if (typeof this.page?.evaluate === 'function') {
      await this.page.evaluate(installOverlay).catch(() => {});
    }
    await this.refreshSnapshot();
    this._log('info', `Voice browser controller ready on ${this.snapshot?.url || 'page'}`);
  }

  _log(level: string, msg: string, extra: Record<string, any> = {}): void {
    const entry = { t: Date.now(), level, msg, ...extra };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this.emit('log', entry);
  }

  async refreshSnapshot(): Promise<DOMSnapshot> {
    try {
      if (typeof this.page?.waitForLoadState === 'function') {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => {});
      }
      this.snapshot = await extractPlaywrightSnapshot(this.page);
    } catch {
      this.snapshot = {
        url: typeof this.page?.url === 'function' ? this.page.url() : '',
        title: '',
        elements: []
      };
    }
    this.snapshotAt = Date.now();
    this.emit('snapshot', this.snapshot);
    return this.snapshot;
  }

  handleCommand(text: string): void {
    this.handleTranscript({
      text,
      final: true,
      utteranceId: `typed-${Date.now()}`
    });
  }

  handleTranscript(msg: { text: string; final?: boolean; utteranceId: string | number }): void {
    let clean = cleanTranscript(msg.text);
    const final = msg.final === true;
    const utteranceId = msg.utteranceId;
    const now = Date.now();

    // Continuation breath check: multi-command sequence in one breath
    const consumed = this.consumed;
    let virtualId = utteranceId;
    if (consumed && consumed.id === utteranceId) {
      if (!clean.toLowerCase().startsWith(consumed.prefix)) return;
      clean = clean.slice(consumed.prefix.length).trim();
      if (clean.split(/\s+/).filter(Boolean).length < 2) return;
      virtualId = `${utteranceId}+${consumed.gen}`;
    }

    if (!this.utterance || this.utterance.id !== virtualId) {
      this.utterance = {
        id: String(virtualId),
        physicalId: utteranceId,
        prefix: consumed && consumed.id === utteranceId ? consumed.prefix : '',
        gen: consumed && consumed.id === utteranceId ? consumed.gen : 0,
        text: clean,
        final,
        startedAt: now,
        updatedAt: now,
        actedOn: false,
        actedText: null
      };
    } else {
      if (clean === this.utterance.text && final === this.utterance.final) return;
      this.utterance.text = clean;
      this.utterance.final = final || this.utterance.final;
      this.utterance.updatedAt = now;
    }

    this.emit('transcript', {
      text: clean,
      final,
      utteranceId: virtualId,
      actedOn: this.utterance.actedOn
    });

    if (!clean || this.utterance.actedOn) return;

    // Deterministic shortcut: numbered candidate pick by voice ("two", "number 3")
    if (this.candidates && now - this.candidates.at < this.candidateTtlMs) {
      const pickNumber = parseCandidatePick(clean, this.candidates.list.length);
      if (pickNumber !== null && pickNumber > 0 && pickNumber <= this.candidates.list.length) {
        const candidate = this.candidates.list[pickNumber - 1];
        this._consume(this.utterance, clean);
        this._log('info', `Picked candidate ${pickNumber} (${candidate.label}) by number (zero-model shortcut)`);

        const action: ActionPayload = {
          action: 'click',
          targetId: candidate.id,
          targetText: candidate.label,
          explanation: `Click ${candidate.label}`
        };
        this.candidates = null;
        this.engine.clearCandidates().catch(() => {});
        this._runAction(action, { via: 'candidate-pick' });
        return;
      }
    }

    clearTimeout(this.debounceTimer);
    clearTimeout(this.silenceTimer);
    this.debounceTimer = setTimeout(() => this.decideNow('debounce'), final ? 0 : this.debounceMs);
  }

  _consume(utt: VoiceUtterance, text: string): void {
    utt.actedOn = true;
    utt.actedText = text;
    this.consumed = {
      id: utt.physicalId,
      prefix: `${utt.prefix} ${text}`.trim().toLowerCase(),
      gen: (utt.gen || 0) + 1
    };
  }

  async decideNow(trigger = 'manual'): Promise<void> {
    const utt = this.utterance;
    if (!utt || !utt.text || utt.actedOn) return;
    if (this.busy) {
      this.silenceTimer = setTimeout(() => this.decideNow('after-action'), 150);
      return;
    }

    while (this.inflight.length >= this.maxInflight) {
      const old = this.inflight.shift();
      if (old) old.ac.abort();
    }

    const ac = new AbortController();
    const req = { ac, text: utt.text, at: Date.now() };
    this.inflight.push(req);

    if (Date.now() - this.snapshotAt > 1500) {
      await this.refreshSnapshot();
    }

    const textAtRequest = utt.text;
    let result: VoiceDecisionResult;

    try {
      result = await this._decide({
        transcript: textAtRequest,
        snapshot: this.snapshot,
        pendingConfirmation: this.pending ? describeAction(this.pending) : null,
        model: this.model
      });
    } catch (err: any) {
      this.inflight = this.inflight.filter((r) => r !== req);
      if (ac.signal.aborted) return;
      this._log('error', `Decision error: ${err?.message || err}`);
      this.emit('error', err);
      return;
    }

    this.inflight = this.inflight.filter((r) => r !== req);
    if (ac.signal.aborted || this.utterance !== utt || utt.actedOn) return;

    this.stats.calls += 1;
    this.stats.latencies.push(result.latencyMs);
    if (this.stats.latencies.length > 200) this.stats.latencies.shift();

    const stale = utt.text !== textAtRequest;
    const silentMs = stale ? 0 : Date.now() - utt.updatedAt;

    const policy = evaluateVoicePolicy({
      answers: result.answers,
      candidates: result.candidates,
      snapshot: this.snapshot!,
      silentMs,
      isFinal: utt.final && !stale,
      pending: this.pending,
      thresholds: this.thresholds
    });

    const decisionRecord = {
      transcript: textAtRequest,
      trigger,
      decisionLagMs: Math.max(0, Date.now() - utt.updatedAt),
      answers: result.answers,
      candidates: result.candidates,
      latencyMs: result.latencyMs,
      policy,
      silentMs,
      at: Date.now()
    };

    this.lastDecision = decisionRecord;
    this.emit('decision', decisionRecord);
    this._log(
      policy.decision === 'act' ? 'act' : 'info',
      `${result.latencyMs}ms · "${textAtRequest}" → ${policy.decision}: ${policy.summary}`
    );

    switch (policy.decision) {
      case 'act':
        this._consume(utt, textAtRequest);
        if (this.pending) this.pending = null;
        this.candidates = null;
        await this._runAction(policy.action!, { decision: decisionRecord, utterance: utt });
        break;

      case 'confirm':
        this._consume(utt, textAtRequest);
        this.pending = policy.action!;
        await this.engine.toast(`Say "confirm" to ${describeAction(policy.action!)}`, 6000);
        this.emit('pending', { action: policy.action, summary: policy.summary });
        break;

      case 'cancel':
        this._consume(utt, textAtRequest);
        this.pending = null;
        await this.engine.toast('Cancelled action');
        this.emit('pending', null);
        break;

      case 'disambiguate': {
        const list = policy.candidates || [];
        this.candidates = { list, intent: policy.pendingIntent, at: Date.now() };
        await this.engine.showCandidates(list, this.candidateTtlMs);
        await this.engine.toast('Which one? Say the number.', 3000);
        this.emit('candidates', list);
        this._scheduleSilenceRetry(utt);
        break;
      }

      case 'wait':
        this._scheduleSilenceRetry(utt, policy.retryInMs);
        break;

      default:
        break;
    }
  }

  _scheduleSilenceRetry(utt: VoiceUtterance, retryInMs: number | null = null): void {
    clearTimeout(this.silenceTimer);
    const waitFor = retryInMs ?? Math.max(50, this.silenceCompleteMs - (Date.now() - utt.updatedAt));
    this.silenceTimer = setTimeout(() => {
      if (this.utterance === utt && !utt.actedOn) {
        this.decideNow('silence');
      }
    }, waitFor);
  }

  async _runAction(action: ActionPayload, meta: Record<string, any> = {}): Promise<void> {
    this.busy = true;
    const t0 = Date.now();
    const utt = meta.utterance || this.utterance;

    try {
      if (action.targetId) {
        await this.engine.highlight(action.targetId, 400).catch(() => {});
      }
      await this.engine.toast(describeAction(action), 1500).catch(() => {});

      const res = await this._execute(action, this.engine);
      const took = Date.now() - t0;
      const sinceLastWord = utt ? Date.now() - utt.updatedAt : null;

      this.stats.actions += 1;
      if (sinceLastWord !== null) this.stats.commandToActionMs.push(sinceLastWord);
      if (meta.decision?.decisionLagMs !== undefined) this.stats.decisionMs.push(meta.decision.decisionLagMs);

      const entry = {
        action,
        ok: res?.success !== false,
        detail: res?.message || res?.error || '',
        executeMs: took,
        sinceLastWordMs: sinceLastWord,
        via: meta.via || 'voice-decision'
      };

      this._log(
        entry.ok ? 'act' : 'warn',
        `${entry.ok ? '✓' : '✗'} ${describeAction(action)} in ${took}ms`
      );
      this.emit('action', entry);
    } catch (err: any) {
      this._log('error', `Action failed: ${describeAction(action)} — ${err?.message || err}`);
      this.emit('action', { action, ok: false, detail: String(err?.message || err) });
    } finally {
      this.busy = false;
      await this.refreshSnapshot().catch(() => {});
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.silenceTimer);
    for (const r of this.inflight) r.ac.abort();
    this.inflight = [];
  }
}
