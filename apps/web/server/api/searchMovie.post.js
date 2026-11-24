import { TMDB } from 'tmdb-ts';

// TMDB movie search for the movie/game composer (web: newBookmark.vue; native:
// BFFClient.searchMovies).
//
// Anonymous on purpose, like searchGame: the native app calls it without its
// session, so it is held to a per-IP rate limit in
// server/middleware/rateLimit.ts instead of a session check. The TMDB token
// comes from runtime config (TMDB_API_TOKEN).

const MAX_QUERY_LENGTH = 100

let client = null
let clientToken = ''

function tmdbClient(token) {
    if (!client || clientToken !== token) {
        client = new TMDB(token)
        clientToken = token
    }
    return client
}

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event)
        const movieToSearch = typeof body?.movieToSearch === 'string'
            ? body.movieToSearch.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
            : ''
        if (!movieToSearch) return { movies: { page: 1, results: [], total_pages: 0, total_results: 0 } }

        const { tmdbApiToken } = useRuntimeConfig(event)
        if (!tmdbApiToken) {
            console.error('[searchMovie] TMDB_API_TOKEN is not configured')
            return { error: { message: 'Movie search is not configured' } }
        }

        const movies = await tmdbClient(tmdbApiToken).search.movies({ query: movieToSearch });

        return { movies }
    } catch (error) {
        console.log('error searching movie: ', error?.message || error)
        return { error: { message: 'Movie search failed' } }
    }
})
