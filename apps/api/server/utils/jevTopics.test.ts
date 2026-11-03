/**
 * Run: npm run test:jevTopics
 *
 * AI-topic matching with Jev: the requests built from a bookmark, how answers
 * become per-topic probabilities and threshold hits, and that askJev goes
 * through the LiteLLM proxy's TypeSafe pass-through with the LiteLLM key.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bookmarkState, topicRequests, topicScores, bestTopic } from './jevTopics';
import { askJev, getJevModel, withImageFallback } from './aiClients';
import type { AutomationBookmark } from '../types/automation.types';
import type { JevImages, JevResponse } from '../types/jev.types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const recipe: AutomationBookmark = {
  id: 'w1', url: 'https://food.example/pasta', title: 'Weeknight pasta', description: '',
  type: 'article', tags: ['Cooking', 'Italian'], summary: 'A 20-minute tomato pasta.',
};

const noul = (p: number) => ({ type: 'noul' as const, noul: p });
const reply = (answers: JevResponse['answers']): JevResponse => ({ model: 'jev-1.13.0', answers });

// State
{
  const { bookmark } = bookmarkState(recipe) as { bookmark: Record<string, unknown> };
  check('state: empty fields left out', !('description' in bookmark));
  check('state: keeps title, summary, url, type, tags', ['title', 'summary', 'url', 'type', 'tags'].every((k) => k in bookmark));
  const long = bookmarkState({ ...recipe, description: 'x'.repeat(5000), tags: Array.from({ length: 50 }, (_, i) => `t${i}`) }) as any;
  check('state: long description capped', long.bookmark.description.length <= 1001);
  check('state: tags capped at 30', long.bookmark.tags.length === 30);
  const withText = bookmarkState({ ...recipe, excerpt: 'y'.repeat(9000) }) as any;
  check('state: page excerpt included, capped', withText.bookmark.excerpt.length <= 2001);
}

// Requests
{
  const { requests, keys } = topicRequests(recipe, ['Recipes', ' recipes ', 'Travel', '']);
  check('requests: one call', requests.length === 1);
  check('requests: topics deduped case-insensitively, blanks dropped', keys.size === 2 && keys.has('recipes') && keys.has('travel'));
  const q = requests[0].questions[keys.get('recipes')!];
  check('requests: a noul per topic', q.type === 'noul');
  check('requests: topic travels in the instructions', (q.instructions as any).topic === 'Recipes');
  check('requests: state is the bookmark', (requests[0].state as any).bookmark.title === 'Weeknight pasta');
  check('requests: model left to askJev', requests[0].model === undefined);

  const many = topicRequests(recipe, Array.from({ length: 5 }, (_, i) => `topic ${i}`), 2);
  check('requests: split by perCall', many.requests.length === 3 && many.requests.map((r) => Object.keys(r.questions).length).join() === '2,2,1');
  check('requests: keys unique across calls', new Set(many.keys.values()).size === 5);
  check('requests: no topics, no calls', topicRequests(recipe, []).requests.length === 0);
}

// Pictures
const pictures: JevImages = {
  refs: ['ref-1'],
  assets: { 'ref-1': { type: 'image', format: 'jpg', data_base64: 'AAAA' } },
};
{
  const plain = topicRequests(recipe, ['Recipes', 'Travel'], 1);
  check('images: none by default', plain.requests.every((r) => !('assets' in r)) && !('images' in (plain.requests[0].state as any).bookmark));
  const seen = topicRequests(recipe, ['Recipes', 'Travel'], 1, pictures);
  check('images: refs go in the bookmark state', (seen.requests[0].state as any).bookmark.images[0] === 'ref-1');
  check('images: every call carries the assets', seen.requests.length === 2 && seen.requests.every((r) => r.assets?.['ref-1']?.data_base64 === 'AAAA'));
  check('images: other state untouched', (seen.requests[0].state as any).bookmark.title === 'Weeknight pasta');
}

// Answers → scores → hits
{
  const { keys } = topicRequests(recipe, ['Recipes', 'Travel', 'Finance']);
  const scores = topicScores([reply({ t0: noul(0.92), t1: noul(0.04), t2: { type: 'choice', choice: 'x', probabilities: {}, confidence: 1 } })], keys);
  check('scores: noul probabilities read', scores.get('recipes') === 0.92 && scores.get('travel') === 0.04);
  check('scores: wrong answer type ignored', !scores.has('finance'));
  check('scores: out-of-range ignored', !topicScores([reply({ t0: noul(1.4) })], keys).has('recipes'));
  check('scores: answers merged across calls', topicScores([reply({ t0: noul(0.9) }), reply({ t1: noul(0.8) })], keys).size === 2);

  const hit = bestTopic(['Travel', 'Recipes'], scores, 0.6);
  check('hit: best topic over threshold', hit?.topic === 'Recipes' && hit.confidence === 0.92);
  check('hit: nothing under threshold', bestTopic(['Recipes'], scores, 0.95) === null);
  check('hit: unanswered topic never matches', bestTopic(['Finance'], scores, 0) === null);
  check('hit: topic lookup ignores case', bestTopic([' RECIPES'], scores, 0.6)?.topic === 'RECIPES');
}

// askJev goes through LiteLLM
(async () => {
  const seen: { url?: string; auth?: string; tag?: string; images?: string | string[]; body?: any } = {};
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      Object.assign(seen, { url: req.url, auth: req.headers.authorization, tag: req.headers['x-litellm-tags'], images: req.headers['typesafe-danger-zone-images'], body: JSON.parse(raw) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply({ t0: noul(0.7) })));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.LITELLM_API_KEY = 'sk-litellm-test';
  process.env.LITELLM_API_BASE_URL = `http://127.0.0.1:${port}/`;
  delete process.env.LITELLM_JEV_MODEL;
  delete process.env.TYPESAFE_API_KEY;

  const { requests } = topicRequests(recipe, ['Recipes']);
  const result = await askJev(requests[0], 'runAutomations');
  check('askJev: hits the proxy pass-through route', seen.url === '/typesafe/v1/systemone');
  check('askJev: authenticates with the LiteLLM key', seen.auth === 'Bearer sk-litellm-test');
  check('askJev: tags the call', seen.tag === 'runAutomations');
  check('askJev: defaults to jev-latest', seen.body.model === 'jev-latest' && getJevModel() === 'jev-latest');
  check('askJev: returns the answers', (result.answers.t0 as any).noul === 0.7);
  check('askJev: no images header on a text request', seen.images === undefined && !('assets' in seen.body));

  const withPictures = topicRequests(recipe, ['Recipes'], undefined, pictures).requests[0];
  await askJev(withPictures, 'runAutomations');
  check('askJev: opts in to images when the request has them', seen.images === 'true');
  check('askJev: the assets travel in the body', seen.body.assets['ref-1'].data_base64 === 'AAAA' && seen.body.state.bookmark.images[0] === 'ref-1');
  check('askJev: images use the built-in route by default', seen.url === '/typesafe/v1/systemone');

  process.env.LITELLM_JEV_IMAGES_PATH = ' typesafe-images/v1/systemone ';
  await askJev(withPictures);
  check('askJev: LITELLM_JEV_IMAGES_PATH reroutes image requests', seen.url === '/typesafe-images/v1/systemone' && seen.images === 'true');
  await askJev(requests[0]);
  check('askJev: text requests keep the built-in route', seen.url === '/typesafe/v1/systemone');
  delete process.env.LITELLM_JEV_IMAGES_PATH;

  const attempts: Array<JevImages | null> = [];
  const fellBack = await withImageFallback(pictures, async (img) => { attempts.push(img); if (img) throw new Error('400 bad image'); return 'text only'; });
  check('fallback: a failed image request is retried without images', fellBack === 'text only' && attempts.length === 2 && attempts[0] === pictures && attempts[1] === null);
  attempts.length = 0;
  await withImageFallback(null, async (img) => { attempts.push(img); return 1; });
  check('fallback: no images, one plain attempt', attempts.length === 1 && attempts[0] === null);
  const stillDown = await withImageFallback(pictures, async () => { throw new Error('down'); }).then(() => null, (e: Error) => e);
  check('fallback: failing without images too throws', stillDown?.message === 'down');

  process.env.LITELLM_JEV_MODEL = 'jev-1.13.0';
  await askJev(requests[0]);
  check('askJev: LITELLM_JEV_MODEL pins the model', seen.body.model === 'jev-1.13.0');
  server.close();

  const down = createServer((_req, res) => { res.statusCode = 404; res.end('no typesafe route'); });
  await new Promise<void>((resolve) => down.listen(0, '127.0.0.1', resolve));
  process.env.LITELLM_API_BASE_URL = `http://127.0.0.1:${(down.address() as AddressInfo).port}`;
  const error = await askJev(requests[0]).then(() => null, (e: Error) => e);
  check('askJev: proxy errors throw (callers fall back)', !!error && /404/.test(error.message));
  down.close();

  let calls = 0;
  const busy = createServer((_req, res) => {
    calls++;
    if (calls === 1) { res.statusCode = 529; res.end('overloaded'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply({ t0: noul(0.6) })));
  });
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
  process.env.LITELLM_API_BASE_URL = `http://127.0.0.1:${(busy.address() as AddressInfo).port}`;
  const retried = await askJev(requests[0]).catch(() => null);
  check('askJev: retries an overloaded (529) proxy', calls === 2 && (retried?.answers.t0 as any)?.noul === 0.6);
  busy.close();

  delete process.env.LITELLM_API_KEY;
  check('askJev: refuses without the proxy', await askJev(requests[0]).then(() => false, () => true));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
