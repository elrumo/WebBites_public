/**
 * Which objects in the bucket belong to a user, for deleting an account.
 *
 * Most of a user's files are found by prefix: Parse Server's S3 adapter keys an
 * upload named `parseUser=<id>_fileName=<name>` as `parse/user/<id>/<name>`
 * (`generateKey` in parse-compose's config), and the backend's own `uploadToS3`
 * writes `/userFiles/<id>/…`. Anything uploaded under its plain name sits
 * outside both — the native app's direct uploads (`device-screenshot-<uuid>`,
 * `note-drawing-<uuid>`, share-sheet and composer media), the web editor's
 * images, the bookmark import file, a drawing asset — at `parse/<name>`. The
 * only thing that says whose those are is the row pointing at them, so they are
 * found by reading the rows before they go.
 *
 * Found is not the same as safe to delete. Parse runs with
 * `preserveFileName: true`, so a plain name is the key as it stands: two users
 * who each upload `image.png` share one object, and deleting it for one takes
 * it from the other. Only a key whose name could not have been anyone else's
 * is deleted — see `isStrayUserKey`. The rest stays behind until uploads stop
 * using plain names.
 *
 * Pure on purpose, so it is testable without Parse or S3.
 */

/** Parse Server's `bucketPrefix` (parse-compose `src/config.js`). */
const PARSE_PREFIX = 'parse/';

/** The id `createFileName` files an upload under when it was given no user. */
const ANON_USER = 'anon';

/**
 * Where our public URLs point: the file store's public base (`S3_PUBLIC_URL`, which is also the
 * Parse adapter's `baseUrl`), plus any hosts listed in STORAGE_LEGACY_HOSTS (a deployment that
 * moved store keeps its old URLs in its rows). The path is `/<bucket>/<key>` on all of them.
 * Built on each call so it follows the settings.
 */
function storageUrl(): RegExp {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const alternatives: string[] = [];

    const publicUrl = (process.env.S3_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (publicUrl) alternatives.push(escape(publicUrl));

    for (const host of (process.env.STORAGE_LEGACY_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)) {
        alternatives.push(`https?:\\/\\/${escape(host)}`);
    }

    if (alternatives.length === 0) return /(?!)/g; // nothing configured: matches nothing
    return new RegExp(`(?:${alternatives.join('|')})\\/([^\\s"'<>()\\\\]+)`, 'g');
}

/** A UUID anywhere in the name: every native upload that is not user-named. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The 32-hex prefix Parse adds itself whenever `preserveFileName` is off. */
const PARSE_RANDOM_PREFIX = /^[0-9a-f]{32}_/i;

/** The prefixes swept whole for a user — every key under them is theirs. */
export function userStoragePrefixes(userId: string): string[] {
    // `uploadToS3` passes its key with a leading slash, hence both spellings.
    return [`${PARSE_PREFIX}user/${userId}/`, `userFiles/${userId}/`, `/userFiles/${userId}/`];
}

/** The bucket key of a Parse file, from its stored name — `generateKey`'s mapping. */
export function keyForParseFileName(name: string): string {
    const match = name.match(/^parseUser=([^_]+)_(?:fileName=)?(.+)$/i);
    return PARSE_PREFIX + (match ? `user/${match[1]}/${match[2]}` : name);
}

function keyForStorageUrlPath(path: string, bucket: string): string | null {
    const withoutQuery = path.split(/[?#]/)[0];
    if (!withoutQuery.startsWith(`${bucket}/`)) return null;
    try {
        return decodeURIComponent(withoutQuery.slice(bucket.length + 1)) || null;
    } catch {
        return null;
    }
}

/**
 * Every bucket key a row refers to, from its `toJSON()`.
 *
 * Two shapes: a Parse file (`{ __type: 'File', name }`), and a URL into the
 * bucket anywhere in a string — a bare `fileUrl`, an `images[].url`, or an
 * `<img src>` inside a note's HTML. Pointers and relations are other rows and
 * are not followed.
 */
export function storageKeysIn(value: unknown, bucket: string, into: Set<string> = new Set()): Set<string> {
    if (typeof value === 'string') {
        for (const match of value.matchAll(storageUrl())) {
            const key = keyForStorageUrlPath(match[1], bucket);
            if (key) into.add(key);
        }
    } else if (Array.isArray(value)) {
        for (const item of value) storageKeysIn(item, bucket, into);
    } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (record.__type === 'File') {
            if (typeof record.name === 'string' && record.name) into.add(keyForParseFileName(record.name));
        } else if (record.__type !== 'Pointer' && record.__type !== 'Relation') {
            for (const item of Object.values(record)) storageKeysIn(item, bucket, into);
        }
    }
    return into;
}

/**
 * `value` with every reference to a moved object pointed at its new key — the
 * inverse of `storageKeysIn`, over the same two shapes. `moves` maps old bucket
 * key to new bucket key; anything not in it comes back untouched, and so does
 * the host, the query string and the fragment of a rewritten URL.
 *
 * Built for `scripts/relink-salted-uploads.ts`, which repoints rows at the
 * objects `generateKey` actually wrote. Returns a copy; `value` is not mutated.
 */
export function relinkStorageKeys<T>(value: T, bucket: string, moves: Map<string, string>): T {
    const walk = (node: unknown): unknown => {
        if (typeof node === 'string') {
            return node.replace(storageUrl(), (match, path: string) => {
                const key = keyForStorageUrlPath(path, bucket);
                const to = key && moves.get(key);
                if (!to) return match;
                const suffixAt = path.search(/[?#]/);
                const suffix = suffixAt === -1 ? '' : path.slice(suffixAt);
                const encoded = to.split('/').map(encodeURIComponent).join('/');
                return `${match.slice(0, match.length - path.length)}${bucket}/${encoded}${suffix}`;
            });
        }
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const record = node as Record<string, unknown>;
            if (record.__type === 'File') {
                const to = typeof record.name === 'string' ? moves.get(keyForParseFileName(record.name)) : undefined;
                if (!to) return { ...record, url: walk(record.url) };
                return { ...record, name: to.startsWith(PARSE_PREFIX) ? to.slice(PARSE_PREFIX.length) : to, url: walk(record.url) };
            }
            if (record.__type === 'Pointer' || record.__type === 'Relation') return node;
            return Object.fromEntries(Object.entries(record).map(([column, item]) => [column, walk(item)]));
        }
        return node;
    };
    return walk(value) as T;
}

/**
 * Columns that hold what the user *bookmarked* rather than what we stored:
 * `websites.url`, `websiteUrls.urls`, an import's `url`. A bookmark of another
 * user's file link names their object here. Whatever we stored for a bookmark
 * is in its own column (`file`, `fileUrl`, `OGImage`, `images`, …) as well.
 */
const BOOKMARKED_ADDRESS_COLUMNS = new Set(['url', 'urls']);

/** `storageKeysIn` for one row's `toJSON()`, leaving out the bookmarked address. */
export function storageKeysInRow(row: Record<string, unknown>, bucket: string, into: Set<string> = new Set()): Set<string> {
    for (const [column, value] of Object.entries(row)) {
        if (!BOOKMARKED_ADDRESS_COLUMNS.has(column)) storageKeysIn(value, bucket, into);
    }
    return into;
}

/**
 * Whether a key a user's row refers to is theirs to delete, and not already
 * covered by the prefix sweep.
 *
 * Yes only when the name itself rules out anyone else: `createFileName`'s
 * `anon` files (a timestamp and a random suffix in every name), a name starting
 * with this user's id, one carrying a UUID, or one with Parse's own random
 * prefix. Another user's prefix is never touched, and a plain user-chosen name
 * never is either, because that object may be someone else's upload too.
 */
export function isStrayUserKey(key: string, userId: string): boolean {
    if (!userId || userStoragePrefixes(userId).some((prefix) => key.startsWith(prefix))) return false;
    if (key.startsWith(`${PARSE_PREFIX}user/${ANON_USER}/`)) return true;
    if (!key.startsWith(PARSE_PREFIX) || key.startsWith(`${PARSE_PREFIX}user/`)) return false;

    const name = key.slice(PARSE_PREFIX.length);
    return name.startsWith(`${userId}_`) || UUID.test(name) || PARSE_RANDOM_PREFIX.test(name);
}

/**
 * Names of the Parse files a row holds, from its `toJSON()`: `{ __type: 'File', name }` anywhere in
 * it, pointers and relations not followed. This is how an installation that keeps files in
 * MongoDB (GridFS) finds a user's files to delete, since there is no bucket to sweep.
 */
export function parseFileNamesIn(value: unknown, into: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) parseFileNamesIn(item, into);
    } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (record.__type === 'File') {
            if (typeof record.name === 'string' && record.name) into.add(record.name);
        } else if (record.__type !== 'Pointer' && record.__type !== 'Relation') {
            for (const item of Object.values(record)) parseFileNamesIn(item, into);
        }
    }
    return into;
}

/**
 * Whether a stored Parse file name could only have been this user's.
 *
 * Every upload name is salted with a random segment before Parse stores it, so a `parseUser=<id>_…`
 * name or a plain name behind a 16-hex salt belongs to one upload. An older plain name might be
 * shared with another account's identical upload, so it is left alone.
 */
export function isOwnParseFileName(name: string, userId: string): boolean {
    if (!userId) return false;
    if (new RegExp(`^parseUser=${userId.replace(/[^A-Za-z0-9]/g, '')}_`, 'i').test(name)) return true;
    return /^[0-9a-f]{16}_/.test(name);
}
