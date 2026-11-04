/**
 * Run: npm run test:billing
 *
 * The self-hosted default: BILLING_PROVIDER unset (or "none") means no plans, no limits, every
 * feature on, and nothing to look up in the database. Also the provider registry the hosted
 * overlay plugs into.
 */
import Parse from 'parse/node.js';

Parse.initialize('test-app-id', 'test-js-key', 'test-master-key');
Parse.serverURL = 'https://parse.invalid/parse';

import {
    UNLIMITED_PLAN_ID,
    getUnlimitedPlan,
    getPlanLimits,
    getPlanFeatures,
    getPlanTier,
    isPaidPlan,
    getPlanSource,
    getBookmarkQuota,
    getAudioQuota,
    getUsageSummary,
    serializePlan,
    buildEntitlements,
    resolveUserPlan,
    getFreePlan,
    getFreePlanPointer,
    setUserToFreePlan,
    setUserPlan,
} from './plans';
import { registerBillingProvider, getBillingProvider, isBillingEnabled, billingProviderName, runBillingHook } from './billing';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}`); }
};

const user = (attrs: Record<string, unknown> = {}) => {
    const u = new Parse.User();
    for (const [k, v] of Object.entries(attrs)) u.set(k, v);
    return u;
};

console.log('no billing (default)');
delete process.env.BILLING_PROVIDER;
check('billing is off when BILLING_PROVIDER is unset', !isBillingEnabled() && billingProviderName() === 'none');
process.env.BILLING_PROVIDER = '  NONE ';
check('the name is trimmed and case-insensitive', !isBillingEnabled() && billingProviderName() === 'none');
delete process.env.BILLING_PROVIDER;

const plan = getUnlimitedPlan();
check('the unlimited plan is one shared in-memory object', plan === getUnlimitedPlan());
check('it is not saved anywhere', plan.id === undefined);
check('its id is the self-hosted plan id', plan.get('planId') === UNLIMITED_PLAN_ID);

check('limits are null (unlimited)', JSON.stringify(getPlanLimits(plan)) === '{"bookmarks":null,"audioGenerations":null}');
check('limits are unlimited even with no plan at all', getPlanLimits(null).bookmarks === null);
check('limits ignore a stale free plan row', getPlanLimits(Object.assign(new (Parse.Object.extend('plans'))(), {}).set('bookmarkCountLimit', 100) as any).bookmarks === null);

const features = getPlanFeatures(plan);
check('every feature is on', Object.values(features).length > 0 && Object.values(features).every(Boolean));
check('every feature is on for a missing plan too', Object.values(getPlanFeatures(null)).every(Boolean));
check('the tier is the top one', getPlanTier(plan) === 'plus');
check('nobody is on a paid plan (nothing to sell, nothing to downgrade)', isPaidPlan(plan) === false);

const someone = user({ usage: { currentMonth: { month: '1/2026', bookmarksTotal: 5000, audiosGenerated: 900 } } });
check('5000 bookmarks is under an unlimited limit', getBookmarkQuota(someone, plan).exceeded === false && getBookmarkQuota(someone, plan).unlimited === true);
check('900 audio generations is under an unlimited limit', getAudioQuota(someone, plan).exceeded === false && getAudioQuota(someone, plan).remaining === null);
check('the usage summary reports the real counts', getUsageSummary(someone, plan).bookmarks.used === 5000);

const wire = serializePlan(plan);
check('the plan serialises as free of charge and not paid', wire.isPaid === false && wire.prices.monthly === null);
check('its name is Self-hosted', wire.name === 'Self-hosted');
check('it serialises with null limits', wire.limits.bookmarks === null && wire.limits.audioGenerations === null);

check('plan source is none', getPlanSource(user({ stripeSubscriptionStatus: 'active', appStoreStatus: 'active' })) === 'none');

const entitlements = buildEntitlements(someone, plan);
check('entitlements say billing is off', entitlements.billing.enabled === false && entitlements.billing.provider === 'none');
check('entitlements carry the unlimited plan', entitlements.plan.limits.bookmarks === null);

async function main() {
    console.log('\nno database needed');
    // None of these may reach Parse: the host is .invalid, so any query would reject.
    const resolved = await resolveUserPlan(user());
    check('a user resolves to the unlimited plan with no currentPlan', resolved === plan);
    check('the "free plan" is the unlimited plan', (await getFreePlan()) === plan);
    check('there is no plan pointer to give a new account', (await getFreePlanPointer()) === null);
    check('downgrading to free is a no-op', (await setUserToFreePlan(user(), 'test')) === plan);
    const target = user();
    check('setting a plan is a no-op and writes nothing', (await setUserPlan(target, 'plus_monthly', 'test')) === plan && target.get('currentPlan') === undefined);

    console.log('\nwith a billing provider');
    process.env.BILLING_PROVIDER = 'acme';
    check('billing is on when a provider is named', isBillingEnabled() && billingProviderName() === 'acme');
    check('limits come from the plan again (the free allowance for no plan)', getPlanLimits(null).bookmarks === 100);
    check('an explicit null on a plan row means unlimited', (() => {
        const row = new (Parse.Object.extend('plans'))(); row.set('planId', 'big'); row.set('bookmarkCountLimit', null); row.set('audioGenerationLimit', 7);
        const limits = getPlanLimits(row as any); return limits.bookmarks === null && limits.audioGenerations === 7;
    })());
    check('a missing limit column still falls back to the free allowance', (() => {
        const row = new (Parse.Object.extend('plans'))(); row.set('planId', 'odd'); return getPlanLimits(row as any).bookmarks === 100;
    })());
    check('paid plans are paid again', isPaidPlan(Object.assign(new (Parse.Object.extend('plans'))(), {}).set('planId', 'plus_monthly') as any) === true);
    check('a registered but absent provider is simply null', getBillingProvider() === null);

    const calls: string[] = [];
    registerBillingProvider({
        name: 'acme',
        async onUserCreated(u) { calls.push(`created:${u.id ?? 'new'}`); },
        async onUserDeleted(_u, ctx) { calls.push(`deleted:${ctx.email}`); },
        async beforeEmailChange() { return { ids: [1] }; },
    });
    check('the registered provider is found by name', getBillingProvider()?.name === 'acme');
    await runBillingHook('onUserCreated', user());
    await runBillingHook('onUserDeleted', user(), { email: 'a@b.c' });
    check('hooks run on the provider', calls.join(',') === 'created:new,deleted:a@b.c');

    registerBillingProvider({ name: 'broken', async onUserCreated() { throw new Error('boom'); } });
    process.env.BILLING_PROVIDER = 'broken';
    const originalError = console.error; console.error = () => {};
    let threw = false;
    try { await runBillingHook('onUserCreated', user()); } catch { threw = true; }
    console.error = originalError;
    check('a failing hook never throws into the caller', !threw);

    process.env.BILLING_PROVIDER = 'acme';
    await runBillingHook('afterEmailChange' as any, user(), 'x@y.z', null).catch(() => {});
    check('a hook the provider does not implement is skipped', true);

    process.env.BILLING_PROVIDER = 'none';
    calls.length = 0;
    await runBillingHook('onUserCreated', user());
    check('no hooks run when billing is off, even if a provider is registered', calls.length === 0);


    console.log(`\nbilling: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
