/**
 * Where this installation lives and what it is called.
 *
 * Used wherever the server writes a link into an email or a redirect, or puts a name on a
 * message. Nothing here defaults to a hosted domain: an install that has not set SITE_URL
 * gets localhost links rather than someone else's website.
 */

/** The public URL of the web app, without a trailing slash. SITE_URL, or the older VITE_WEBSITE_URL. */
export function siteUrl(): string {
    const configured = process.env.SITE_URL || process.env.VITE_WEBSITE_URL || process.env.APP_URL || 'http://localhost:3000';
    return configured.trim().replace(/\/+$/, '');
}

/** The product name shown in emails and consent screens. */
export function appName(): string {
    return (process.env.APP_NAME || 'WebBites').trim() || 'WebBites';
}

/** The host part of the site URL, for default addresses (noreply@host). */
export function siteHost(): string {
    try {
        return new URL(siteUrl()).hostname;
    } catch {
        return 'localhost';
    }
}

/**
 * This server's own address, with a trailing slash, for the requests it makes to itself (job
 * handlers calling an endpoint, the sign-up flow starting its follow-up). Going out through the
 * public address and back in needs DNS, TLS and a proxy rule for every such path, and is slower;
 * INTERNAL_API_URL overrides it for a split deployment.
 */
export function selfUrl(): string {
    const configured = (process.env.INTERNAL_API_URL || '').trim();
    const url = configured || `http://127.0.0.1:${process.env.PORT || process.env.NITRO_PORT || 3000}`;
    return url.replace(/\/+$/, '') + '/';
}
