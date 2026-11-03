/**
 * POST /v1/triggers/users/beforeDelete — erase everything a user owns.
 *
 * App Review §5.1.1(v) is about the data, not the row. Parse's
 * `beforeDelete(_User)` hook calls this and waits for it, so the `_User` row is
 * only destroyed once the cascade has actually succeeded — a failure leaves the
 * account intact and visibly failed rather than half-deleted.
 *
 * It lives here rather than in Cloud Code because most of a user is not in
 * Parse: the API keys are in Redis, the search documents in Meilisearch, the
 * files in MinIO, the customer at Stripe. The hook that used to do this in
 * Cloud Code reached none of them, and capped every Parse query it did run at
 * the default 100 rows.
 *
 * Deliberately never destroys the `_User` row itself. That keeps it safe to
 * call from the hook (no recursion), safe to re-run, and makes the admin route
 * `POST /v1/auth/deleteUser` cascade for free — it destroys the row, the hook
 * fires, this runs.
 *
 * ponytail: every delete happens inline in one request. Hand it to QStash
 * (`sendToQstash`) if a library large enough to time out ever turns up.
 */

import { createError, defineEventHandler, readBody } from 'h3';
import Parse from 'parse/node.js';
import * as Minio from 'minio';
import { revokeAllApiKeys, validateInternalApiKey } from '#root/server/utils/api-keys';
import { removeUserFromMeilisearch } from '#root/server/utils/meilisearchTrash';
import { runBillingHook } from '#root/server/utils/billing';
import { captureException } from '#root/server/utils/sentry.js';
import { revokeAppleTokens } from '#root/server/utils/appleTokens';
import { getPlanId, getPlanSource, resolveUserPlan } from '#root/server/utils/plans';
import { isOwnParseFileName, isStrayUserKey, parseFileNamesIn, storageKeysInRow, userStoragePrefixes } from '#root/server/utils/userStorageKeys';
import { filesDriver, s3Settings } from '#root/server/utils/storage/config';
import { eraseHelpbitesUser } from '#root/server/utils/helpbites';
import { revokeAllOAuthGrants } from '#root/server/utils/oauthStore';

Parse.initialize(
    process.env.VITE_PARSE_ID as string,
    process.env.VITE_PARSE_JS_KEY as string,
    process.env.VITE_PARSE_MASTER_KEY as string
);
Parse.serverURL = process.env.VITE_PARSE_URL as string;

/**
 * Every class that holds rows belonging to one user, and the column that says
 * so. `websites` is first because it is the big one and the most important to
 * get gone.
 *
 * Not listed, on purpose: `rssFeeds` and `rssItems` are a **shared** catalogue
 * (a feed row is public-read, master-write, and serves every subscriber), so
 * deleting them with a user would take other people's feeds with them. Only the
 * per-user rows around them go.
 */
const USER_OWNED_CLASSES: Array<{ className: string; column: string }> = [
    { className: 'websites', column: 'user' },
    { className: 'websiteUrls', column: 'user' },
    { className: 'ImportSession', column: 'user' },
    { className: 'bookmarksToImport', column: 'user' },
    { className: 'boards', column: 'user' },
    { className: 'boardBookmarks', column: 'user' },
    { className: 'rssSubscriptions', column: 'user' },
    { className: 'rssReadMarks', column: 'user' },
    { className: 'rssReadLater', column: 'user' },
    { className: 'Tags', column: 'user' },
    { className: 'WebsiteTags', column: 'user' },
    { className: 'TagOccurrences', column: 'user' },
    { className: 'userOptions', column: 'user' },
    { className: 'UsageStats', column: 'user' },
    { className: 'apiWebhooks', column: 'user' },
    { className: 'backupConfigs', column: 'user' },
    // Legacy: the feedback board lives on HelpBites now (erased below), but
    // rows from before the move may still be here.
    { className: 'feedback', column: 'createdBy' },
    // The web editor's image uploads (`Tiptap.vue`), one row per file.
    { className: 'files', column: 'user' },
    // Email-update signups (`subscribeUserTo` in the web app) made while
    // signed in. Ones made before the account existed carry no pointer — see
    // `destroyUnclaimedEmailSubscriptions`.
    { className: 'emailSubscriptions', column: 'user' },
    // Embedding backups of the user's bookmarks (`server/services/meilisearchSync.ts`).
    { className: 'SearchEmbedding', column: 'user' },
    // A pending email change still holds both addresses. Also keyed by
    // `userId`, but every row has had the pointer since the class began.
    { className: 'EmailChangeRequest', column: 'user' },
    // Board sharing: where this person is a member, the invites they sent, and
    // their notification history. (Rows on boards they own go with the boards.)
    { className: 'boardMembers', column: 'user' },
    { className: 'boardMembers', column: 'invitedBy' },
    { className: 'boardNotifications', column: 'recipient' },
    { className: 'boardNotifications', column: 'actor' },
];

/** One page of deletes. Parse's own default is 100, which is how a 5 000-bookmark account used to keep 4 900 of them. */
const PAGE_SIZE = 500;

defineRouteMeta({
    openAPI: {
        tags: ['Triggers'],
        description:
            "Delete everything belonging to a user — Parse rows, files, search documents, API keys, Sign in with Apple tokens, their HelpBites support conversations and feedback, and the Stripe subscriptions and customer — without deleting the user row itself. Called by Parse's beforeDelete(_User) hook.",
        responses: {
            200: { description: 'Everything owned by the user is gone' },
            400: { description: 'userId is required' },
            403: { description: 'Invalid internal API key' },
            500: { description: 'Cleanup failed — the caller must not delete the user' },
        },
    },
});

export default defineEventHandler(async (event) => {
    if (!validateInternalApiKey(event)) {
        throw createError({ statusCode: 403, statusMessage: 'Invalid API key' });
    }

    const { userId, email } = (await readBody(event)) ?? {};
    if (!userId) {
        throw createError({ statusCode: 400, statusMessage: 'userId is required' });
    }

    console.log(`[deleteUserData] Erasing everything owned by ${userId}`);

    const user = Parse.User.createWithoutData(userId) as Parse.Object;
    const storage = userStorage();
    const deleted: Record<string, number> = {};

    try {
        const account = await loadAccount(userId);
        const address: string | undefined = email || account?.get('email');

        deleted.strayFiles = 0;
        for (const { className, column } of USER_OWNED_CLASSES) {
            const { rows, strayFiles } = await destroyOwnedRows(className, column, user, storage);
            deleted[className] = rows;
            deleted.strayFiles += strayFiles;
        }
        deleted.emailSubscriptions += await destroyUnclaimedEmailSubscriptions(address, userId);
        // The account row itself goes after this returns, and may point at files too.
        if (account) deleted.strayFiles += await destroyStrayFiles([account], userId, storage);

        // Search documents keyed by user, in one call per Meilisearch instance.
        await removeUserFromMeilisearch(userId);

        // Support chat and the feedback board live on HelpBites, keyed by our user id.
        const helpbites = await eraseHelpbitesUser(userId);
        if (helpbites) for (const [kind, count] of Object.entries(helpbites)) deleted[`helpbites.${kind}`] = count;

        deleted.files = await destroyUserFiles(userId, storage);
        deleted.apiKeys = await revokeAllApiKeys(userId);
        // Same reason as the keys: MCP connections live in Redis, not Parse.
        deleted.oauthGrants = await revokeAllOAuthGrants(userId);
        deleted.appleTokens = await revokeAppleTokens(user);
        // Billing: cancel subscriptions and close the customer (a no-op unless a billing
        // provider is installed). Never blocks the deletion.
        await runBillingHook('onUserDeleted', (account ?? user) as Parse.Object, { email: address });

        if (account) await recordDeletion(account);

        console.log(`[deleteUserData] ${userId}:`, deleted);
        return { success: true, userId, deleted };
    } catch (error: any) {
        console.error(`[deleteUserData] Failed for ${userId}:`, error);
        captureException(error);
        // The hook is waiting on this. Failing loudly keeps the account whole;
        // returning success would delete the user and strand their data.
        throw createError({
            statusCode: 500,
            statusMessage: `Account data could not be deleted: ${error?.message || String(error)}`,
        });
    }
});

/**
 * One `DeletedAccount` row per deletion, for the admin Business tab — nothing
 * else survives a delete to be counted. Anonymous on purpose: no user id or
 * email, just when they joined, what they were on and who billed it. Master-key
 * only. Skipped on a re-run (the account row is already gone), so each account
 * counts once. Never fails the delete.
 */
async function recordDeletion(account: Parse.Object) {
    try {
        const row = new Parse.Object('DeletedAccount');
        row.setACL(new Parse.ACL());
        await row.save({
            signedUpAt: account.createdAt,
            planId: getPlanId(await resolveUserPlan(account)),
            planSource: getPlanSource(account),
        }, { useMasterKey: true });
    } catch (error) {
        console.error('[deleteUserData] Could not record the deletion:', error);
        captureException(error);
    }
}

/**
 * The account row, read before anything goes: it holds the Stripe customer id,
 * and may point at files of its own.
 *
 * Absent is fine — the admin route or a re-run may get here after the row is
 * gone. Anything else is a Parse failure, which fails the delete like any other.
 */
async function loadAccount(userId: string): Promise<Parse.Object | null> {
    try {
        return await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
    } catch (error: any) {
        if (error?.code === Parse.Error.OBJECT_NOT_FOUND) return null;
        throw error;
    }
}

/**
 * Destroy every row of one class owned by the user, a page at a time.
 *
 * Each page's stray files go first (see `destroyStrayFiles`): once a row is
 * destroyed nothing records what it pointed at, so doing it the other way round
 * would lose them for good on a delete that failed halfway and was re-run.
 *
 * `context: { userDeleted: true }` reaches the per-row Cloud Code triggers,
 * which bail out on it: the `websites` triggers otherwise re-fetch and re-save
 * the very user being deleted, once per bookmark, and settle a quota that is
 * about to stop existing.
 */
async function destroyOwnedRows(
    className: string,
    column: string,
    user: Parse.Object,
    storage: UserStorage | null
): Promise<{ rows: number; strayFiles: number }> {
    let removed = 0;
    let strayFiles = 0;
    const done = () => ({ rows: removed, strayFiles });

    for (;;) {
        const query = new Parse.Query(className);
        query.equalTo(column, user);
        query.limit(PAGE_SIZE);

        let rows: Parse.Object[];
        try {
            rows = await query.find({ useMasterKey: true });
        } catch (error: any) {
            // A class that has never been created is not a failure — it is a
            // user who never used that feature.
            if (error?.code === Parse.Error.INVALID_CLASS_NAME) return done();
            throw error;
        }

        if (rows.length === 0) return done();

        strayFiles += await destroyStrayFiles(rows, user.id as string, storage);
        await Parse.Object.destroyAll(rows, { useMasterKey: true, context: { userDeleted: true } } as any);
        removed += rows.length;

        if (rows.length < PAGE_SIZE) return done();
    }
}

/**
 * `emailSubscriptions` rows for the user's address that no account holds.
 *
 * The web app's changelog signup (`subscribeUserTo`) writes one with no user
 * for an address that has no account yet, and nothing links it when that
 * person signs up, so the pointer sweep never sees it. A row pointing at a
 * different account stays: an address can move between accounts by an email
 * change, and the row is that account's.
 */
async function destroyUnclaimedEmailSubscriptions(email: string | undefined, userId: string): Promise<number> {
    if (!email) return 0;

    const query = new Parse.Query('emailSubscriptions');
    query.containedIn('email', [...new Set([email, email.toLowerCase()])]);
    query.limit(PAGE_SIZE);

    let rows: Parse.Object[];
    try {
        rows = await query.find({ useMasterKey: true });
    } catch (error: any) {
        if (error?.code === Parse.Error.INVALID_CLASS_NAME) return 0;
        throw error;
    }

    const unclaimed = rows.filter((row) => {
        const owner = row.get('user') as Parse.Object | undefined;
        return !owner || owner.id === userId;
    });
    if (unclaimed.length === 0) return 0;

    await Parse.Object.destroyAll(unclaimed, { useMasterKey: true });
    return unclaimed.length;
}

interface UserStorage {
    client: Minio.Client;
    bucket: string;
}

/** The bucket every upload lands in, or null where files are not kept in S3. */
function userStorage(): UserStorage | null {
    const settings = s3Settings();
    if (!settings) return null;

    const client = new Minio.Client({
        endPoint: settings.endPoint,
        port: settings.port,
        useSSL: settings.useSSL,
        accessKey: settings.accessKey,
        secretKey: settings.secretKey,
        region: settings.region,
    });
    return { client, bucket: settings.bucket };
}

/**
 * Remove objects by key, failing if the store refused any of them.
 *
 * `removeObjects` sends the batch in quiet mode and *resolves* with whatever
 * the store would not delete, so without the check a denied key reads as done
 * and the account goes with its file still there.
 */
async function removeKeys(storage: UserStorage, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const refused = await storage.client.removeObjects(storage.bucket, keys);
    if (refused.length > 0) {
        throw new Error(`Storage refused to delete ${refused.length} of ${keys.length} files, e.g. ${JSON.stringify(refused[0])}`);
    }
}

/**
 * Delete the files some rows point at outside the user's prefixes.
 *
 * The native app, the web editor and a few older paths upload under a plain
 * name, which lands at `parse/<name>` where no prefix sweep reaches. The row is
 * the only record of whose it is — and only a name that could not also be
 * another user's upload is deleted; `userStorageKeys.ts` has the rules.
 */
async function destroyStrayFiles(rows: Parse.Object[], userId: string, storage: UserStorage | null): Promise<number> {
    if (!storage) return filesDriver() === 'gridfs' ? destroyGridFsFiles(rows, userId) : 0;

    const keys = new Set<string>();
    for (const row of rows) storageKeysInRow(row.toJSON(), storage.bucket, keys);
    const strays = [...keys].filter((key) => isStrayUserKey(key, userId));

    await removeKeys(storage, strays);
    return strays.length;
}

/**
 * Delete the user's files when they live in MongoDB (GridFS), which Parse deletes only when asked.
 *
 * There is no bucket to sweep, so the rows are the record: every Parse file they hold whose name
 * could only be this user's is removed through Parse's files endpoint.
 */
async function destroyGridFsFiles(rows: Parse.Object[], userId: string): Promise<number> {
    const names = new Set<string>();
    for (const row of rows) parseFileNamesIn(row.toJSON(), names);

    const parseUrl = String(process.env.VITE_PARSE_URL || '').replace(/\/+$/, '');
    if (!parseUrl) return 0;

    let removed = 0;
    for (const name of names) {
        if (!isOwnParseFileName(name, userId)) continue;
        const response = await fetch(`${parseUrl}/files/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: {
                'X-Parse-Application-Id': String(process.env.VITE_PARSE_ID),
                'X-Parse-Master-Key': String(process.env.VITE_PARSE_MASTER_KEY),
            },
        });
        // A file that is already gone is what we wanted; anything else is worth knowing.
        if (response.ok) removed++;
        else if (response.status !== 404) console.warn(`[deleteUserData] Parse would not delete file ${name}: ${response.status}`);
    }
    return removed;
}

/**
 * Delete the user's files from object storage.
 *
 * Parse never deletes a file when the row pointing at it goes, so this is the
 * only thing standing between a deleted account and its screenshots living on
 * in MinIO forever. Every upload is keyed `parse/user/<userId>/<name>` by the
 * S3 adapter's `generateKey`, so the whole prefix goes in one sweep.
 *
 * Files uploaded under a plain name sit outside it; `destroyStrayFiles` finds
 * those by row, before the rows go.
 */
async function destroyUserFiles(userId: string, storage: UserStorage | null): Promise<number> {
    if (!storage) {
        // GridFS files are found through the rows (destroyStrayFiles); only a half-set-up S3 deserves a warning.
        if (filesDriver() === 's3') console.warn('[deleteUserData] S3 is not fully configured — skipping the file sweep');
        return 0;
    }
    const { client, bucket } = storage;

    // Two writers, two shapes. Parse Server's S3 adapter keys uploads
    // `parse/user/<id>/…` (`generateKey` in parse-compose's config), while the
    // backend's own `uploadToS3` writes `/userFiles/<id>/…` — with the leading
    // slash it passes, hence both spellings.
    const names: string[] = [];

    for (const prefix of userStoragePrefixes(userId)) {
        const found: string[] = await new Promise((resolve, reject) => {
            const keys: string[] = [];
            const stream = client.listObjectsV2(bucket, prefix, true);
            stream.on('data', (item) => { if (item.name) keys.push(item.name); });
            stream.on('end', () => resolve(keys));
            stream.on('error', reject);
        });
        names.push(...found);
    }

    await removeKeys(storage, names);
    return names.length;
}
