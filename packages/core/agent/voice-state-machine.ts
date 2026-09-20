/**
 * VoiceStateMachine: A clean, minimal state machine for voice interaction.
 * Enforces mutual exclusion between LISTENING and ACTIONING states.
 */

export const InteractionState = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  ACTIONING: 'ACTIONING'
} as const;

export type InteractionStateType = (typeof InteractionState)[keyof typeof InteractionState];
export const VoiceAgentState = InteractionState;

export interface VoiceStateMachineOptions {
  onStateChange?: (newState: InteractionStateType, oldState: InteractionStateType, data?: any) => void;
  onEnterListening?: (data?: any) => void;
  onEnterActioning?: (data?: any) => void;
  onEnterIdle?: (data?: any) => void;
}

export class VoiceStateMachine {
  public state: InteractionStateType;
  public continuous: boolean;
  public onStateChange: (newState: InteractionStateType, oldState: InteractionStateType, data?: any) => void;
  public onEnterListening: (data?: any) => void;
  public onEnterActioning: (data?: any) => void;
  public onEnterIdle: (data?: any) => void;

  constructor(options: VoiceStateMachineOptions = {}) {
    this.state = InteractionState.IDLE;
    this.continuous = false;
    this.onStateChange = options.onStateChange || (() => {});
    this.onEnterListening = options.onEnterListening || (() => {});
    this.onEnterActioning = options.onEnterActioning || (() => {});
    this.onEnterIdle = options.onEnterIdle || (() => {});
  }

  get current(): InteractionStateType {
    return this.state;
  }

  isListening(): boolean {
    return this.state === InteractionState.LISTENING;
  }

  isActioning(): boolean {
    return this.state === InteractionState.ACTIONING;
  }

  isIdle(): boolean {
    return this.state === InteractionState.IDLE;
  }

  transition(newState: InteractionStateType, data?: any): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;

    if (newState === InteractionState.LISTENING) {
      this.onEnterListening(data);
    } else if (newState === InteractionState.ACTIONING) {
      this.onEnterActioning(data);
    } else if (newState === InteractionState.IDLE) {
      this.onEnterIdle(data);
    }

    this.onStateChange(newState, oldState, data);
  }

  startListening(continuous = true): void {
    this.continuous = continuous;
    this.transition(InteractionState.LISTENING);
  }

  commandReceived(command?: any): boolean {
    if (this.state !== InteractionState.LISTENING && this.state !== InteractionState.IDLE) {
      return false;
    }
    this.transition(InteractionState.ACTIONING, command);
    return true;
  }

  actionCompleted(result?: any): void {
    if (this.state !== InteractionState.ACTIONING) return;
    if (this.continuous) {
      this.transition(InteractionState.LISTENING, result);
    } else {
      this.transition(InteractionState.IDLE, result);
    }
  }

  stop(): void {
    this.continuous = false;
    this.transition(InteractionState.IDLE);
  }
}
