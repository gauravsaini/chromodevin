import { executeAction, type ActionResult } from './action-executor.js';
import type { ActionPayload } from '../types.js';

export interface BrowserEngineOptions {
  executor?: (payload: ActionPayload | any) => Promise<ActionResult>;
}

/**
 * BrowserEngine: Performs browser/DOM actions given an action payload.
 * Decouples DOM side-effects from the agent's decision/planning engine.
 */
export class BrowserEngine {
  public executor: (payload: ActionPayload | any) => Promise<ActionResult>;

  constructor(options: BrowserEngineOptions = {}) {
    this.executor = options.executor || executeAction;
  }

  /**
   * Performs the browser action described by the payload.
   */
  async perform(actionPayload: ActionPayload | any): Promise<ActionResult> {
    if (!actionPayload || typeof actionPayload !== 'object') {
      return { success: false, error: 'Invalid action payload' };
    }
    return this.executor(actionPayload);
  }
}
