/**
 * Core Type Contracts for Kevin Agent & Browser Perception.
 * Pure unit contracts with strict input/output boundaries.
 */

export interface DOMElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DOMElementCandidate {
  id: string;
  tag?: string;
  role?: string;
  text?: string;
  placeholder?: string;
  type?: string;
  name?: string;
  disabled?: boolean;
  ariaExpanded?: boolean;
  ariaChecked?: boolean;
  checked?: boolean;
  href?: string;
  value?: string;
  ariaLabel?: string;
  title?: string;
  isIframe?: boolean;
  rect?: DOMElementRect;
}

export interface DOMSnapshot {
  url: string;
  title: string;
  elements: DOMElementCandidate[];
  bodyText?: string;
}

export type ActionType =
  | 'click'
  | 'dblclick'
  | 'hover'
  | 'type'
  | 'press_key'
  | 'scroll'
  | 'navigate'
  | 'back'
  | 'forward'
  | 'extract'
  | 'wait'
  | 'done'
  | 'webmcp'
  | 'reload'
  | 'select_option'
  | 'open_new_tab'
  | 'close_tab'
  | 'switch_tab'
  | 'click_element'
  | 'type_into_field'
  | 'press_enter'
  | 'scroll_down'
  | 'scroll_up'
  | 'go_back'
  | 'go_forward'
  | 'navigate_url';

export interface ActionPayload {
  action: ActionType;
  targetId?: string | null;
  targetText?: string | null;
  targetPlaceholder?: string | null;
  targetHref?: string | null;
  targetName?: string | null;
  targetTag?: string | null;
  text?: string | null;
  key?: string | null;
  url?: string | null;
  direction?: 'up' | 'down';
  amount?: number;
  duration?: number;
  pressEnter?: boolean;
  explanation?: string;
  targetElement?: DOMElementCandidate | null;
  risk?: RiskAssessment;
  tool?: WebMcpTool;
  goal?: string;
  error?: string;
}

export interface VerificationResult {
  satisfied: boolean;
  reason: string;
  actual?: any;
  expected?: any;
}

export interface ActionValidationResult {
  valid: boolean;
  action?: ActionPayload;
  error?: string;
}

export interface RiskAssessment {
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  reason: string;
}

export interface DecisionChoiceAnswer {
  type: 'choice';
  choice: string | null;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface DecisionNoulAnswer {
  type: 'noul';
  noul: number;
}

export interface DecisionScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: number[];
}

export type TypedAnswer = DecisionChoiceAnswer | DecisionNoulAnswer | DecisionScoreAnswer;

export interface DecisionModelOutput {
  answers: Record<string, TypedAnswer>;
  action: ActionPayload;
  telemetry: {
    model: string;
    family: string;
    mode: string;
    contract: string;
    forwardCalls: number;
    schemaGuaranteed: boolean;
    provider?: string;
    adapter?: string;
  };
}

export interface WebMcpTool {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  handler?: (args: any) => Promise<any> | any;
}

export interface ExtractionResult {
  success: boolean;
  data: Record<string, any>;
  missingFields: string[];
  confidence: number;
}

export interface SchemaFieldDef {
  key: string;
  type: string;
  description: string;
  required: boolean;
}
