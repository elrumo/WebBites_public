import fetch from 'node-fetch';
import { TMDB } from 'tmdb-ts';

export default defineEventHandler(async (event) => {
    try {
        let body = await readBody(event)
        let gameToSearch = body.gameToSearch;
        let gameToken = body.gameToken ? body.gameToken : false;

        console.log("gameToSearch: ", gameToSearch);

        // Game search is optional: it needs a Twitch application (IGDB), TWITCH_CLIENT_ID and
        // TWITCH_CLIENT_SECRET. Without them it simply finds nothing.
        const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID
        const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET
        if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return { games: [] }


        if (!gameToken){
            let tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
            })
            tokenResponse = await tokenResponse.json();
            gameToken = tokenResponse.access_token
        }

        let response = await fetch(
            "https://api.igdb.com/v4/games",
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${gameToken}`,
                },
                body: `limit 10; search "${gameToSearch}"; fields name, platforms.name, cover.url, first_release_date, rating, summary, slug;`
            });
        let games = await response.json();

        if (games[0] && games[0].cause) return { error: games }

        games = games.map(game => {
            if (game.platforms) {
                game.platforms.sort((a, b) => a.name.length - b.name.length);
            }
            return game;
        });

        // console.log("games.length: ", games.length);

        return { games, token: gameToken }
    } catch (error) {
        console.log("error searching games: ", error)
        return { error }
    }
})