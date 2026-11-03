/**
 * Tests for game / movie URL detection. Pure cases always run; set LIVE=1 to
 * also hit IGDB / TMDB / Steam / iTunes with the keys from .env. Run with:
 *
 *   npm run test:mediaUrl
 */

import { detectMediaUrl, resolveMediaBookmark, resolveMediaBookmarks } from './mediaUrl';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => {
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};
const is = (url: string, want: Record<string, any> | null) => {
    const got = detectMediaUrl(url);
    const ok = want === null ? got === null : !!got && Object.entries(want).every(([k, v]) => (got as any)[k] === v);
    if (!ok) console.log('   got', got);
    check(`${want ? 'detects' : 'ignores'} ${url}`, ok);
};

is('https://store.steampowered.com/app/1145360/Hades/', { kind: 'game', steamAppId: '1145360' });
is('https://store.steampowered.com/app/1145360', { kind: 'game', steamAppId: '1145360' });
is('https://store.steampowered.com/', null);
is('https://apps.apple.com/us/app/subway-surfers/id512939461', { kind: 'game', appleId: '512939461' });
is('https://apps.apple.com/us/developer/foo/id123', null);
is('https://store.epicgames.com/en-US/p/hollow-knight', { kind: 'game', title: 'hollow knight' });
is('https://www.gog.com/en/game/the_witcher_3_wild_hunt', { kind: 'game', title: 'the witcher 3 wild hunt' });
is('https://www.nintendo.com/us/store/products/the-legend-of-zelda-tears-of-the-kingdom-switch/', { kind: 'game', title: 'the legend of zelda tears of the kingdom' });
is('https://www.igdb.com/games/chrono-trigger', { kind: 'game', igdbSlug: 'chrono-trigger' });

is('https://www.themoviedb.org/movie/603-the-matrix', { kind: 'movie', tmdbId: 603 });
is('https://www.themoviedb.org/tv/1396-breaking-bad', null);
is('https://www.imdb.com/title/tt0133093/', { kind: 'movie', imdbId: 'tt0133093' });
is('https://m.imdb.com/es/title/tt0133093/reviews', { kind: 'movie', imdbId: 'tt0133093' });
is('https://www.imdb.com/name/nm0000206/', null);
is('https://www.netflix.com/title/81091393', { kind: 'movie', needsTitle: true, ambiguous: true });
is('https://www.netflix.com/es/title/81091393', { kind: 'movie', needsTitle: true });
is('https://www.netflix.com/browse', null);
is('https://www.filmin.es/pelicula/el-padrino', { kind: 'movie', title: 'el padrino' });
is('https://www.filmin.es/serie/succession', null);
is('https://letterboxd.com/film/dune-2021/', { kind: 'movie', title: 'dune', year: 2021 });
is('https://www.rottentomatoes.com/m/the_godfather', { kind: 'movie', title: 'the godfather' });
is('https://www.justwatch.com/us/movie/inception', { kind: 'movie', title: 'inception' });

is('https://example.com/app/123', null);
is('https://github.com/foo/bar', null);
is('not a url', null);

const run = async () => {
    if (process.env.LIVE) {
        const g = await resolveMediaBookmark('https://store.steampowered.com/app/1145360/Hades/');
        check('live: steam Hades -> IGDB game', g?.type === 'game' && !!g.mediaBookmark.cover?.url);
        const dlc = await resolveMediaBookmark('https://store.steampowered.com/app/1182140/'); // soundtrack/DLC-type app
        check('live: non-game steam app is not forced into a game', dlc === null || dlc.type === 'game');
        const a = await resolveMediaBookmark('https://apps.apple.com/us/app/subway-surfers/id512939461');
        check('live: App Store game -> IGDB game', a?.type === 'game');
        const notGame = await resolveMediaBookmark('https://apps.apple.com/us/app/notes/id1110145109');
        check('live: App Store non-game stays a website', notGame === null);
        const m = await resolveMediaBookmark('https://www.imdb.com/title/tt0133093/');
        check('live: IMDb Matrix -> TMDB 603', m?.mediaBookmark.id === 603);
        const tv = await resolveMediaBookmark('https://www.imdb.com/title/tt0903747/');
        check('live: IMDb series stays a website', tv === null);
        const l = await resolveMediaBookmark('https://letterboxd.com/film/inception/');
        check('live: letterboxd Inception -> movie', l?.type === 'movie');
        const n = await resolveMediaBookmark('https://www.netflix.com/title/70131314', 'Inception | Netflix');
        check('live: netflix title via client title -> movie', n?.type === 'movie');

        const urls = [
            'https://store.steampowered.com/app/1145360/', 'https://store.steampowered.com/app/1145360/', // duplicate
            'https://www.igdb.com/games/chrono-trigger', 'https://store.epicgames.com/en-US/p/hollow-knight',
            'https://www.themoviedb.org/movie/603', 'https://www.imdb.com/title/tt0133093/',
            'https://example.com/post', 'https://www.imdb.com/title/tt0903747/',
        ];
        const t0 = Date.now();
        const batch = await resolveMediaBookmarks(urls.map((url) => ({ url })));
        console.log(`   batch of ${urls.length} in ${Date.now() - t0}ms`);
        check('live batch: resolves the media URLs, once each', batch.size === 5 && !batch.has('https://example.com/post') && !batch.has('https://www.imdb.com/title/tt0903747/'));
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
};
run();
