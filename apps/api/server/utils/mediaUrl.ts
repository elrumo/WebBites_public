/**
 * Telling a game or a movie apart from an ordinary page, from its URL.
 *
 * Saving a Steam page or a TMDB entry as a plain website gives a card with a
 * store banner on it; saving it as a `game` / `movie` gives the proper media
 * card (cover, cast, trailers…) that `saveGame` / `saveMovie` build from an
 * IGDB / TMDB record. Those two endpoints want that record, so detection is
 * two steps:
 *
 *   1. {@link detectMediaUrl} — pure. Host + path only, says "this is a game /
 *      movie" and what we know about which one (an id, an IMDb id, or just a
 *      title lifted from the slug).
 *   2. {@link resolveMediaBookmark} — network. Turns that into the IGDB / TMDB
 *      record, or null. Null always means "save it as a website", never an
 *      error: a wrong guess is worse than no guess, so title matches are strict.
 *
 * Only hosts that unambiguously carry one kind of thing are listed. Stores that
 * sell games and apps alike (Play Store, Amazon) or films and series alike
 * (Prime Video, Disney+) are left out unless the URL itself can settle it.
 */

export interface MediaHit {
    kind: 'game' | 'movie';
    /** Title lifted from the URL slug. */
    title?: string;
    year?: number;
    tmdbId?: number;
    imdbId?: string;
    steamAppId?: string;
    appleId?: string;
    igdbSlug?: string;
    /** Host has no slug (Netflix) — the caller supplies the title, and the movie-vs-series call is made against TMDB. */
    needsTitle?: boolean;
    /** Host also lists series, so a movie match has to beat the series match. */
    ambiguous?: boolean;
}

const slugToTitle = (slug: string) => {
    const decoded = (() => { try { return decodeURIComponent(slug); } catch { return slug; } })();
    const year = decoded.match(/[-_](19|20)\d{2}$/)?.[0].slice(1);
    const words = decoded.replace(/[-_](19|20)\d{2}$/, '').replace(/[-_]+/g, ' ').trim();
    return { title: words, year: year ? Number(year) : undefined };
};

// host regex, path regex (group 1 = slug) -> hit
const SLUG_RULES: Array<{ host: RegExp; path: RegExp; kind: 'game' | 'movie'; strip?: RegExp }> = [
    { host: /^store\.epicgames\.com$/, path: /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?p\/([^/?#]+)/, kind: 'game' },
    { host: /^gog\.com$/, path: /^\/(?:[a-z]{2}\/)?game\/([^/?#]+)/, kind: 'game' },
    { host: /^humblebundle\.com$/, path: /^\/store\/([^/?#]+)/, kind: 'game' },
    { host: /^(?:xbox|microsoft)\.com$/, path: /^\/(?:[a-z]{2}-[A-Za-z]{2}\/)?(?:games\/store|p)\/([^/?#]+)/, kind: 'game' },
    { host: /^nintendo\.com$/, path: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?store\/products\/([^/?#]+)/, kind: 'game', strip: /[-_](switch(?:-2)?|nintendo-switch)$/ },
    { host: /^fanatical\.com$/, path: /^\/(?:[a-z]{2}\/)?game\/([^/?#]+)/, kind: 'game' },
    { host: /^greenmangaming\.com$/, path: /^\/games\/([^/?#]+)/, kind: 'game', strip: /[-_]pc$/ },
    { host: /^metacritic\.com$/, path: /^\/game\/([^/?#]+)/, kind: 'game' },
    { host: /^backloggd\.com$/, path: /^\/games\/([^/?#]+)/, kind: 'game' },

    { host: /^letterboxd\.com$/, path: /^\/film\/([^/?#]+)/, kind: 'movie' },
    { host: /^filmin\.(?:es|cat|fr|pt|de|co\.uk)$/, path: /^\/(?:pelicula|pel-licula|film|filme|movie)\/([^/?#]+)/, kind: 'movie' },
    { host: /^rottentomatoes\.com$/, path: /^\/m\/([^/?#]+)/, kind: 'movie' },
    { host: /^trakt\.tv$/, path: /^\/movies\/([^/?#]+)/, kind: 'movie' },
    { host: /^justwatch\.com$/, path: /^\/[a-z]{2}\/(?:movie|pelicula|film|filme|pel-licula|película)\/([^/?#]+)/, kind: 'movie' },
];

export function detectMediaUrl(url: string): MediaHit | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const path = u.pathname;

    // --- ids in the URL: no guessing needed --------------------------------
    if (host === 'store.steampowered.com') {
        const id = path.match(/^\/app\/(\d+)/)?.[1];
        return id ? { kind: 'game', steamAppId: id } : null;
    }
    if (host === 'apps.apple.com') {
        const id = path.match(/\/id(\d+)/)?.[1];
        return id && /\/app\//.test(path) ? { kind: 'game', appleId: id } : null;
    }
    if (host === 'igdb.com') {
        const slug = path.match(/^\/games\/([^/?#]+)/)?.[1];
        return slug ? { kind: 'game', igdbSlug: slug } : null;
    }
    if (host === 'themoviedb.org') {
        const id = path.match(/^\/movie\/(\d+)/)?.[1];
        return id ? { kind: 'movie', tmdbId: Number(id) } : null;
    }
    if (host === 'imdb.com') {
        const id = path.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/)?.[1];
        // IMDb ids cover series and episodes too — TMDB's lookup says which.
        return id ? { kind: 'movie', imdbId: id } : null;
    }
    if (host === 'netflix.com') {
        return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/\d+/.test(path)
            ? { kind: 'movie', needsTitle: true, ambiguous: true }
            : null;
    }

    // --- slug-only stores --------------------------------------------------
    for (const rule of SLUG_RULES) {
        if (!rule.host.test(host)) continue;
        const slug = path.match(rule.path)?.[1];
        if (!slug) continue;
        const { title, year } = slugToTitle(slug.replace(rule.strip ?? /$^/, ''));
        return title ? { kind: rule.kind, title, year } : null;
    }
    return null;
}

// --- resolving against IGDB / TMDB ---------------------------------------------

const norm = (s: string) =>
    s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const TIMEOUT = 8000;
const getJson = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return res.json() as Promise<any>;
};


let igdbToken: { value: string; expires: number } | null = null;
async function igdbPost(path: string, body: string): Promise<any[] | null> {
    const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
    if (!id || !secret) return null;
    if (!igdbToken || igdbToken.expires < Date.now()) {
        const t = await getJson(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
        if (!t?.access_token) return null;
        igdbToken = { value: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
    }
    return getJson(`https://api.igdb.com/v4/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Client-ID': id, Authorization: `Bearer ${igdbToken.value}` },
        body,
    });
}

const tmdb = (path: string) =>
    (process.env.TMDB_API_KEY || process.env.TMBD_API_KEY)
        ? getJson(`https://api.themoviedb.org/3${path}`, { headers: { accept: 'application/json', Authorization: `Bearer ${(process.env.TMDB_API_KEY || process.env.TMBD_API_KEY)}` } })
        : Promise.resolve(null);

/** Runs `fn` over `items`, at most `limit` at a time, keeping order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}

/** Name the store itself gives, for hosts whose URL is only an id. */
async function storeTitle(hit: MediaHit): Promise<string | null> {
    if (hit.steamAppId) {
        const d = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${hit.steamAppId}&l=english`))?.[hit.steamAppId];
        // `type` is what keeps DLC, soundtracks and software out.
        return d?.success && d.data?.type === 'game' ? d.data.name : null;
    }
    if (hit.appleId) {
        const d = (await getJson(`https://itunes.apple.com/lookup?id=${hit.appleId}`))?.results?.[0];
        // App Store links are mostly apps — only the ones filed under Games count.
        return d?.genres?.includes('Games') ? d.trackName : null;
    }
    return hit.title ?? null;
}

const GAME_FIELDS = 'fields name,slug,url,cover.url;';
const esc = (s: string) => s.replace(/["\\]/g, '');
// multiquery has no `search`, so the batched pass asks for an exact (case-insensitive)
// name — the common case. Misses go through {@link searchGame} one at a time.
const exactGameQuery = (hit: MediaHit, title: string | null) =>
    hit.igdbSlug
        ? `${GAME_FIELDS} where slug = "${esc(hit.igdbSlug)}" & cover != null; limit 1;`
        : `${GAME_FIELDS} where name ~ "${esc(title!)}" & cover != null & version_parent = null; sort total_rating_count desc; limit 5;`;
const searchGameQuery = (title: string) =>
    `search "${esc(title)}"; ${GAME_FIELDS} where cover != null & version_parent = null; limit 8;`;

function pickGame(hit: MediaHit, title: string | null, results: any[] | undefined) {
    const g = hit.igdbSlug
        ? results?.[0]
        : (() => {
            const want = norm(title!);
            return results?.find((r) => norm(r.name) === want)
                // Stores append edition / platform words ("Hades - Deluxe Edition"); one name containing the other is enough if they're close in length.
                ?? results?.find((r) => {
                    const n = norm(r.name);
                    return (n.includes(want) || want.includes(n)) && Math.min(n.length, want.length) / Math.max(n.length, want.length) >= 0.6;
                });
        })();
    return g ? { id: g.id, cover: g.cover, url: g.url } : null;
}

async function resolveMovie(hit: MediaHit, fallbackTitle?: string) {
    const pick = (m: any) => (m ? { id: m.id, poster_path: m.poster_path } : null);

    if (hit.tmdbId) return pick(await tmdb(`/movie/${hit.tmdbId}`));
    if (hit.imdbId) return pick((await tmdb(`/find/${hit.imdbId}?external_source=imdb_id`))?.movie_results?.[0]);

    const title = hit.needsTitle ? fallbackTitle?.replace(/^watch\s+/i, '').replace(/\s*[|\-–—]\s*netflix.*$/i, '').trim() : hit.title;
    if (!title) return null;
    const q = encodeURIComponent(title);
    const [movies, series] = await Promise.all([
        tmdb(`/search/movie?query=${q}${hit.year ? `&year=${hit.year}` : ''}`),
        hit.ambiguous ? tmdb(`/search/tv?query=${q}`) : null,
    ]);
    const want = norm(title);
    const exact = (r: any) => norm(r.title ?? r.name ?? '') === want || norm(r.original_title ?? r.original_name ?? '') === want;
    const movie = movies?.results?.find(exact);
    if (hit.ambiguous) {
        // Netflix: a title shared by a film and a series goes to whichever is the more popular.
        const show = series?.results?.find(exact);
        return movie && (!show || movie.popularity > show.popularity) ? pick(movie) : null;
    }
    // Movie-only hosts: the slug may be in another language than TMDB's title, so fall back to its top hit.
    return pick(movie ?? movies?.results?.[0]);
}

export interface MediaResolution { type: 'game' | 'movie'; mediaBookmark: any }

/**
 * Resolves many URLs at once. Cost is proportional to the *media* URLs only —
 * detection is a pure check, so every other URL in an import costs nothing —
 * and what is left is shared work: duplicate URLs are looked up once, store /
 * TMDB calls run in a bounded pool, and all the IGDB lookups travel ten to a
 * request through IGDB's multiquery endpoint (its limit is 4 requests/s).
 * URLs that are not media, or do not resolve, are simply absent from the map.
 */
export async function resolveMediaBookmarks(
    items: Array<{ url: string; title?: string }>
): Promise<Map<string, MediaResolution>> {
    const out = new Map<string, MediaResolution>();
    const hits = new Map<string, { hit: MediaHit; title?: string }>();
    for (const { url, title } of items) {
        if (hits.has(url)) continue;
        const hit = detectMediaUrl(url);
        if (hit) hits.set(url, { hit, title });
    }
    if (hits.size === 0) return out;

    const entries = [...hits.entries()];
    const games = entries.filter(([, v]) => v.hit.kind === 'game');
    const movies = entries.filter(([, v]) => v.hit.kind === 'movie');

    const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
        try { return await fn(); } catch (error) { console.error('[mediaUrl] lookup failed:', error); return null; }
    };

    await Promise.all([
        // Movies: independent TMDB calls.
        pool(movies, 8, async ([url, { hit, title }]) => {
            const mediaBookmark = await safe(() => resolveMovie(hit, title));
            if (mediaBookmark) out.set(url, { type: 'movie', mediaBookmark });
        }),
        // Games: names from the stores (bounded), then IGDB in multiquery chunks.
        (async () => {
            const named = (await pool(games, 8, async ([url, { hit }]) => ({ url, hit, title: await safe(() => storeTitle(hit)) })))
                .filter((g) => g.hit.igdbSlug || g.title);
            const misses: Array<{ url: string; hit: MediaHit; title: string }> = [];
            for (let i = 0; i < named.length; i += 10) {
                const chunk = named.slice(i, i + 10);
                const body = chunk.map((g, j) => `query games "q${j}" { ${exactGameQuery(g.hit, g.title)} };`).join('\n');
                const res = await safe(() => igdbPost('multiquery', body));
                chunk.forEach((g, j) => {
                    const mediaBookmark = pickGame(g.hit, g.title, res?.find((r) => r.name === `q${j}`)?.result);
                    if (mediaBookmark) out.set(g.url, { type: 'game', mediaBookmark });
                    else if (g.title) misses.push(g as typeof g & { title: string });
                });
            }
            // Edition / subtitle differences ("Hades - Deluxe Edition"): fuzzy search, few at a time to stay under IGDB's rate limit.
            await pool(misses, 2, async (g) => {
                const mediaBookmark = pickGame(g.hit, g.title, (await safe(() => igdbPost('games', searchGameQuery(g.title)))) ?? undefined);
                if (mediaBookmark) out.set(g.url, { type: 'game', mediaBookmark });
            });
        })(),
    ]);
    return out;
}

/** The `mediaBookmark` that saveGame / saveMovie expect, or null to save as a website. */
export async function resolveMediaBookmark(url: string, fallbackTitle?: string): Promise<MediaResolution | null> {
    return (await resolveMediaBookmarks([{ url, title: fallbackTitle }])).get(url) ?? null;
}
