/**
 * Tests for the Meilisearch sync planner. Worth pinning because the failure is
 * silent: handing back a backup made from old text leaves a bookmark findable
 * by what it used to say, and not handing one back re-bills OpenAI. Run:
 *
 *   npm run test:meiliSyncPlan
 */

import { decodeVector, encodeVector, planTarget, textHash, toIndexDocument, type Backup } from './meilisearchSyncPlan';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const KEY = 'embedder-a';
const doc = (id: string, over: Record<string, any> = {}) => ({ id, userId: 'u1', siteTitle: `title ${id}`, siteBody: 'body', tags: ['x'], favorited: false, ...over });
const backupOf = (d: ReturnType<typeof doc>, key = KEY): Backup => ({ textHash: textHash(d, key), vector: encodeVector([0.5, -0.25]) });
const ids = (list: Array<{ doc: { id: string } }>) => list.map((w) => w.doc.id).sort().join(',');

// Vectors survive the round trip exactly (Meilisearch stores f32).
const f32 = Array.from(new Float32Array([0.1, -0.2, 0.30000001, 1e-8]));
check('vector round-trips', JSON.stringify(decodeVector(encodeVector(f32))) === JSON.stringify(f32));

// In sync: nothing to write, remove or back up once backed up.
{
    const a = doc('a');
    const plan = planTarget([a], new Map([['a', { ...a }]]), new Map([['a', backupOf(a)]]), KEY);
    check('in sync writes nothing', plan.write.length === 0 && plan.remove.length === 0 && plan.backUp.length === 0);
}

// Key order in the index doesn't count as a difference.
{
    const a = doc('a');
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    check('key order ignored', planTarget([a], new Map([['a', reordered]]), new Map(), KEY).write.length === 0);
}

// Missing from the index, with a matching backup: written with the embedding.
{
    const a = doc('a');
    const plan = planTarget([a], new Map(), new Map([['a', backupOf(a)]]), KEY);
    check('missing doc is written', ids(plan.write) === 'a');
    check('missing doc gets its backup', plan.write[0].vector === backupOf(a).vector);
    const sent = toIndexDocument(plan.write[0]);
    check('backup sent with regenerate: true', sent._vectors.openai.regenerate === true && sent._vectors.openai.embeddings[0][1] === -0.25);
}

// Text changed since the backup: written without it, so Meilisearch re-embeds.
{
    const old = doc('a');
    const now = doc('a', { siteTitle: 'renamed' });
    const plan = planTarget([now], new Map(), new Map([['a', backupOf(old)]]), KEY);
    check('stale backup not handed back', plan.write.length === 1 && plan.write[0].vector === undefined);
    check('no _vectors without a backup', !('_vectors' in toIndexDocument(plan.write[0])));
}

// A backup from an embedder set up differently is never handed back.
{
    const a = doc('a');
    const plan = planTarget([a], new Map(), new Map([['a', backupOf(a, 'embedder-b')]]), KEY);
    check('other embedder config not reused', plan.write[0].vector === undefined);
}

// A non-text field drifted: rewritten, but the index keeps its own embedding.
{
    const a = doc('a', { favorited: true });
    const plan = planTarget([a], new Map([['a', doc('a')]]), new Map([['a', backupOf(a)]]), KEY);
    check('drifted doc rewritten', ids(plan.write) === 'a');
    check('drifted doc keeps index embedding', plan.write[0].vector === undefined);
}

// The index has stale text: rewritten, and the backup made elsewhere from the new text is used.
{
    const now = doc('a', { siteBody: 'new body' });
    const plan = planTarget([now], new Map([['a', doc('a')]]), new Map([['a', backupOf(now)]]), KEY);
    check('stale index text gets current backup', plan.write[0].vector === backupOf(now).vector);
    check('stale index embedding not backed up', plan.backUp.length === 0);
}

// Backed up only when the index's text is Parse's text and no backup covers it yet.
{
    const a = doc('a'), b = doc('b'), c = doc('c');
    const index = new Map([['a', a], ['b', b], ['c', doc('c', { siteTitle: 'old' })]]);
    const plan = planTarget([a, b, c], index, new Map([['b', backupOf(b)]]), KEY);
    check('backs up uncovered, current embeddings only', plan.backUp.join(',') === 'a');
}

// In the index but gone from Parse: removed.
{
    const a = doc('a');
    const plan = planTarget([a], new Map([['a', a], ['gone', doc('gone')]]), new Map(), KEY);
    check('extra doc removed', plan.remove.join(',') === 'gone');
    check('extra doc not backed up', !plan.backUp.includes('gone'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
