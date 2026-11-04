/**
 * Jev questions outside smart boards (those live in jevTopics.ts): is an
 * extracted page a wall, which of the user's tags fit a page, and how well
 * search hits answer a query. Pure: builds requests and reads answers;
 * askJev (aiClients.ts) makes the call.
 */
import type { JevImages, JevRequest, JevResponse } from '../types/jev.types';
import { CONTENT_LANGUAGES, contentLanguageName } from './aiLanguage';

/** Every feature here is on unless its flag is set to `false`. */
export const jevOn = (flag: 'JEV_PAGE_CHECK' | 'JEV_TAGS' | 'JEV_SEARCH_RERANK' | 'JEV_IMAGES') =>
  process.env[flag]?.trim().toLowerCase() !== 'false';

/** How many of the user's own tags Jev weighs for one page. */
export const JEV_TAG_POOL = 150;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/** A noul's probability, or undefined when it is missing or malformed. */
function noul(response: JevResponse, key: string): number | undefined {
  const answer = response.answers[key];
  const p = answer?.type === 'noul' ? Number(answer.noul) : NaN;
  return Number.isFinite(p) && p >= 0 && p <= 1 ? p : undefined;
}

// ─── Page check ───────────────────────────────────────────────────────────────

export type PageCheck = { barrier?: number; article?: number; language?: string };

/** The language is left unset unless Jev puts at least this much on its pick. */
const LANGUAGE_AT = 0.7;

/** Two nouls and a choice about one extraction: is it a wall instead of content, is it an article, and what language is it in. */
export function pageCheckRequest(url: string, title: string | null | undefined, text: string): JevRequest {
  return {
    state: { page: { url: clip(url, 500), title: clip(title || '', 300), text: clip(text, 2500) } },
    questions: {
      barrier: {
        type: 'noul',
        instructions: "Is `page.text` a barrier or placeholder shown instead of the page's own content?",
        criteria: {
          true: 'It is mostly a cookie or consent notice, a login or sign-up prompt, a paywall or subscribe teaser, '
            + 'a bot check or captcha ("Just a moment…", "Verify you are human"), an error or "page not found" message, '
            + 'or an "enable JavaScript" / app-loading shell.',
          false: "It is the page's own content (an article, product, post, documentation, listing…), "
            + 'even if a short notice or menu text is mixed in.',
        },
      },
      article: {
        type: 'noul',
        instructions: 'Is `page.text` an article meant to be read: news, a blog post, an essay, a guide or a tutorial?',
        criteria: {
          true: 'Mostly continuous prose written to be read from start to end.',
          false: 'A product page, homepage, listing, search results, app, profile, index or other page that is not an article.',
        },
      },
      language: {
        type: 'choice',
        instructions: 'Which language is `page.text` written in?',
        criteria: { ...CONTENT_LANGUAGES, other: 'Any other language, or no real text.' },
      },
    },
  };
}

/** The chosen language's code, or undefined when it is unknown, `other` or not clear-cut. */
function language(response: JevResponse): string | undefined {
  const answer = response.answers.language;
  if (answer?.type !== 'choice' || !contentLanguageName(answer.choice)) return undefined;
  return Number(answer.probabilities?.[answer.choice]) >= LANGUAGE_AT ? answer.choice : undefined;
}

export const readPageCheck = (response: JevResponse): PageCheck => ({
  barrier: noul(response, 'barrier'),
  article: noul(response, 'article'),
  language: language(response),
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

/**
 * One noul per existing user tag, about the page. Keys are `t<index into tags>`.
 * `images` puts the page's pictures in the state, so Jev sees what the text cannot say.
 */
export function tagRequest(
  page: { title?: string; description?: string; url?: string; text?: string },
  tags: string[],
  images?: JevImages | null,
): JevRequest {
  const state: Record<string, unknown> = {};
  if (page.title) state.title = clip(page.title, 300);
  if (page.description) state.description = clip(page.description, 1000);
  if (page.url) state.url = clip(page.url, 500);
  if (page.text) state.text = clip(page.text, 2500);
  if (images) state.images = images.refs;
  const questions: JevRequest['questions'] = {};
  tags.forEach((tag, i) => {
    questions[`t${i}`] = {
      type: 'noul',
      instructions: { tag, question: 'Would `tag` be a fitting label for the saved page in `page`?' },
      criteria: {
        true: 'Someone browsing this tag would expect to find this page under it.',
        false: 'The page is not about `tag`, or only mentions it in passing.',
      },
    };
  });
  return { state: { page: state }, questions, ...(images && { assets: images.assets }) };
}

/** The tags at P ≥ `min`, best first, at most `max`. */
export function pickTags(response: JevResponse, tags: string[], max = 5, min = 0.75): string[] {
  return tags
    .map((tag, i) => ({ tag, p: noul(response, `t${i}`) ?? -1 }))
    .filter((x) => x.p >= min)
    .sort((a, b) => b.p - a.p)
    .slice(0, max)
    .map((x) => x.tag);
}

/**
 * The row's tags stay as they are. New tags that only differ from one of the
 * user's tags in case take the user's spelling. Duplicates are dropped
 * case-insensitively.
 */
export function mergeTags(existing: string[], added: string[], userTags: string[]): string[] {
  const spelling = new Map(userTags.map((t) => [t.toLowerCase(), t]));
  const out = new Map<string, string>();
  const add = (tag: unknown, respell: boolean) => {
    if (typeof tag !== 'string' || !tag.trim()) return;
    const key = tag.trim().toLowerCase();
    if (!out.has(key)) out.set(key, (respell && spelling.get(key)) || tag.trim());
  };
  existing.forEach((tag) => add(tag, false));
  added.forEach((tag) => add(tag, true));
  return [...out.values()];
}

// ─── Search rerank ────────────────────────────────────────────────────────────

type SearchHit = { siteTitle?: string; siteDescription?: string; url?: string; tags?: string[]; aiSummary?: any };

/** One noul per hit, all in one call. The state lists the hits in search order. */
export function rerankRequest(query: string, hits: SearchHit[]): JevRequest {
  const bookmarks = hits.map((hit) => {
    const b: Record<string, unknown> = {};
    if (hit.siteTitle) b.title = clip(hit.siteTitle, 200);
    if (hit.siteDescription) b.description = clip(hit.siteDescription, 300);
    if (hit.aiSummary?.tldr) b.summary = clip(String(hit.aiSummary.tldr), 300);
    if (hit.url) b.url = clip(hit.url, 200);
    if (hit.tags?.length) b.tags = hit.tags.slice(0, 10);
    return b;
  });
  const questions: JevRequest['questions'] = {};
  hits.forEach((_, i) => {
    questions[`h${i}`] = {
      type: 'noul',
      instructions: `Is \`bookmarks[${i}]\` something the user is looking for with the search \`query\`?`,
      criteria: {
        true: 'The bookmark is about what the search describes, or is the specific page the search is trying to find.',
        false: 'The bookmark is about something else, or only shares a word with the search.',
      },
    };
  });
  return { state: { query: clip(query, 300), bookmarks }, questions };
}

/** Hits by P(yes), best first. Ties and unanswered hits keep the search engine's order. */
export function rerankBy<T>(hits: T[], response: JevResponse): T[] {
  return hits
    .map((hit, i) => ({ hit, p: noul(response, `h${i}`) ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .map((x) => x.hit);
}
