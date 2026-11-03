/**
 * Automations: one `automations` row per rule, run once per saved bookmark
 * after categoriseSite (so AI tags are there for `tag` conditions).
 *
 * Smart boards are automations too: a board in smart/mixed mode with
 * `smartRules.autoApply` owns a row (`board` pointer) with one `ai_topic`
 * condition and an `add_to_board` action. `syncBoardAutomation` keeps that
 * row in step with the board, and editing the row writes back to the board.
 */
import Parse from 'parse/node.js';
import { randomBytes, randomUUID } from 'crypto';
import { createError } from 'h3';
import {
  initParseForBoards, makeOwnerAcl, addBookmarkToBoard, updateBoardBookmarkCount,
  Boards, Websites,
} from './boardUtils';
import { signPayload } from './webhooks';
import { notifyBoardAudience } from './boardNotifications';
import { askClaude, mapWithConcurrency } from '#root/server/utils/serverUtils';
import { askJev, withImageFallback } from './aiClients';
import { topicRequests, topicScores, bestTopic } from './jevTopics';
import { imageUrlsFor, prepareImages } from './jevImages';
import {
  normalizeAutomation, normalizeBoardRule, automationMatches, evaluateCondition, renderTemplate, defaultWebhookBody,
  RuleError, READ_LATER_TAG,
} from './automationRules';
import type {
  AutomationBookmark, AutomationCondition, AutomationInput, AutomationResponse,
} from '../types/automation.types';
import type { SmartRules } from '../types/board.types';

export const AUTOMATIONS_CLASS = 'automations';
const Automations = Parse.Object.extend(AUTOMATIONS_CLASS);
const MAX_PER_USER = 100;
const WEBHOOK_TIMEOUT_MS = 10_000;

const userPointer = (objectId: string) => ({ __type: 'Pointer', className: '_User', objectId });
const boardPointer = (objectId: string) => ({ __type: 'Pointer', className: 'boards', objectId });

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function serializeAutomation(row: Parse.Object): AutomationResponse {
  const lastRunAt = row.get('lastRunAt');
  return {
    id: row.id,
    name: row.get('name'),
    enabled: row.get('enabled') !== false,
    trigger: row.get('trigger') || 'bookmark.added',
    match: row.get('match') === 'any' ? 'any' : 'all',
    conditions: row.get('conditions') || [],
    actions: row.get('actions') || [],
    boardId: row.get('board')?.id || null,
    secret: row.get('secret'),
    runCount: row.get('runCount') || 0,
    lastRunAt: lastRunAt?.toISOString?.() || null,
    createdAt: row.createdAt?.toISOString?.() || row.get('createdAt'),
    updatedAt: row.updatedAt?.toISOString?.() || row.get('updatedAt'),
  };
}

export async function listAutomations(userId: string): Promise<Parse.Object[]> {
  initParseForBoards();
  const query = new Parse.Query(Automations);
  query.equalTo('owner', userPointer(userId));
  query.ascending('createdAt');
  query.limit(MAX_PER_USER);
  return query.find({ useMasterKey: true });
}

export async function getAutomation(userId: string, id: string): Promise<Parse.Object> {
  initParseForBoards();
  const query = new Parse.Query(Automations);
  query.equalTo('owner', userPointer(userId));
  const row = await query.get(id, { useMasterKey: true }).catch(() => null);
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Automation not found' });
  return row;
}

/** RuleError → 400; anything else propagates. */
function as400<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error: any) {
    if (error instanceof RuleError) throw createError({ statusCode: 400, statusMessage: error.message });
    throw error;
  }
}

export const parseAutomationBody = (raw: unknown): AutomationInput => as400(() => normalizeAutomation(raw));

export type BoardRule = Pick<AutomationInput, 'match' | 'conditions'>;
export const parseBoardRule = (raw: unknown): BoardRule => as400(() => normalizeBoardRule(raw));

/** Boards named in add_to_board actions must be the user's own. */
async function assertOwnBoards(userId: string, input: AutomationInput) {
  const ids = [...new Set(input.actions.filter((a) => a.type === 'add_to_board').map((a) => a.boardId!))];
  if (!ids.length) return;
  const query = new Parse.Query(Boards);
  query.equalTo('owner', userPointer(userId));
  query.notEqualTo('isDeleted', true);
  query.notEqualTo('kind', 'folder');
  query.containedIn('objectId', ids);
  const found = await query.count({ useMasterKey: true });
  if (found !== ids.length) throw createError({ statusCode: 400, statusMessage: 'Board not found' });
}

function applyInput(row: Parse.Object, input: AutomationInput) {
  row.set('name', input.name);
  row.set('enabled', input.enabled);
  row.set('trigger', input.trigger);
  row.set('match', input.match);
  row.set('conditions', input.conditions);
  row.set('actions', input.actions);
}

export async function createAutomation(userId: string, input: AutomationInput, boardId?: string): Promise<Parse.Object> {
  initParseForBoards();
  await assertOwnBoards(userId, input);
  if ((await listAutomations(userId)).length >= MAX_PER_USER) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_PER_USER} automations per account` });
  }
  const row = new Automations();
  applyInput(row, input);
  row.set('owner', userPointer(userId));
  row.set('secret', `whsec_${randomBytes(24).toString('base64url')}`);
  row.set('runCount', 0);
  if (boardId) row.set('board', boardPointer(boardId));
  row.setACL(makeOwnerAcl(userId));
  return row.save(null, { useMasterKey: true });
}

export async function updateAutomation(userId: string, row: Parse.Object, input: AutomationInput): Promise<Parse.Object> {
  await assertOwnBoards(userId, input);
  applyInput(row, input);
  await row.save(null, { useMasterKey: true });
  await writeBackToBoard(row);
  return row;
}

export async function deleteAutomation(row: Parse.Object) {
  const boardId = row.get('board')?.id;
  await row.destroy({ useMasterKey: true });
  if (!boardId) return;
  // The board's smart rule is gone, so the board goes back to manual.
  const board = await new Parse.Query(Boards).get(boardId, { useMasterKey: true }).catch(() => null);
  if (!board) return;
  board.set('mode', 'manual');
  board.unset('smartRules');
  await board.save(null, { useMasterKey: true });
}

// ─── Smart board ↔ automation ────────────────────────────────────────────────

async function findBoardAutomation(boardId: string): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(Automations);
  query.equalTo('board', boardPointer(boardId));
  return (await query.first({ useMasterKey: true })) || undefined;
}

/**
 * Call after every board save that can change mode, smartRules, its rule or
 * isDeleted. Creates, updates or disables the board's automation.
 *
 * A smart board matches on AI topics, its own exact conditions (`rule`), or
 * both. Pass `rule` only when the client sent one; otherwise the conditions
 * already on the automation stay. Actions other than filing into this board
 * — added in the automation editor — are left alone.
 */
export async function syncBoardAutomation(board: Parse.Object, userId: string, rule?: BoardRule): Promise<void> {
  const rules = board.get('smartRules') as SmartRules | undefined;
  const existing = await findBoardAutomation(board.id);
  const stored: AutomationCondition[] = existing?.get('conditions') || [];
  const exact = rule ? rule.conditions : stored.filter((c) => c.field !== 'ai_topic');
  const topics = rules?.topics || [];
  const active = !board.get('isDeleted')
    && ['smart', 'mixed'].includes(board.get('mode'))
    && rules?.autoApply !== false
    && (topics.length > 0 || exact.length > 0);

  if (!active) {
    if (existing && existing.get('enabled') !== false) {
      existing.set('enabled', false);
      await existing.save(null, { useMasterKey: true });
    }
    return;
  }

  const conditions: AutomationCondition[] = [
    ...(topics.length ? [{ field: 'ai_topic' as const, op: 'is' as const, topics, threshold: rules?.confidenceThreshold ?? 0.6 }] : []),
    ...exact,
  ];
  const match = rule?.match ?? existing?.get('match') ?? 'all';

  if (!existing) {
    await createAutomation(userId, {
      name: board.get('name'),
      enabled: true,
      trigger: 'bookmark.added',
      match,
      conditions,
      actions: [{ type: 'add_to_board', boardId: board.id }],
    }, board.id);
    return;
  }

  const actions = existing.get('actions') || [];
  if (!actions.some((a: any) => a.type === 'add_to_board' && a.boardId === board.id)) {
    actions.unshift({ type: 'add_to_board', boardId: board.id });
  }
  existing.set('conditions', conditions);
  existing.set('match', match);
  existing.set('actions', actions);
  existing.set('enabled', true);
  await existing.save(null, { useMasterKey: true });
}

/** Mirror of the above for edits made in the automation editor. */
async function writeBackToBoard(row: Parse.Object) {
  const boardId = row.get('board')?.id;
  if (!boardId) return;
  const board = await new Parse.Query(Boards).get(boardId, { useMasterKey: true }).catch(() => null);
  if (!board || board.get('isDeleted')) return;
  const topic = (row.get('conditions') || []).find((c: AutomationCondition) => c.field === 'ai_topic');
  const previous = (board.get('smartRules') || {}) as SmartRules;
  // Without an AI condition the board is still smart — it files on its exact
  // conditions — so only the topics are cleared.
  board.set('smartRules', {
    ...previous,
    topics: topic?.topics || [],
    confidenceThreshold: topic?.threshold ?? previous.confidenceThreshold ?? 0.6,
    autoApply: row.get('enabled') !== false,
  });
  if (board.get('mode') === 'manual') board.set('mode', 'smart');
  await board.save(null, { useMasterKey: true });
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export function toBookmark(site: Parse.Object): AutomationBookmark {
  const summary = site.get('aiSummary');
  return {
    id: site.id,
    url: site.get('url') || '',
    title: site.get('siteTitle') || site.get('url') || '',
    description: site.get('siteDescription') || '',
    type: site.get('type') || '',
    tags: site.get('tags') || [],
    summary: typeof summary === 'object' ? summary?.tldr || '' : '',
    excerpt: (site.get('siteBody') || '').slice(0, 2000),
    imageUrls: imageUrlsFor(site),
  };
}

type AiCandidate = { id: string; name: string; topics: string[]; threshold: number };
type AiHit = { confidence: number; topic: string };

/**
 * AI_TOPIC_MATCHER=jev decides AI topics with TypeSafe's Jev, through the
 * LiteLLM proxy (see askJev). Anything else, or a failed Jev call, uses the
 * text model.
 */
export const useJev = () => process.env.AI_TOPIC_MATCHER?.trim().toLowerCase() === 'jev';
const JEV_CONCURRENCY = 8;

/** Jev's probability for each of `topics`, one call per bookmark, looking at its picture when it has one. */
export async function jevTopicScores(bookmark: AutomationBookmark, topics: string[], tag: string) {
  const images = await prepareImages(bookmark.imageUrls ?? []);
  return withImageFallback(images, async (img) => {
    const { requests, keys } = topicRequests(bookmark, topics, undefined, img);
    return topicScores(await Promise.all(requests.map((request) => askJev(request, tag))), keys);
  });
}

/** Backfill with Jev, a few bookmarks at a time. Null when a call fails, so the caller can fall back. */
async function jevBoardHits(bookmarks: AutomationBookmark[], topics: string[], threshold: number): Promise<Map<string, AiHit> | null> {
  let failed = false;
  try {
    const hits = await mapWithConcurrency(bookmarks, JEV_CONCURRENCY, async (bookmark) => {
      if (failed) return null;
      try {
        return bestTopic(topics, await jevTopicScores(bookmark, topics, 'applySmartFilter'), threshold);
      } catch (error) {
        failed = true;
        throw error;
      }
    });
    return new Map(bookmarks.flatMap((b, i) => (hits[i] ? [[b.id, hits[i]!] as const] : [])));
  } catch (error: any) {
    console.error('[automations] Jev smart-board matching failed, using the text model:', error?.message);
    return null;
  }
}

/**
 * Only asks Claude about automations whose exact conditions leave the
 * outcome open, then does it in one call for all of them.
 */
async function matchAiTopics(bookmark: AutomationBookmark, rows: Parse.Object[]): Promise<Map<string, { confidence: number; topic: string }>> {
  const candidates: AiCandidate[] = [];
  for (const row of rows) {
    const conditions: AutomationCondition[] = row.get('conditions') || [];
    const exact = conditions.filter((c) => c.field !== 'ai_topic').map((c) => evaluateCondition(c, bookmark));
    const undecided = row.get('match') === 'any' ? !exact.some(Boolean) : exact.every(Boolean);
    if (!undecided) continue;
    conditions.forEach((c, i) => {
      if (c.field === 'ai_topic') {
        candidates.push({ id: `${row.id}:${i}`, name: row.get('name'), topics: c.topics || [], threshold: c.threshold ?? 0.6 });
      }
    });
  }
  const hits = new Map<string, AiHit>();
  if (!candidates.length) return hits;

  if (useJev()) {
    try {
      const scores = await jevTopicScores(bookmark, candidates.flatMap((c) => c.topics), 'runAutomations');
      for (const candidate of candidates) {
        const hit = bestTopic(candidate.topics, scores, candidate.threshold);
        if (hit) hits.set(candidate.id, hit);
      }
      return hits;
    } catch (error: any) {
      console.error('[automations] Jev topic matching failed, using the text model:', error?.message);
    }
  }

  const prompt = `You are a bookmark classification assistant. Given a bookmark and rules with topics, determine which rules match.

BOOKMARK:
- Title: ${bookmark.title}
- Description: ${bookmark.description}
- Tags: ${JSON.stringify(bookmark.tags)}
- Type: ${bookmark.type}
- URL: ${bookmark.url}
- Summary: ${bookmark.summary}

RULES:
${JSON.stringify(candidates, null, 2)}

Return: {"matches": [{"id": "rule id", "confidence": 0.85, "topic": "matching topic"}]}
Only include matches above each rule's threshold.`;

  const result: any = await askClaude(prompt, { name: 'runAutomations', timeout: 60000 });
  if (result?.result?.error) {
    console.error('[automations] AI topic matching failed:', result.result.message);
    return hits;
  }
  for (const m of result?.result?.matches || []) {
    const candidate = candidates.find((c) => c.id === m?.id);
    const confidence = Number(m?.confidence);
    if (candidate && confidence >= candidate.threshold) hits.set(candidate.id, { confidence, topic: String(m.topic || '') });
  }
  return hits;
}

/**
 * Which of `sites` a smart board's rule matches, for backfilling existing
 * bookmarks. Exact conditions run in JS first; only bookmarks they leave
 * undecided go to Claude, in one call. Other actions are not run.
 */
export async function matchBookmarksToBoard(
  board: Parse.Object,
  sites: Parse.Object[],
): Promise<Array<{ id: string; confidence?: number; topic?: string }>> {
  const row = await findBoardAutomation(board.id);
  const rules = board.get('smartRules') as SmartRules | undefined;
  const conditions: AutomationCondition[] = row?.get('conditions')
    ?? (rules?.topics?.length ? [{ field: 'ai_topic', op: 'is', topics: rules.topics, threshold: rules.confidenceThreshold ?? 0.6 }] : []);
  if (!conditions.length || !sites.length) return [];
  const match = row?.get('match') === 'any' ? 'any' : 'all';
  const bookmarks = sites.map(toBookmark);

  const aiIndex = conditions.findIndex((c) => c.field === 'ai_topic');
  let aiHits = new Map<string, AiHit>();
  if (aiIndex !== -1) {
    const exact = conditions.filter((c) => c.field !== 'ai_topic');
    const undecided = bookmarks.filter((b) => {
      const results = exact.map((c) => evaluateCondition(c, b));
      return match === 'any' ? !results.some(Boolean) : results.every(Boolean);
    });
    const topic = conditions[aiIndex];
    const threshold = topic.threshold ?? 0.6;
    const jevHits = undecided.length && useJev() ? await jevBoardHits(undecided, topic.topics || [], threshold) : null;
    if (jevHits) {
      aiHits = jevHits;
    } else if (undecided.length) {
      const prompt = `You are a bookmark classification assistant. Given a board's topics and a list of bookmarks, determine which bookmarks match the board's theme.

BOARD: "${board.get('name')}"
BOARD TOPICS: ${JSON.stringify(topic.topics)}
BOARD DESCRIPTION: "${board.get('description') || ''}"
CONFIDENCE THRESHOLD: ${threshold}

BOOKMARKS:
${JSON.stringify(undecided.map(({ id, title, description, tags, type, url }) => ({ id, title, description, tags, type, url })), null, 2)}

Return: {"matches": [{"id": "...", "confidence": 0.85, "topic": "matching topic"}]}
Only include matches above the confidence threshold.`;
      const result: any = await askClaude(prompt, { name: 'applySmartFilter', timeout: 60000, maxTokens: 2000 });
      if (result?.result?.error) throw createError({ statusCode: 502, statusMessage: 'AI classification failed' });
      const sent = new Set(undecided.map((b) => b.id));
      for (const m of result?.result?.matches || []) {
        // Claude can echo ids it was never given.
        if (sent.has(m?.id) && Number(m.confidence) >= threshold) {
          aiHits.set(m.id, { confidence: Number(m.confidence), topic: String(m.topic || '') });
        }
      }
    }
  }

  return bookmarks
    .filter((b) => automationMatches({ match, conditions }, b, (i) => i === aiIndex && aiHits.has(b.id)))
    .map((b) => ({ id: b.id, ...aiHits.get(b.id) }));
}

async function postWebhook(row: Parse.Object, url: string, template: string | undefined, bookmark: AutomationBookmark) {
  const body = template ? renderTemplate(template, bookmark) : JSON.stringify(defaultWebhookBody(bookmark));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WebBites-Automations/1.0',
        'X-WebBites-Event': 'automation.run',
        'X-WebBites-Automation': row.id,
        'X-WebBites-Delivery': randomUUID(),
        'X-WebBites-Signature': signPayload(row.get('secret'), body),
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`[automations] webhook ${row.id} → ${response.status}`);
  } catch (error: any) {
    console.error(`[automations] webhook ${row.id} failed:`, error?.message);
  }
}

/**
 * Runs every enabled automation for one freshly saved bookmark.
 * Idempotent except for webhooks (a redelivered message re-posts them).
 */
export async function runAutomations(websiteId: string, userId: string) {
  initParseForBoards();
  const rows = (await listAutomations(userId)).filter((row) => row.get('enabled') !== false);
  if (!rows.length) return { ran: 0, matched: [] as string[] };

  const site = await new Parse.Query(Websites).get(websiteId, { useMasterKey: true }).catch(() => null);
  if (!site || site.get('user')?.id !== userId || site.get('isDeleted')) return { ran: 0, matched: [] as string[] };

  const bookmark = toBookmark(site);
  const aiHits = await matchAiTopics(bookmark, rows);
  const matched = rows.filter((row) => automationMatches(
    { match: row.get('match'), conditions: row.get('conditions') || [] },
    bookmark,
    (i) => aiHits.has(`${row.id}:${i}`),
  ));
  if (!matched.length) return { ran: rows.length, matched: [] as string[] };

  // Tags first, in one save, so webhooks below see them.
  const tags = new Set(bookmark.tags);
  for (const row of matched) {
    for (const action of row.get('actions') || []) {
      if (action.type === 'add_tag' && action.tag) tags.add(action.tag);
      if (action.type === 'read_later') tags.add(READ_LATER_TAG);
    }
  }
  if (tags.size !== bookmark.tags.length) {
    bookmark.tags = [...tags];
    site.set('tags', bookmark.tags);
    await site.save(null, { useMasterKey: true });
  }

  const webhooks: Promise<void>[] = [];
  for (const row of matched) {
    const aiHit = [...aiHits.entries()].find(([key]) => key.startsWith(`${row.id}:`))?.[1];
    for (const action of row.get('actions') || []) {
      if (action.type === 'add_to_board' && action.boardId) {
        const board = await new Parse.Query(Boards).get(action.boardId, { useMasterKey: true }).catch(() => null);
        if (!board || board.get('isDeleted') || board.get('owner')?.id !== userId) continue;
        const status = await addBookmarkToBoard(board, websiteId, userId, {
          source: row.get('board') ? 'smart' : 'automation',
          reactivate: false,
          aiTopic: aiHit?.topic,
          aiConfidence: aiHit?.confidence,
        });
        if (status === 'created') {
          await updateBoardBookmarkCount(board.id, 1);
          await notifyBoardAudience(board, userId, 'item_added', { websiteIds: [websiteId] });
        }
      }
      if (action.type === 'webhook' && action.url) webhooks.push(postWebhook(row, action.url, action.body, bookmark));
    }
    row.increment('runCount');
    row.set('lastRunAt', new Date());
  }
  await Promise.all(webhooks);
  await Parse.Object.saveAll(matched, { useMasterKey: true }).catch(() => {});
  return { ran: rows.length, matched: matched.map((row) => row.id) };
}
