/**
 * The pure half of automations: validation, condition evaluation, webhook
 * templating. No Parse here, so `npm run test:automationRules` needs no env.
 */
import {
  AUTOMATION_TRIGGERS, CONDITION_FIELDS, CONDITION_OPS, ACTION_TYPES,
  type AutomationAction, type AutomationBookmark, type AutomationCondition, type AutomationInput,
} from '../types/automation.types';

export const READ_LATER_TAG = 'read-later';
const MAX_CONDITIONS = 20;
const MAX_ACTIONS = 10;

export class RuleError extends Error {}

const oneOf = <T extends readonly string[]>(list: T, value: unknown, what: string): T[number] => {
  if (!list.includes(value as string)) throw new RuleError(`${what} must be one of: ${list.join(', ')}`);
  return value as T[number];
};

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

/**
 * Rejects anything but a public https url. Hostname-only: a public name that
 * resolves to a private address still gets through.
 * ponytail: resolve and check the address before fetching if that matters.
 */
export function assertPublicHttpsUrl(raw: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new RuleError('A valid https:// url is required');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLocal = host === 'localhost' || host.endsWith('.localhost');
  if (isLocal && process.env.NODE_ENV === 'development') return url;
  if (url.protocol !== 'https:') throw new RuleError('Webhook urls must use https');
  const isPrivate = isLocal
    || host.endsWith('.local') || host.endsWith('.internal')
    || /^(127|10|0)\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80');
  if (isPrivate) throw new RuleError('Webhook urls must point at a public host');
  return url;
}

export function normalizeCondition(raw: any): AutomationCondition {
  const field = oneOf(CONDITION_FIELDS, raw?.field, 'condition.field');
  if (field === 'ai_topic') {
    const topics = (Array.isArray(raw.topics) ? raw.topics : []).map((t: unknown) => text(t, 100)).filter(Boolean).slice(0, 20);
    if (!topics.length) throw new RuleError('An AI topic condition needs at least one topic');
    const threshold = Number(raw.threshold ?? 0.6);
    return { field, op: 'is', topics, threshold: Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.6 };
  }
  const op = oneOf(CONDITION_OPS, raw?.op, 'condition.op');
  const value = text(raw.value, 500);
  if (!value) throw new RuleError(`The ${field} condition needs a value`);
  return { field, op, value };
}

function normalizeAction(raw: any): AutomationAction {
  const type = oneOf(ACTION_TYPES, raw?.type, 'action.type');
  if (type === 'add_tag') {
    const tag = text(raw.tag, 100);
    if (!tag) throw new RuleError('Add tag needs a tag');
    return { type, tag };
  }
  if (type === 'add_to_board') {
    const boardId = text(raw.boardId, 40);
    if (!boardId) throw new RuleError('Add to board needs a board');
    return { type, boardId };
  }
  if (type === 'webhook') {
    const url = assertPublicHttpsUrl(raw.url).toString();
    const body = raw.body == null || raw.body === '' ? '' : text(raw.body, 5000);
    // Validate the template once with dummy values so a typo fails on save, not on every bookmark.
    if (body) JSON.parse(renderTemplate(body, { id: '', url: '', title: '', description: '', type: '', tags: [], summary: '' }));
    return { type, url, ...(body ? { body } : {}) };
  }
  return { type };
}

/** Validates and cleans a client payload. Throws RuleError with a user-facing message. */
export function normalizeAutomation(raw: any): AutomationInput {
  const name = text(raw?.name, 100);
  if (!name) throw new RuleError('name is required');
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  const actions = Array.isArray(raw.actions) ? raw.actions : [];
  if (conditions.length > MAX_CONDITIONS) throw new RuleError(`At most ${MAX_CONDITIONS} conditions`);
  if (!actions.length) throw new RuleError('At least one action is required');
  if (actions.length > MAX_ACTIONS) throw new RuleError(`At most ${MAX_ACTIONS} actions`);
  try {
    return {
      name,
      enabled: raw.enabled !== false,
      trigger: oneOf(AUTOMATION_TRIGGERS, raw.trigger ?? 'bookmark.added', 'trigger'),
      match: raw.match === 'any' ? 'any' : 'all',
      conditions: conditions.map(normalizeCondition),
      actions: actions.map(normalizeAction),
    };
  } catch (error) {
    if (error instanceof SyntaxError) throw new RuleError('The webhook body must be valid JSON');
    throw error;
  }
}

/**
 * A smart board's own conditions, sent with the board. AI topics travel in
 * `smartRules`, so `ai_topic` entries here are dropped rather than doubled.
 */
export function normalizeBoardRule(raw: any): Pick<AutomationInput, 'match' | 'conditions'> {
  const conditions = (Array.isArray(raw?.conditions) ? raw.conditions : []).filter((c: any) => c?.field !== 'ai_topic');
  if (conditions.length > MAX_CONDITIONS) throw new RuleError(`At most ${MAX_CONDITIONS} conditions`);
  return { match: raw?.match === 'any' ? 'any' : 'all', conditions: conditions.map(normalizeCondition) };
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Evaluates one exact condition. `ai_topic` conditions are decided elsewhere
 * (one Claude call per bookmark) and passed in through `aiMatches`.
 */
export function evaluateCondition(c: AutomationCondition, b: AutomationBookmark, aiMatch = false): boolean {
  if (c.field === 'ai_topic') return aiMatch;
  const needle = (c.value || '').toLowerCase();
  const negate = c.op === 'not_contains' || c.op === 'is_not';
  const exact = c.op === 'is' || c.op === 'is_not';

  let hit: boolean;
  if (c.field === 'tag') {
    const tags = b.tags.map((t) => t.toLowerCase());
    hit = exact ? tags.includes(needle) : tags.some((t) => t.includes(needle));
  } else if (c.field === 'domain') {
    // "is amazon.com" also matches smile.amazon.com.
    const host = hostname(b.url);
    const want = needle.replace(/^www\./, '');
    hit = exact ? host === want || host.endsWith(`.${want}`) : host.includes(want);
  } else {
    const haystack = (c.field === 'url' ? b.url : c.field === 'title' ? b.title : b.type).toLowerCase();
    hit = exact ? haystack === needle : haystack.includes(needle);
  }
  return negate ? !hit : hit;
}

/** No conditions means "every bookmark". */
export function automationMatches(
  a: Pick<AutomationInput, 'match' | 'conditions'>,
  b: AutomationBookmark,
  aiMatches: (conditionIndex: number) => boolean = () => false,
): boolean {
  if (!a.conditions.length) return true;
  const results = a.conditions.map((c, i) => evaluateCondition(c, b, aiMatches(i)));
  return a.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** Fills `{{field}}` placeholders with JSON-escaped values; `{{tags}}` becomes an array. */
export function renderTemplate(template: string, b: AutomationBookmark): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (whole, key: string) => {
    if (key === 'tags') return JSON.stringify(b.tags);
    if (!(key in b)) return whole;
    // Placeholders sit inside a JSON string: escape, drop the outer quotes.
    return JSON.stringify(String((b as any)[key] ?? '')).slice(1, -1);
  });
}

/** Default webhook payload when the user leaves the body empty. */
export function defaultWebhookBody(b: AutomationBookmark) {
  return { event: 'bookmark.added', bookmark: { id: b.id, url: b.url, title: b.title, type: b.type, tags: b.tags } };
}
