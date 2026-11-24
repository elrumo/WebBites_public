/**
 * Keeping search working while the embedder is down.
 *
 * The `openai` embedder asks OpenAI for an embedding on every document write.
 * When that fails (no credit, an outage) Meilisearch fails the whole write with
 * `vector_embedding_error` — after about 8 minutes of retries, each one holding
 * up the queue — and the bookmark never reaches the index at all, keyword
 * search included.
 *
 * So while the embedder is down a document is written without one. Measured on
 * Meilisearch 1.22:
 *
 * - `_vectors.openai = null` indexes the document at once, never calling the
 *   embedder. It is keyword-searchable, just absent from semantic results.
 * - That opt-out sticks: rewriting the document as normal, even with new text,
 *   leaves it without an embedding.
 * - `_vectors.openai = { regenerate: true }` undoes it — the embedder runs for
 *   a document without one, or whose text changed — and costs nothing for a
 *   document that is already embedded (no OpenAI call). So every normal write
 *   carries it, and any later save or sync heals a bookmark.
 *
 * A skipped document also carries `embeddingSkipped: true`. Parse does not have
 * that field, so the sync sees the document as different and rewrites it, which
 * is how a bookmark nobody edits again gets its embedding once OpenAI is back.
 *
 *   npm run test:meiliEmbedder
 */

import { MEILISEARCH_CONFIG } from '../config/meilisearchConfig';
/** The name the index's embedder is registered under. */
export const EMBEDDER = 'openai';

export type EmbeddingMode = 'embed' | 'skip';

export const SKIPPED_FIELD = 'embeddingSkipped';

/** The document as it should be sent to Meilisearch, for the mode the embedder is in. */
export function withEmbedding<T extends Record<string, any>>(doc: T, mode: EmbeddingMode): T & { _vectors: Record<string, unknown> } {
    if (mode === 'skip') {
        return { ...doc, [SKIPPED_FIELD]: true, _vectors: { [EMBEDDER]: null } };
    }
    // Not `{ ...doc, _vectors }` blindly: a skipped marker never survives a normal write.
    const { [SKIPPED_FIELD]: _dropped, ...rest } = doc;
    return { ...(rest as T), _vectors: { [EMBEDDER]: { regenerate: true } } };
}

export interface EmbedderHealthOptions {
    /** Resolves true when the embedder can embed right now. Must not throw. */
    probe: () => Promise<boolean>;
    now?: () => number;
    /** How long a "working" answer is trusted. */
    upTtlMs?: number;
    /** How long a "down" answer is trusted — short, so recovery is noticed quickly. */
    downTtlMs?: number;
}

export function createEmbedderHealth({ probe, now = Date.now, upTtlMs = 60_000, downTtlMs = 30_000 }: EmbedderHealthOptions) {
    let state: { up: boolean; until: number } | null = null;
    let inFlight: Promise<boolean> | null = null;

    return {
        /** One probe at a time, however many saves ask while it runs. */
        async isUp(): Promise<boolean> {
            if (state && now() < state.until) return state.up;
            inFlight ??= probe()
                .catch(() => false)
                .then((up) => {
                    state = { up, until: now() + (up ? upTtlMs : downTtlMs) };
                    return up;
                })
                .finally(() => { inFlight = null; });
            return inFlight;
        },
        /** A write has just failed on the embedder: don't wait for the next probe to say so. */
        markDown(): void {
            state = { up: false, until: now() + downTtlMs };
        },
    };
}

/**
 * Asks OpenAI for one tiny embedding with the key the index's embedder uses.
 * Without that key here there is nothing to ask, so the embedder is assumed up
 * and a failed write falls back through `markDown` instead.
 */
export async function probeOpenAiEmbedder(): Promise<boolean> {
    const apiKey = (process.env.OPENAI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
    if (!apiKey) return true;
    try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MEILISEARCH_CONFIG.embedderConfig.model, input: 'ok' }),
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) console.warn(`[embedderHealth] OpenAI embeddings probe answered ${response.status}; indexing without embeddings`);
        return response.ok;
    } catch (error: any) {
        console.warn(`[embedderHealth] OpenAI embeddings probe failed (${error?.message || error}); indexing without embeddings`);
        return false;
    }
}

/** The one shared health check for this process. */
export const embedderHealth = createEmbedderHealth({ probe: probeOpenAiEmbedder });
