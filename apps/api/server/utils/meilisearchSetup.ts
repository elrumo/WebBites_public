/**
 * Making a Meilisearch instance ready for WebBites: the index, its settings, and the two
 * instance-level flags the queries rely on. Safe to run on every start: Meilisearch only
 * re-indexes when a setting actually changed.
 */
import { MEILISEARCH_CONFIG } from '../config/meilisearchConfig';
import { meilisearchTargets, type MeiliTarget } from './meilisearchTrash';
import { aiConfigured } from './aiClients';

const { INDEX_NAME } = MEILISEARCH_CONFIG;

/**
 * The embedder that makes semantic search work, or undefined when there is nothing to embed with.
 *
 * Meilisearch calls the embedding service itself, so it needs its own copy of the key. A plain
 * OPENAI_API_KEY means OpenAI directly; otherwise the configured AI endpoint is used.
 */
export function embedderSettings(): Record<string, unknown> | undefined {
    const base = { ...MEILISEARCH_CONFIG.embedderConfig, model: process.env.EMBEDDING_MODEL || MEILISEARCH_CONFIG.embedderConfig.model };
    if (process.env.OPENAI_API_KEY) return { ...base, apiKey: process.env.OPENAI_API_KEY };
    const key = process.env.AI_API_KEY || process.env.LITELLM_API_KEY;
    const root = (process.env.AI_API_BASE_URL || process.env.LITELLM_API_BASE_URL || '').replace(/\/+$/, '');
    if (aiConfigured() && key && root) return { ...base, apiKey: key, url: `${root}/v1/embeddings` };
    return undefined;
}

export async function configureMeilisearchIndex({ client, label }: MeiliTarget, log: (message: string) => void = console.log) {
    const embedder = embedderSettings();
    await client.index(INDEX_NAME).updateSettings({
        searchableAttributes: MEILISEARCH_CONFIG.searchableAttributes,
        filterableAttributes: MEILISEARCH_CONFIG.filterableAttributes,
        sortableAttributes: MEILISEARCH_CONFIG.sortableAttributes,
        faceting: MEILISEARCH_CONFIG.faceting,
        // No embedder means keyword search only; the index still works.
        ...(embedder ? { embedders: { openai: embedder as any } } : {}),
    });

    // Instance-level flags. Sent one at a time: a Meilisearch version that has
    // already stabilised one of them rejects the whole PATCH if both are sent.
    for (const feature of ['vectorStore', 'containsFilter']) {
        const res = await fetch(`${client.config.host}/experimental-features`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.config.apiKey}` },
            body: JSON.stringify({ [feature]: true }),
        }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
        if (!res.ok) log(`[meilisearch] ${label}: could not enable ${feature} (${res.status} ${await res.text()})`);
    }
    log(`[meilisearch] ${label}: settings applied${embedder ? ' (with embeddings)' : ' (keyword search only)'}`);
}

/** Create the index if it is missing and apply the settings, on every configured instance. */
export async function prepareMeilisearch(targets: MeiliTarget[] = meilisearchTargets(), log: (message: string) => void = console.log) {
    for (const target of targets) {
        await target.client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {}); // already exists
        await configureMeilisearchIndex(target, log);
    }
}

/**
 * `prepareMeilisearch` for server start: Meilisearch may still be booting next to us, so wait
 * for it instead of failing. Gives up quietly after `attempts`; search then reports its own error.
 */
export async function prepareMeilisearchWhenReady(options: { attempts?: number; delayMs?: number; log?: (message: string) => void } = {}): Promise<boolean> {
    const { attempts = 30, delayMs = 2000, log = console.log } = options;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const targets = meilisearchTargets();
            await Promise.all(targets.map((t) => t.client.health()));
            await prepareMeilisearch(targets, log);
            return true;
        } catch (error: any) {
            if (attempt === attempts) {
                log(`[meilisearch] could not prepare the search index: ${error?.message || error}`);
                return false;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    return false;
}
