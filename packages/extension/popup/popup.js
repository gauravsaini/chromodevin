import { AgentRuntime, AgentState } from '../src/agent/agent-runtime.js';
import { NanoClient } from '../src/ai/nano-client.js';
import { CommandStream } from '../src/agent/command-stream.js';
import { VoiceStateMachine, InteractionState } from '../src/agent/voice-state-machine.js';
import { DEFAULT_DECISION_MODEL } from '../src/ai/model-loader.js';

const nanoClient = new NanoClient({
  modelId: DEFAULT_DECISION_MODEL, // 'receptron/laya-onnx'
  mode: 'decision', // RLCD / Kev System 1 discriminative decision mode
  onProgress: (progress) => {
    const section = document.getElementById('model-download-section');
    const bar = document.getElementById('model-download-bar');
    const text = document.getElementById('model-download-text');
    if (!section) return;
    if (progress.status === 'downloading' || progress.status === 'loading') {
      section.classList.remove('hidden');
      if (bar) bar.style.width = `${progress.progress || 0}%`;
      const modelName = progress.modelId ? progress.modelId.split('/')[1] || progress.modelId : 'Laya';
      if (text) text.textContent = progress.progress
        ? `Loading ${modelName} decision model... ${Math.round(progress.progress)}%`
        : `Initializing ${modelName} on WebGPU...`;
    } else if (progress.status === 'ready') {

      if (bar) bar.style.width = '100%';
      if (text) text.textContent = 'Decision model ready';
      setTimeout(() => section.classList.add('hidden'), 1500);
    }
  }
});
const agentRuntime = new AgentRuntime({ nanoClient, maxSteps: 25 });

let commandStream = new CommandStream();
let isStreamConsumerActive = false;

let currentSnapshot = null;
let currentTabId = null;
let recognition = null;
let isRecognitionActive = false;
let ttsEnabled = true;
let confirmationResolver = null;

// UI Elements
const statusBadge = document.getElementById('ai-status-badge');
const tabStatusDot = document.getElementById('tab-status-dot');
const pageTitleEl = document.getElementById('page-title');
const pageUrlEl = document.getElementById('page-url');
const elementCountEl = document.getElementById('element-count');
const openTabsSelect = document.getElementById('open-tabs-select');
const refreshTabBtn = document.getElementById('refresh-tab-btn');
const commandInput = document.getElementById('command-input');
const runBtn = document.getElementById('run-btn');
const stopBtn = document.getElementById('stop-btn');
const voiceBtn = document.getElementById('voice-btn');
const micText = document.getElementById('mic-text');
const listeningIndicator = document.getElementById('listening-indicator');
const ttsToggleBtn = document.getElementById('tts-toggle-btn');
const logsContainer = document.getElementById('logs');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Trace Collapsible Drawer Elements
const traceSection = document.querySelector('.trace-section');
const toggleTraceBtn = document.getElementById('toggle-trace-btn');
const liveStatus = document.getElementById('live-status');

// Progress Bar Elements
const progressContainer = document.getElementById('progress-container');
const progressStageText = document.getElementById('progress-stage-text');
const progressPercentage = document.getElementById('progress-percentage');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressSubgoal = document.getElementById('progress-subgoal');

// Modal Elements
const confirmationModal = document.getElementById('confirmation-modal');
const confirmationReason = document.getElementById('confirmation-reason');
const confirmAllowBtn = document.getElementById('confirm-allow-btn');
const confirmDenyBtn = document.getElementById('confirm-deny-btn');

// Quick Action Chips
const quickChips = document.querySelectorAll('.chip-btn');

function updateLiveStatus(text) {
  if (liveStatus) {
    liveStatus.textContent = text;
    liveStatus.title = text;
  }
}

function addLog(msg, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsContainer.appendChild(entry);
  logsContainer.scrollTop = logsContainer.scrollHeight;
  updateLiveStatus(msg);
}

function speak(text) {
  if (!ttsEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('TTS error:', e);
  }
}

// Check WebGPU AI capability and initialize decision model
async function initAI() {
  const check = await nanoClient.checkAvailability();
  const shortName = nanoClient.modelId.includes('laya')
    ? 'Laya'
    : (nanoClient.modelId.includes('LFM2.5') ? 'LFM2.5-350M' : 'Kev');
  if (check.available) {

    statusBadge.textContent = `🧠 ${shortName} Decision Model (WebGPU)`;
    statusBadge.className = 'badge ready';
    statusBadge.title = `WebGPU Active — ${nanoClient.modelId} (${shortName} calibrated decision model)`;
    addLog(`WebGPU active with decision model: ${nanoClient.modelId}`, 'system');
  } else {
    statusBadge.textContent = `⚡ ${shortName} Decision Engine (Local)`;
    statusBadge.className = 'badge fallback';
    statusBadge.title = `${nanoClient.modelId} local decision engine active`;
    addLog(`Ready. Discriminative decision model active: ${nanoClient.modelId}`, 'system');
  }
}


// Format URL nicely for display (host + shortened path)
function formatUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 24) : '');
  } catch (e) {
    return rawUrl.slice(0, 30);
  }
}

// Fetch and populate remembered open tabs in dropdown
async function loadOpenTabs() {
  if (!openTabsSelect) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_OPEN_TABS' });
    if (res && res.success && Array.isArray(res.openTabs)) {
      openTabsSelect.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.disabled = true;
      defaultOpt.textContent = `Tabs (${res.openTabs.length})`;
      openTabsSelect.appendChild(defaultOpt);

      for (const tab of res.openTabs) {
        const opt = document.createElement('option');
        opt.value = String(tab.id);
        const title = tab.title || tab.url || `Tab #${tab.id}`;
        opt.textContent = title.length > 22 ? title.slice(0, 20) + '…' : title;
        if (tab.id === currentTabId || (tab.active && !currentTabId)) {
          opt.selected = true;
        }
        openTabsSelect.appendChild(opt);

        // Sync into AgentRuntime context memory
        if (agentRuntime?.contextMemory) {
          agentRuntime.contextMemory.rememberTab(tab);
        }
      }

      if (!currentTabId && res.activeTabId) {
        currentTabId = res.activeTabId;
      }
    }
  } catch (e) {
    console.warn('Failed to load open tabs:', e);
  }
}

// Request DOM snapshot from target or active web tab
async function refreshSnapshot(explicitTabId = null) {
  try {
    const targetId = explicitTabId || currentTabId;
    const res = await chrome.runtime.sendMessage({
      type: 'GET_PAGE_SNAPSHOT',
      tabId: targetId
    });

    await loadOpenTabs();

    if (res && res.success && res.snapshot && !res.snapshot.isRestricted) {
      currentSnapshot = res.snapshot;
      currentTabId = currentSnapshot.tabId;
      const count = currentSnapshot.elements?.length || 0;

      pageTitleEl.textContent = currentSnapshot.title || currentSnapshot.url || 'Active Tab';
      pageTitleEl.title = currentSnapshot.title || currentSnapshot.url || '';
      pageUrlEl.textContent = formatUrl(currentSnapshot.url);
      pageUrlEl.title = currentSnapshot.url || '';
      elementCountEl.textContent = `${count} element${count === 1 ? '' : 's'}`;
      if (tabStatusDot) tabStatusDot.classList.remove('disconnected');

      // Update open tabs dropdown selection
      if (openTabsSelect && currentTabId) {
        openTabsSelect.value = String(currentTabId);
      }

      if (agentRuntime?.contextMemory) {
        agentRuntime.contextMemory.rememberTab({
          id: currentTabId,
          url: currentSnapshot.url,
          title: currentSnapshot.title,
          active: true
        });
        agentRuntime.contextMemory.updateCandidates(currentSnapshot.elements || []);
      }

      addLog(`Connected to tab #${currentTabId}: "${currentSnapshot.title || currentSnapshot.url}" (${count} elements)`, 'system');
      return currentSnapshot;
    } else {
      currentSnapshot = null;
      pageTitleEl.textContent = 'No Web Page Active';
      pageUrlEl.textContent = 'Open any web page in Chrome';
      elementCountEl.textContent = '0 elements';
      if (tabStatusDot) tabStatusDot.classList.add('disconnected');
      return null;
    }
  } catch (err) {
    currentSnapshot = null;
    pageTitleEl.textContent = 'Tab Disconnected';
    pageUrlEl.textContent = 'Click 🔄 to retry';
    elementCountEl.textContent = '-';
    if (tabStatusDot) tabStatusDot.classList.add('disconnected');
    return null;
  }
}

// Switch active tab context
async function switchTab(tabId) {
  if (!tabId) return;
  addLog(`Switching active tab context to #${tabId}...`, 'system');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'SWITCH_TAB',
      tabId: Number(tabId)
    });
    if (res && res.success) {
      currentTabId = Number(tabId);
      if (agentRuntime?.contextMemory) {
        agentRuntime.contextMemory.switchActiveTab(currentTabId);
      }
      await refreshSnapshot(currentTabId);
    }
  } catch (err) {
    addLog(`Failed to switch tab: ${err.message}`, 'error');
  }
}

// Send execution request to current active tab
async function executePageAction(action) {
  const targetDesc = action.url || action.targetId || action.text || '';
  addLog(`Action: ${action.action} ${targetDesc}`, 'action');
  const res = await chrome.runtime.sendMessage({
    type: 'EXECUTE_PAGE_ACTION',
    tabId: currentTabId,
    action
  });

  if (res.success && res.result) {
    return res.result;
  }
  return { success: false, error: res.error || 'Action failed' };
}

// Speech Recognition & State Machine Setup
const voiceStateMachine = new VoiceStateMachine({
  onEnterListening: () => {
    voiceBtn.classList.add('listening');
    voiceBtn.classList.remove('actioning');
    micText.textContent = 'Listening';
    listeningIndicator.classList.remove('hidden');
    runBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    updateLiveStatus('Listening...');
    addLog('State: LISTENING — Microphone active. Speak command.', 'system');
    safeStartRecognition();
  },
  onEnterActioning: (cmd) => {
    safeStopRecognition(); // Microphone is strictly OFF during actioning!
    voiceBtn.classList.remove('listening');
    voiceBtn.classList.add('actioning');
    micText.textContent = 'Actioning';
    listeningIndicator.classList.add('hidden');
    runBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    if (traceSection) traceSection.classList.remove('collapsed');
    progressContainer.classList.remove('hidden');
    progressBarFill.style.width = '10%';
    progressPercentage.textContent = '10%';
    progressSubgoal.textContent = `Actioning: ${cmd || 'command'}`;
    updateLiveStatus(`Actioning: ${cmd || 'command'}`);
    addLog(`State: ACTIONING — Processing: "${cmd}". Mic muted.`, 'system');
  },
  onEnterIdle: () => {
    safeStopRecognition();
    voiceBtn.classList.remove('listening', 'actioning');
    micText.textContent = 'Voice';
    listeningIndicator.classList.add('hidden');
    runBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    updateLiveStatus('Ready');
    addLog('State: IDLE', 'system');
  }
});

function safeStartRecognition() {
  if (!recognition || isRecognitionActive) return;
  try {
    isRecognitionActive = true;
    recognition.start();
  } catch (e) {
    isRecognitionActive = false;
  }
}

function safeStopRecognition() {
  if (!recognition || !isRecognitionActive) return;
  try {
    isRecognitionActive = false;
    recognition.stop();
  } catch (e) {}
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Web Speech API not supported in this browser';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false; // Mutually exclusive turns: 1 utterance per listening turn
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isRecognitionActive = true;
  };

  recognition.onresult = (event) => {
    if (!voiceStateMachine.isListening()) return;
    const transcript = event.results[0][0].transcript.trim();
    if (transcript) {
      commandInput.value = transcript;
      addLog(`Heard: "${transcript}"`, 'user');
      voiceStateMachine.commandReceived(transcript);
      commandStream.push(transcript);
    }
  };

  recognition.onerror = (event) => {
    if (event.error !== 'no-speech') {
      addLog(`Voice notice: ${event.error}`, 'system');
    }
  };

  recognition.onend = () => {
    isRecognitionActive = false;
    // If still in LISTENING state (e.g. silence timeout), restart listening
    if (voiceStateMachine.isListening() && voiceStateMachine.continuous) {
      setTimeout(() => {
        if (voiceStateMachine.isListening()) {
          safeStartRecognition();
        }
      }, 150);
    }
  };
}

function toggleVoice() {
  if (!recognition) return;
  if (voiceStateMachine.isIdle()) {
    ensureStreamConsumer();
    voiceStateMachine.startListening(true);
  } else {
    stopAllExecution();
  }
}

function stopAllExecution() {
  voiceStateMachine.stop();
  agentRuntime.abort();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  commandStream.close();
  commandStream = new CommandStream();
  isStreamConsumerActive = false;
  addLog('Agent execution halted by user.', 'system');
}

// Confirmation modal handler
function requestUserConfirmation({ action, candidate, reason }) {
  return new Promise((resolve) => {
    confirmationReason.textContent = `${reason}. Target: ${candidate?.text || action.targetId || action.url || action.action}.`;
    confirmationModal.classList.remove('hidden');
    confirmationResolver = resolve;
  });
}

function resolveConfirmation(approved) {
  confirmationModal.classList.add('hidden');
  if (confirmationResolver) {
    confirmationResolver(approved);
    confirmationResolver = null;
  }
}

confirmAllowBtn.addEventListener('click', () => resolveConfirmation(true));
confirmDenyBtn.addEventListener('click', () => resolveConfirmation(false));

// Continuous Command Stream Consumer
function ensureStreamConsumer() {
  if (isStreamConsumerActive) return;
  isStreamConsumerActive = true;

  agentRuntime.runStream(commandStream, {
    getSnapshot: refreshSnapshot,
    executeAction: executePageAction,
    onLog: addLog,
    onTaskStart: (command) => {
      speak(`Executing: ${command}`);
    },
    onTaskEnd: async (command, result) => {
      if (result.success) {
        progressBarFill.style.width = '100%';
        progressPercentage.textContent = '100%';
        progressSubgoal.textContent = 'Completed!';
        addLog(`Success: ${result.message || 'Task completed'}`, 'success');
        speak(result.message || 'Task completed');
      } else if (result.aborted) {
        addLog('Execution Aborted.', 'system');
        speak('Task stopped');
      } else {
        addLog(`Failed: ${result.error || 'Unknown error'}`, 'error');
        speak(`Task failed: ${result.error || 'Error'}`);
      }

      // Wait for TTS audio to complete before reopening microphone
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        await new Promise((r) => {
          const interval = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
              clearInterval(interval);
              r();
            }
          }, 80);
          setTimeout(() => { clearInterval(interval); r(); }, 2500);
        });
      }
      await new Promise((r) => setTimeout(r, 200));

      // Signal state machine that action finished
      // In continuous mode, this automatically transitions back to LISTENING!
      voiceStateMachine.actionCompleted(result);
      setTimeout(refreshSnapshot, 500);
    },
    onStateChange: (state) => {
      if (state === AgentState.COMPLETED || state === AgentState.FAILED || state === AgentState.ABORTED) {
        if (!voiceStateMachine.continuous) {
          runBtn.classList.remove('hidden');
          stopBtn.classList.add('hidden');
          setTimeout(() => progressContainer.classList.add('hidden'), 2500);
        }
      }
    },
    onConfirmationRequired: requestUserConfirmation,
    onStep: ({ step, action, subGoal, stage = 1, totalStages = 1 }) => {
      const pct = Math.min(100, Math.round((stage / totalStages) * 100));
      progressBarFill.style.width = `${pct}%`;
      progressPercentage.textContent = `${pct}%`;
      progressStageText.textContent = `Stage ${stage} of ${totalStages}`;
      progressSubgoal.textContent = `Action: ${action.action} (${action.url || action.targetId || action.text || ''})`;

      if (action.action === 'click') {
        speak(`Clicking target`);
      } else if (action.action === 'type') {
        speak(`Typing ${action.text}`);
      } else if (action.action === 'navigate') {
        speak(`Navigating to ${action.url}`);
      }
    }
  }).catch((err) => {
    isStreamConsumerActive = false;
    voiceStateMachine.stop();
    addLog(`Stream error: ${err.message}`, 'error');
  });
}

// Push user goal into continuous stream as an event in the chain
function dispatchCommand(goal) {
  if (!goal || !goal.trim()) return;
  ensureStreamConsumer();
  voiceStateMachine.commandReceived(goal);
  commandStream.push(goal);
}

// Event Listeners
runBtn.addEventListener('click', () => {
  const goal = commandInput.value.trim();
  if (goal) dispatchCommand(goal);
});

stopBtn.addEventListener('click', stopAllExecution);

commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const goal = commandInput.value.trim();
    if (goal) dispatchCommand(goal);
  }
});

voiceBtn.addEventListener('click', toggleVoice);

quickChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const cmd = chip.getAttribute('data-command');
    if (cmd) {
      commandInput.value = cmd;
      dispatchCommand(cmd);
    }
  });
});

ttsToggleBtn.addEventListener('click', () => {
  ttsEnabled = !ttsEnabled;
  ttsToggleBtn.textContent = ttsEnabled ? '🔊' : '🔇';
  ttsToggleBtn.classList.toggle('muted', !ttsEnabled);
  addLog(`Audio feedback ${ttsEnabled ? 'enabled' : 'muted'}.`, 'system');
});

const openHarnessBtn = document.getElementById('open-harness-btn');
if (openHarnessBtn) {
  openHarnessBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
      chrome.tabs.create({ url: chrome.runtime.getURL('harness/index.html') });
    } else {
      window.open('../harness/index.html', '_blank');
    }
  });
}

clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '<div class="log-entry system">Trace cleared.</div>';
  updateLiveStatus('Ready');
});

refreshTabBtn.addEventListener('click', () => {
  addLog('Rescanning active web tab...', 'system');
  refreshSnapshot();
});

if (openTabsSelect) {
  openTabsSelect.addEventListener('change', (e) => {
    const selectedTabId = e.target.value;
    if (selectedTabId) {
      switchTab(selectedTabId);
    }
  });
}

if (toggleTraceBtn && traceSection) {
  toggleTraceBtn.addEventListener('click', () => {
    traceSection.classList.toggle('collapsed');
  });
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await initAI();
  await refreshSnapshot();
  setupSpeechRecognition();
});
