/**
 * Run: npm run test:meiliSetup
 *
 * What the server asks a Meilisearch instance to do at start-up, checked against an in-process
 * stand-in that records the requests (it is not a real Meilisearch).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { embedderSettings, prepareMeilisearch, prepareMeilisearchWhenReady } from './meilisearchSetup';
import { meilisearchTargets } from './meilisearchTrash';
import { MEILISEARCH_CONFIG } from '../config/meilisearchConfig';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); }
};

const MANAGED = ['MEILISEARCH_HOST', 'MEILISEARCH_API_KEY', 'MEILISEARCH_HOST_ALT', 'MEILISEARCH_API_KEY_ALT', 'OPENAI_API_KEY',
    'AI_API_KEY', 'AI_API_BASE_URL', 'LITELLM_API_KEY', 'LITELLM_API_BASE_URL', 'EMBEDDING_MODEL'];
const reset = () => { for (const k of MANAGED) delete process.env[k]; };

interface Seen { method: string; url: string; auth?: string; body: any }

function fakeMeilisearch(options: { healthyAfter?: number } = {}) {
    const seen: Seen[] = [];
    let healthChecks = 0;
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
            res.setHeader('content-type', 'application/json');
            if (req.url === '/health') {
                healthChecks++;
                if (healthChecks <= (options.healthyAfter ?? 0)) { res.statusCode = 503; res.end('{"status":"starting"}'); return; }
                res.end('{"status":"available"}'); return;
            }
            // Tasks: every write is accepted; the client then polls /tasks/<uid> if asked to wait.
            res.statusCode = req.url!.startsWith('/experimental-features') ? 200 : 202;
            res.end(JSON.stringify({ taskUid: seen.length, indexUid: 'webbites', status: 'enqueued', type: 'x', enqueuedAt: new Date().toISOString() }));
        });
    });
    return new Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve({
            url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            seen,
            close: () => new Promise((done) => server.close(() => done())),
        })));
}

async function main() {
    console.log('which instances');
    reset();
    check('one instance by default', meilisearchTargets().length === 1);
    process.env.MEILISEARCH_HOST = 'http://meili:7700';
    check('still one with only a primary set', meilisearchTargets().length === 1);
    process.env.MEILISEARCH_HOST_ALT = 'http://meili-two:7700';
    check('a second instance only when one is configured', meilisearchTargets().length === 2);
    process.env.MEILISEARCH_HOST_ALT = 'http://meili:7700';
    check('naming the same host twice is still one instance', meilisearchTargets().length === 1);

    console.log('\nembeddings');
    reset();
    check('no AI configured means no embedder (keyword search only)', embedderSettings() === undefined);
    process.env.OPENAI_API_KEY = 'sk-direct';
    let e: any = embedderSettings();
    check('an OpenAI key embeds with OpenAI directly', e?.apiKey === 'sk-direct' && e?.url === undefined && e?.source === 'openAi');
    check('using the shared model and template', e?.model === MEILISEARCH_CONFIG.embedderConfig.model && e?.documentTemplate === MEILISEARCH_CONFIG.embedderConfig.documentTemplate);
    reset();
    process.env.AI_API_KEY = 'k'; process.env.AI_API_BASE_URL = 'http://llm:4000/';
    e = embedderSettings();
    check('another endpoint is used through its /v1/embeddings', e?.apiKey === 'k' && e?.url === 'http://llm:4000/v1/embeddings', JSON.stringify(e));
    process.env.EMBEDDING_MODEL = 'nomic-embed-text';
    check('EMBEDDING_MODEL changes the model', (embedderSettings() as any)?.model === 'nomic-embed-text');

    console.log('\nsetting up an instance');
    reset();
    const meili = await fakeMeilisearch();
    process.env.MEILISEARCH_HOST = meili.url; process.env.MEILISEARCH_API_KEY = 'secret-key';
    const logs: string[] = [];
    await prepareMeilisearch(meilisearchTargets(), (m) => logs.push(m));
    const by = (method: string, url: string) => meili.seen.filter((r) => r.method === method && r.url === url);
    const create = by('POST', '/indexes')[0];
    check('the index is created with id as its primary key', create?.body?.uid === 'webbites' && create?.body?.primaryKey === 'id', JSON.stringify(create?.body));
    const settings = by('PATCH', '/indexes/webbites/settings')[0]?.body;
    check('searchable attributes are set', JSON.stringify(settings?.searchableAttributes) === JSON.stringify(MEILISEARCH_CONFIG.searchableAttributes));
    check('filterable attributes include the user and trash filters', settings?.filterableAttributes?.includes('user.objectId') && settings?.filterableAttributes?.includes('isDeleted'));
    check('sortable attributes are set', JSON.stringify(settings?.sortableAttributes) === JSON.stringify(MEILISEARCH_CONFIG.sortableAttributes));
    check('tags can have thousands of facet values', settings?.faceting?.maxValuesPerFacet === 10000);
    check('without AI there is no embedder in the settings', !('embedders' in (settings ?? {})));
    const flags = meili.seen.filter((r) => r.url === '/experimental-features').map((r) => Object.keys(r.body)[0]).sort();
    check('both experimental flags are switched on', flags.join() === 'containsFilter,vectorStore', flags.join());
    check('every request carries the key', meili.seen.filter((r) => r.url !== '/health').every((r) => r.auth === 'Bearer secret-key'));
    check('it reports keyword-only search', logs.some((m) => /keyword search only/.test(m)));

    meili.seen.length = 0;
    process.env.OPENAI_API_KEY = 'sk-direct';
    await prepareMeilisearch(meilisearchTargets(), () => {});
    const withAi = by('PATCH', '/indexes/webbites/settings')[0]?.body;
    check('with an OpenAI key the embedder is part of the settings', withAi?.embedders?.openai?.apiKey === 'sk-direct');

    console.log('\nwaiting for Meilisearch to come up');
    await meili.close();
    reset();
    const slow = await fakeMeilisearch({ healthyAfter: 2 });
    process.env.MEILISEARCH_HOST = slow.url; process.env.MEILISEARCH_API_KEY = 'secret-key';
    const ready = await prepareMeilisearchWhenReady({ attempts: 6, delayMs: 20, log: () => {} });
    check('it retries until the instance is healthy, then sets it up', ready === true && slow.seen.some((r) => r.url === '/indexes/webbites/settings'));
    await slow.close();

    reset();
    process.env.MEILISEARCH_HOST = 'http://127.0.0.1:9';
    const t0 = Date.now();
    const gaveUp = await prepareMeilisearchWhenReady({ attempts: 2, delayMs: 10, log: () => {} });
    check('an instance that never answers gives up quietly instead of throwing', gaveUp === false && Date.now() - t0 < 5000);

    console.log(`\nmeiliSetup: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
