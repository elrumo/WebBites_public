import { prepareMeilisearchWhenReady } from '../utils/meilisearchSetup';
import { settingsReady } from '../utils/settings';

/**
 * Prepares the search index at startup so a fresh install can search without anyone running a
 * dev-only route. Does not hold up the server: it keeps trying in the background until
 * Meilisearch answers. MEILISEARCH_AUTO_SETUP=false leaves the index alone.
 */
export default defineNitroPlugin(() => {
    if (process.env.MEILISEARCH_AUTO_SETUP === 'false') return;
    settingsReady().then(() => prepareMeilisearchWhenReady()).catch((error) => console.error('[meilisearch] setup failed:', error));
});
