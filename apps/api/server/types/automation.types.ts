/**
 * Automations: "whenever a bookmark is added, if <conditions>, do <actions>".
 *
 * A smart board is one of these too — an `ai_topic` condition plus an
 * `add_to_board` action, linked back to the board through `board`.
 */

export const AUTOMATION_TRIGGERS = ['bookmark.added'] as const;
export const CONDITION_FIELDS = ['url', 'domain', 'title', 'type', 'tag', 'ai_topic'] as const;
export const CONDITION_OPS = ['contains', 'not_contains', 'is', 'is_not'] as const;
export const ACTION_TYPES = ['add_tag', 'add_to_board', 'read_later', 'webhook'] as const;

export type AutomationTrigger = typeof AUTOMATION_TRIGGERS[number];
export type ConditionField = typeof CONDITION_FIELDS[number];
export type ConditionOp = typeof CONDITION_OPS[number];
export type ActionType = typeof ACTION_TYPES[number];

export interface AutomationCondition {
  field: ConditionField;
  /** Ignored for `ai_topic`, which always means "matches one of `topics`". */
  op: ConditionOp;
  value?: string;
  /** `ai_topic` only. */
  topics?: string[];
  /** `ai_topic` only, 0-1. */
  threshold?: number;
}

export interface AutomationAction {
  type: ActionType;
  /** add_tag: the tag. */
  tag?: string;
  /** add_to_board: target board id. */
  boardId?: string;
  /** webhook: https endpoint. */
  url?: string;
  /** webhook: JSON body template, `{{id}}` `{{url}}` `{{title}}` `{{tags}}` `{{type}}` placeholders. */
  body?: string;
}

export interface AutomationInput {
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  match: 'all' | 'any';
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

export interface AutomationResponse extends AutomationInput {
  id: string;
  /** Set when this automation is a board's smart rule. */
  boardId: string | null;
  /** HMAC secret for webhook actions. */
  secret: string;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The bookmark fields conditions and webhook templates read. */
export interface AutomationBookmark {
  id: string;
  url: string;
  title: string;
  description: string;
  type: string;
  tags: string[];
  summary: string;
  /** Start of the page text. Only Jev reads it: the summary is usually not written yet when automations run. */
  excerpt?: string;
  /** Where the bookmark's pictures are (screenshot or OG image, or an image bookmark's own). Only Jev reads them. */
  imageUrls?: string[];
}
