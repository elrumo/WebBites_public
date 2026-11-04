/**
 * AI-topic matching (smart boards and automations) with Jev instead of the
 * text model. Jev answers one yes/no question per topic with a calibrated
 * probability, so a rule's threshold is compared against a real probability
 * rather than a confidence the model wrote, and answers come back under keys
 * chosen here, so no id can be invented or dropped from a long reply.
 *
 * Pure: builds the requests and reads the answers. askJev makes the call.
 */
import type { AutomationBookmark } from '../types/automation.types';
import type { JevImages, JevRequest, JevResponse } from '../types/jev.types';

/** Keeps each request far inside Jev's 64k-token budget. */
export const MAX_TOPICS_PER_CALL = 100;

export const normTopic = (topic: string) => topic.trim().toLowerCase();

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/**
 * Only what a topic decision needs, capped: Jev gets less accurate as the
 * state fills with unrelated text. `images` are the bookmark's pictures.
 */
export function bookmarkState(b: AutomationBookmark, images?: JevImages | null) {
  const bookmark: Record<string, unknown> = {};
  if (images) bookmark.images = images.refs;
  if (b.title) bookmark.title = clip(b.title, 300);
  if (b.description) bookmark.description = clip(b.description, 1000);
  if (b.summary) bookmark.summary = clip(b.summary, 1500);
  if (b.excerpt) bookmark.excerpt = clip(b.excerpt, 2000);
  if (b.url) bookmark.url = clip(b.url, 500);
  if (b.type) bookmark.type = b.type;
  if (b.tags?.length) bookmark.tags = b.tags.slice(0, 30);
  return { bookmark };
}

/**
 * One noul per distinct topic (case-insensitive), split into calls of at most
 * `perCall` questions. `keys` maps each normalised topic to its question key.
 */
export function topicRequests(
  bookmark: AutomationBookmark,
  topics: string[],
  perCall = MAX_TOPICS_PER_CALL,
  images?: JevImages | null,
): { requests: JevRequest[]; keys: Map<string, string> } {
  const state = bookmarkState(bookmark, images);
  const keys = new Map<string, string>();
  const requests: JevRequest[] = [];
  for (const topic of topics) {
    const norm = normTopic(topic);
    if (!norm || keys.has(norm)) continue;
    const key = `t${keys.size}`;
    keys.set(norm, key);
    if ((keys.size - 1) % perCall === 0) requests.push({ state, questions: {}, ...(images && { assets: images.assets }) });
    requests[requests.length - 1].questions[key] = {
      type: 'noul',
      instructions: {
        topic: topic.trim(),
        question: 'Is the saved page described in `bookmark` about `topic`?',
      },
      criteria: {
        true: 'The page is mainly about `topic`, or clearly falls under it.',
        false: 'The page is about something else, or only mentions `topic` in passing.',
      },
    };
  }
  return { requests, keys };
}

/** Normalised topic → probability the bookmark is about it. Missing or malformed answers are left out. */
export function topicScores(responses: JevResponse[], keys: Map<string, string>): Map<string, number> {
  const answers = Object.assign({}, ...responses.map((r) => r.answers));
  const scores = new Map<string, number>();
  for (const [norm, key] of keys) {
    const answer = answers[key];
    const p = answer?.type === 'noul' ? Number(answer.noul) : NaN;
    if (Number.isFinite(p) && p >= 0 && p <= 1) scores.set(norm, p);
  }
  return scores;
}

/** The rule's most likely topic, if it clears the rule's threshold. */
export function bestTopic(
  topics: string[],
  scores: Map<string, number>,
  threshold: number,
): { topic: string; confidence: number } | null {
  let best: { topic: string; confidence: number } | null = null;
  for (const topic of topics) {
    const p = scores.get(normTopic(topic));
    if (p !== undefined && (!best || p > best.confidence)) best = { topic: topic.trim(), confidence: p };
  }
  return best && best.confidence >= threshold ? best : null;
}
