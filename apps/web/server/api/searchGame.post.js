// IGDB game search for the movie/game composer (web: newBookmark.vue; native:
// BFFClient.searchGames).
//
// Anonymous on purpose: the native app calls it without its session (it skips
// the cookie exchange so a search typed before the jar is warm still answers),
// so it is held to a per-IP rate limit in server/middleware/rateLimit.ts
// instead of a session check.
//
// The Twitch app credentials come from runtime config, and the app access
// token they buy stays on the server: it used to be returned to the caller and
// accepted back as `gameToken`, which handed anyone a working token for this
// app's IGDB quota.

const MAX_QUERY_LENGTH = 100

// One client-credentials token per process, refreshed a minute before Twitch
// says it expires (they last about two months).
let cachedToken = null
let cachedTokenExpiresAt = 0
let pendingToken = null

async function getAppToken(clientId, clientSecret) {
    if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken
    if (pendingToken) return pendingToken

    pendingToken = (async () => {
        try {
            const response = await $fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'client_credentials',
                }).toString(),
            })
            if (!response?.access_token) throw new Error('Twitch returned no access token')
            const lifetimeMs = Math.max(0, (Number(response.expires_in) || 3600) * 1000 - 60_000)
            cachedToken = response.access_token
            cachedTokenExpiresAt = Date.now() + lifetimeMs
            return cachedToken
        } finally {
            pendingToken = null
        }
    })()
    return pendingToken
}

function forgetAppToken() {
    cachedToken = null
    cachedTokenExpiresAt = 0
}

/**
 * The query goes inside an Apicalypse string literal (`search "…";`). A `"`
 * would close it and a `;` start a new clause (`fields *`, `limit 500`, a
 * different endpoint's filters), so both go, along with backslashes and
 * control characters, and the length is capped.
 */
function sanitizeIgdbSearch(value) {
    if (typeof value !== 'string') return ''
    return value
        .replace(/[\u0000-\u001f\u007f"\\;]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_QUERY_LENGTH)
        .trim()
}

async function searchIgdb(clientId, token, query) {
    return $fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Client-ID': clientId,
            'Authorization': `Bearer ${token}`,
        },
        body: `limit 10; search "${query}"; fields name, platforms.name, cover.url, first_release_date, rating, summary, slug;`,
    })
}

export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event)
        const gameToSearch = sanitizeIgdbSearch(body?.gameToSearch)
        if (!gameToSearch) return { games: [] }

        const { twitchClientId, twitchClientSecret } = useRuntimeConfig(event)
        if (!twitchClientId || !twitchClientSecret) {
            console.error('[searchGame] TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not configured')
            return { error: { message: 'Game search is not configured' } }
        }

        let token = await getAppToken(twitchClientId, twitchClientSecret)
        let games
        try {
            games = await searchIgdb(twitchClientId, token, gameToSearch)
        } catch (error) {
            // A revoked or expired token: get a fresh one and try once more.
            if (error?.status !== 401 && error?.statusCode !== 401) throw error
            forgetAppToken()
            token = await getAppToken(twitchClientId, twitchClientSecret)
            games = await searchIgdb(twitchClientId, token, gameToSearch)
        }

        if (!Array.isArray(games)) return { error: { message: 'Unexpected response from IGDB' } }
        if (games[0] && games[0].cause) return { error: games }

        games = games.map(game => {
            if (game.platforms) {
                game.platforms.sort((a, b) => a.name.length - b.name.length);
            }
            return game;
        });

        return { games }
    } catch (error) {
        console.log('error searching games: ', error?.message || error)
        return { error: { message: 'Game search failed' } }
    }
})
