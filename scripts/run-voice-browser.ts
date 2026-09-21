/**
 * CLI Runner for Kevin Voice Browser.
 * Launches a Playwright browser instance, hooks up the VoiceBrowserController,
 * and starts the live HTTP/WebSocket control server on http://localhost:8787.
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoiceBrowserController } from '../packages/playwright/voice-controller.js';
import { PlaywrightBrowserEngine } from '../packages/playwright/driver.js';
import { KevinVoiceServer } from '../packages/daemon/voice-server.js';
import { installOverlay } from '../packages/playwright/overlay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE_DIR = path.join(__dirname, '..', '.browser-profile');

export async function startVoiceBrowser(options: {
  port?: number;
  headless?: boolean;
  startUrl?: string;
  profileDir?: string;
  cdp?: string;
} = {}) {
  const port = options.port || 8787;
  const headless = options.headless === true;
  const startUrl = options.startUrl || 'https://en.wikipedia.org/wiki/Main_Page';
  const profileDir = options.profileDir || DEFAULT_PROFILE_DIR;

  console.log('🎙️ Launching Kevin Voice Browser...');

  let context: any;
  let browser: any;

  if (options.cdp) {
    browser = await chromium.connectOverCDP(options.cdp);
    context = browser.contexts()[0] || (await browser.newContext());
  } else {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: headless ? { width: 1280, height: 900 } : null,
      args: headless ? [] : ['--window-size=1280,900', '--window-position=40,40'],
      ignoreDefaultArgs: ['--enable-automation']
    });
  }

  await context.addInitScript(installOverlay);

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  if (startUrl && startUrl !== 'about:blank') {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  const engine = new PlaywrightBrowserEngine(page);
  const controller = new VoiceBrowserController({
    page,
    engine,
    model: 'onnx-community/LFM2.5-350M-RLCD'
  });

  await controller.start();

  const server = new KevinVoiceServer({
    port,
    controller
  });

  const { url } = await server.start();
  console.log(`\n======================================================`);
  console.log(`🚀 Kevin Voice Browser Server live at: ${url}`);
  console.log(`👉 Open ${url} in Chrome/Edge to use the microphone!`);
  console.log(`⚡ Powered by on-device System 1 RLCD/ONNX decision head`);
  console.log(`======================================================\n`);

  return { server, controller, context, page };
}

// Direct invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const headless = args.includes('--headless');
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1], 10) : 8787;

  startVoiceBrowser({ headless, port }).catch((err) => {
    console.error('Failed to start voice browser:', err);
    process.exit(1);
  });
}
