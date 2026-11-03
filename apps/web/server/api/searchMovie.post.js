import fetch from 'node-fetch';
import { TMDB } from 'tmdb-ts';

export default defineEventHandler(async (event) => {
    try {
        let body = await readBody(event)
        let movieToSearch = body.movieToSearch;

        // Movie search is optional: it needs a TMDB read-access token (TMDB_API_KEY).
        const tmdbKey = process.env.TMDB_API_KEY;
        if (!tmdbKey) return { movies: { results: [] } }
        const tmdb = new TMDB(tmdbKey);

        const movies = await tmdb.search.movies({ query: movieToSearch });
        
        return { movies }
    } catch (error) {
        console.log("error searching movie: ", error)
        return { error }
    }
})