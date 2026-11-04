const { assignAdminToNewUser } = require('./instance.js');

// Parse.Cloud.beforeDelete(Parse.User, async (request) => {
//     try {
//         let user = request.object;

//         console.log("Deleting user data");
//         await deleteWebsites(user);
//         await deleteUserOptions(user);
//         await deleteUserUrls(user);
//         console.log("User data deleted");

//         try {
//             await Parse.Cloud.startJob('updateAnalytics', { userId: null, date: date.toDateString(), userDeleted: 1 }, { useMasterKey: true });
//         } catch (error) {
//             console.log("Error running updateAnalytics on user delete");
//         }

//     } catch (e) {
//         console.error("Failed to delete user data: ", e);
//     }
// })

// Parse keeps one afterSave handler per class, so everything that has to happen when an account
// is created goes through this one.
Parse.Cloud.afterSave(Parse.User, async (request) => {
    const user = request.object;

    // If it's not a new user, then return
    if (user.existed()) return;

    // The first account on a self-hosted install becomes its administrator.
    await assignAdminToNewUser(user);
});

// Columns on `_User` that only the servers write: the plan and the Stripe and
// App Store links behind it, paid import access, the counters quotas are
// measured against, the waitlist flag and the admin role. webbites-backend,
// the web app's server routes and this cloud code set every one of them with
// the master key, and no client sets any. Without this a signed-in client
// could PUT itself onto a paid plan, or sign up with `appStoreStatus:
// 'active'`, which also makes the Stripe sync leave the row alone.
//
// Left out on purpose:
// - `emailVerified`: Parse Server already refuses it from clients before this
//   trigger runs, and its own verification link writes it with the
//   maintenance key, which a trigger sees as `request.master === false`.
const SERVER_ONLY_USER_FIELDS = new Set([
    'currentPlan',
    'planSyncedAt',
    'planSource',
    'pendingDowngrade',
    // The old plan mirrors (`DEPRECATED_USER_PLAN_COLUMNS` in the backend's
    // `server/utils/plans.ts`). Nothing reads them any more, and nothing
    // should be able to write them back to life either.
    'planTier',
    'isPremium',
    'plan',
    'planHistory',
    'maxWebsiteCount',
    'hasImportAccess',
    'hasUsedImportAccess',
    'bookmarksTotal',
    'websiteCount',
    'tokenUsage',
    'canCreateAccount',
    // Every plan limit is measured against this: bookmarks, AI audio,
    // transcription and file uploads all read `usage.currentMonth` in the
    // backend's `getUsage`. A client that can write it can zero its own
    // counters and keep going, which is a free pass to paid features. The
    // server owns it (`flushUserUpdate` / `updateUsage`) and treats a missing
    // value as zeros, so no client ever needs to initialise it.
    'usage',
    // The web app's admin check (`checkIsAdmin`) trusts this pointer, so a
    // client pointing it at the admin role would be an admin.
    'role',
]);

// Whole families, so a column added to one later is covered without anyone
// remembering this file: every `stripe…` and `appStore…` column, and
// `importAccessStatus`, `importAccessGrantedAt`, `importAccessExpiresAt`.
const SERVER_ONLY_USER_FIELD_PREFIXES = ['stripe', 'appStore', 'importAccess'];

// The first server-only column this save writes, or null. `dirtyKeys()` rather
// than `dirty(field)`, because on a signup `dirty()` is true for every field
// of an object that has no id yet. A dotted key such as `plan.name` writes
// into the column before the dot.
function serverOnlyUserField(user) {
    for (const key of user.dirtyKeys()) {
        const field = key.split('.')[0];
        if (
            SERVER_ONLY_USER_FIELDS.has(field)
            || SERVER_ONLY_USER_FIELD_PREFIXES.some((prefix) => field.startsWith(prefix))
        ) {
            return field;
        }
    }
    return null;
}

Parse.Cloud.beforeSave(Parse.User, async (request) => {
    const user = request.object;

    // Before anything else, on a signup as much as on an update: further down
    // this trigger sets `currentPlan` on a new user itself, and only what the
    // client sent is to be judged here.
    if (!request.master) {
        const field = serverOnlyUserField(user);
        if (field) {
            throw new Parse.Error(
                Parse.Error.OPERATION_FORBIDDEN,
                `Clients can't change ${field}.`
            );
        }
    }

    if (request.original) {
        // An email address only changes once the new one is verified, and
        // that happens in webbites-backend (`POST /v1/me/email`, then the
        // link in the email), which saves with the master key. Without this a
        // signed-in client could PUT any address straight onto its own row —
        // skipping verification, and with it the owner of that inbox's say.
        const before = (request.original.get('email') || '').toLowerCase();
        const after = (user.get('email') || '').toLowerCase();
        if (!request.master && user.dirty('email') && before !== after) {
            throw new Parse.Error(
                Parse.Error.OPERATION_FORBIDDEN,
                'Change your email from Settings. The new address has to be verified first.'
            );
        }
        return;
    }

    console.log("FIRST TIME USER: ", user);

    // With billing off (the self-hosted default) there are no plans: everyone is unlimited
    // and no `plans` row exists. A billing overlay sets BILLING_PROVIDER and, with it,
    // this plan pointer (BILLING_FREE_PLAN_ID is the free plan's objectId).
    const billingProvider = process.env.BILLING_PROVIDER || 'none';
    if (billingProvider !== 'none' && process.env.BILLING_FREE_PLAN_ID) {
        const Plan = Parse.Object.extend('plans');
        const planPointer = new Plan();
        planPointer.id = process.env.BILLING_FREE_PLAN_ID;
        user.set('currentPlan', planPointer);
    }

    try {
        let websiteUrlsPointer;
        const WebsiteUrls = Parse.Object.extend('websiteUrls');

        websiteUrlsPointer = new WebsiteUrls();
        websiteUrlsPointer.set('urls', []);
        await websiteUrlsPointer.save(null, { useMasterKey: true });

        user.set('websiteUrls', websiteUrlsPointer);
        user.set('bookmarksToImport', []);
    } catch (error) {
        console.log("Error setting websiteUrls 3: ", error);
    }
});

async function deleteWebsites(user) {
    try {
        const query = new Parse.Query('websites');
        query.equalTo('user', user);
        const websites = await query.find({ useMasterKey: true });
        await Parse.Object.destroyAll(websites, { useMasterKey: true });
        console.log("websites deleted");
    } catch (error) {
        console.error("Failed to delete user websites: ", error);
    }
}

async function deleteUserOptions(user) {
    try {
        const query = new Parse.Query('userOptions');
        query.equalTo('user', user);
        const userOptions = await query.find({ useMasterKey: true });
        await Parse.Object.destroyAll(userOptions, { useMasterKey: true });
        console.log("user options deleted");
    } catch (error) {
        console.error("Failed to delete user options: ", error);
    }
}

async function deleteUserUrls(user) {
    try {
        const websiteUrlsPointer = user.get('websiteUrls');
        if (websiteUrlsPointer) {
            const websiteUrlsQuery = new Parse.Query('websiteUrls');
            const websiteUrls = await websiteUrlsQuery.get(websiteUrlsPointer.id, { useMasterKey: true });
            await websiteUrls.destroy({ useMasterKey: true });
            console.log("User's websiteUrls relation deleted");
        }
    } catch (error) {
        console.error("Failed to delete user urls: ", error);
    }

}

async function countWebsites(user) {
    try {
        const query = new Parse.Query('websites');
        query.equalTo('user', user.id);
        const websites = await query.count({ useMasterKey: true });
        return websites;
    } catch (error) {
        console.error("Failed to count user websites: ", error);
    }
}
