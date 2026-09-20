/**
 * Chrome MV3 Extension Background Daemon Bridge.
 * Allows the extension background service worker and popup to communicate
 * with the local Kevin Daemon over WebSocket for high-speed Playwright automation.
 */

import { KevinDaemonClient } from '../../daemon/client.js';

let activeClient = null;

export async function getDaemonClient(url = 'ws://127.0.0.1:9222') {
  if (activeClient && activeClient.connected) {
    return activeClient;
  }

  const client = new KevinDaemonClient(url);
  try {
    await client.connect(1500);
    activeClient = client;
    return client;
  } catch (err) {
    activeClient = null;
    return null;
  }
}

export async function isDaemonAvailable(url = 'ws://127.0.0.1:9222') {
  const client = await getDaemonClient(url);
  return Boolean(client && client.connected);
}

export async function delegateActionToDaemon(goal, options = {}) {
  const client = await getDaemonClient(options.url);
  if (!client) {
    return { success: false, error: 'Kevin Daemon is not running locally on port 9222' };
  }

  return client.act(goal, options.tabId, options.url);
}
