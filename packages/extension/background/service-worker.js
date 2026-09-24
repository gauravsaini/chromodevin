// Background service worker for Kevin
// Coordinates tab inspection, persistent open tabs registry, active context management, and DOM automation

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Kevin] Background service worker initialized.');
  syncOpenTabs();
});

// Storage keys
const STORAGE_OPEN_TABS = 'kevin_open_tabs';
const STORAGE_ACTIVE_TAB = 'kevin_active_tab_id';
const STORAGE_TAB_HISTORY = 'kevin_tab_history';

let openTabsCache = new Map(); // tabId -> tabInfo
let lastActiveWebTabId = null;

function isExcludedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('devtools://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:')
  );
}

function isPrivateHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const cleanHost = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost === 'local' ||
    cleanHost.endsWith('.local') ||
    cleanHost === 'internal' ||
    cleanHost.endsWith('.internal')
  ) {
    return true;
  }
  if (
    cleanHost === '::1' ||
    cleanHost === '::' ||
    cleanHost === '0:0:0:0:0:0:0:1' ||
    cleanHost === '0:0:0:0:0:0:0:0' ||
    cleanHost.startsWith('fc') ||
    cleanHost.startsWith('fd') ||
    cleanHost.startsWith('fe80:')
  ) {
    return true;
  }
  if (/^127(?:\.\d{1,3}){1,3}$/.test(cleanHost)) return true;
  if (/^10(?:\.\d{1,3}){1,3}$/.test(cleanHost)) return true;
  if (/^192\.168(?:\.\d{1,3}){1,2}$/.test(cleanHost)) return true;
  const match172 = cleanHost.match(/^172\.(\d{1,3})(?:\.\d{1,3}){1,2}$/);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  if (/^169\.254(?:\.\d{1,3}){1,2}$/.test(cleanHost) || /^0(?:\.\d{1,3}){1,3}$/.test(cleanHost)) {
    return true;
  }
  return false;
}

function isAllowedNavigationUrl(url, options = {}) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { allowed: false, reason: 'URL cannot be empty' };
  }
  if (/[\s\x00-\x1F\x7F]/.test(url)) {
    return { allowed: false, reason: 'URL contains whitespace or control characters' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL format' };
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'file:') {
    if (!options.allowFile) return { allowed: false, reason: 'Navigation to file: URLs is blocked' };
    return { allowed: true };
  }
  if (protocol === 'blob:') {
    if (!options.allowBlob) return { allowed: false, reason: 'Navigation to blob: URLs is blocked' };
    return { allowed: true };
  }
  if (protocol === 'javascript:') {
    return { allowed: false, reason: 'Navigation to javascript: URLs is blocked' };
  }
  if (protocol === 'data:') {
    return { allowed: false, reason: 'Navigation to data: URLs is blocked' };
  }
  if (
    protocol === 'chrome:' ||
    protocol === 'chrome-extension:' ||
    protocol === 'devtools:' ||
    protocol === 'about:'
  ) {
    return { allowed: false, reason: `Navigation to ${protocol} URLs is blocked` };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { allowed: false, reason: `Disallowed URL protocol: "${protocol}"` };
  }
  if (!parsed.hostname) {
    return { allowed: false, reason: 'URL is missing a valid hostname' };
  }
  if (!options.allowPrivateNetwork && isPrivateHostname(parsed.hostname)) {
    return {
      allowed: false,
      reason: `Navigation to private network address (${parsed.hostname}) is blocked`
    };
  }
  return { allowed: true };
}

/**
 * Synchronizes all open tabs from browser into local cache and persistent storage.
 */
async function syncOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    openTabsCache.clear();
    for (const tab of tabs) {
      if (!isExcludedUrl(tab.url)) {
        openTabsCache.set(tab.id, {
          id: tab.id,
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || '',
          active: tab.active,
          windowId: tab.windowId,
          lastActiveAt: tab.active ? Date.now() : 0
        });
        if (tab.active) {
          lastActiveWebTabId = tab.id;
        }
      }
    }
    await persistTabsState();
  } catch (err) {
    console.warn('[Kevin] Failed to sync open tabs:', err);
  }
}

/**
 * Persists open tabs and active tab context into chrome.storage.local
 */
async function persistTabsState() {
  try {
    const tabsArray = Array.from(openTabsCache.values());
    await chrome.storage.local.set({
      [STORAGE_OPEN_TABS]: tabsArray,
      [STORAGE_ACTIVE_TAB]: lastActiveWebTabId
    });
  } catch (err) {
    console.warn('[Kevin] Error persisting tabs state:', err);
  }
}

/**
 * Records a closed tab into recent history so context is preserved even if tabs are closed.
 */
async function recordClosedTab(tabInfo) {
  if (!tabInfo || !tabInfo.url) return;
  try {
    const stored = await chrome.storage.local.get([STORAGE_TAB_HISTORY]);
    const history = stored[STORAGE_TAB_HISTORY] || [];
    history.unshift({
      ...tabInfo,
      closedAt: Date.now()
    });
    // Keep last 25 closed tabs in memory
    const trimmed = history.slice(0, 25);
    await chrome.storage.local.set({ [STORAGE_TAB_HISTORY]: trimmed });
  } catch (e) {}
}

// 1. Tab Created: remember new tab
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab && tab.url && !isExcludedUrl(tab.url)) {
    openTabsCache.set(tab.id, {
      id: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      active: tab.active,
      windowId: tab.windowId,
      lastActiveAt: tab.active ? Date.now() : 0
    });
    if (tab.active) lastActiveWebTabId = tab.id;
    await persistTabsState();
  }
});

// 2. Tab Updated: remember title, url, status changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab && tab.url && !isExcludedUrl(tab.url)) {
    const existing = openTabsCache.get(tabId) || {};
    const updated = {
      ...existing,
      id: tabId,
      url: tab.url,
      title: tab.title || existing.title || tab.url,
      favIconUrl: tab.favIconUrl || existing.favIconUrl || '',
      active: tab.active,
      windowId: tab.windowId,
      lastActiveAt: tab.active ? Date.now() : (existing.lastActiveAt || 0)
    };
    openTabsCache.set(tabId, updated);
    if (tab.active) lastActiveWebTabId = tabId;
    await persistTabsState();
  }
});

// 3. Tab Activated: update active tab context
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url && !isExcludedUrl(tab.url)) {
      lastActiveWebTabId = tab.id;
      // Mark active in cache
      for (const [id, t] of openTabsCache.entries()) {
        t.active = (id === tab.id);
        if (t.active) t.lastActiveAt = Date.now();
      }
      openTabsCache.set(tab.id, {
        id: tab.id,
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl || '',
        active: true,
        windowId: tab.windowId,
        lastActiveAt: Date.now()
      });
      await persistTabsState();
    }
  } catch (e) {}
});

// 4. Tab Removed: closed tab resilience (Bug 1 & Bug 2 fix)
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const closedTab = openTabsCache.get(tabId);
  if (closedTab) {
    await recordClosedTab(closedTab);
    openTabsCache.delete(tabId);
  }

  // If the active tab was closed, seamlessly elect the next active open tab
  if (lastActiveWebTabId === tabId) {
    lastActiveWebTabId = null;
    const target = await getTargetTab();
    if (target) {
      lastActiveWebTabId = target.id;
    }
  }
  await persistTabsState();
});

// 5. Window Focus Changed
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab && activeTab.url && !isExcludedUrl(activeTab.url)) {
      lastActiveWebTabId = activeTab.id;
      await persistTabsState();
    }
  } catch (e) {}
});

// Initialize on startup
syncOpenTabs();

/**
 * Resolves the target web tab with multi-level fallback ensuring context is NEVER lost.
 */
async function getTargetTab(explicitTabId = null) {
  // 1. Explicit Tab ID if open and valid
  if (explicitTabId) {
    try {
      const tab = await chrome.tabs.get(explicitTabId);
      if (tab && tab.url && !isExcludedUrl(tab.url)) {
        lastActiveWebTabId = tab.id;
        return tab;
      }
    } catch (e) {
      openTabsCache.delete(explicitTabId);
    }
  }

  // 2. Most recently active web tab if valid
  if (lastActiveWebTabId) {
    try {
      const tab = await chrome.tabs.get(lastActiveWebTabId);
      if (tab && tab.url && !isExcludedUrl(tab.url)) {
        return tab;
      }
    } catch (e) {
      openTabsCache.delete(lastActiveWebTabId);
      lastActiveWebTabId = null;
    }
  }

  // 3. Active tab in current focused/normal browser window
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const sortedWindows = windows.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
    for (const win of sortedWindows) {
      const activeTab = win.tabs?.find((t) => t.active && !isExcludedUrl(t.url));
      if (activeTab) {
        lastActiveWebTabId = activeTab.id;
        return activeTab;
      }
    }
  } catch (e) {}

  // 4. Any active web tab in any window
  try {
    const allTabs = await chrome.tabs.query({});
    const activeWeb = allTabs.find((t) => t.active && !isExcludedUrl(t.url));
    if (activeWeb) {
      lastActiveWebTabId = activeWeb.id;
      return activeWeb;
    }

    // 5. Any web tab open in browser
    const anyWeb = allTabs.find((t) => !isExcludedUrl(t.url));
    if (anyWeb) {
      lastActiveWebTabId = anyWeb.id;
      return anyWeb;
    }
  } catch (e) {}

  // 6. Inspect Open Tabs Cache
  if (openTabsCache.size > 0) {
    const cachedTabs = Array.from(openTabsCache.values())
      .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
    for (const c of cachedTabs) {
      try {
        const tab = await chrome.tabs.get(c.id);
        if (tab && !isExcludedUrl(tab.url)) {
          lastActiveWebTabId = tab.id;
          return tab;
        }
      } catch (e) {
        openTabsCache.delete(c.id);
      }
    }
  }

  return null;
}

// Sends message to content script on target tab, auto-injecting if absent
async function sendTabMessage(targetTab, message) {
  if (!targetTab || !targetTab.id) {
    throw new Error('No active tab found');
  }

  if (targetTab.url?.startsWith('chrome://') || targetTab.url?.startsWith('chrome-extension://')) {
    throw new Error(`Cannot run DOM script on browser internal page (${targetTab.url})`);
  }

  try {
    return await chrome.tabs.sendMessage(targetTab.id, message);
  } catch (err) {
    // Inject content script if not already present
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      files: ['content/content.js']
    });
    return await chrome.tabs.sendMessage(targetTab.id, message);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Get List of Open Tabs (Remembered Tabs)
  if (request.type === 'GET_OPEN_TABS') {
    (async () => {
      await syncOpenTabs();
      const openTabs = Array.from(openTabsCache.values())
        .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
      sendResponse({
        success: true,
        openTabs,
        activeTabId: lastActiveWebTabId
      });
    })();
    return true;
  }

  // 2. Switch Active Target Tab
  if (request.type === 'SWITCH_TAB') {
    (async () => {
      try {
        const targetId = Number(request.tabId);
        const tab = await chrome.tabs.get(targetId);
        if (tab) {
          await chrome.tabs.update(targetId, { active: true });
          if (tab.windowId) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
          lastActiveWebTabId = targetId;
          await persistTabsState();
          sendResponse({ success: true, tab });
        } else {
          sendResponse({ success: false, error: 'Tab not found' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // 3. Get Snapshot from Active / Selected Tab (with automatic closed-tab recovery)
  if (request.type === 'GET_PAGE_SNAPSHOT') {
    getTargetTab(request.tabId)
      .then(async (tab) => {
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'No open web tab found' });
          return;
        }

        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
          sendResponse({
            success: true,
            snapshot: {
              url: tab.url,
              title: tab.title || tab.url,
              elements: [],
              isRestricted: true,
              tabId: tab.id
            }
          });
          return;
        }

        const snapshot = await sendTabMessage(tab, { type: 'KEVIN_GET_SNAPSHOT' });
        snapshot.tabId = tab.id;
        sendResponse({ success: true, snapshot });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 4. Execute Page Action
  if (request.type === 'EXECUTE_PAGE_ACTION') {
    getTargetTab(request.tabId)
      .then(async (tab) => {
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }

        const action = request.action || {};
        const kind = String(action.action || action.type || '').toLowerCase();

        // Navigate the current opened tab in place
        if (kind === 'navigate') {
          if (!action.url) {
            sendResponse({ success: false, error: 'Navigate requires a URL' });
            return;
          }

          const check = isAllowedNavigationUrl(action.url);
          if (!check.allowed) {
            sendResponse({ success: false, error: check.reason || 'Navigation URL is not allowed' });
            return;
          }

          await chrome.tabs.update(tab.id, { url: action.url });
          sendResponse({
            success: true,
            result: {
              success: true,
              message: `Navigated tab #${tab.id} to ${action.url}`,
              targetTabId: tab.id,
              url: action.url
            }
          });
          return;
        }

        if (kind === 'back') {
          await chrome.tabs.goBack(tab.id);
          sendResponse({
            success: true,
            result: { success: true, message: `Navigated back on tab #${tab.id}`, targetTabId: tab.id }
          });
          return;
        }

        if (kind === 'forward') {
          await chrome.tabs.goForward(tab.id);
          sendResponse({
            success: true,
            result: { success: true, message: `Navigated forward on tab #${tab.id}`, targetTabId: tab.id }
          });
          return;
        }

        // DOM-level actions dispatched directly to current active tab content script
        const domResult = await sendTabMessage(tab, { type: 'KEVIN_EXECUTE_ACTION', action });
        sendResponse({ success: true, result: domResult });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'NAVIGATE_TAB') {
    getTargetTab(request.tabId).then(async (tab) => {
      if (!request.url) {
        sendResponse({ success: false, error: 'No tab or invalid URL' });
        return;
      }
      const check = isAllowedNavigationUrl(request.url);
      if (!check.allowed) {
        sendResponse({ success: false, error: check.reason || 'Navigation URL is not allowed' });
        return;
      }
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: request.url });
        sendResponse({ success: true, tabId: tab.id });
      } else {
        sendResponse({ success: false, error: 'No tab or invalid URL' });
      }
    });
    return true;
  }

  if (request.type === 'CAPTURE_TAB_SCREENSHOT') {
    chrome.tabs
      .captureVisibleTab(null, { format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'GET_ACTIVE_TAB_INFO') {
    getTargetTab(request.tabId)
      .then((tab) => {
        if (tab) {
          sendResponse({
            success: true,
            tab: { id: tab.id, url: tab.url, title: tab.title },
            openTabs: Array.from(openTabsCache.values())
          });
        } else {
          sendResponse({ success: false, error: 'No active tab', openTabs: Array.from(openTabsCache.values()) });
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

