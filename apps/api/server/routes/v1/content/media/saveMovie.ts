import { captureException } from '#root/server/utils/sentry.js';
import { defineEventHandler, readBody, createError } from 'h3';
import Parse from 'parse/node.js';
import { fetchUrl, saveBookmarkToUser } from '#root/server/utils/serverUtils.js';

const Websites = Parse.Object.extend("websites");

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL;

const TMBD_API_KEY = (process.env.TMDB_API_KEY || process.env.TMBD_API_KEY) || '';

const TMDB_Options = {
    method: 'GET',
    headers: {
        accept: 'application/json',
        Authorization: `Bearer ${TMBD_API_KEY}`
    }
};

interface SaveMovieBody {
    userId: string;
    mediaBookmark: any;
    savedFrom?: string;
    type?: string;
    customId?: string | null;
}

// Define OpenAPI documentation for this route
defineRouteMeta({
    openAPI: {
        tags: ["Media", "Bookmarks"],
        description: "Save a movie bookmark to the user's collection",
        requestBody: {
            description: "Movie information to save",
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        required: ["userId", "mediaBookmark"],
                        properties: {
                            userId: { type: "string", description: "ID of the user saving the movie" },
                            mediaBookmark: { type: "object", description: "Movie metadata from TMDB" },
                            savedFrom: { type: "string", description: "Source of the bookmark", default: "website" },
                            type: { type: "string", description: "Type of bookmark", default: "movie" },
                            customId: { type: "string", description: "Custom identifier", nullable: true }
                        }
                    }
                }
            }
        },
        responses: {
            "200": {
                description: "Movie successfully saved",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                status: { type: "string", example: "ok" },
                                savedSite: { type: "object", description: "The saved movie bookmark object" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Invalid request parameters"
            },
            "500": {
                description: "Server error during movie saving"
            }
        }
    }
});

export default defineEventHandler(async (event) => {
    try {
        const rawBody = await readBody(event);
        const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

        if (!body.userId) throw createError({ statusCode: 400, statusMessage: 'No user ID provided' });
        if (!body.mediaBookmark) throw createError({ statusCode: 400, statusMessage: 'No media bookmark provided' });

        const movieService = new SaveMovie();
        const result = await movieService.saveMovieAsBookmark(
            body.mediaBookmark,
            body.userId,
            body.savedFrom || 'website',
            body.type || 'movie',
            body.customId || null
        );

        // saveMovieAsBookmark already links the bookmark to the user via
        // saveBookmarkToUser; the previous extra call here had its arguments
        // swapped and crashed when the save failed.
        if (result.status === 'error') {
            throw createError({ statusCode: 500, statusMessage: 'Error saving movie bookmark' });
        }

        return result;
    } catch (error) {
        console.error('[saveMovie] Error saving movie bookmark:', error);
        throw createError({ statusCode: 500, statusMessage: 'Error saving movie bookmark' });
    }
});

class SaveMovie {
    async saveMovieAsBookmark(
        mediaBookmark: any,
        userId: string,
        savedFrom: string,
        type: string,
        customId: string | null
    ) {
        try {
            // Get user object
            const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
            const bookmark = new Websites();

            bookmark.set("OGImage", 'https://image.tmdb.org/t/p/w500' + mediaBookmark.poster_path);

            // Parallelize TMDB API calls for better performance
            const [movieDetails, movieCredits, movieImages, movieKeywords, movieVideos] = await Promise.all([
                this.fetchMovieDetails(mediaBookmark.id),
                this.fetchMovieCredits(mediaBookmark.id),
                this.fetchMovieImages(mediaBookmark.id),
                this.fetchMovieKeywords(mediaBookmark.id),
                this.fetchMovieVideos(mediaBookmark.id)
            ]);

            movieDetails.credits = movieCredits;
            movieDetails.movieImages = movieImages;
            movieDetails.movieKeywords = movieKeywords;
            movieDetails.videos = movieVideos;

            movieDetails.poster_path = movieDetails.poster_path != undefined ? 'https://image.tmdb.org/t/p/original' + movieDetails.poster_path : movieDetails.poster_path;
            movieDetails.backdrop_path = movieDetails.backdrop_path != undefined ? 'https://image.tmdb.org/t/p/original' + movieDetails.backdrop_path : movieDetails.backdrop_path;

            bookmark.set("siteTitle", movieDetails.title);
            bookmark.set("tags", []);
            bookmark.set("url", 'https://www.themoviedb.org/movie/' + movieDetails.id);
            bookmark.set("user", user);
            bookmark.setACL(new Parse.ACL(user));
            bookmark.set("customId", customId);
            bookmark.set("savedFrom", savedFrom);
            bookmark.set("mediaTypeObject", movieDetails);
            bookmark.set("type", type);

            let savedSite = await bookmark.save(null, { useMasterKey: true });

            await saveBookmarkToUser(user, savedSite);

            return { status: 'ok', savedSite };
        } catch (error) {
            console.error('Error saving bookmark as movie:', error);
            return { status: 'error', error };
        }
    }

    async fetchMovieUrl(url: string) {
        try {
            const response = await fetchUrl(url, TMDB_Options, 'fetchMovieUrl');
            if ('error' in response) {
                console.error('Error fetching URL:' + response.error);
                return { error: response.error };
            }
            // fetchUrl already returns parsed JSON data, no need to call .json()
            return response;
        } catch (err) {
            console.error('Error fetching URL:' + err);
            throw err;
        }
    }

    async fetchMovieDetails(id: number) {
        const url = `https://api.themoviedb.org/3/movie/${id}`;
        return await this.fetchMovieUrl(url);
    }

    async fetchMovieCredits(id: number) {
        const url = `https://api.themoviedb.org/3/movie/${id}/credits`;
        let credits = await this.fetchMovieUrl(url);

        // Only return the first 10 credits for crew and cast
        credits.crew = credits.crew.slice(0, 10);
        credits.cast = credits.cast.slice(0, 10);

        return credits;
    }

    async fetchMovieImages(id: number) {
        const url = `https://api.themoviedb.org/3/movie/${id}/images`;
        let images = await this.fetchMovieUrl(url);

        // only return the first 10 images
        images.backdrops = images.backdrops.slice(0, 10);
        images.posters = images.posters.slice(0, 10);

        return images;
    }

    async fetchMovieKeywords(id: number) {
        const url = `https://api.themoviedb.org/3/movie/${id}/keywords`;
        let keywords = await this.fetchMovieUrl(url);

        return keywords;
    }

    async fetchMovieVideos(id: number) {
        const url = `https://api.themoviedb.org/3/movie/${id}/videos`;
        return await this.fetchMovieUrl(url);
    }
}