/**
 * Tests for the reader-body extraction layer.
 *
 * The regression these guard against: bookmarks whose reader body opened with
 * `Skip to content {"props":{"docsUrl":...}}` — the old fallback read
 * `document.body.textContent`, which walks straight into the hydration payloads
 * that React/Next/GitHub pages embed. Run with:
 *
 *   npm run test:contentExtraction
 */

import { extractContent, findAmpUrl, htmlToText, stripJsonBlobs, parseImageMarker, MIN_CONTENT_LENGTH } from './contentExtraction';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } };

const LOREM = 'The reader pipeline stores a simplified article body so the web modal and the native reader render from one source of truth. ';

// --- The exact shape that produced the bug: app shell + hydration payloads ---
const appShell = `<!doctype html><html><head><title>anvme/bunnycdn-mcp</title>
<meta name="description" content="MCP server for BunnyCDN."></head>
<body>
<a href="#start">Skip to content</a>
<script type="application/json" data-target="react-app.embeddedData">{"props":{"docsUrl":"https://docs.github.com/get-started/accessibility/keyboard-shortcuts"}}</script>
<script type="application/json">{"props":{"color_mode":"auto","logged_in":false,"login_path":"/login","auth_type":"LOG_UP"}}</script>
<script>window.__DATA__ = {"boot":{"flags":["copilot_chat","billing_v2"]}};</script>
<nav class="navbar">Product Solutions Pricing Sign in Sign up</nav>
<main>
<h1>bunnycdn-mcp</h1>
<p>${LOREM}${LOREM}</p>
<h2>Installation</h2>
<p>${LOREM}</p>
<ul><li>bunny_get_account — get account details and balance</li></ul>
<blockquote>Requires a BunnyCDN API key.</blockquote>
<noscript>You need JavaScript enabled to use this site.</noscript>
</main>
<footer class="footer">Terms Privacy Security Status</footer>
<style>.navbar{display:flex}</style>
</body></html>`;

const shell = extractContent(appShell, 'https://github.com/anvme/bunnycdn-mcp');
check('app shell: extracts something', shell.text.length >= MIN_CONTENT_LENGTH);
check('app shell: no hydration JSON in text', !/"props"|docsUrl|__DATA__|copilot_chat/.test(shell.text));
check('app shell: no hydration JSON in html', !/"props"|docsUrl|__DATA__/.test(shell.html));
check('app shell: no noscript text', !shell.text.includes('JavaScript enabled'));
check('app shell: no inline css', !shell.text.includes('display:flex'));
check('app shell: keeps real prose', shell.text.includes('simplified article body'));
check('app shell: keeps list item', shell.text.includes('bunny_get_account'));
check('app shell: emits block markup', /<(p|h[1-4]|li|blockquote)>/.test(shell.html));

// --- A repeated hero image and a paragraph echoed later in the article ---
const duplicatedArticle = `<!doctype html><html><head><title>Duplicated</title></head><body>
<article>
<h1>Release notes</h1>
<img src="/hero.jpg">
<p>${LOREM}</p>
<h2>Installation</h2>
<p>${LOREM}${LOREM}</p>
<img src="/hero.jpg">
<p>${LOREM}</p>
</article>
</body></html>`;
const duplicated = extractContent(duplicatedArticle, 'https://example.com/dup');
check('duplicated content: strategy is readability', duplicated.strategy === 'readability');
check('duplicated content: only one hero image kept', (duplicated.html.match(/<img/g) || []).length === 1);
check('duplicated content: repeated paragraph collapsed to one',
    (duplicated.html.match(/<p>/g) || []).length === 2);

// --- Div soup with no <p>: the DOM fallback has to carry it ---
const divSoup = `<!doctype html><html><head><title>Dashboard</title></head><body>
<script type="application/json">{"props":{"user":{"id":42},"routes":["/a","/b"]}}</script>
<nav>Home Docs Pricing Login</nav>
<div id="content">
<h1>Release notes</h1>
<div>${LOREM}${LOREM}</div>
<div>${LOREM}</div>
</div>
<footer>Terms Privacy</footer></body></html>`;

const soup = extractContent(divSoup, 'https://example.com/notes');
check('div soup: extracts something', soup.text.length >= MIN_CONTENT_LENGTH);
check('div soup: no hydration JSON', !/"props"|"routes"/.test(soup.text));
check('div soup: keeps real prose', soup.text.includes('simplified article body'));

// --- Table-based page: Readability usually declines, fallback must not ---
const tablePage = `<!doctype html><html><head><title>Changelog</title></head><body>
<script>{"config":{"a":1,"b":"padding padding padding"}}</script>
<table><tr><td>${LOREM}</td></tr><tr><td>${LOREM}</td></tr><tr><td>${LOREM}</td></tr></table>
</body></html>`;
const table = extractContent(tablePage, 'https://example.com/changelog');
check('table page: no hydration JSON', !/"config"/.test(table.text));

// --- Short but real content must survive, not fall through to nothing ---
const shortPage = `<!doctype html><html><head><title>Note</title></head><body>
<script>{"props":{"a":1,"b":"padding padding padding padding padding"}}</script>
<main><div role="grid"><div role="row"><div role="gridcell">A short note that is well under the preferred content length but is still the real content of the page.</div></div></div></main>
</body></html>`;
const short = extractContent(shortPage, 'https://example.com/note');
check('short page: keeps the real text', short.text.includes('short note'));
check('short page: no hydration JSON', !/"props"|padding/.test(short.text));
check('short page: not reported as empty', short.strategy !== 'none');

// A short page WITH a description prefers whichever is more informative.
const shortWithMeta = `<!doctype html><html><head><title>Note</title>
<meta name="description" content="A description that is considerably longer than the tiny body text on this page."></head>
<body><main><span>Tiny.</span></main></body></html>`;
const shortMeta = extractContent(shortWithMeta, 'https://example.com/note2');
check('short page + meta: picks the longer text', shortMeta.text.includes('considerably longer'));

// --- Pure app shell: nothing readable, so fall back to the description ---
const empty = `<!doctype html><html><head><title>App</title>
<meta property="og:description" content="Webbites saves the readable text of every page you keep."></head>
<body><div id="root"></div>
<script>{"props":{"a":1,"b":"lots and lots of hydration payload padding here"}}</script>
</body></html>`;
const meta = extractContent(empty, 'https://example.com/app');
check('app-only page: uses metadata', meta.strategy === 'metadata');
check('app-only page: description not JSON', meta.text === 'Webbites saves the readable text of every page you keep.');
check('app-only page: title kept', meta.title === 'App');

// --- Paywall: teaser in the DOM, full article in JSON-LD ---
const paywalled = `<!doctype html><html><head><title>Paywalled</title>
<link rel="amphtml" href="/amp/story">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Paper"},{"@type":"NewsArticle","headline":"The real headline","author":[{"@type":"Person","name":"Ada Lovelace"}],"articleBody":"${LOREM}${LOREM}\\n\\n${LOREM}"}]}</script>
</head><body><article><h1>Teaser</h1><p>Subscribe to keep reading.</p></article></body></html>`;

const wall = extractContent(paywalled, 'https://paper.example/story');
check('json-ld: used when the DOM is a teaser', wall.strategy === 'json-ld');
check('json-ld: carries the full body', wall.text.includes('simplified article body') && !wall.text.includes('Subscribe'));
check('json-ld: keeps headline and author', wall.title === 'The real headline' && wall.byline === 'Ada Lovelace');
check('json-ld: splits paragraphs', wall.html.split('<p>').length - 1 === 2);
check('json-ld: readability still wins when longer',
  extractContent(paywalled.replace('Subscribe to keep reading.', LOREM.repeat(6)), 'https://paper.example/story').strategy === 'readability');
check('json-ld: malformed block is ignored',
  extractContent('<script type="application/ld+json">{not json</script><body><p>x</p></body>', 'https://a.b').strategy !== 'json-ld');

// --- JSON-LD image markers (The Verge, Vox): `[Image: caption https://…]` ---
const withImages = paywalled.replace(`"articleBody":"${LOREM}${LOREM}`,
  `"articleBody":"${LOREM}${LOREM}\\n[Image: The old homepage. https://cdn.example/a.jpg?quality=90&strip=all]\\n[Image: https://cdn.example/b.jpg]`);
const pictured = extractContent(withImages, 'https://paper.example/story');
check('image marker: becomes an <img>', pictured.html.includes('<img src="https://cdn.example/a.jpg?quality=90&amp;strip=all"'));
check('image marker: caption becomes a figcaption', pictured.html.includes('<figcaption>The old homepage.</figcaption>'));
check('image marker: no caption, no figcaption', pictured.html.includes('<figure><img src="https://cdn.example/b.jpg" alt="" /></figure>'));
check('image marker: no literal marker left', !pictured.html.includes('[Image:'));
check('image marker: kept out of the text', !pictured.text.includes('[Image:') && !pictured.text.includes('cdn.example'));
check('image marker: parse', parseImageMarker('[Image: Cap https://x.y/z.png]')?.url === 'https://x.y/z.png');
check('image marker: prose is not a marker', parseImageMarker('See [Image: x https://x.y/z.png] above') === null);

check('amp: resolves relative href', findAmpUrl(paywalled, 'https://paper.example/story') === 'https://paper.example/amp/story');
check('amp: attribute order does not matter',
  findAmpUrl('<link href="https://x.y/amp" rel="amphtml">', 'https://x.y/') === 'https://x.y/amp');
check('amp: absent', findAmpUrl('<link rel="canonical" href="/x">', 'https://x.y/') === null);

// --- Truly empty input ---
const nothing = extractContent('', 'https://example.com');
check('empty html: strategy none', nothing.strategy === 'none' && nothing.text === '');
const blank = extractContent('<html><body></body></html>', 'https://example.com');
check('blank body: strategy none', blank.strategy === 'none' && blank.text === '');

// --- htmlToText: the primitive the whole thing rests on ---
check('htmlToText drops script bodies',
  !htmlToText('<p>hi</p><script>var x = {"a":1};</script>').includes('"a"'));
check('htmlToText drops style bodies',
  !htmlToText('<p>hi</p><style>.a{color:red}</style>').includes('color:red'));
check('htmlToText drops noscript',
  !htmlToText('<p>hi</p><noscript>enable js</noscript>').includes('enable js'));
check('htmlToText decodes entities',
  htmlToText('<p>a&nbsp;&amp;&nbsp;b</p>') === 'a & b');
check('htmlToText decodes named and hex references once',
  htmlToText('<p>it&rsquo;s &#x2019; &hellip; &amp;lt;</p>') === 'it’s ’ … &lt;');
check('htmlToText keeps paragraph breaks',
  htmlToText('<p>one</p><p>two</p>').split('\n').filter(Boolean).length === 2);
check('htmlToText respects limit',
  htmlToText('<p>abcdefghij</p>', 4).length === 4);
check('htmlToText handles null', htmlToText(null as any) === '');

check('stripJsonBlobs removes payloads',
  !stripJsonBlobs('Skip to content {"props":{"docsUrl":"https://x"}} Real text').includes('docsUrl'));
check('stripJsonBlobs keeps surrounding prose',
  stripJsonBlobs('Skip to content {"props":{"a":1}} Real text').includes('Real text'));
check('stripJsonBlobs leaves plain prose alone',
  stripJsonBlobs('A sentence with { a brace } in it.') === 'A sentence with { a brace } in it.');

// --- looksLikeBadExtraction: what the re-extraction migration selects on ---
import { looksLikeBadExtraction } from './contentExtraction';

const SCREENSHOT_BODY = 'Skip to content {"props":{"docsUrl":"https://docs.github.com/get-started/accessibility/keyboard-shortcuts"}} {"props":{"color_mode":"auto","logged_in":false}} MCP server for BunnyCDN.';

check('detector: flags the hydration-payload body',
  looksLikeBadExtraction(SCREENSHOT_BODY).reason === 'hydration-payload');
check('detector: flags inline script leftovers',
  looksLikeBadExtraction('window.__NEXT_DATA__ = {}; and some text').reason === 'inline-script');
check('detector: flags inline css',
  looksLikeBadExtraction('.navbar{display:flex;padding:0;} then text').reason === 'inline-css');
check('detector: flags a long body with no paragraph breaks',
  looksLikeBadExtraction('word '.repeat(400)).reason === 'no-paragraph-breaks');

check('detector: passes a clean article',
  !looksLikeBadExtraction('A real article.\n\nWith paragraph breaks and ordinary prose.').bad);
check('detector: passes a short flat line',
  !looksLikeBadExtraction('A short note with no line breaks.').bad);
check('detector: passes empty and null',
  !looksLikeBadExtraction('').bad && !looksLikeBadExtraction(null).bad && !looksLikeBadExtraction(undefined).bad);

// A repaired body must not re-trip the detector, or the migration would loop.
const repaired = extractContent(appShell, 'https://github.com/anvme/bunnycdn-mcp');
check('detector: a freshly extracted body is not flagged',
  !looksLikeBadExtraction(repaired.text).bad);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
