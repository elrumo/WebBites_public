// Where the screenshot / render service lives. WebBites ships one (apps/screenshot, image
// elrumo/webbites-screenshot) but it is optional: with no SCREENSHOT_SERVICE_URL, bookmark
// cards use the page's OG image and JS-rendered pages are not fetched.
//
// There is deliberately no default URL: an install that has not configured a service must not
// send the addresses its users bookmark to anyone else's server.

/** Base URL of the service, without a trailing slash or endpoint path. Null when not configured. */
export function screenshotServiceBase(): string | null {
    const raw = (process.env.SCREENSHOT_SERVICE_URL || '').trim();
    if (!raw) return null;
    // Older configs pointed straight at the endpoint ("https://host/screenshot").
    return raw.replace(/\/+$/, '').replace(/\/(screenshot|render)$/, '');
}

export function screenshotServiceUrl(endpoint: 'screenshot' | 'render'): string | null {
    const base = screenshotServiceBase();
    return base ? `${base}/${endpoint}` : null;
}

export function screenshotServiceKey(): string {
    return process.env.SCREENSHOT_API_KEY || '';
}

/** The third-party Siterelic scraper, only used when the operator brought their own key. */
export function siterelicKey(): string | null {
    return (process.env.VITE_SITERELIC_KEY || process.env.SITERELIC_KEY || '').trim() || null;
}
