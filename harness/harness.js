/**
 * Kevin WebGPU Decision Pipeline Harness (Browser Tab Runner)
 * 
 * Provides an interactive visual testbed in a dedicated browser tab for:
 * 1. [<decomposer>]    ──▶ decomposeCommand(goal) ➔ subGoals
 * 2. [<perception>]    ──▶ snapshot + resolveEntityReference()
 * 3. [<decision model>]──▶ WebGPU System 1 browserDecision({ state, questions, model })
 * 4. [<security gate>] ──▶ validateAction() + classifyActionRisk()
 * 5. [<browser action>]──▶ BrowserEngine.perform(payload)
 * 6. <harness>         ──▶ Assertion gate: subGoals, actions, telemetry, risk levels
 */

import { PipelineHarness } from '../src/testing/agent-harness.js';
import { NanoClient } from '../src/ai/nano-client.js';
import { checkWebGPU, loadModel, DEFAULT_DECISION_MODEL, SUPPORTED_DECISION_MODELS } from '../src/ai/model-loader.js';

// Preset Scenarios
const PRESETS = {
  'preset-search': {
    goal: 'search for WebGPU and click search',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://en.wikipedia.org',
      title: 'Wikipedia, the free encyclopedia',
      elements: [
        { id: 'cd-1', tag: 'input', role: 'searchbox', text: 'Search Wikipedia', placeholder: 'Search Wikipedia', type: 'search' },
        { id: 'cd-2', tag: 'button', role: 'button', text: 'Search', type: 'submit' },
        { id: 'cd-3', tag: 'a', role: 'link', text: 'Main page', href: '/wiki/Main_Page' },
        { id: 'cd-4', tag: 'a', role: 'link', text: 'Current events', href: '/wiki/Portal:Current_events' }
      ]
    },
    expectations: {
      subgoals: '2',
      action: 'type',
      target: 'cd-1',
      maxRisk: 'low'
    }
  },
  'preset-ecommerce': {
    goal: 'Click Add to Cart and proceed to checkout',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://store.example.com/item/42',
      title: 'Wireless Mechanical Keyboard - TechStore',
      elements: [
        { id: 'cd-1', tag: 'button', role: 'button', text: 'Add to Cart', type: 'button' },
        { id: 'cd-2', tag: 'a', role: 'link', text: 'Proceed to Checkout', href: '/checkout' },
        { id: 'cd-3', tag: 'button', role: 'button', text: 'Save for later', type: 'button' },
        { id: 'cd-4', tag: 'input', role: 'spinbutton', text: 'Quantity', value: '1', type: 'number' }
      ]
    },
    expectations: {
      subgoals: '2',
      action: 'click',
      target: 'cd-1',
      maxRisk: 'low'
    }
  },
  'preset-multistep': {
    goal: 'Type John Doe into name field and submit form',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://portal.example.com/register',
      title: 'User Registration',
      elements: [
        { id: 'cd-1', tag: 'input', role: 'textbox', text: 'Full Name', name: 'fullname', placeholder: 'Enter your name', type: 'text' },
        { id: 'cd-2', tag: 'input', role: 'textbox', text: 'Email Address', name: 'email', placeholder: 'you@example.com', type: 'email' },
        { id: 'cd-3', tag: 'button', role: 'button', text: 'Submit Registration', type: 'submit' }
      ]
    },
    expectations: {
      subgoals: '2',
      action: 'type',
      target: 'cd-1',
      maxRisk: 'low'
    }
  },
  'preset-risk': {
    goal: 'Delete my user account immediately',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://app.example.com/settings/danger-zone',
      title: 'Account Settings - Danger Zone',
      elements: [
        { id: 'cd-1', tag: 'button', role: 'button', text: 'Delete Account Permanently', type: 'button' },
        { id: 'cd-2', tag: 'button', role: 'button', text: 'Cancel and return to dashboard', type: 'button' },
        { id: 'cd-3', tag: 'a', role: 'link', text: 'Export data backup', href: '/export' }
      ]
    },
    expectations: {
      subgoals: '1',
      action: 'click',
      target: 'cd-1',
      maxRisk: 'high'
    }
  },
  'preset-pronoun': {
    goal: 'Click the second result link',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://search.local/q?test',
      title: 'Search Results',
      elements: [
        { id: 'cd-1', tag: 'a', role: 'link', text: '1. WebGPU Specification Draft - W3C', href: 'https://w3.org/TR/webgpu' },
        { id: 'cd-2', tag: 'a', role: 'link', text: '2. WebGPU Explainer & Tutorials - MDN', href: 'https://developer.mozilla.org' },
        { id: 'cd-3', tag: 'a', role: 'link', text: '3. GPU Architecture in Chrome - Chromium', href: 'https://chromium.org' }
      ]
    },
    expectations: {
      subgoals: '1',
      action: 'click',
      target: 'cd-2',
      maxRisk: 'low'
    }
  },
  'preset-custom': {
    goal: 'Click search and type query',
    model: 'receptron/laya-onnx',
    mode: 'decision',
    snapshot: {
      url: 'https://custom.app',
      title: 'Custom Testbed Page',
      elements: [
        { id: 'cd-1', tag: 'input', role: 'searchbox', text: 'Search query', placeholder: 'Type here...', type: 'text' },
        { id: 'cd-2', tag: 'button', role: 'button', text: 'Search', type: 'submit' }
      ]
    },
    expectations: {
      subgoals: '',
      action: '',
      target: '',
      maxRisk: ''
    }
  }
};

let activeNanoClient = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  await setupWebGPUProbe();
  setupPresetSelector();
  setupEventListeners();
  loadPreset('preset-search');

  const autoload = document.getElementById('autoload-model-checkbox')?.checked;
  if (autoload) {
    const initialModel = document.getElementById('model-select').value;
    preloadModel(initialModel);
  }
});

async function setupWebGPUProbe() {
  const badge = document.getElementById('webgpu-badge');
  try {
    const gpu = await checkWebGPU();
    if (gpu.available) {
      const adapterInfo = gpu.adapter?.info;
      const desc = adapterInfo?.architecture || adapterInfo?.description || 'Supported';
      badge.textContent = `WebGPU: Active (${desc})`;
      badge.className = 'badge ready';
    } else {
      badge.textContent = `WebGPU: Unavailable (${gpu.reason})`;
      badge.className = 'badge checking';
    }
  } catch (err) {
    badge.textContent = 'WebGPU: Probe error';
    badge.className = 'badge fail';
  }
}

async function preloadModel(modelId = null) {
  const targetModel = modelId || document.getElementById('model-select').value;
  const modelStatusBadge = document.getElementById('model-status-badge');
  const progressContainer = document.getElementById('model-progress-bar-container');
  const progressFill = document.getElementById('model-progress-fill');
  const progressLabel = document.getElementById('model-progress-label');
  const progressPercent = document.getElementById('model-progress-percent');
  const preloadBtn = document.getElementById('preload-model-btn');

  if (preloadBtn) preloadBtn.disabled = true;
  modelStatusBadge.textContent = 'Model: Loading...';
  modelStatusBadge.className = 'badge checking';
  progressContainer.className = 'model-progress-container';
  progressLabel.textContent = `Loading ${targetModel}...`;
  progressFill.style.width = '10%';
  progressPercent.textContent = '10%';

  try {
    const gpu = await checkWebGPU();
    if (!gpu.available) {
      throw new Error(`WebGPU required for decision model: ${gpu.reason || 'WebGPU unavailable'}`);
    }

    await loadModel({
      modelId: targetModel,
      device: 'webgpu',
      onProgress: (prog) => {
        if (prog.status === 'downloading' && prog.progress !== undefined) {
          const pct = Math.round(prog.progress);
          progressFill.style.width = `${pct}%`;
          progressPercent.textContent = `${pct}%`;
          progressLabel.textContent = `Downloading ${prog.file || targetModel}...`;
        } else if (prog.status === 'ready') {
          progressFill.style.width = '100%';
          progressPercent.textContent = '100%';
          progressLabel.textContent = `Model ${targetModel} loaded on WEBGPU!`;
        }
      }
    });

    modelStatusBadge.textContent = `Model: Ready (${targetModel.split('/')[1] || targetModel} WebGPU)`;
    modelStatusBadge.className = 'badge ready';
    setTimeout(() => {
      progressContainer.className = 'model-progress-container hidden';
    }, 1500);
  } catch (err) {
    console.error('WebGPU Model Loading Error:', err);
    modelStatusBadge.textContent = `Model Error: WebGPU Required`;
    modelStatusBadge.className = 'badge fail';
    progressLabel.textContent = `Error: ${err.message}`;
    progressFill.style.width = '100%';
    progressFill.style.backgroundColor = 'var(--accent-red)';
    progressPercent.textContent = 'ERR';
  } finally {
    if (preloadBtn) preloadBtn.disabled = false;
  }
}

function setupPresetSelector() {
  const select = document.getElementById('scenario-presets');
  select.addEventListener('change', (e) => {
    loadPreset(e.target.value);
  });
}

function loadPreset(presetKey) {
  const data = PRESETS[presetKey] || PRESETS['preset-search'];
  document.getElementById('goal-input').value = data.goal;
  document.getElementById('model-select').value = data.model;
  document.getElementById('mode-select').value = data.mode;
  document.getElementById('snapshot-editor').value = JSON.stringify(data.snapshot, null, 2);

  document.getElementById('expect-subgoals').value = data.expectations?.subgoals || '';
  document.getElementById('expect-action').value = data.expectations?.action || '';
  document.getElementById('expect-target').value = data.expectations?.target || '';
  document.getElementById('expect-risk').value = data.expectations?.maxRisk || '';

  renderDomPreview(data.snapshot);
}

function setupEventListeners() {
  document.getElementById('preload-model-btn')?.addEventListener('click', () => {
    const model = document.getElementById('model-select').value;
    preloadModel(model);
  });

  document.getElementById('model-select').addEventListener('change', (e) => {
    const autoload = document.getElementById('autoload-model-checkbox')?.checked;
    if (autoload) {
      preloadModel(e.target.value);
    } else {
      const modelStatusBadge = document.getElementById('model-status-badge');
      modelStatusBadge.textContent = 'Model: Unloaded';
      modelStatusBadge.className = 'badge idle';
    }
  });

  document.getElementById('format-json-btn').addEventListener('click', () => {
    const editor = document.getElementById('snapshot-editor');
    try {
      const parsed = JSON.parse(editor.value);
      editor.value = JSON.stringify(parsed, null, 2);
      renderDomPreview(parsed);
    } catch (e) {
      alert(`Invalid JSON: ${e.message}`);
    }
  });

  document.getElementById('snapshot-editor').addEventListener('input', () => {
    try {
      const parsed = JSON.parse(document.getElementById('snapshot-editor').value);
      renderDomPreview(parsed);
    } catch (e) { }
  });

  document.getElementById('reset-harness-btn').addEventListener('click', () => {
    loadPreset(document.getElementById('scenario-presets').value);
    resetPipelineDiagram();
    document.getElementById('assertion-result-box').className = 'assertion-result-box hidden';
    document.getElementById('trace-cards-container').innerHTML = `
      <div class="empty-trace-notice">Click "Run WebGPU Pipeline Harness" to execute the pipeline with the selected decision model.</div>
    `;
    document.getElementById('harness-result-badge').textContent = 'Ready';
    document.getElementById('harness-result-badge').className = 'badge idle';
  });

  document.getElementById('run-harness-btn').addEventListener('click', runHarness);
}

function renderDomPreview(snapshot, targetId = null) {
  const canvas = document.getElementById('dom-preview-canvas');
  const previewUrl = document.getElementById('preview-url');
  previewUrl.textContent = snapshot?.url || '-';

  if (!snapshot || !Array.isArray(snapshot.elements) || snapshot.elements.length === 0) {
    canvas.innerHTML = '<div class="preview-placeholder">No elements in snapshot.</div>';
    return;
  }

  canvas.innerHTML = '';
  snapshot.elements.forEach(el => {
    const node = document.createElement('div');
    const isTargeted = el.id === targetId;
    node.className = `mock-dom-node ${isTargeted ? 'targeted' : ''}`;
    node.id = `preview-${el.id}`;

    let icon = '🏷️';
    if (el.tag === 'button' || el.role === 'button') icon = '🔘';
    else if (el.tag === 'input') icon = '✏️';
    else if (el.tag === 'a') icon = '🔗';

    node.innerHTML = `
      <span>${icon}</span>
      <span class="node-id-tag">${escapeHtml(el.id)}</span>
      <span>${escapeHtml(el.text || el.placeholder || el.name || el.tag)}</span>
    `;
    canvas.appendChild(node);
  });
}

function resetPipelineDiagram() {
  ['node-decomposer', 'node-perception', 'node-decision', 'node-security', 'node-action'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'flow-node';
  });
}

function setNodeState(nodeId, state) {
  const el = document.getElementById(nodeId);
  if (el) {
    el.className = `flow-node ${state}`;
  }
}

async function runHarness() {
  const runBtn = document.getElementById('run-harness-btn');
  const resultBadge = document.getElementById('harness-result-badge');
  const modelStatusBadge = document.getElementById('model-status-badge');
  const progressContainer = document.getElementById('model-progress-bar-container');
  const progressFill = document.getElementById('model-progress-fill');
  const progressLabel = document.getElementById('model-progress-label');
  const progressPercent = document.getElementById('model-progress-percent');
  const latencyPill = document.getElementById('telemetry-latency');

  const goal = document.getElementById('goal-input').value.trim();
  const modelId = document.getElementById('model-select').value;
  const mode = document.getElementById('mode-select').value;
  let snapshot;

  try {
    snapshot = JSON.parse(document.getElementById('snapshot-editor').value);
  } catch (e) {
    alert(`Snapshot JSON is invalid: ${e.message}`);
    return;
  }

  if (!goal) {
    alert('Please enter a goal or command.');
    return;
  }

  runBtn.disabled = true;
  resultBadge.textContent = 'Executing...';
  resultBadge.className = 'badge active';
  resetPipelineDiagram();

  const startTime = performance.now();

  // Configure WebGPU / NanoClient instance with progress updates
  activeNanoClient = new NanoClient({
    modelId,
    mode,
    onProgress: (prog) => {
      if (prog.status === 'downloading' || prog.status === 'loading') {
        progressContainer.classList.remove('hidden');
        const pct = Math.round(prog.progress || 0);
        progressFill.style.width = `${pct}%`;
        progressLabel.textContent = `Loading ${modelId.split('/')[1] || modelId} on WebGPU...`;
        progressPercent.textContent = `${pct}%`;
        modelStatusBadge.textContent = `Loading ${pct}%`;
        modelStatusBadge.className = 'badge checking';
      } else if (prog.status === 'ready') {
        progressFill.style.width = '100%';
        progressPercent.textContent = '100%';
        modelStatusBadge.textContent = `Model Ready (${modelId.split('/')[1] || modelId})`;
        modelStatusBadge.className = 'badge ready';
        setTimeout(() => progressContainer.classList.add('hidden'), 1000);
      }
    }
  });

  // Simulated browser engine for tab testbed
  let targetedElementId = null;
  const simulatedBrowserEngine = {
    perform: async (payload) => {
      targetedElementId = payload.targetId || null;
      if (targetedElementId) {
        renderDomPreview(snapshot, targetedElementId);
      }
      return {
        success: true,
        message: `Simulated browser action: [${payload.action.toUpperCase()}] target=${payload.targetId || 'none'} text=${payload.text || 'none'}`
      };
    }
  };

  const harness = new PipelineHarness({
    initialSnapshot: snapshot,
    nanoClient: activeNanoClient,
    browserEngine: simulatedBrowserEngine,
    hooks: {
      onDecompose: async () => setNodeState('node-decomposer', 'active'),
      onPerception: async () => setNodeState('node-perception', 'active'),
      onDecision: async () => setNodeState('node-decision', 'active'),
      onSecurity: async () => setNodeState('node-security', 'active'),
      onBrowserAction: async () => setNodeState('node-action', 'active')
    }
  });

  try {
    const trace = await harness.run(goal);
    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    latencyPill.textContent = `Latency: ${durationMs}ms`;

    // Mark nodes passed
    setNodeState('node-decomposer', 'passed');
    setNodeState('node-perception', 'passed');
    setNodeState('node-decision', 'passed');
    setNodeState('node-security', 'passed');
    setNodeState('node-action', 'passed');

    // Render Step Trace Cards
    renderTraceCards(trace);

    // Run Assertion Gate verification
    const assertionResult = evaluateAssertionGate(trace);
    renderAssertionBox(assertionResult);

    if (assertionResult.passed && trace.success) {
      resultBadge.textContent = 'PASS';
      resultBadge.className = 'badge pass';
    } else {
      resultBadge.textContent = 'ASSERTION FAILED';
      resultBadge.className = 'badge fail';
    }
  } catch (err) {
    resultBadge.textContent = 'ERROR';
    resultBadge.className = 'badge error';
    renderErrorCard(err);
  } finally {
    runBtn.disabled = false;
  }
}

function evaluateAssertionGate(trace) {
  const errors = [];

  const expectSubgoals = document.getElementById('expect-subgoals').value.trim();
  const expectAction = document.getElementById('expect-action').value.trim();
  const expectTarget = document.getElementById('expect-target').value.trim();
  const expectRisk = document.getElementById('expect-risk').value.trim();

  // 1. Sub-goals count or list check
  if (expectSubgoals) {
    if (!isNaN(Number(expectSubgoals))) {
      const expectedCount = Number(expectSubgoals);
      if (trace.decomposed.length !== expectedCount) {
        errors.push(`Sub-goals count mismatch: expected ${expectedCount}, got ${trace.decomposed.length} (${JSON.stringify(trace.decomposed)})`);
      }
    } else {
      const expectedList = expectSubgoals.split(',').map(s => s.trim().toLowerCase());
      if (trace.decomposed.length !== expectedList.length) {
        errors.push(`Sub-goals list mismatch: expected [${expectedList.join(', ')}], got [${trace.decomposed.join(', ')}]`);
      }
    }
  }

  // 2. Action Type check
  if (expectAction) {
    const firstAction = trace.payloads[0]?.action;
    if (firstAction !== expectAction) {
      errors.push(`First action type mismatch: expected "${expectAction}", got "${firstAction || 'none'}"`);
    }
  }

  // 3. Target Element check
  if (expectTarget) {
    const firstTarget = trace.payloads[0]?.targetId;
    if (firstTarget !== expectTarget) {
      errors.push(`First action target mismatch: expected "${expectTarget}", got "${firstTarget || 'none'}"`);
    }
  }

  // 4. Max Risk check
  if (expectRisk) {
    const riskRank = { low: 1, medium: 2, high: 3 };
    const maxRank = riskRank[expectRisk] || 3;
    trace.steps.forEach((step, idx) => {
      const stepRisk = step.risk?.risk || 'low';
      if ((riskRank[stepRisk] || 1) > maxRank) {
        errors.push(`Step [${idx + 1}] risk exceeded allowed "${expectRisk}": got "${stepRisk}"`);
      }
    });
  }

  return {
    passed: errors.length === 0,
    errors
  };
}

function renderAssertionBox(assertionResult) {
  const box = document.getElementById('assertion-result-box');
  const icon = document.getElementById('assertion-status-icon');
  const text = document.getElementById('assertion-status-text');
  const list = document.getElementById('assertion-errors-list');

  box.classList.remove('hidden');
  list.innerHTML = '';

  if (assertionResult.passed) {
    box.className = 'assertion-result-box pass';
    icon.textContent = '✓';
    text.textContent = 'All Assertion Gates Passed Successfully';
  } else {
    box.className = 'assertion-result-box fail';
    icon.textContent = '✗';
    text.textContent = `Assertion Failed with ${assertionResult.errors.length} Error(s)`;
    assertionResult.errors.forEach(err => {
      const li = document.createElement('li');
      li.textContent = err;
      list.appendChild(li);
    });
  }
}

function renderTraceCards(trace) {
  const container = document.getElementById('trace-cards-container');
  container.innerHTML = '';

  if (!trace.steps || trace.steps.length === 0) {
    container.innerHTML = '<div class="empty-trace-notice">No execution steps recorded.</div>';
    return;
  }

  trace.steps.forEach(step => {
    const card = document.createElement('div');
    card.className = 'step-card';

    const action = step.action || {};
    const answers = step.decisionAnswers || {};
    const risk = step.risk || { risk: 'low' };
    const telemetry = step.decisionTelemetry || {};

    // Build probability breakdown HTML
    let probBreakdownHtml = '';
    if (answers.actionType?.probabilities) {
      const probs = answers.actionType.probabilities;
      probBreakdownHtml = Object.entries(probs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name, val]) => {
          const pct = Math.round(val * 100);
          const isSelected = name === answers.actionType.value;
          return `
            <div class="prob-item">
              <span class="prob-name">${name}</span>
              <div class="prob-bar-track">
                <div class="prob-bar-fill ${isSelected ? 'selected' : ''}" style="width: ${pct}%"></div>
              </div>
              <span class="prob-pct">${pct}%</span>
            </div>
          `;
        }).join('');
    }

    card.innerHTML = `
      <div class="step-card-header">
        <span class="step-number">Step ${step.stepIndex}</span>
        <span class="step-goal-title">"${escapeHtml(step.subGoal)}"</span>
        <span class="action-badge-pill">${escapeHtml(action.action || 'NONE')}</span>
      </div>

      <div class="step-grid">
        <!-- Decision Model WebGPU System 1 Output -->
        <div class="step-box">
          <div class="step-box-title">🧠 WebGPU Decision Model Output</div>
          <div style="margin-bottom: 8px;">
            <strong>Action:</strong> <span class="action-badge-pill">${action.action || 'none'}</span>
            ${action.targetId ? `<strong>Target:</strong> <code>${action.targetId}</code>` : ''}
            ${action.text ? `<strong>Text:</strong> "${escapeHtml(action.text)}"` : ''}
            ${action.url ? `<strong>URL:</strong> <code>${escapeHtml(action.url)}</code>` : ''}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">
            Confidence: <strong>${Math.round((answers.actionType?.confidence || 1) * 100)}%</strong> | 
            Search Intent (noul): <strong>${answers.searchIntent?.noul !== undefined ? Math.round(answers.searchIntent.noul * 100) + '%' : (answers.searchIntent?.probability !== undefined ? Math.round(answers.searchIntent.probability * 100) + '%' : 'N/A')}</strong>
          </div>
          <div>${probBreakdownHtml}</div>
        </div>

        <!-- Security Risk & Execution Result -->
        <div class="step-box">
          <div class="step-box-title">🛡️ Security Gate & Browser Action</div>
          <div style="margin-bottom: 6px;">
            Risk Level: <span class="risk-pill ${risk.risk || 'low'}">${(risk.risk || 'low').toUpperCase()}</span>
            ${risk.requiresConfirmation ? '<span class="badge fail" style="margin-left:4px;">Confirmation Required</span>' : ''}
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 8px;">
            ${risk.reasons?.length ? risk.reasons.join(', ') : 'Standard safe browser operation'}
          </div>
          <div style="font-size: 11.5px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
            <strong>Browser Engine:</strong>
            <span style="color: ${step.result?.success ? '#34d399' : '#f87171'}">${escapeHtml(step.result?.message || 'Done')}</span>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderErrorCard(err) {
  const container = document.getElementById('trace-cards-container');
  container.innerHTML = `
    <div class="step-card" style="border-color: var(--accent-red); background-color: rgba(239, 68, 68, 0.1);">
      <div class="step-card-header">
        <span class="step-number" style="background: var(--accent-red);">Error</span>
        <span class="step-goal-title">${escapeHtml(err.message || String(err))}</span>
      </div>
      <div style="font-size: 12px; color: #fca5a5; padding-top: 8px;">
        <pre style="white-space: pre-wrap; font-family: var(--font-mono);">${escapeHtml(err.stack || '')}</pre>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
