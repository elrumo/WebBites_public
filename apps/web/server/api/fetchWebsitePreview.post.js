import { load } from 'cheerio';
import { verifySession } from '../utils/sessionCache';
import { safeFetch } from '../utils/safeUrl';

// Lightweight metadata extractor using cheerio only
function extractMetadata($, url) {
    // Helper to get meta content by property or name
    const getMeta = (attr, value) => {
        return $(`meta[${attr}="${value}"]`).attr('content') ||
               $(`meta[${attr}="${value.toLowerCase()}"]`).attr('content');
    };

    // Extract title
    const title = getMeta('property', 'og:title') ||
                  getMeta('name', 'twitter:title') ||
                  $('title').text() ||
                  '';

    // Extract description
    const description = getMeta('property', 'og:description') ||
                       getMeta('name', 'twitter:description') ||
                       getMeta('name', 'description') ||
                       '';

    // Extract image
    const image = getMeta('property', 'og:image') ||
                  getMeta('name', 'twitter:image') ||
                  getMeta('property', 'og:image:url') ||
                  '';

    // Extract favicon/logo
    const favicon = $('link[rel="icon"]').attr('href') ||
                   $('link[rel="shortcut icon"]').attr('href') ||
                   $('link[rel="apple-touch-icon"]').attr('href') ||
                   '';

    // Extract publisher/site name
    const publisher = getMeta('property', 'og:site_name') ||
                     getMeta('name', 'twitter:site') ||
                     getMeta('property', 'og:publisher') ||
                     '';

    // Extract canonical URL
    const canonicalUrl = $('link[rel="canonical"]').attr('href') ||
                        getMeta('property', 'og:url') ||
                        url;

    // Extract author
    const author = getMeta('name', 'author') ||
                  getMeta('property', 'article:author') ||
                  '';

    // Extract date
    const date = getMeta('property', 'article:published_time') ||
                getMeta('name', 'publish_date') ||
                getMeta('name', 'date') ||
                '';

    return {
        title: title.trim(),
        description: description.trim(),
        image,
        favicon,
        publisher,
        url: canonicalUrl,
        canonicalUrl,
        author,
        date
    };
}

export default defineEventHandler(async (event) => {
    // Fetches an arbitrary address on the user's behalf, so only for signed-in users, and only
    // public ones (see safeFetch).
    const sessionUser = await verifySession(getCookie(event, 'parse.session'));
    if (!sessionUser) {
        throw createError({ statusCode: 401, statusMessage: 'Not authenticated' });
    }

    let body = await readBody(event);
    let url = body.url;

    try{
        if (!url) {
            console.log("No URL found to fetch website preview")
            throw new Error('URL is required');
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const html = await fetchHtml(url);
        const $ = load(html);

        // Extract metadata using our lightweight cheerio-based extractor
        const metadata = extractMetadata($, url);

        const title = metadata.title || '';
        const description = metadata.description || '';
        const imageUrl = metadata.image || '';
        const baseUrl = metadata.url || '';
        const favicon = metadata.favicon || '';
        const canonicalUrl = metadata.canonicalUrl || '';

        return {
            title,
            description,
            imageUrl,
            baseUrl,
            favicon,
            canonicalUrl,
            url,
            metadata
        };
    } catch(error){
        console.log("error fetching website: ", error);
        return error
    }
})

async function fetchHtml(url) {
    try {
        const response = await fetchUrl(url, {}, 'fetchHtml');
        return await response.text();
    } catch (error) {
        console.log('Error fetching HTML:', error);
        throw error;
    }
}

async function fetchUrl(url, options = {}, funcName = 'fetchUrl') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await safeFetch(url, { signal: controller.signal, ...options });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.log(`Request timed out in ${funcName} for ${url}`);
            return { error: 'Timeout, took longer than 15s' };
        } else {
            console.error('error fetching URL in fetchUrl:' + error);
            return { error: error };
        }
    }
}
