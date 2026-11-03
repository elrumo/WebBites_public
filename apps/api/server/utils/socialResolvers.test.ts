/**
 * Tests for the social post resolvers.
 *
 * Hermetic: `fetch` is stubbed with recorded fixtures, so this runs offline and
 * does not depend on a platform's uptime or rate limit. The fixtures are real
 * responses, trimmed — if one of these APIs changes shape, the resolver breaks
 * in production and these still pass, which is what the `extractedBy` field in
 * the logs is for.
 *
 * Run with:
 *
 *   npm run test:socialResolvers
 */

import {
  resolveSocialUrl,
  canonicalizeSocialUrl,
  hasSocialResolver,
  clearSocialResolverCache
} from './socialResolvers';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name); }
};

// --------------------------------------------------------------- fetch stub

type Route = { match: RegExp; body: any; status?: number };
let routes: Route[] = [];
let requested: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, _init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  requested.push(url);
  const route = routes.find((candidate) => candidate.match.test(url));
  if (!route) {
    return new Response('not found', { status: 404 });
  }
  return new Response(JSON.stringify(route.body), {
    status: route.status ?? 200,
    headers: { 'content-type': 'application/json' }
  });
}) as any;

const withRoutes = async <T>(next: Route[], fn: () => Promise<T>): Promise<T> => {
  routes = next;
  requested = [];
  clearSocialResolverCache();
  return fn();
};

// ------------------------------------------------------- canonicalization

check(
  'strips instagram share tracking',
  canonicalizeSocialUrl('https://www.instagram.com/p/ABC/?igsh=xyz&img_index=1') ===
    'https://www.instagram.com/p/ABC'
);
check(
  'strips utm_* and the fragment',
  canonicalizeSocialUrl('https://x.com/a/status/1?utm_source=n&utm_medium=m#frag') ===
    'https://x.com/a/status/1'
);
check(
  'strips tiktok _t/_r',
  canonicalizeSocialUrl('https://www.tiktok.com/@u/video/7?_t=abc&_r=1') ===
    'https://www.tiktok.com/@u/video/7'
);
check(
  'keeps a meaningful query parameter',
  canonicalizeSocialUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=drop') ===
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
);
check(
  'leaves an unparseable url alone',
  canonicalizeSocialUrl('not a url') === 'not a url'
);

// ------------------------------------------------------------- dispatching

check('recognizes bluesky', hasSocialResolver('https://bsky.app/profile/a.bsky.social/post/3l6o'));
check('recognizes x.com', hasSocialResolver('https://x.com/jack/status/20'));
check('recognizes youtu.be', hasSocialResolver('https://youtu.be/dQw4w9WgXcQ'));
check('recognizes a mastodon-shaped url', hasSocialResolver('https://mastodon.social/@Mastodon/117156549508722805'));
check('ignores a plain website', hasSocialResolver('https://example.com/post/123') === false);
check(
  'does not mistake medium for mastodon',
  hasSocialResolver('https://medium.com/@author/123456789012') === false
);
check('ignores a non-http scheme', hasSocialResolver('ftp://bsky.app/profile/a/post/b') === false);

// Everything below performs network calls (against the stub above), so it lives
// inside an async entry point: tsx transpiles a .ts file to CJS, where
// top-level await is not available.
async function main() {

// ----------------------------------------------------------------- bluesky

const blueskyPost = {
  thread: {
    post: {
      uri: 'at://did:plc:abc/app.bsky.feed.post/3l6o',
      author: { did: 'did:plc:abc', handle: 'onion.example', displayName: 'The Onion', avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:abc/x@jpeg' },
      record: { text: 'Shop the store.', createdAt: '2026-09-11T22:30:05.592Z', langs: ['en'] },
      embed: {
        $type: 'app.bsky.embed.images#view',
        images: [
          { thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/a', fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/a', alt: 'shirt' }
        ]
      }
    }
  }
};

const bluesky = await withRoutes(
  [
    { match: /resolveHandle/, body: { did: 'did:plc:abc' } },
    { match: /getPostThread/, body: blueskyPost }
  ],
  () => resolveSocialUrl('https://bsky.app/profile/onion.example/post/3l6o')
);
check('bluesky resolves', bluesky !== null);
check('bluesky platform', bluesky?.platform === 'bluesky');
check('bluesky is authoritative', bluesky?.extractedBy === 'server:bluesky');
check('bluesky text', bluesky?.text === 'Shop the store.');
check('bluesky handle', bluesky?.authorHandle === '@onion.example');
check('bluesky author name', bluesky?.author === 'The Onion');
check('bluesky prefers fullsize over thumb', bluesky?.media[0]?.url.includes('feed_fullsize') === true);
check('bluesky date', bluesky?.publishedAt === '2026-09-11T22:30:05.592Z');
check('bluesky lang', bluesky?.lang === 'en');
check('bluesky resolved the handle to a did', requested.some((url) => url.includes('resolveHandle')));

// A DID in the permalink needs no resolution hop.
const blueskyDid = await withRoutes(
  [{ match: /getPostThread/, body: blueskyPost }],
  () => resolveSocialUrl('https://bsky.app/profile/did:plc:abc/post/3l6o')
);
check('bluesky accepts a did permalink', blueskyDid?.text === 'Shop the store.');
check('bluesky skips resolveHandle for a did', !requested.some((url) => url.includes('resolveHandle')));

// Video embeds carry a thumbnail and never a playable stream.
const blueskyVideo = await withRoutes(
  [
    { match: /resolveHandle/, body: { did: 'did:plc:abc' } },
    {
      match: /getPostThread/,
      body: {
        thread: {
          post: {
            author: { handle: 'a.example' },
            record: { text: 'clip', createdAt: '2026-01-01T00:00:00.000Z' },
            embed: {
              $type: 'app.bsky.embed.video#view',
              playlist: 'https://video.bsky.app/x.m3u8',
              thumbnail: 'https://cdn.bsky.app/img/thumb/x'
            }
          }
        }
      }
    }
  ],
  () => resolveSocialUrl('https://bsky.app/profile/a.example/post/xyz')
);
check('bluesky video kind', blueskyVideo?.kind === 'video');
check('bluesky video keeps only the poster', blueskyVideo?.media[0]?.url.includes('cdn.bsky.app') === true);

// A malformed permalink must not reach the network at all.
const blueskyBad = await withRoutes([], () => resolveSocialUrl('https://bsky.app/profile/a.example'));
check('bluesky rejects a non-post path', blueskyBad === null);
check('bluesky made no request for a bad path', requested.length === 0);

// ----------------------------------------------------------------- twitter

const tweet = {
  tweet: {
    url: 'https://x.com/elonmusk/status/1519480761749016577',
    text: 'Next I am buying Coca-Cola',
    author: { screen_name: 'elonmusk', name: 'Elon Musk', avatar_url: 'https://pbs.twimg.com/profile_images/1/a.jpg' },
    created_at: 'Thu Apr 28 00:56:58 +0000 2022',
    created_timestamp: 1651107418,
    lang: 'en',
    media: {
      all: [
        { type: 'photo', url: 'https://pbs.twimg.com/media/a?format=jpg&name=large' },
        { type: 'video', url: 'https://video.twimg.com/a.mp4', thumbnail_url: 'https://pbs.twimg.com/tweet_video_thumb/b.jpg' }
      ]
    }
  }
};

const twitter = await withRoutes(
  [{ match: /fxtwitter|fxembed/, body: tweet }],
  () => resolveSocialUrl('https://x.com/elonmusk/status/1519480761749016577?s=20')
);
check('twitter resolves', twitter !== null);
check('twitter is authoritative', twitter?.extractedBy === 'server:twitter');
check('twitter text', twitter?.text === 'Next I am buying Coca-Cola');
check('twitter handle', twitter?.authorHandle === '@elonmusk');
check('twitter prefers the unix timestamp', twitter?.publishedAt === '2022-04-28T00:56:58.000Z');
check('twitter keeps the photo', twitter?.media.some((item) => item.type === 'image') === true);
check('twitter never stores a playable video url', twitter?.media.every((item) => !item.url.includes('video.twimg.com')) === true);
check('twitter video carries a poster', twitter?.media.some((item) => item.type === 'video' && Boolean(item.poster)) === true);
check('twitter kind is video when one is present', twitter?.kind === 'video');

// /i/status/<id> has no handle in the path.
const twitterNoHandle = await withRoutes(
  [{ match: /fxtwitter|fxembed/, body: tweet }],
  () => resolveSocialUrl('https://x.com/i/status/1519480761749016577')
);
check('twitter handles /i/status/', twitterNoHandle?.text === 'Next I am buying Coca-Cola');
check('twitter used the i/status path', requested.some((url) => url.includes('/i/status/')));

const twitterProfile = await withRoutes([], () => resolveSocialUrl('https://x.com/elonmusk'));
check('twitter ignores a profile url', twitterProfile === null);

// A link-card tweet has no media of its own.
const twitterCard = await withRoutes(
  [{
    match: /fxtwitter|fxembed/,
    body: { tweet: { text: 'read this', author: { screen_name: 'a' }, media: { external: { thumbnail_url: 'https://pbs.twimg.com/card_img/c.jpg' } } } }
  }],
  () => resolveSocialUrl('https://twitter.com/a/status/99')
);
check('twitter falls back to the link card thumbnail', twitterCard?.media[0]?.url.includes('card_img') === true);

// A four-photo tweet. `media.all` carries the photos *and* the mosaic — one
// image with all four tiled into it, meant for an unfurl card. Keeping the
// mosaic made it the cover and turned the carousel into five slides, the last
// of which is a contact sheet of the other four.
const twitterQuad = await withRoutes(
  [{
    match: /fxtwitter|fxembed/,
    body: {
      tweet: {
        text: 'four of them',
        author: { screen_name: 'a' },
        media: {
          all: [
            { type: 'mosaic_photo', url: 'https://pbs.twimg.com/media/mosaic?name=large' },
            { type: 'photo', url: 'https://pbs.twimg.com/media/1?name=large' },
            { type: 'photo', url: 'https://pbs.twimg.com/media/2?name=large' },
            { type: 'photo', url: 'https://pbs.twimg.com/media/3?name=large' },
            { type: 'photo', url: 'https://pbs.twimg.com/media/4?name=large' }
          ]
        }
      }
    }
  }],
  () => resolveSocialUrl('https://x.com/a/status/4444')
);
check('twitter keeps every photo of a four-photo tweet', twitterQuad?.media.length === 4);
check('twitter drops the mosaic duplicate', twitterQuad?.media.every((item) => !item.url.includes('mosaic')) === true);
check('twitter cover is the first photo, not the mosaic', twitterQuad?.media[0]?.url.includes('/media/1') === true);

const twitterMosaicOnly = await withRoutes(
  [{
    match: /fxtwitter|fxembed/,
    body: {
      tweet: {
        text: 'only a mosaic',
        author: { screen_name: 'a' },
        media: { all: [{ type: 'mosaic_photo', url: 'https://pbs.twimg.com/media/m?name=large' }], mosaic: { formats: { jpeg: 'https://pbs.twimg.com/media/m.jpg' } } }
      }
    }
  }],
  () => resolveSocialUrl('https://x.com/a/status/5555')
);
check('twitter keeps the mosaic when it is the only picture', twitterMosaicOnly?.media.length === 1);

// ------------------------------------------------------------------ reddit

// The resolver is a no-op without app credentials, so the gallery cases need
// them present. Both routes are stubbed, so nothing reaches Reddit.
process.env.REDDIT_CLIENT_ID = 'test-id';
process.env.REDDIT_CLIENT_SECRET = 'test-secret';
const redditToken: Route = { match: /access_token/, body: { access_token: 'tok', expires_in: 3600 } };

const redditListing = (post: any) => ({ data: { children: [{ data: post }] } });

// `media_metadata` is a map, so its key order is whatever JSON.parse produced.
// `gallery_data.items` is the order the poster arranged the gallery in, and is
// the one that decides which picture is the cover.
const gallery = await withRoutes(
  [
    redditToken,
    {
      match: /oauth\.reddit\.com/,
      body: redditListing({
        title: 'my gallery',
        subreddit_name_prefixed: 'r/pics',
        author: 'someone',
        gallery_data: { items: [{ media_id: 'ccc' }, { media_id: 'aaa' }, { media_id: 'bbb' }] },
        media_metadata: {
          aaa: { s: { u: 'https://preview.redd.it/aaa.jpg?format=pjpg&amp;width=1' } },
          bbb: { s: { u: 'https://preview.redd.it/bbb.jpg' } },
          ccc: { s: { u: 'https://preview.redd.it/ccc.jpg' } }
        }
      })
    }
  ],
  () => resolveSocialUrl('https://www.reddit.com/r/pics/comments/abc123/my_gallery/')
);
check('reddit keeps every picture of a gallery', gallery?.media.length === 3);
check('reddit orders the gallery the way the poster arranged it', gallery?.media[0]?.url.includes('ccc') === true);
check('reddit unescapes the urls inside its json', gallery?.media[1]?.url.includes('&width=1') === true);

const animatedGallery = await withRoutes(
  [
    redditToken,
    {
      match: /oauth\.reddit\.com/,
      body: redditListing({
        title: 'gifs',
        author: 'someone',
        gallery_data: { items: [{ media_id: 'a' }, { media_id: 'b' }] },
        media_metadata: {
          a: { s: { gif: 'https://i.redd.it/a.gif' } },
          b: { p: [{ u: 'https://preview.redd.it/b-small.jpg' }, { u: 'https://preview.redd.it/b-large.jpg' }] }
        }
      })
    }
  ],
  () => resolveSocialUrl('https://www.reddit.com/r/gifs/comments/def456/gifs/')
);
check('reddit reads an animated gallery item', animatedGallery?.media[0]?.url.includes('a.gif') === true);
check('reddit falls back to the largest preview', animatedGallery?.media[1]?.url.includes('b-large') === true);

const crosspost = await withRoutes(
  [
    redditToken,
    {
      match: /oauth\.reddit\.com/,
      body: redditListing({
        title: 'look at this',
        author: 'someone',
        crosspost_parent_list: [{
          gallery_data: { items: [{ media_id: 'x' }, { media_id: 'y' }] },
          media_metadata: { x: { s: { u: 'https://preview.redd.it/x.jpg' } }, y: { s: { u: 'https://preview.redd.it/y.jpg' } } }
        }]
      })
    }
  ],
  () => resolveSocialUrl('https://www.reddit.com/r/all/comments/ghi789/look_at_this/')
);
check('reddit reads a crosspost wrapper through to the original', crosspost?.media.length === 2);

// ------------------------------------------------------------------ oembed

const tiktok = await withRoutes(
  [{
    match: /tiktok\.com\/oembed/,
    body: {
      title: 'Scramble up ur name',
      author_name: 'Scout',
      author_unique_id: 'scout2015',
      author_url: 'https://www.tiktok.com/@scout2015',
      thumbnail_url: 'https://p16-common-sign.tiktokcdn-us.com/tos/a.image'
    }
  }],
  () => resolveSocialUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173')
);
check('tiktok resolves', tiktok !== null);
check('tiktok caption becomes the body text', tiktok?.text === 'Scramble up ur name');
check('tiktok handle from author_unique_id', tiktok?.authorHandle === '@scout2015');
check('tiktok thumbnail passes the cdn allowlist', tiktok?.media[0]?.url.includes('tiktokcdn-us.com') === true);
check('tiktok kind is video', tiktok?.kind === 'video');

const youtube = await withRoutes(
  [{
    match: /youtube\.com\/oembed/,
    body: {
      title: 'Never Gonna Give You Up',
      author_name: 'Rick Astley',
      author_url: 'https://www.youtube.com/@RickAstleyYT',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    }
  }],
  () => resolveSocialUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
);
check('youtube resolves', youtube !== null);
check('youtube keeps its real title', youtube?.title === 'Never Gonna Give You Up');
check('youtube does not invent body text', youtube?.text === undefined);
check('youtube handle from author_url', youtube?.authorHandle === '@RickAstleyYT');

const pinterest = await withRoutes(
  [{
    match: /pinterest\.com\/oembed/,
    body: { title: 'Next stop: Pinterest!', author_name: 'Kent Brewster', author_url: 'https://www.pinterest.com/kentbrew/', thumbnail_url: 'https://i.pinimg.com/236x/a.jpg' }
  }],
  () => resolveSocialUrl('https://www.pinterest.com/pin/99360735500167749/')
);
check('pinterest resolves', pinterest?.title === 'Next stop: Pinterest!');
check('pinterest handle from author_url', pinterest?.authorHandle === '@kentbrew');
check('pinterest media host allowed', pinterest?.media[0]?.url.includes('pinimg.com') === true);

// ---------------------------------------------------------------- mastodon

const mastodon = await withRoutes(
  [{
    match: /mastodon\.social\/api\/v1\/statuses/,
    body: {
      id: '117156549508722805',
      url: 'https://mastodon.social/@Mastodon/117156549508722805',
      content: '<p>Hannah is leaving.<br />Thank you &amp; farewell</p>',
      created_at: '2026-08-25T14:11:16.256Z',
      language: 'en',
      spoiler_text: '',
      account: { acct: 'Mastodon', display_name: 'Mastodon', avatar_static: 'https://mastodon.social/avatars/a.png' },
      media_attachments: [
        { type: 'image', url: 'https://files.mastodon.social/media/a.png', preview_url: 'https://files.mastodon.social/small/a.png' }
      ]
    }
  }],
  () => resolveSocialUrl('https://mastodon.social/@Mastodon/117156549508722805')
);
check('mastodon resolves', mastodon !== null);
check('mastodon strips html from content', mastodon?.text === 'Hannah is leaving.\nThank you & farewell');
check('mastodon handle', mastodon?.authorHandle === '@Mastodon');
check('mastodon allows instance-hosted media', mastodon?.media[0]?.url.includes('files.mastodon.social') === true);
check('mastodon probed the instance api', requested.some((url) => url.includes('/api/v1/statuses/117156549508722805')));

// The /users/<name>/statuses/<id> spelling is the same status.
const mastodonUsersPath = await withRoutes(
  [{ match: /\/api\/v1\/statuses/, body: { id: '1', content: '<p>hi</p>', account: { acct: 'a' }, media_attachments: [] } }],
  () => resolveSocialUrl('https://example.social/users/a/statuses/117156549508722805')
);
check('mastodon accepts the /users/ path', mastodonUsersPath?.text === 'hi');

// A host that merely looks the part and answers with something else.
const notAnInstance = await withRoutes(
  [{ match: /\/api\/v1\/statuses/, body: { error: 'Record not found' }, status: 404 }],
  () => resolveSocialUrl('https://blog.example.com/@someone/123456789')
);
check('a non-instance host resolves to null', notAnInstance === null);

// ------------------------------------------------------- instagram/threads

const before = process.env.SOCIAL_RESOLVER_URL;
delete process.env.SOCIAL_RESOLVER_URL;
const instagramUnconfigured = await withRoutes([], () => resolveSocialUrl('https://www.instagram.com/p/ABC/'));
check('instagram is null with no provider configured', instagramUnconfigured === null);
check('instagram makes no request with no provider configured', requested.length === 0);

process.env.SOCIAL_RESOLVER_URL = 'https://resolver.example/api';
const instagram = await withRoutes(
  [{
    match: /resolver\.example/,
    body: {
      data: {
        caption: 'a caption',
        is_video: false,
        author: { username: 'nasa', full_name: 'NASA' },
        media: [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/a.jpg' }]
      }
    }
  }],
  () => resolveSocialUrl('https://www.instagram.com/p/ABC/?igsh=drop')
);
check('instagram resolves through the provider', instagram?.text === 'a caption');
check('instagram handle', instagram?.authorHandle === '@nasa');
check('instagram media passes the cdn allowlist', instagram?.media[0]?.url.includes('cdninstagram.com') === true);
check('instagram is authoritative', instagram?.extractedBy === 'server:instagram');
check('instagram provider received the canonical url', requested.some((url) => url.includes('%2FABC') && !url.includes('igsh')));

// The provider is as untrusted as a page script: its media still has to pass
// the platform allowlist.
const instagramSsrf = await withRoutes(
  [{
    match: /resolver\.example/,
    body: { data: { caption: 'x', media: [{ type: 'image', url: 'http://169.254.169.254/latest/meta-data/' }] } }
  }],
  () => resolveSocialUrl('https://www.instagram.com/p/DEF/')
);
check('a provider cannot smuggle an SSRF media url', instagramSsrf?.media.length === 0);

if (before === undefined) delete process.env.SOCIAL_RESOLVER_URL;
else process.env.SOCIAL_RESOLVER_URL = before;

// ------------------------------------------------------------------- cache

routes = [
  { match: /resolveHandle/, body: { did: 'did:plc:abc' } },
  { match: /getPostThread/, body: blueskyPost }
];
clearSocialResolverCache();
requested = [];
await resolveSocialUrl('https://bsky.app/profile/onion.example/post/3l6o');
const firstCount = requested.length;
await resolveSocialUrl('https://bsky.app/profile/onion.example/post/3l6o?utm_source=x');
check('a repeat save of the same post hits the cache', requested.length === firstCount);

// A failed resolution is cached too, so a dead upstream is not hammered.
clearSocialResolverCache();
routes = [];
requested = [];
await resolveSocialUrl('https://bsky.app/profile/a.example/post/zzz');
const failedCount = requested.length;
await resolveSocialUrl('https://bsky.app/profile/a.example/post/zzz');
check('a failed resolution is cached', requested.length === failedCount);

// ------------------------------------------------------------------ upstream failure

const upstreamDown = await withRoutes(
  [{ match: /getPostThread/, body: { error: 'upstream' }, status: 503 }, { match: /resolveHandle/, body: { did: 'did:plc:abc' } }],
  () => resolveSocialUrl('https://bsky.app/profile/onion.example/post/3l6o')
);
check('a 503 upstream resolves to null rather than throwing', upstreamDown === null);

const upstreamGarbage = await withRoutes(
  [{ match: /getPostThread/, body: { thread: { notAPost: true } } }, { match: /resolveHandle/, body: { did: 'did:plc:abc' } }],
  () => resolveSocialUrl('https://bsky.app/profile/onion.example/post/3l6o')
);
check('an unexpected response shape resolves to null', upstreamGarbage === null);

globalThis.fetch = realFetch;
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
}

main();
