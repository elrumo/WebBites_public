/**
 * Plans and entitlements — the single source of truth.
 *
 * ## The problem this file exists to solve
 *
 * A user's plan used to be readable from six different places on the `_User`
 * row, and every call site picked its own:
 *
 *   currentPlan     Pointer -> plans  the real one; every write path sets it
 *   planTier        String            a stale mirror ('free' / 'Feast')
 *   isPremium       Boolean           a stale mirror, true for 3 of 2722 users
 *   plan            Object            `{currentPlan:{name,price},history:[]}`
 *   planHistory     Array             a stale mirror, set on 2 rows
 *   maxWebsiteCount Number            a stale copy of the bookmark limit
 *
 * Only `currentPlan` is maintained. The other five are dead columns kept alive
 * by their schema defaults, and code that read them silently disagreed with
 * code that read the pointer.
 *
 * So: **`_User.currentPlan` is the only plan column.** Everything else about a
 * user's entitlement is derived from the `plans` row it points at, by the
 * helpers below. Nothing outside this file should call
 * `user.get('currentPlan')`, compare a `planId` to `'free'`, or read a limit
 * column off a plan object.
 *
 * ## The `plans` class
 *
 *   planId              String   stable key; also the Stripe price id
 *   planName            String   row label; clients get the tier's name instead
 *   occurrence          String   monthly | yearly | singlePayment
 *   planPrices          Object   { monthly, yearly } or { price } for add-ons
 *   planFeatures        Array    marketing bullets — display only, never gate
 *   bookmarkCountLimit  Number   total bookmarks allowed
 *   audioGenerationLimit Number  audio generations per calendar month
 *   <feature>Enabled    Boolean  optional per-plan override, see PLAN_FEATURES
 *
 * Numeric allowances live in the row so they can be tuned without a deploy.
 * Boolean entitlements derive from the plan's *tier* (see `PLAN_TIERS`), which
 * keeps a new price point from having to be feature-flagged by hand — an
 * `<feature>Enabled` column on the row overrides the tier default when set.
 *
 * ## Usage counters
 *
 * `usage.currentMonth.bookmarksTotal` is the bookmark count the limits are
 * measured against; `distributedBookmarkCounter` is what maintains it (and
 * mirrors it to the top-level `bookmarksTotal`). The older `websiteCount`
 * column is *not* written by anything any more — code that gated on it was
 * comparing `undefined` and never blocked. `getBookmarkQuota` reads the
 * maintained counter, falling back through the mirrors for old rows.
 */

import Parse from 'parse/node.js';
import { createError } from 'h3';
import { isBillingEnabled, billingProviderName } from './billing';
import type {
    PlanFeatures,
    PlanLimits,
    PlanOccurrence,
    PlanResponse,
    PlanTier,
    QuotaResponse,
    UsageResponse,
} from '../types/plan.types';

export const PLANS_CLASS = 'plans';

/** The only `_User` column that says what a user is entitled to. */
export const USER_PLAN_COLUMN = 'currentPlan';

/**
 * Columns that used to answer the same question and no longer do. Listed so
 * the deprecation is greppable, and so the cleanup task in
 * `/v1/dev/migration/plans-cleanup` has one list to work from.
 *
 * `websiteCount` is dead too, but it is a counter rather than a plan column and
 * one legacy admin route still queries it, so it is left in place — nothing in
 * this file reads it.
 */
export const DEPRECATED_USER_PLAN_COLUMNS = [
    'planTier',
    'isPremium',
    'plan',
    'planHistory',
    'maxWebsiteCount',
] as const;

/**
 * Columns recording the Stripe link, written by `utils/stripePlans.ts`.
 *
 * These are **lookup keys and diagnostics, never entitlement inputs.** Nothing
 * in this file reads them, and nothing else should gate on them: the moment a
 * `stripeSubscriptionStatus` mirror decides what a user may do, we are back to
 * two columns disagreeing about the same question. `currentPlan` stays the only
 * answer; these just make repairing it cheap and exact.
 *
 * `planSyncedAt` is how stale that repair is, and is surfaced to clients so a
 * mirror can never quietly pass itself off as live.
 */
export const USER_STRIPE_COLUMNS = [
    'stripeCustomerId',
    'stripeSubscriptionId',
    'stripeSubscriptionStatus',
    'stripeCurrentPeriodEnd',
    'planSyncedAt',
] as const;

/**
 * Stripe subscription statuses that still entitle the user to what they bought.
 *
 * `past_due` is a deliberate grace period while Stripe retries the card. Lives
 * here rather than in `stripePlans.ts` because `getPlanSource` below needs it
 * and `stripePlans` imports this file — the other direction would be a cycle.
 */
export const ENTITLED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Columns recording the App Store link, written by `utils/appStorePlans.ts`.
 *
 * Same rule as the Stripe columns above: **lookup keys and diagnostics, never
 * entitlement inputs.** `currentPlan` stays the only answer to "what may this
 * user do".
 *
 * `appStoreOriginalTransactionId` is the key every Server Notification arrives
 * with, so it is written once and **never unset** — a resubscribe months later
 * carries the same id. `appStoreStatus` is what says whether Apple is currently
 * billing; it, not the presence of the id, decides `planSource`.
 * `appStoreNotifiedAt` is the `signedDate` of the newest Server Notification
 * applied, which is how a retried or late one is recognised as older.
 */
export const USER_APPSTORE_COLUMNS = [
    'appStoreOriginalTransactionId',
    'appStoreProductId',
    'appStoreStatus',
    'appStoreExpiresAt',
    'appStoreAutoRenew',
    'appStoreNotifiedAt',
] as const;

/** `appStoreStatus` while Apple is billing. Anything else means it is not. */
export const APPSTORE_ACTIVE = 'active';

/** Who is billing the current plan. Mirrors the client's `PlanSource`. */
export type PlanSource = 'stripe' | 'app_store' | 'none';

/**
 * Which of the two billing sources owns this user's plan.
 *
 * The phone reads this to decide whether to show a purchase button at all: a
 * subscription bought on the web cannot be cancelled or replaced from the App
 * Store, so offering one there charges the same library twice.
 *
 * App Store wins a tie on purpose — `/v1/me/plan/appstore` refuses to sell to a
 * live Stripe subscriber, so a user holding both is a repair case, and the side
 * that can be managed in-app is the one to report.
 */
export function getPlanSource(user: Parse.Object): PlanSource {
    if (!isBillingEnabled()) return 'none';
    if (user.get('appStoreStatus') === APPSTORE_ACTIVE) return 'app_store';
    if (ENTITLED_SUBSCRIPTION_STATUSES.has(user.get('stripeSubscriptionStatus'))) return 'stripe';
    return 'none';
}

/**
 * `planId` of the plan every account has when no billing provider is installed (the
 * self-hosted default, BILLING_PROVIDER=none). There is no `plans` row behind it: it exists
 * only in memory, with no limits, so a fresh database needs no plan data at all.
 */
export const UNLIMITED_PLAN_ID = 'selfhosted';

/** `planId` of the free plan. Also the $0 Stripe price. */
export const FREE_PLAN_ID = 'free';

/** `planId` of the one-off bookmark-import add-on. Not a subscription tier. */
export const IMPORT_ADDON_PLAN_ID = 'webbites-import';

/**
 * Fallback free-plan objectId, used only when the `plans` table cannot be
 * reached at signup. Signup paths should call `getFreePlan()` instead of
 * hard-coding this — it is here so the one place that still needs a literal
 * has a named constant rather than a magic string in three files.
 */
export const FREE_PLAN_OBJECT_ID = process.env.BILLING_FREE_PLAN_ID || '';

/** Used when a plan row is missing a limit, and for users with no plan at all. */
export const FALLBACK_FREE_LIMITS: PlanLimits = {
    bookmarks: 100,
    audioGenerations: 5,
};

/**
 * planId -> tier. A plan not listed here is assumed to be a *new paid* plan and
 * gets the lowest paid tier, so adding a price point in Stripe can never
 * accidentally hand out top-tier features before this map is updated.
 */
const PLAN_TIERS: Record<string, PlanTier> = {
    free: 'free',
    [UNLIMITED_PLAN_ID]: 'plus',
    plus_monthly: 'plus',
    plus_yearly: 'plus',
    // Retired price ids. Their rows are archived (hidden from the catalogue)
    // but kept, and their Stripe prices deactivated, so the handful of users
    // grandfathered onto them keep billing. Plus is the only paid tier and it
    // includes everything, so every one of them is Plus — by tier and by name.
    bite_monthly: 'plus',
    bite_yearly: 'plus',
    feast_monthly: 'plus',
    feast_yearly: 'plus',
    ultra_monthly: 'plus',
    ultra_yearly: 'plus',
};

/** Tier ranking, for "at least this tier" comparisons. */
const TIER_RANK: Record<PlanTier, number> = { free: 0, plus: 1 };

/**
 * What each tier is called. The name a client shows comes from here, not from
 * the row's `planName`: the retired rows still say 'Bite' or 'Feast', and a
 * grandfathered subscriber was being told they were on a plan we no longer
 * sell under a name we no longer use.
 */
export const PLAN_TIER_NAMES: Record<PlanTier, string> = { free: 'Free', plus: 'Plus' };

/**
 * The feature matrix: minimum tier each boolean entitlement requires.
 *
 * A `plans` row may override any entry with a boolean column named
 * `<feature>Enabled` (e.g. `rssAutoExtractEnabled`). When the column is absent
 * the tier decides — which is the fix for RSS auto-extract, whose gate read a
 * column that was never added to the schema and therefore refused every user,
 * paid ones included.
 */
const PLAN_FEATURES: Record<keyof PlanFeatures, PlanTier> = {
    aiSummaries: 'plus',
    imageTagging: 'plus',
    highResScreenshots: 'plus',
    rssAutoExtract: 'plus',
    ocr: 'plus',
    smartBoards: 'plus',
    backups: 'plus',
};

// ─── Catalogue ───────────────────────────────────────────────────────────────

/**
 * Plans change a few times a year and are read on nearly every quota check, so
 * the whole table is cached in-process. The TTL is what bounds how long a
 * pricing edit takes to reach a running instance.
 */
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; plans: Parse.Object[] } | null = null;

/** Drop the cached catalogue. Call after writing a `plans` row. */
export function invalidatePlanCache(): void {
    catalogCache = null;
}

async function loadCatalog(): Promise<Parse.Object[]> {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
        return catalogCache.plans;
    }

    try {
        const plans = await new Parse.Query(PLANS_CLASS)
            .limit(1000)
            .find({ useMasterKey: true });

        catalogCache = { at: Date.now(), plans };
        return plans;
    } catch (error) {
        // A failed refresh serves the last good catalogue rather than taking
        // every quota check down with it. Plans change a few times a year, so
        // slightly stale pricing beats a 500 on save-bookmark.
        if (catalogCache) {
            console.error('[plans] Catalogue refresh failed — serving the cached copy:', error);
            return catalogCache.plans;
        }
        throw error;
    }
}

/** Every plan row, cached. Includes the free plan and the import add-on. */
export async function getPlanCatalog(): Promise<Parse.Object[]> {
    return loadCatalog();
}

/** Look a plan up by its `planId` (which is also its Stripe price id). */
export async function getPlanByPlanId(planId: string): Promise<Parse.Object | null> {
    if (!planId) return null;
    const plans = await loadCatalog();
    return plans.find((plan) => plan.get('planId') === planId) ?? null;
}

/**
 * The free plan row. Throws rather than guessing: every downgrade path needs a
 * real object to point at, and silently leaving a cancelled user on a paid plan
 * is worse than a failed webhook Stripe will retry.
 */
export async function getFreePlan(): Promise<Parse.Object> {
    if (!isBillingEnabled()) return getUnlimitedPlan();
    const plan = await getPlanByPlanId(FREE_PLAN_ID);
    if (!plan) {
        throw new Error(`[plans] No '${FREE_PLAN_ID}' row in the ${PLANS_CLASS} class`);
    }
    return plan;
}

/**
 * A pointer at the free plan, for the signup paths.
 *
 * Signup must not fail because the catalogue is momentarily unreachable, so
 * this falls back to `FREE_PLAN_OBJECT_ID` — the one place a literal objectId
 * is allowed to appear.
 */
export async function getFreePlanPointer(): Promise<{ __type: 'Pointer'; className: string; objectId: string } | null> {
    // No billing: accounts have no plan row to point at.
    if (!isBillingEnabled()) return null;
    let objectId = FREE_PLAN_OBJECT_ID;
    try {
        objectId = (await getFreePlan()).id as string;
    } catch (error) {
        console.error('[plans] Free plan lookup failed at signup — falling back to the known objectId:', error);
    }
    return { __type: 'Pointer', className: PLANS_CLASS, objectId };
}

// ─── No billing ──────────────────────────────────────────────────────────────

let unlimitedPlan: Parse.Object | null = null;

/** The in-memory plan for installs without billing. Never saved. */
export function getUnlimitedPlan(): Parse.Object {
    if (!unlimitedPlan) {
        const plan = new (Parse.Object.extend(PLANS_CLASS))();
        plan.set('planId', UNLIMITED_PLAN_ID);
        plan.set('planName', 'Self-hosted');
        plan.set('bookmarkCountLimit', null);
        plan.set('audioGenerationLimit', null);
        plan.set('planPrices', {});
        plan.set('planFeatures', []);
        unlimitedPlan = plan as Parse.Object;
    }
    return unlimitedPlan;
}

// ─── Derivation ──────────────────────────────────────────────────────────────

export function getPlanId(plan: Parse.Object | null | undefined): string {
    return (plan?.get('planId') as string) || FREE_PLAN_ID;
}

export function getPlanTier(plan: Parse.Object | null | undefined): PlanTier {
    const planId = getPlanId(plan);
    if (planId === IMPORT_ADDON_PLAN_ID) return 'free';
    // Unknown paid plans fall to the lowest paid tier — see PLAN_TIERS.
    return PLAN_TIERS[planId] ?? (planId === FREE_PLAN_ID ? 'free' : 'plus');
}

/** True for any plan that is not the free tier. Add-ons do not count. */
export function isPaidPlan(plan: Parse.Object | null | undefined): boolean {
    if (!isBillingEnabled()) return false;
    const planId = getPlanId(plan);
    return planId !== FREE_PLAN_ID && planId !== IMPORT_ADDON_PLAN_ID;
}

/**
 * A retired price point: kept in the table so grandfathered subscribers still
 * resolve to a real plan and the reconciler still recognises their price, but
 * never offered for sale again.
 */
export function isArchivedPlan(plan: Parse.Object | null | undefined): boolean {
    return plan?.get('archived') === true;
}

/** String form of the same test, for the few places that only hold an id. */
export function isPaidPlanId(planId: string | null | undefined): boolean {
    if (!isBillingEnabled()) return false;
    return Boolean(planId) && planId !== FREE_PLAN_ID && planId !== IMPORT_ADDON_PLAN_ID;
}

export function getPlanLimits(plan: Parse.Object | null | undefined): PlanLimits {
    // No billing: nothing is limited.
    if (!isBillingEnabled()) return { bookmarks: null, audioGenerations: null };
    const bookmarks = plan?.get('bookmarkCountLimit');
    const audio = plan?.get('audioGenerationLimit');
    // A number is a limit and an explicit null is "unlimited"; anything else (a missing
    // column) falls back to the free allowance.
    const limit = (value: unknown, fallback: number | null) =>
        typeof value === 'number' ? value : value === null ? null : fallback;
    return {
        bookmarks: limit(bookmarks, FALLBACK_FREE_LIMITS.bookmarks),
        audioGenerations: limit(audio, FALLBACK_FREE_LIMITS.audioGenerations),
    };
}

/** Resolve the boolean entitlements for a plan. See `PLAN_FEATURES`. */
export function getPlanFeatures(plan: Parse.Object | null | undefined): PlanFeatures {
    const tier = getPlanTier(plan);
    const features = {} as PlanFeatures;
    // No billing: every feature is on.
    if (!isBillingEnabled()) {
        for (const name of Object.keys(PLAN_FEATURES) as Array<keyof PlanFeatures>) features[name] = true;
        return features;
    }

    for (const [name, minimumTier] of Object.entries(PLAN_FEATURES) as Array<[keyof PlanFeatures, PlanTier]>) {
        const override = plan?.get(`${name}Enabled`);
        features[name] = typeof override === 'boolean'
            ? override
            : TIER_RANK[tier] >= TIER_RANK[minimumTier];
    }

    return features;
}

export function hasPlanFeature(plan: Parse.Object | null | undefined, feature: keyof PlanFeatures): boolean {
    return getPlanFeatures(plan)[feature];
}

/**
 * How generous a plan is, for picking between several a user is entitled to.
 *
 * Holding two paid subscriptions at once is a real state — it is what the
 * duplicate-customer bug produced — and when it happens the user is being
 * charged for both. Giving them the better of the two is the only defensible
 * answer; giving them whichever event arrived last is how someone paying for
 * the bigger plan ended up on the smaller one.
 */
export async function rankPlanIdsBestFirst(planIds: string[]): Promise<string[]> {
    const catalog = await loadCatalog().catch(() => [] as Parse.Object[]);
    const planOf = (planId: string) =>
        catalog.find((candidate) => candidate.get('planId') === planId) ?? null;
    return [...planIds].sort((a, b) => comparePlanGenerosity(planOf(b), planOf(a)));
}

/**
 * Positive when `a` is the more generous plan. Tier first, then the numeric
 * allowances: every paid plan is Plus now, so the tier alone can no longer tell
 * a grandfathered row from the one on sale, but the limits still can.
 *
 * `null` is a price with no `plans` row. It ranks above free but below anything
 * we recognise, so it is still reported rather than silently outranking a real
 * plan.
 */
export function comparePlanGenerosity(a: Parse.Object | null, b: Parse.Object | null): number {
    const key = (plan: Parse.Object | null): number[] => {
        if (!plan) return [0.5, 0, 0];
        const limits = getPlanLimits(plan);
        const size = (limit: number | null) => (limit === null ? Infinity : limit);
        return [TIER_RANK[getPlanTier(plan)], size(limits.bookmarks), size(limits.audioGenerations)];
    };
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] > kb[i] ? 1 : -1;
    }
    return 0;
}

// ─── Resolving a user's plan ─────────────────────────────────────────────────

/**
 * The user's plan object, guaranteed hydrated.
 *
 * `user.get('currentPlan')` on a query that did not `.include('currentPlan')`
 * returns an *unfetched pointer stub*, on which every `.get()` answers
 * `undefined`. Call sites that compared `planId !== 'free'` on a stub were
 * therefore granting paid access to free users. Rather than making every caller
 * remember the include, this fetches when the stub is cold.
 *
 * Falls back to the free plan when the pointer is missing or unreadable, so
 * callers never have to handle a null plan.
 */
export async function resolveUserPlan(user: Parse.Object): Promise<Parse.Object> {
    if (!isBillingEnabled()) return getUnlimitedPlan();
    const memoised = resolvedPlans.get(user);
    if (memoised) return memoised;

    const plan = await resolvePlanFor(user);
    resolvedPlans.set(user, plan);
    return plan;
}

/**
 * Per-instance memo of `resolveUserPlan`.
 *
 * Resolution may return the cached catalogue row rather than hydrating the
 * pointer in place, which would leave `user.get('currentPlan')` a cold stub for
 * any synchronous helper called afterwards. Keyed on the user object so it
 * lives exactly as long as the request that owns it, and so nothing is written
 * back to the row.
 */
const resolvedPlans = new WeakMap<Parse.Object, Parse.Object>();

/**
 * The plan already resolved for this user instance, if any.
 *
 * For synchronous helpers that run after `resolveUserPlan`. Falls back to the
 * raw pointer, which may be cold — callers get free-tier limits in that case
 * rather than a wrong answer.
 */
export function getResolvedPlan(user: Parse.Object): Parse.Object | null {
    return resolvedPlans.get(user) ?? (user.get(USER_PLAN_COLUMN) || null);
}

async function resolvePlanFor(user: Parse.Object): Promise<Parse.Object> {
    const pointer = user.get(USER_PLAN_COLUMN);

    if (pointer && typeof pointer.get === 'function') {
        // A hydrated object always has a planId; a cold stub never does.
        if (pointer.get('planId') !== undefined) return pointer;

        try {
            // Prefer the cached catalogue over a network fetch when we can
            // match the pointer by objectId.
            const cached = (await loadCatalog()).find((plan) => plan.id === pointer.id);
            if (cached) return cached;

            await pointer.fetch({ useMasterKey: true });
            if (pointer.get('planId') !== undefined) return pointer;
        } catch (error) {
            console.error(`[plans] Failed to hydrate currentPlan for user ${user.id}:`, error);
        }
    }

    console.warn(`[plans] User ${user.id} has no readable currentPlan — treating as free`);
    return freePlanOrFallback();
}

/**
 * The free plan, or an in-memory stand-in if the `plans` table is unreachable.
 *
 * Read paths must not 500 because the catalogue is down — degrading to free
 * limits is the safe failure. Write paths call `getFreePlan()` instead, which
 * throws, because pointing a user at a fabricated object would corrupt the row.
 */
async function freePlanOrFallback(): Promise<Parse.Object> {
    try {
        return await getFreePlan();
    } catch (error) {
        console.error('[plans] Free plan row unavailable — using in-memory fallback:', error);
        const stub = new (Parse.Object.extend(PLANS_CLASS))();
        stub.set('planId', FREE_PLAN_ID);
        stub.set('planName', 'Free');
        stub.set('bookmarkCountLimit', FALLBACK_FREE_LIMITS.bookmarks);
        stub.set('audioGenerationLimit', FALLBACK_FREE_LIMITS.audioGenerations);
        return stub as Parse.Object;
    }
}

/**
 * Load a user (by id or object) together with a hydrated plan.
 *
 * An unknown id answers 400 rather than letting Parse's own error escape as a
 * 500 — every caller is acting on a user id supplied by a client.
 */
export async function getUserWithPlan(
    userOrId: string | Parse.Object
): Promise<{ user: Parse.Object; plan: Parse.Object }> {
    const user = typeof userOrId === 'string'
        ? await new Parse.Query(Parse.User)
            .include(USER_PLAN_COLUMN)
            .get(userOrId, { useMasterKey: true })
            .catch((error) => {
                // 101 is "object not found"; anything else is a Parse failure worth seeing in the logs.
                if (error?.code !== 101) console.error(`[plans] Could not load user ${userOrId}:`, error?.code, error?.message);
                throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' });
            })
        : userOrId;

    return { user, plan: await resolveUserPlan(user) };
}

// ─── Usage and quotas ────────────────────────────────────────────────────────

/**
 * The month key as it is *stored* in `usage.currentMonth.month`: `M/YYYY`,
 * unpadded. Ugly, but it is what every writer has always produced, and a
 * key that does not match byte-for-byte silently zeroes a user's meters.
 *
 * `distributedBookmarkCounter` and `serverUtils` both call this rather than
 * re-deriving the format — that they each had their own copy is how the
 * padding question could have gone wrong in the first place.
 */
export function currentUsageMonth(date: Date = new Date()): string {
    return `${date.getMonth() + 1}/${date.getFullYear()}`;
}

/** The same month, sortable, for the wire. */
export function isoMonth(date: Date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

interface RawUsage {
    month: string;
    bookmarksTotal: number;
    bookmarksThisMonth: number;
    audiosGenerated: number;
    filesUploaded: number;
}

/**
 * Normalised counters for the current month.
 *
 * `usage.currentMonth.bookmarksTotal` is the maintained counter. The top-level
 * `bookmarksTotal` mirror is the fallback for rows written before the `usage`
 * object existed; `websiteCount` is not consulted, because nothing has written
 * it in a long time and trusting it under-counts.
 */
export function getUsage(user: Parse.Object): RawUsage {
    const usage = user.get('usage') || {};

    const bookmarksTotal =
        usage.currentMonth?.bookmarksTotal ??
        (user.get('bookmarksTotal') as number | undefined) ??
        0;

    // `currentMonth` is only rolled over when something writes to it, so a user
    // who has not saved anything since July still has July's block sitting
    // there. Its `bookmarksTotal` is a running lifetime figure and stays valid,
    // but the monthly meters belong to a window that has closed — reading them
    // would charge this month's audio against last month's count.
    const isCurrentMonth = usage.currentMonth?.month === currentUsageMonth();

    return {
        month: isoMonth(),
        bookmarksTotal,
        bookmarksThisMonth: isCurrentMonth ? usage.currentMonth?.bookmarksThisMonth || 0 : 0,
        audiosGenerated: isCurrentMonth ? usage.currentMonth?.audiosGenerated || 0 : 0,
        filesUploaded: isCurrentMonth ? usage.currentMonth?.filesUploaded || 0 : 0,
    };
}

function buildQuota(used: number, limit: number | null): QuotaResponse {
    if (limit === null) {
        return { used, limit: null, remaining: null, unlimited: true, exceeded: false };
    }
    return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        unlimited: false,
        exceeded: used >= limit,
    };
}

/** Bookmarks held vs. the plan's bookmark limit. */
export function getBookmarkQuota(user: Parse.Object, plan: Parse.Object | null): QuotaResponse {
    return buildQuota(getUsage(user).bookmarksTotal, getPlanLimits(plan).bookmarks);
}

/** Audio generated this month vs. the plan's monthly allowance. */
export function getAudioQuota(user: Parse.Object, plan: Parse.Object | null): QuotaResponse {
    return buildQuota(getUsage(user).audiosGenerated, getPlanLimits(plan).audioGenerations);
}

/** Everything the usage card renders, in one object. */
export function getUsageSummary(user: Parse.Object, plan: Parse.Object | null): UsageResponse {
    const usage = getUsage(user);
    return {
        month: usage.month,
        bookmarks: getBookmarkQuota(user, plan),
        audio: getAudioQuota(user, plan),
        bookmarksThisMonth: usage.bookmarksThisMonth,
        filesUploaded: usage.filesUploaded,
    };
}

/**
 * The audio allowance is one monthly pool shared by bookmark playback and RSS
 * article playback.
 */
export async function hasAudioQuota(userOrId: string | Parse.Object): Promise<boolean> {
    const { user, plan } = await getUserWithPlan(userOrId);
    return !getAudioQuota(user, plan).exceeded;
}

/** How many more bookmarks the user may save. `null` means unlimited. */
export async function getRemainingBookmarkSlots(
    userOrId: string | Parse.Object
): Promise<number | null> {
    const { user, plan } = await getUserWithPlan(userOrId);
    return getBookmarkQuota(user, plan).remaining;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/**
 * The only way to change a user's plan.
 *
 * Does **not** save — callers batch this with their other mutations and save
 * once. Returns the plan that was applied, or null when no such `planId`
 * exists (in which case the user is left untouched, which is the right
 * behaviour for a Stripe price we do not sell any more).
 *
 * Also clears the dead mirror columns on the way past, so a row stops carrying
 * two contradictory answers as soon as anything touches its plan.
 */
export async function setUserPlan(
    user: Parse.Object,
    planId: string,
    reason: string
): Promise<Parse.Object | null> {
    if (!isBillingEnabled()) return getUnlimitedPlan();
    const plan = await getPlanByPlanId(planId);
    if (!plan) {
        console.warn(`[plans] No plan row for planId '${planId}' — leaving user ${user.id} unchanged (${reason})`);
        return null;
    }

    user.set(USER_PLAN_COLUMN, plan);
    resolvedPlans.set(user, plan);
    clearDeprecatedPlanColumns(user);

    console.log(`[plans] User ${user.id} -> '${planId}' (${reason})`);
    return plan;
}

/** Convenience wrapper for the downgrade paths. */
export async function setUserToFreePlan(user: Parse.Object, reason: string): Promise<Parse.Object> {
    if (!isBillingEnabled()) return getUnlimitedPlan();
    const plan = await getFreePlan();
    user.set(USER_PLAN_COLUMN, plan);
    resolvedPlans.set(user, plan);
    clearDeprecatedPlanColumns(user);
    console.log(`[plans] User ${user.id} -> '${FREE_PLAN_ID}' (${reason})`);
    return plan;
}

/**
 * Unset the dead mirror columns. Safe to call on any user: unsetting a column
 * that is already absent is a no-op, and none of them are read any more.
 */
export function clearDeprecatedPlanColumns(user: Parse.Object): void {
    for (const column of DEPRECATED_USER_PLAN_COLUMNS) {
        if (user.get(column) !== undefined) user.unset(column);
    }
}

// ─── Serialisation ───────────────────────────────────────────────────────────

function readPrices(plan: Parse.Object): PlanResponse['prices'] {
    const prices = (plan.get('planPrices') || {}) as Record<string, number | undefined>;
    const toNumber = (value: unknown) => (typeof value === 'number' ? value : null);
    return {
        monthly: toNumber(prices.monthly),
        yearly: toNumber(prices.yearly),
        oneTime: toNumber(prices.price),
    };
}

/**
 * The plan half of every entitlements answer.
 *
 * `GET /v1/me/entitlements`, `POST /v1/me/plan/refresh` and
 * `POST /v1/me/plan/appstore` all return this, each adding its own extras, so
 * the phone can apply any of the three responses without a second round trip.
 */
export function buildEntitlements(user: Parse.Object, plan: Parse.Object) {
    return {
        plan: serializePlan(plan),
        usage: getUsageSummary(user, plan),
        features: getPlanFeatures(plan),
        planSource: getPlanSource(user),
        // The web app hides pricing, upgrade prompts and billing settings unless this is on.
        billing: { enabled: isBillingEnabled(), provider: billingProviderName() },
    };
}

/**
 * The name to show for a plan: its tier's, so a subscriber grandfathered onto
 * a retired Bite or Feast row reads as Plus like everyone else who pays. The
 * import add-on is not a tier and keeps its own label.
 */
export function getPlanDisplayName(plan: Parse.Object | null | undefined): string {
    const planId = getPlanId(plan);
    if (planId === UNLIMITED_PLAN_ID) return (plan?.get('planName') as string) || 'Self-hosted';
    if (planId === IMPORT_ADDON_PLAN_ID) return (plan?.get('planName') as string) || planId;
    return PLAN_TIER_NAMES[getPlanTier(plan)];
}

/** Turn a `plans` row into the shape clients decode. */
export function serializePlan(plan: Parse.Object): PlanResponse {
    const planId = getPlanId(plan);
    const occurrence = plan.get('occurrence') as PlanOccurrence | undefined;

    return {
        id: plan.id as string,
        planId,
        name: getPlanDisplayName(plan),
        tier: getPlanTier(plan),
        occurrence: occurrence || null,
        isPaid: isPaidPlan(plan),
        isAddon: planId === IMPORT_ADDON_PLAN_ID,
        prices: readPrices(plan),
        limits: getPlanLimits(plan),
        features: getPlanFeatures(plan),
        marketingFeatures: (plan.get('planFeatures') || []).filter(
            (entry: { title?: string }) => entry && entry.title
        ),
    };
}
