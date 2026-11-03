/**
 * Tests for the plan derivation and quota arithmetic.
 *
 * These are the pure parts of `plans.ts` — tier and feature derivation,
 * quota maths, usage normalisation and serialisation. Everything that talks to
 * Parse (the catalogue cache, `resolveUserPlan`, `setUserPlan`) is left out;
 * those are exercised end-to-end by `/v1/plans` and `/v1/import/importStatus`.
 *
 * The case worth pinning hardest is the month key. `usage.currentMonth.month`
 * is stored unpadded as `M/YYYY`, and a helper that produced `YYYY-MM` instead
 * would silently read every user's monthly meters as zero — handing out free
 * audio rather than throwing. Run with:
 *
 *   npm run test:plans
 */

import Parse from 'parse/node.js';

Parse.initialize('test-app-id', 'test-js-key', 'test-master-key');
Parse.serverURL = 'https://parse.invalid/parse';

// These tests pin the plan arithmetic of a deployment WITH billing (the hosted service).
// The self-hosted default (no billing, everything unlimited) is covered by billing.test.ts.
process.env.BILLING_PROVIDER = 'test-billing';

import {
    getPlanId,
    getPlanTier,
    isPaidPlan,
    isPaidPlanId,
    isArchivedPlan,
    getPlanLimits,
    getPlanFeatures,
    hasPlanFeature,
    getPlanDisplayName,
    comparePlanGenerosity,
    getUsage,
    getBookmarkQuota,
    getAudioQuota,
    getUsageSummary,
    serializePlan,
    clearDeprecatedPlanColumns,
    currentUsageMonth,
    isoMonth,
    DEPRECATED_USER_PLAN_COLUMNS,
    FALLBACK_FREE_LIMITS,
    PLANS_CLASS,
} from './plans';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const Plans = Parse.Object.extend(PLANS_CLASS);

function makePlan(attrs: Record<string, unknown>): Parse.Object {
    const plan = new Plans();
    for (const [key, value] of Object.entries(attrs)) plan.set(key, value);
    return plan as Parse.Object;
}

function makeUser(attrs: Record<string, unknown> = {}): Parse.Object {
    const user = new Parse.User();
    for (const [key, value] of Object.entries(attrs)) user.set(key, value);
    return user as unknown as Parse.Object;
}

const FREE = makePlan({ planId: 'free', planName: 'Free', bookmarkCountLimit: 100, audioGenerationLimit: 5, occurrence: 'monthly', planPrices: { monthly: 0, yearly: 0 } });
const BITE = makePlan({ planId: 'bite_monthly', planName: 'Bite', bookmarkCountLimit: 5000, audioGenerationLimit: 10, occurrence: 'monthly', planPrices: { monthly: 4.99, yearly: 42 } });
const FEAST = makePlan({ planId: 'feast_yearly', planName: 'Feast', bookmarkCountLimit: 100000, audioGenerationLimit: 100, occurrence: 'yearly', planPrices: { monthly: 6.99, yearly: 67 } });
const IMPORT = makePlan({ planId: 'webbites-import', planName: 'ImportBookmarks', bookmarkCountLimit: 0, audioGenerationLimit: 0, occurrence: 'singlePayment', planPrices: { price: 3 } });

// ─── Tier derivation ─────────────────────────────────────────────────────────

console.log('\ntier derivation');
check('free plan is the free tier', getPlanTier(FREE) === 'free');
check('bite_monthly is the plus tier (legacy id)', getPlanTier(BITE) === 'plus');
check('plus_monthly is the plus tier', getPlanTier(makePlan({ planId: 'plus_monthly' })) === 'plus');
// Plus is the only paid tier. Every retired price id is Plus, not a tier of
// its own that clients would have to know how to name and rank.
check('feast_yearly is the plus tier (legacy id)', getPlanTier(FEAST) === 'plus');
check('ultra_yearly is the plus tier (legacy id)', getPlanTier(makePlan({ planId: 'ultra_yearly' })) === 'plus');
check('the import add-on is not a paid tier', getPlanTier(IMPORT) === 'free');
check(
    'an unmapped paid plan falls to the lowest paid tier, not the highest',
    getPlanTier(makePlan({ planId: 'brand_new_price' })) === 'plus'
);
check('a missing plan reads as free', getPlanTier(null) === 'free');
check('a missing plan has the free planId', getPlanId(undefined) === 'free');

console.log('\npaid tests');
check('free is not paid', isPaidPlan(FREE) === false);
check('bite is paid', isPaidPlan(BITE) === true);
check('the import add-on does not count as a subscription', isPaidPlan(IMPORT) === false);
check('isPaidPlanId agrees with isPaidPlan', isPaidPlanId('feast_monthly') && !isPaidPlanId('free'));
check('isPaidPlanId is false for a missing id', isPaidPlanId(undefined) === false);

// ─── Limits ──────────────────────────────────────────────────────────────────

console.log('\nlimits');
check('limits come off the plan row', getPlanLimits(BITE).bookmarks === 5000);
check('audio limit comes off the plan row', getPlanLimits(FEAST).audioGenerations === 100);
check(
    'a plan row missing a limit falls back to free',
    getPlanLimits(makePlan({ planId: 'free' })).bookmarks === FALLBACK_FREE_LIMITS.bookmarks
);
check(
    'a zero limit is honoured rather than treated as missing',
    getPlanLimits(IMPORT).bookmarks === 0
);

check('a retired plan is archived', isArchivedPlan(makePlan({ planId: 'bite_monthly', archived: true })));
check('a plan on sale is not', isArchivedPlan(BITE) === false);
check('a missing plan is not archived either', isArchivedPlan(null) === false);

// ─── Features ────────────────────────────────────────────────────────────────

console.log('\nfeatures');
check('free unlocks nothing', Object.values(getPlanFeatures(FREE)).every((v) => v === false));
check('bite unlocks summaries', hasPlanFeature(BITE, 'aiSummaries'));
// One paid tier, and it includes everything — OCR and smart boards no longer
// sit behind the retired top tier.
check('the paid tier unlocks OCR', hasPlanFeature(BITE, 'ocr'));
check('the paid tier unlocks everything', Object.values(getPlanFeatures(BITE)).every((v) => v === true));
check('a grandfathered feast plan still unlocks everything', Object.values(getPlanFeatures(FEAST)).every((v) => v === true));
check(
    'RSS auto-extract is a paid feature (the gate that used to refuse everyone)',
    hasPlanFeature(FREE, 'rssAutoExtract') === false && hasPlanFeature(BITE, 'rssAutoExtract') === true
);
check(
    'a per-plan column overrides the tier default on',
    hasPlanFeature(makePlan({ planId: 'free', ocrEnabled: true }), 'ocr') === true
);
check(
    'a per-plan column overrides the tier default off',
    hasPlanFeature(makePlan({ planId: 'feast_yearly', ocrEnabled: false }), 'ocr') === false
);

// ─── Ranking ─────────────────────────────────────────────────────────────────

console.log('\nranking');
const PLUS = makePlan({ planId: 'plus_monthly', planName: 'Plus', bookmarkCountLimit: 1_000_000, audioGenerationLimit: 100 });
// Same tier now, so the limits decide: a user paying for both a retired row
// and the plan on sale gets whichever allows more.
check('a paid plan outranks free', comparePlanGenerosity(BITE, FREE) > 0);
check('within Plus, the bigger allowance wins', comparePlanGenerosity(PLUS, FEAST) > 0 && comparePlanGenerosity(FEAST, BITE) > 0);
check('an unknown price ranks above free', comparePlanGenerosity(null, FREE) > 0);
check('an unknown price ranks below any real paid plan', comparePlanGenerosity(BITE, null) > 0);
check('a plan ties with itself', comparePlanGenerosity(FEAST, FEAST) === 0);

// ─── Month key ───────────────────────────────────────────────────────────────

console.log('\nmonth key');
const JAN = new Date(2026, 0, 15);
check('stored month key is unpadded M/YYYY', currentUsageMonth(JAN) === '1/2026');
check('wire month key is zero-padded YYYY-MM', isoMonth(JAN) === '2026-01');
check('the two formats are deliberately different', currentUsageMonth(JAN) !== isoMonth(JAN));

// ─── Usage ───────────────────────────────────────────────────────────────────

console.log('\nusage');
const thisMonth = currentUsageMonth();
const active = makeUser({
    usage: {
        currentMonth: { month: thisMonth, bookmarksTotal: 1182, bookmarksThisMonth: 55, audiosGenerated: 6, filesUploaded: 2 },
        pastMonths: [],
    },
});
check('current-month meters are read', getUsage(active).audiosGenerated === 6);
check('current-month bookmark total is read', getUsage(active).bookmarksTotal === 1182);
check('files uploaded is read', getUsage(active).filesUploaded === 2);

// A user who has not saved anything since June still carries June's block.
const stale = makeUser({
    usage: {
        currentMonth: { month: '6/2020', bookmarksTotal: 9226, bookmarksThisMonth: 5, audiosGenerated: 4, filesUploaded: 1 },
        pastMonths: [],
    },
});
check('a stale month keeps the lifetime bookmark total', getUsage(stale).bookmarksTotal === 9226);
check('a stale month zeroes the monthly audio meter', getUsage(stale).audiosGenerated === 0);
check('a stale month zeroes bookmarks-this-month', getUsage(stale).bookmarksThisMonth === 0);

const legacy = makeUser({ bookmarksTotal: 42 });
check('the top-level mirror is the fallback for rows with no usage object', getUsage(legacy).bookmarksTotal === 42);
check('a user with nothing at all reads as zero', getUsage(makeUser()).bookmarksTotal === 0);

// ─── Quotas ──────────────────────────────────────────────────────────────────

console.log('\nquotas');
const overFree = getBookmarkQuota(makeUser({ bookmarksTotal: 9226 }), FREE);
check('a free user over the limit is exceeded', overFree.exceeded === true);
check('remaining never goes negative', overFree.remaining === 0);
check('used reports the real count, not the clamped one', overFree.used === 9226);

const underFeast = getBookmarkQuota(makeUser({ bookmarksTotal: 1182 }), FEAST);
check('a feast user under the limit is not exceeded', underFeast.exceeded === false);
check('remaining is limit minus used', underFeast.remaining === 100000 - 1182);

check(
    'a user exactly at the limit is exceeded, not merely at it',
    getBookmarkQuota(makeUser({ bookmarksTotal: 100 }), FREE).exceeded === true
);
check(
    'one under the limit is still allowed',
    getBookmarkQuota(makeUser({ bookmarksTotal: 99 }), FREE).exceeded === false
);
check(
    'a user with no plan gets free limits rather than unlimited access',
    getBookmarkQuota(makeUser({ bookmarksTotal: 500 }), null).exceeded === true
);

check('audio quota reads the monthly meter', getAudioQuota(active, FEAST).used === 6);
check('audio quota is not exceeded under the limit', getAudioQuota(active, FEAST).exceeded === false);
check('audio quota is exceeded at the limit', getAudioQuota(active, BITE.clone().set('audioGenerationLimit', 6) as Parse.Object).exceeded === true);
check(
    'a stale usage month means this month has spent no audio',
    getAudioQuota(stale, FREE).exceeded === false
);

const summary = getUsageSummary(active, FEAST);
check('summary reports the wire month format', summary.month === isoMonth());
check('summary carries both quotas', summary.bookmarks.limit === 100000 && summary.audio.limit === 100);
check('summary carries bookmarks-this-month', summary.bookmarksThisMonth === 55);

// ─── Serialisation ───────────────────────────────────────────────────────────

console.log('\nserialisation');
const wire = serializePlan(BITE);
check('planId is carried through', wire.planId === 'bite_monthly');
// The screenshot bug: a grandfathered subscriber read "You're on the Feast plan."
check('a retired Feast row is shown as Plus', serializePlan(FEAST).name === 'Plus');
check('a retired Bite row is shown as Plus', wire.name === 'Plus');
check('a retired Ultra row is shown as Plus', getPlanDisplayName(makePlan({ planId: 'ultra_monthly', planName: 'Ultra' })) === 'Plus');
check('the free plan is shown as Free', serializePlan(FREE).name === 'Free');
check('a price with no row of its own is still named for its tier', serializePlan(makePlan({ planId: 'x_monthly' })).name === 'Plus');
check('the import add-on keeps its own label', serializePlan(IMPORT).name === 'ImportBookmarks');
check('a missing plan is shown as Free', getPlanDisplayName(null) === 'Free');
check('prices are split out of planPrices', wire.prices.monthly === 4.99 && wire.prices.yearly === 42);
check('one-off prices land in oneTime', serializePlan(IMPORT).prices.oneTime === 3);
check('a missing price is null, not zero', wire.prices.oneTime === null);
check('the add-on is flagged', serializePlan(IMPORT).isAddon === true && wire.isAddon === false);
check('features are included for gating', wire.features.aiSummaries === true);
check(
    'blank marketing bullets are dropped',
    serializePlan(makePlan({ planId: 'free', planFeatures: [{ title: '', description: '' }, { title: 'Real' }] }))
        .marketingFeatures.length === 1
);

// ─── Deprecated columns ──────────────────────────────────────────────────────

console.log('\ndeprecated columns');
const legacyUser = makeUser({ planTier: 'Feast', isPremium: true, maxWebsiteCount: 100, plan: { currentPlan: { name: 'free' } } });
clearDeprecatedPlanColumns(legacyUser);
check(
    'every deprecated column is unset',
    DEPRECATED_USER_PLAN_COLUMNS.every((column) => legacyUser.get(column) === undefined)
);
check('currentPlan is never touched by the cleanup', (() => {
    const user = makeUser({ currentPlan: FREE, planTier: 'free' });
    clearDeprecatedPlanColumns(user);
    return user.get('currentPlan') === FREE;
})());


console.log(`\nplans: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
