/**
 * Run: npm run test:jevJudgments
 *
 * Jev outside smart boards: the page check, picking from the user's tags,
 * merging tags, and reranking search hits. No network.
 */
import { jevOn, pageCheckRequest, readPageCheck, tagRequest, pickTags, mergeTags, rerankRequest, rerankBy } from './jevJudgments';
import type { JevResponse } from '../types/jev.types';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const noul = (p: number) => ({ type: 'noul' as const, noul: p });
const reply = (answers: JevResponse['answers']): JevResponse => ({ model: 'jev-1.13.0', answers });

// Flags
{
  delete process.env.JEV_TAGS;
  check('flags: on by default', jevOn('JEV_TAGS'));
  process.env.JEV_TAGS = ' False ';
  check('flags: "false" turns it off', !jevOn('JEV_TAGS'));
  process.env.JEV_TAGS = '0';
  check('flags: anything else leaves it on', jevOn('JEV_TAGS'));
  delete process.env.JEV_TAGS;
}

// Page check
{
  const request = pageCheckRequest('https://news.example/a', null, 'x'.repeat(10_000));
  const page = (request.state as any).page;
  check('page: text capped', page.text.length <= 2501);
  check('page: missing title is empty', page.title === '');
  check('page: two nouls and a language choice', Object.keys(request.questions).join() === 'barrier,article,language'
    && request.questions.barrier.type === 'noul' && request.questions.language.type === 'choice');
  const read = readPageCheck(reply({ barrier: noul(0.91), article: { type: 'choice', choice: 'x', probabilities: {}, confidence: 1 } }));
  check('page: barrier read', read.barrier === 0.91);
  check('page: malformed answer is undefined', read.article === undefined);
  check('page: out of range is undefined', readPageCheck(reply({ barrier: noul(1.2) })).barrier === undefined);

  const picked = (choice: string, p: number): JevResponse =>
    reply({ language: { type: 'choice', choice, probabilities: { [choice]: p }, confidence: p } });
  check('language: a clear pick is read', readPageCheck(picked('de', 0.95)).language === 'de');
  check('language: an unclear pick is unset', readPageCheck(picked('de', 0.5)).language === undefined);
  check('language: other is unset', readPageCheck(picked('other', 0.99)).language === undefined);
  check('language: an unlisted code is unset', readPageCheck(picked('xx', 0.99)).language === undefined);
  check('language: no answer is unset', readPageCheck(reply({})).language === undefined);
}

// Tags
{
  const tags = ['Cooking', 'Travel', 'Italian', 'Finance', 'Pasta', 'Recipes', 'Dinner'];
  const request = tagRequest({ title: 'Weeknight pasta', text: '' }, tags);
  check('tags: a noul per tag', Object.keys(request.questions).length === tags.length);
  check('tags: tag travels in the instructions', (request.questions.t2.instructions as any).tag === 'Italian');
  check('tags: empty fields left out of the state', !('text' in (request.state as any).page));
  check('tags: no pictures, no assets', !('assets' in request) && !('images' in (request.state as any).page));

  const pictures = { refs: ['ref-1'], assets: { 'ref-1': { type: 'image' as const, format: 'jpg' as const, data_base64: 'AAAA' } } };
  const seen = tagRequest({ title: 'Untitled', text: '' }, tags, pictures);
  check('tags: pictures go in the page state', (seen.state as any).page.images[0] === 'ref-1' && (seen.state as any).page.title === 'Untitled');
  check('tags: pictures travel as assets', seen.assets?.['ref-1']?.data_base64 === 'AAAA');
  delete process.env.JEV_IMAGES;
  check('tags: JEV_IMAGES is on by default', jevOn('JEV_IMAGES'));
  process.env.JEV_IMAGES = 'false';
  check('tags: JEV_IMAGES=false turns pictures off', !jevOn('JEV_IMAGES'));
  delete process.env.JEV_IMAGES;

  const response = reply({ t0: noul(0.9), t1: noul(0.1), t2: noul(0.8), t4: noul(0.95), t5: noul(0.76), t6: noul(0.85), t3: noul(0.74) });
  const picked = pickTags(response, tags);
  check('tags: best first, at most 5', picked.join() === 'Pasta,Cooking,Dinner,Italian,Recipes');
  check('tags: under 0.75 left out', !picked.includes('Finance') && !picked.includes('Travel'));
  check('tags: no answers, no picks', pickTags(reply({}), tags).length === 0);
}

// Merge
{
  const merged = mergeTags(['my tag', 'AI'], ['Cooking', 'machine learning', 'ai', ' ', 'Pasta'], ['cooking', 'Machine Learning']);
  check('merge: row tags kept as they are', merged[0] === 'my tag' && merged[1] === 'AI');
  check('merge: new tags take the user\'s spelling', merged.includes('cooking') && merged.includes('Machine Learning'));
  check('merge: case-insensitive duplicates dropped', merged.filter((t) => t.toLowerCase() === 'ai').length === 1);
  check('merge: blanks dropped, new tags kept', merged.join() === 'my tag,AI,cooking,Machine Learning,Pasta');
}

// Rerank
{
  const hits = [
    { objectId: 'a', siteTitle: 'Tax guide', url: 'https://a' },
    { objectId: 'b', siteTitle: 'Sourdough starter', aiSummary: { tldr: 'How to feed a starter' }, tags: ['Baking'] },
    { objectId: 'c', siteDescription: 'Bread recipes' },
    { objectId: 'd', siteTitle: 'Unanswered' },
  ];
  const request = rerankRequest('how do I keep my sourdough alive', hits);
  const state = request.state as any;
  check('rerank: hits listed in search order', state.bookmarks.length === 4 && state.bookmarks[1].summary === 'How to feed a starter');
  check('rerank: a noul per hit, pointing at its index', (request.questions.h2.instructions as string).includes('bookmarks[2]'));
  const order = rerankBy(hits, reply({ h0: noul(0.05), h1: noul(0.97), h2: noul(0.6) })).map((h) => h.objectId).join();
  check('rerank: ordered by probability, unanswered last', order === 'b,c,a,d');
  const ties = rerankBy(hits, reply({ h0: noul(0.5), h1: noul(0.5), h2: noul(0.5), h3: noul(0.5) })).map((h) => h.objectId).join();
  check('rerank: ties keep the search order', ties === 'a,b,c,d');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
