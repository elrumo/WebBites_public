/**
 * Stored-file URLs, as this container can reach them.
 *
 * Parse (gridfs) and the S3 driver hand out URLs on the public address, and a
 * row keeps them that way because browsers read them. Inside the Docker network
 * the public address is not reachable when it is `http://localhost:8080` (that is
 * this container's own loopback), and with a real domain it is a pointless trip
 * out and back through Caddy. `toInternalUrl` swaps the public prefix of OUR file
 * URLs for the in-network one, right before a server-side fetch. Nothing stored or
 * returned to a browser changes.
 *
 * Only exact prefixes are swapped, never a host or an arbitrary URL, so this is
 * not a way around `safeUrl.ts`: every other URL comes back untouched.
 *
 *   <SITE_URL>/parse/files/…   →  <VITE_PARSE_URL>/files/…     (Parse, gridfs)
 *   <S3_PUBLIC_URL>/…          →  <S3_ENDPOINT_URL>/…          (rustfs, the S3 driver)
 *
 * A pair is used only when the in-network side is a bare service name (`parse`,
 * `rustfs`: no dot). That is how docker-compose.yml wires it, and it leaves a
 * deployment whose Parse/S3 endpoint is a real hostname (hosted webbites.io, AWS
 * S3 with a CDN in front) exactly as it was: there the public URL is reachable
 * and the endpoint may need signed requests.
 */

const trim = (value: string | undefined) => (value ?? '').trim().replace(/\/+$/, '');

/** `parse`, `rustfs`: a service name on the compose network, not a public host. */
function isServiceName(url: string): boolean {
    try {
        return !new URL(url).hostname.includes('.');
    } catch {
        return false;
    }
}

/** [public prefix, in-network prefix], both ending in `/`. Read per call: settings can change live. */
function prefixes(): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];

    const parse = trim(process.env.VITE_PARSE_URL);
    const site = trim(process.env.SITE_URL || process.env.VITE_WEBSITE_URL);
    if (parse && site && isServiceName(parse)) pairs.push([`${site}/parse/files/`, `${parse}/files/`]);

    const s3Public = trim(process.env.S3_PUBLIC_URL);
    const s3Endpoint = trim(process.env.S3_ENDPOINT_URL);
    if (s3Public && s3Endpoint && isServiceName(s3Endpoint)) pairs.push([`${s3Public}/`, `${s3Endpoint}/`]);

    return pairs;
}

/** `url` with our public file prefix swapped for the in-network one, or `url` itself when none applies. */
export function toInternalUrl(url: string): string {
    if (typeof url !== 'string') return url;

    let given: string;
    try {
        given = new URL(url).href; // normalised: host case, default port, dot segments
    } catch {
        return url;
    }

    for (const [publicPrefix, internalPrefix] of prefixes()) {
        try {
            const from = new URL(publicPrefix).href;
            // `given` is normalised, so a `/../` that climbs out of the prefix has
            // already stopped matching `from`.
            if (given.startsWith(from)) return new URL(internalPrefix).href + given.slice(from.length);
        } catch {
            // a malformed setting: leave the URL alone
        }
    }
    return url;
}
