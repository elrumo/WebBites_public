/**
 * Fixture tests for the feed parser.
 *
 * Feed XML in the wild is the least predictable input this backend takes, and
 * a parser regression is silent: items simply stop appearing, or appear with a
 * 1970 date at the bottom of every list. These fixtures cover the shapes that
 * actually broke things — namespaced content, CDATA, permalink guids, Atom
 * self-vs-alternate links, missing dates, media artwork — plus an OPML round
 * trip. Run with:
 *
 *   npm run test:rssParser
 */

import {
    parseFeed,
    parseOpml,
    buildOpml,
    parseFeedDate,
    normalizeFeedUrl,
    looksLikeFeedXml,
    discoverFeedLinksInHtml,
    discoverSiteFeedUrls,
    resolveUrl,
    feedUrlGuesses,
} from './rssParser';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

// ─── RSS 2.0 ─────────────────────────────────────────────────────────────────

const rss2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Craft &amp; Code</title>
    <link>https://example.com/blog/</link>
    <description>Notes on building things</description>
    <language>en-GB</language>
    <image><url>https://example.com/logo.png</url></image>
    <item>
      <title>Shipping the &amp;amp; reader</title>
      <link>https://example.com/blog/reader</link>
      <guid isPermaLink="false">tag:example.com,2024:post-1</guid>
      <pubDate>Tue, 03 Jun 2024 09:39:21 GMT</pubDate>
      <dc:creator>Ada Lovelace</dc:creator>
      <description>A teaser paragraph.</description>
      <content:encoded><![CDATA[<p>The full post body, which is much longer than the teaser and is what a reader should render.</p><script>alert(1)</script><img src="/img/hero.png">]]></content:encoded>
    </item>
    <item>
      <title>No date here</title>
      <guid isPermaLink="true">https://example.com/blog/undated</guid>
      <description>&lt;p&gt;Escaped markup body&lt;/p&gt;</description>
      <media:thumbnail url="https://cdn.example.com/thumb.jpg" />
    </item>
    <item>
      <title>Enclosure item</title>
      <link>/blog/relative</link>
      <pubDate>Mon, 02 Jun 2024 08:00:00 +0100</pubDate>
      <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg" length="1234"/>
    </item>
  </channel>
</rss>`;

const feed = parseFeed(rss2, 'https://example.com/feed.xml');
check('rss2: channel title decoded', feed.title === 'Craft & Code');
check('rss2: site url', feed.siteUrl === 'https://example.com/blog/');
check('rss2: language', feed.language === 'en-GB');
check('rss2: channel icon from image', feed.iconUrl === 'https://example.com/logo.png');
check('rss2: three items', feed.items.length === 3);

const [postOne, undated, enclosure] = feed.items;
check('rss2: double-escaped title reads as text', postOne.title === 'Shipping the & reader');
check('rss2: non-permalink guid kept', postOne.guid === 'tag:example.com,2024:post-1');
check('rss2: link', postOne.link === 'https://example.com/blog/reader');
check('rss2: dc:creator', postOne.author === 'Ada Lovelace');
check('rss2: date parsed', postOne.publishedAt?.toISOString() === '2024-06-03T09:39:21.000Z');
check('rss2: content:encoded beats description', postOne.contentText.includes('full post body'));
check('rss2: teaser not used when encoded present', !postOne.contentText.includes('teaser paragraph'));
check('rss2: script stripped from html', !/<script/i.test(postOne.contentHtml));
check('rss2: body image resolved absolute', postOne.imageUrl === 'https://example.com/img/hero.png');

check('rss2: permalink guid becomes link', undated.link === 'https://example.com/blog/undated');
check('rss2: missing date is null', undated.publishedAt === null);
check('rss2: escaped markup body reads as text', undated.contentText.includes('Escaped markup body'));
check('rss2: media:thumbnail used', undated.imageUrl === 'https://cdn.example.com/thumb.jpg');

check('rss2: relative link resolved against site', enclosure.link === 'https://example.com/blog/relative');
check('rss2: enclosure image used', enclosure.imageUrl === 'https://cdn.example.com/cover.jpg');
check('rss2: offset date parsed', enclosure.publishedAt?.toISOString() === '2024-06-02T07:00:00.000Z');

// ─── Atom ────────────────────────────────────────────────────────────────────

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
  <title>Journal</title>
  <subtitle>Un blog</subtitle>
  <icon>https://atom.example.org/icon.png</icon>
  <link rel="self" href="https://atom.example.org/feed.atom"/>
  <link rel="alternate" type="text/html" href="https://atom.example.org/"/>
  <entry>
    <title type="html">Premier billet</title>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <link rel="edit" href="https://atom.example.org/edit/1"/>
    <link rel="alternate" href="https://atom.example.org/posts/1"/>
    <published>2024-05-01T12:00:00Z</published>
    <updated>2024-05-02T12:00:00Z</updated>
    <author><name>Marie</name></author>
    <content type="html">&lt;p&gt;Le contenu complet du billet.&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>Summary only</title>
    <id>https://atom.example.org/posts/2</id>
    <updated>2024-04-01T12:00:00Z</updated>
    <summary>Just a summary.</summary>
  </entry>
</feed>`;

const atomFeed = parseFeed(atom, 'https://atom.example.org/feed.atom');
check('atom: title', atomFeed.title === 'Journal');
check('atom: alternate link wins over self', atomFeed.siteUrl === 'https://atom.example.org/');
check('atom: subtitle as description', atomFeed.description === 'Un blog');
check('atom: language from xml:lang', atomFeed.language === 'fr');
check('atom: icon', atomFeed.iconUrl === 'https://atom.example.org/icon.png');
check('atom: two entries', atomFeed.items.length === 2);
check('atom: entry alternate link, not edit', atomFeed.items[0].link === 'https://atom.example.org/posts/1');
check('atom: entry id as guid', atomFeed.items[0].guid === 'urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a');
check('atom: author name', atomFeed.items[0].author === 'Marie');
check('atom: published preferred over updated', atomFeed.items[0].publishedAt?.toISOString() === '2024-05-01T12:00:00.000Z');
check('atom: content decoded', atomFeed.items[0].contentText.includes('contenu complet'));
check('atom: id url used as link when no alternate', atomFeed.items[1].link === 'https://atom.example.org/posts/2');
check('atom: summary fallback', atomFeed.items[1].contentText.includes('Just a summary'));

// ─── RDF / RSS 1.0 ───────────────────────────────────────────────────────────

const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://rdf.example.net/">
    <title>Old School</title>
    <link>https://rdf.example.net/</link>
    <description>An RSS 1.0 feed</description>
  </channel>
  <item rdf:about="https://rdf.example.net/a">
    <title>Item A</title>
    <link>https://rdf.example.net/a</link>
    <dc:date>2024-03-01T00:00:00Z</dc:date>
    <dc:creator>Editor</dc:creator>
    <description>Body of A</description>
  </item>
  <item rdf:about="https://rdf.example.net/b">
    <title>Item B</title>
    <link>https://rdf.example.net/b</link>
    <description>Body of B</description>
  </item>
</rdf:RDF>`;

const rdfFeed = parseFeed(rdf, 'https://rdf.example.net/feed.rdf');
check('rdf: title', rdfFeed.title === 'Old School');
check('rdf: items are channel siblings', rdfFeed.items.length === 2);
check('rdf: dc:date parsed', rdfFeed.items[0].publishedAt?.toISOString() === '2024-03-01T00:00:00.000Z');
check('rdf: dc:creator', rdfFeed.items[0].author === 'Editor');
check('rdf: link becomes guid when no guid element', rdfFeed.items[1].guid === 'https://rdf.example.net/b');

// ─── Malformed input ─────────────────────────────────────────────────────────

let threwOnHtml = false;
try { parseFeed('<!doctype html><html><body>Not a feed</body></html>', 'https://x.test/'); }
catch { threwOnHtml = true; }
check('malformed: html body throws', threwOnHtml);

let threwOnEmpty = false;
try { parseFeed('', 'https://x.test/'); } catch { threwOnEmpty = true; }
check('malformed: empty body throws', threwOnEmpty);

const emptyChannel = parseFeed('<rss version="2.0"><channel><title>Nothing yet</title></channel></rss>', 'https://y.test/feed');
check('malformed: zero-item feed is valid', emptyChannel.items.length === 0 && emptyChannel.title === 'Nothing yet');

const noGuid = parseFeed(
    '<rss version="2.0"><channel><title>T</title><item><description>orphan</description></item></channel></rss>',
    'https://z.test/feed'
);
check('malformed: item with no identity dropped', noGuid.items.length === 0);

// ─── HTML character references in plain-text fields ─────────────────────────
// The Nintenderos case: the XML parser leaves numeric references and anything
// inside CDATA alone, so titles reached clients as `Fortune&#8217;s Weave`.

const escaped = parseFeed(`<rss version="2.0"><channel>
  <title><![CDATA[Nintenderos &#8211; Noticias]]></title>
  <description>Caf&#xE9; &amp;amp; games</description>
  <item>
    <title>Fire Emblem: Fortune&#8217;s Weave</title>
    <link>https://n.test/fe</link>
    <author><![CDATA[Jos&eacute; P&eacute;rez]]></author>
  </item>
  <item><title><![CDATA[Zelda &rsquo;s &amp; &lt;b&gt;tears&lt;/b&gt; &hellip;]]></title><link>https://n.test/z</link></item>
  <item><title>Guid-less &amp;#8220;quoted&amp;#8221;</title></item>
</channel></rss>`, 'https://n.test/feed');
check('entities: CDATA feed title', escaped.title === 'Nintenderos – Noticias');
check('entities: feed description hex + double escape', escaped.description === 'Café & games');
check('entities: numeric in title', escaped.items[0].title === 'Fire Emblem: Fortune’s Weave');
check('entities: named in CDATA author', escaped.items[0].author === 'José Pérez');
check('entities: named in CDATA title, markup kept as text',
    escaped.items[1].title === 'Zelda ’s & <b>tears</b> …');
check('entities: title decoded', escaped.items[2].title === 'Guid-less “quoted”');
check('entities: guid-less item keeps the raw title as guid (dedupKey unchanged)',
    escaped.items[2].guid === 'Guid-less &#8220;quoted&#8221;');

// ─── Dates ───────────────────────────────────────────────────────────────────

check('date: rfc822', parseFeedDate('Tue, 03 Jun 2024 09:39:21 GMT')?.getUTCFullYear() === 2024);
check('date: iso', parseFeedDate('2024-06-03T09:39:21Z')?.getUTCMinutes() === 39);
check('date: space instead of T', parseFeedDate('2024-06-03 09:39:21')?.getUTCFullYear() === 2024);
check('date: garbage is null', parseFeedDate('not a date') === null);
check('date: empty is null', parseFeedDate('') === null);
check('date: far future rejected', parseFeedDate('2099-01-01T00:00:00Z') === null);
check('date: pre-1990 rejected', parseFeedDate('1970-01-01T00:00:00Z') === null);

// ─── URL helpers ─────────────────────────────────────────────────────────────

check('url: trailing slash normalised', normalizeFeedUrl('https://Example.com/feed/') === 'https://example.com/feed');
check('url: fragment dropped', normalizeFeedUrl('https://example.com/feed#top') === 'https://example.com/feed');
check('url: query preserved', normalizeFeedUrl('https://example.com/?feed=rss2') === 'https://example.com/?feed=rss2');
check('url: default port dropped', normalizeFeedUrl('https://example.com:443/feed') === 'https://example.com/feed');
check('url: relative resolved', resolveUrl('/a/b', 'https://example.com/c/d') === 'https://example.com/a/b');
check('url: junk resolves to null', resolveUrl('', 'https://example.com') === null);

check('sniff: rss recognised', looksLikeFeedXml('<?xml version="1.0"?><rss version="2.0">'));
check('sniff: atom recognised', looksLikeFeedXml('<feed xmlns="http://www.w3.org/2005/Atom">'));
check('sniff: rdf recognised', looksLikeFeedXml('<rdf:RDF xmlns:rdf="...">'));
check('sniff: html rejected', !looksLikeFeedXml('<!doctype html><html>'));

// ─── Autodiscovery ───────────────────────────────────────────────────────────

const page = `<!doctype html><html><head>
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" title="Main feed" href="/feed.xml">
<link rel='alternate' type='application/atom+xml' href='https://cdn.example.com/atom.xml'>
<link rel="alternate" type="application/json" href="/feed.json">
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
</head><body></body></html>`;

const links = discoverFeedLinksInHtml(page, 'https://example.com/blog/');
check('discover: two unique feeds', links.length === 2);
check('discover: relative resolved', links[0].url === 'https://example.com/feed.xml');
check('discover: title captured', links[0].title === 'Main feed');
check('discover: single-quoted attrs handled', links[1].url === 'https://cdn.example.com/atom.xml');
check('discover: json feed skipped', !links.some((l) => l.url.endsWith('feed.json')));
check('discover: empty page yields nothing', discoverFeedLinksInHtml('', 'https://example.com').length === 0);

const youtubeFeeds = discoverSiteFeedUrls('https://www.youtube.com/channel/UCabc123');
check('site rules: YouTube channel feed', youtubeFeeds[0] === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123');
check('site rules: Reddit subreddit feed', discoverSiteFeedUrls('https://www.reddit.com/r/rss')[0] === 'https://www.reddit.com/r/rss.rss');
check('site rules: Stack Exchange tag feed', discoverSiteFeedUrls('https://stackoverflow.com/questions/tagged/typescript')[0] === 'https://stackoverflow.com/feeds/tag/typescript');
check('site rules: ordinary site untouched', discoverSiteFeedUrls('https://example.com/blog').length === 0);

const blogGuesses = feedUrlGuesses('https://stripe.com/blog');
check('guesses: pasted path before root', blogGuesses.indexOf('https://stripe.com/blog/feed') < blogGuesses.indexOf('https://stripe.com/feed'));
check('guesses: root still tried', blogGuesses.includes('https://stripe.com/rss'));
check('guesses: no duplicates', new Set(blogGuesses).size === blogGuesses.length);
check('guesses: bare domain starts at /feed', feedUrlGuesses('https://example.com/')[0] === 'https://example.com/feed');
check('guesses: bad url yields nothing', feedUrlGuesses('not a url').length === 0);

// ─── OPML round trip ─────────────────────────────────────────────────────────

const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Tech">
      <outline type="rss" text="A &amp; B" xmlUrl="https://a.example/feed" htmlUrl="https://a.example/"/>
      <outline type="rss" text="C" xmlUrl="https://c.example/feed"/>
    </outline>
    <outline type="rss" text="Loose" xmlUrl="https://loose.example/feed"/>
    <outline type="rss" text="Dupe" xmlUrl="https://a.example/feed"/>
    <outline text="Empty folder"/>
  </body>
</opml>`;

const entries = parseOpml(opml);
check('opml: four outlines minus the duplicate', entries.length === 3);
check('opml: nested entry found', entries[0].xmlUrl === 'https://a.example/feed');
check('opml: title entity decoded', entries[0].title === 'A & B');
check('opml: category from parent folder', entries[0].category === 'Tech');
check('opml: htmlUrl captured', entries[0].htmlUrl === 'https://a.example/');
check('opml: top-level entry has no category', entries[2].category === null);
check('opml: folder without xmlUrl not an entry', !entries.some((e) => e.title === 'Empty folder'));

const roundTripped = parseOpml(buildOpml(entries.map((e) => ({ title: e.title, xmlUrl: e.xmlUrl, htmlUrl: e.htmlUrl }))));
check('opml: round trip preserves count', roundTripped.length === entries.length);
check('opml: round trip preserves ampersand title', roundTripped[0].title === 'A & B');
check('opml: round trip preserves urls', roundTripped.every((e, i) => e.xmlUrl === entries[i].xmlUrl));

let threwOnBadOpml = false;
try { parseOpml('<opml version="2.0"><head/></opml>'); } catch { threwOnBadOpml = true; }
check('opml: missing body throws', threwOnBadOpml);

console.log(`\nrssParser: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
