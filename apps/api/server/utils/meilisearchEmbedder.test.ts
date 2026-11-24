/**
 * Tests for indexing while the embedder is down. Run:
 *
 *   npm run test:meiliEmbedder
 *
 * The `_vectors` shapes are not guesses: each was measured against
 * Meilisearch 1.22 (see the header of `meilisearchEmbedder.ts`).
 */

import { withEmbedding, createEmbedderHealth, SKIPPED_FIELD, EMBEDDER } from './meilisearchEmbedder';
import { planTarget, toIndexDocument } from './meilisearchSyncPlan';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const doc = { id: 'a', userId: 'u1', siteTitle: 'byearc', tags: ['x'] };

// Embedder up: the document is embedded as normal, and asks to be (re)embedded.
{
    const sent = withEmbedding(doc, 'embed');
    check('embed mode asks to regenerate', (sent._vectors[EMBEDDER] as any).regenerate === true);
    check('embed mode sends no embedding itself', (sent._vectors[EMBEDDER] as any).embeddings === undefined);
    check('embed mode keeps the document', sent.siteTitle === 'byearc' && sent.id === 'a');
    check('embed mode is not marked skipped', !(SKIPPED_FIELD in sent));
}

// Embedder down: opted out, and marked so the sync can find it later.
{
    const sent = withEmbedding(doc, 'skip');
    check('skip mode opts out with null', sent._vectors[EMBEDDER] === null);
    check('skip mode marks the document', (sent as any)[SKIPPED_FIELD] === true);
    check('skip mode keeps the document', sent.siteTitle === 'byearc' && sent.id === 'a');
}

// A marker from an earlier skipped write never survives a normal one.
{
    const sent = withEmbedding({ ...doc, [SKIPPED_FIELD]: true }, 'embed');
    check('normal write drops the skipped marker', !(SKIPPED_FIELD in sent));
}

check('input is not mutated', !('_vectors' in doc) && !(SKIPPED_FIELD in doc));

// The sync: a skipped document is seen as different from Parse's, so it is rewritten.
{
    const skipped = { ...doc, [SKIPPED_FIELD]: true };
    const plan = planTarget([doc], new Map([['a', skipped]]), new Map(), 'k');
    check('sync rewrites a skipped document', plan.write.length === 1 && plan.write[0].doc.id === 'a');
    const healed = toIndexDocument(plan.write[0], true);
    check('sync heals it by asking for an embedding', (healed._vectors[EMBEDDER] as any).regenerate === true && !(SKIPPED_FIELD in healed));
    const stillDown = toIndexDocument(plan.write[0], false);
    check('sync leaves it skipped while the embedder is down', stillDown._vectors[EMBEDDER] === null && stillDown[SKIPPED_FIELD] === true);
}

// A backed-up embedding is handed back even while the embedder is down (no OpenAI call needed).
{
    const sent = toIndexDocument({ doc: { ...doc, [SKIPPED_FIELD]: true }, vector: Buffer.from(new Float32Array([0.5]).buffer).toString('base64') }, false);
    check('a backup is sent as an embedding in either mode', Array.isArray((sent._vectors[EMBEDDER] as any).embeddings) && !(SKIPPED_FIELD in sent));
}

(async () => {
    // Health: probed once, cached, and a down answer is re-checked sooner than an up one.
    let clock = 0, probes = 0, answer = true;
    const health = createEmbedderHealth({
        probe: async () => { probes++; await new Promise((r) => setTimeout(r, 5)); return answer; },
        now: () => clock, upTtlMs: 60_000, downTtlMs: 30_000,
    });

    const concurrent = await Promise.all([health.isUp(), health.isUp(), health.isUp()]);
    check('concurrent callers share one probe', probes === 1 && concurrent.every(Boolean));

    clock = 59_000;
    await health.isUp();
    check('an up answer is cached', probes === 1);

    clock = 61_000; answer = false;
    check('an expired answer is probed again', (await health.isUp()) === false && probes === 2);

    clock = 80_000;
    await health.isUp();
    check('a down answer is cached', probes === 2);

    clock = 92_000; answer = true;
    check('a down answer expires sooner, so recovery is noticed', (await health.isUp()) === true && probes === 3);

    health.markDown();
    check('markDown takes effect without a probe', (await health.isUp()) === false && probes === 3);

    // A probe that throws is "down", never an exception for the save.
    const throwing = createEmbedderHealth({ probe: async () => { throw new Error('boom'); }, now: () => clock });
    check('a throwing probe reads as down', (await throwing.isUp()) === false);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
