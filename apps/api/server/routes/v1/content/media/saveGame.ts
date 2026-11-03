import { captureException } from '#root/server/utils/sentry.js';
import { defineEventHandler, readBody, createError } from 'h3';
import Parse from 'parse/node.js';
import { fetchUrl, saveBookmarkToUser } from '#root/server/utils/serverUtils.js';

const Websites = Parse.Object.extend("websites");

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL;

let TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
let TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';

interface SaveGameBody {
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
        description: "Save a game bookmark to the user's collection",
        requestBody: {
            description: "Game information to save",
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        required: ["userId", "mediaBookmark"],
                        properties: {
                            userId: { type: "string", description: "ID of the user saving the game" },
                            mediaBookmark: { type: "object", description: "Game metadata from IGDB" },
                            savedFrom: { type: "string", description: "Source of the bookmark", default: "website" },
                            type: { type: "string", description: "Type of bookmark", default: "game" },
                            customId: { type: "string", description: "Custom identifier", nullable: true }
                        }
                    }
                }
            }
        },
        responses: {
            "200": {
                description: "Game successfully saved",
                content: {
                    "application/json": {
                        schema: {
                            type: "object",
                            properties: {
                                status: { type: "string", example: "ok" },
                                savedSite: { type: "object", description: "The saved game bookmark object" }
                            }
                        }
                    }
                }
            },
            "400": {
                description: "Invalid request parameters"
            },
            "500": {
                description: "Server error during game saving"
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

        const gameService = new SaveGame();
        const result = await gameService.saveGameAsBookmark(
            body.mediaBookmark,
            body.userId,
            body.savedFrom || 'website',
            body.type || 'game',
            body.customId || null
        );

        return result;
    } catch (error) {
        console.error('[saveGame] Error saving game bookmark:', error);
        throw createError({ statusCode: 500, statusMessage: 'Error saving game bookmark' });
    }
});

class SaveGame {
    async saveGameAsBookmark(
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

            bookmark.set("OGImage", mediaBookmark.cover.url.replaceAll('t_thumb', 't_1080p').replaceAll('//', 'https://'));

            let gameDetails = await this.fetchGameDetails(mediaBookmark.id);

            const replaceThumbWithCoverBig = (obj) => {
                for (let key in obj) {
                    if (typeof obj[key] === 'string') {
                        obj[key] = obj[key].replaceAll('t_thumb', 't_1080p');
                        if (obj[key].startsWith('//')) {
                            obj[key] = 'https:' + obj[key];
                        }
                    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        replaceThumbWithCoverBig(obj[key]);
                    }
                }
            };

            replaceThumbWithCoverBig(gameDetails);

            let tags = gameDetails.keywords ? gameDetails.keywords.map(keyword => keyword.name) : [];
            if (gameDetails.message) return { status: 'error', error: gameDetails };

            bookmark.set("url", mediaBookmark.url ? mediaBookmark.url : 'https://www.igdb.com/games/' + gameDetails.slug);
            bookmark.set("mediaTypeObject", gameDetails);
            bookmark.set("siteTitle", gameDetails.name);
            bookmark.set("tags", tags);
            bookmark.set("user", user);
            bookmark.setACL(new Parse.ACL(user));
            bookmark.set("customId", customId);
            bookmark.set("savedFrom", savedFrom);
            bookmark.set("type", type);

            let savedSite = await bookmark.save(null, { useMasterKey: true });

            await saveBookmarkToUser(user, savedSite)

            return { status: 'ok', savedSite };
        } catch (error) {
            console.error('[saveGame] Error saving bookmark as game:', error);
            return { status: 'error', error };
        }
    }

    async fetchGameDetails(id: number) {
        try {
            let tokenData = await fetchUrl('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
            }, 'fetchGameDetails 1');

            if ('error' in tokenData) {
                return { message: tokenData.error };
            }

            const access_token = tokenData.access_token;

            let gameDetails = await fetchUrl(
                "https://api.igdb.com/v4/games",
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Client-ID': TWITCH_CLIENT_ID,
                        'Authorization': `Bearer ${access_token}`,
                    },
                    body: ` limit 1;
                            where id = ${id};
                            fields age_ratings.*,aggregated_rating,aggregated_rating_count,alternative_names.comment,alternative_names.name,artworks.animated,artworks.url,artworks.height,artworks.width,bundles.*,category,checksum,collection,collections.name,collections.url,collections.games.name,collections.games.first_release_date,collections.games.cover.url,cover.url,cover.animated,created_at,dlcs.*,expanded_games.*,expansions.*,external_games.category,external_games.countries,external_games.platform,external_games.url,external_games.uid,first_release_date,follows,forks.*,franchise.*,franchises.name,franchises.url,franchises.id,game_engines.*,game_localizations.name,game_localizations.cover.url,game_localizations.region.name,game_modes.name,game_modes.url,genres.name,genres.url,hypes,involved_companies.company.name,involved_companies.company.url,involved_companies.company.logo.url,involved_companies.developer,involved_companies.porting,involved_companies.publisher,keywords.name,keywords.url,language_supports.language.name,language_supports.language_support_type.name,name,parent_game.*,platforms.abbreviation,platforms.name,platforms.platform_logo.*,platforms.url,ports.*,rating,rating_count,release_dates.date,release_dates.platform.name,release_dates.platform.abbreviation,release_dates.platform.platform_logo.*,release_dates.region,remakes.*,remasters.*,screenshots.url,screenshots.width,screenshots.height,similar_games.id,similar_games.name,similar_games.cover.url,slug,standalone_expansions.*,status,storyline,summary,themes.name,themes.url,total_rating,total_rating_count,updated_at,url,version_parent.name,version_title,videos.*,websites.url;
                       `
                }, 'fetchGameDetails 2');

            if ('error' in gameDetails) {
                return { message: gameDetails.error };
            }

            return gameDetails[0] ? gameDetails[0] : [];
        } catch (error) {
            console.error('[saveGame] Error fetching game details:', error);
            return { error: error };
        }
    }
}
