/**
 * Wire types for plans, quotas and entitlements.
 *
 * These are the shapes every client decodes. `GET /v1/plans` returns the
 * catalogue, `GET /v1/me/entitlements` returns one user's resolved state.
 * Clients must not read plan columns off the Parse `_User` row directly —
 * see `server/utils/plans.ts` for why, and `docs/plans-architecture.md` for
 * the migration story.
 */

/**
 * The product ladder. Everything a plan is *allowed* to do derives from its
 * tier, so a new price point only has to be added to `PLAN_TIERS` in
 * `server/utils/plans.ts` to inherit the right feature set.
 *
 * Two account tiers are sold: Free and Plus. The retired Bite, Feast and Ultra
 * price ids are all `plus` — see `PLAN_TIERS`. (The Apple-only device library
 * is sold in the native app and never reaches this server.)
 */
export type PlanTier = 'free' | 'plus';

/** How a plan bills. `singlePayment` marks a one-off add-on, not a tier. */
export type PlanOccurrence = 'monthly' | 'yearly' | 'singlePayment';

/** Numeric allowances. Sourced from the `plans` row, never hard-coded at a call site. */
export interface PlanLimits {
    /** Total bookmarks the account may hold. `null` means unlimited. */
    bookmarks: number | null;
    /** Audio generations per calendar month. `null` means unlimited. */
    audioGenerations: number | null;
}

/**
 * Boolean entitlements. Derived from the tier, with an optional per-plan
 * override column (`<feature>Enabled`) on the `plans` row so pricing can be
 * changed without a deploy.
 */
export interface PlanFeatures {
    /** AI TL;DR summaries for bookmarks and RSS articles. */
    aiSummaries: boolean;
    /** Automatic tagging of uploaded/saved images. */
    imageTagging: boolean;
    /** OCR text recognition on images. */
    ocr: boolean;
    /** Taller, higher-quality full-page screenshots. */
    highResScreenshots: boolean;
    /** Per-feed full-text extraction in the RSS reader. */
    rssAutoExtract: boolean;
    /** Smart board suggestions. */
    smartBoards: boolean;
    /** Scheduled backups to the user's S3 bucket, Google Drive or Dropbox. */
    backups: boolean;
}

/** A row of the `plans` class, normalised. */
export interface PlanResponse {
    /** Parse objectId. Only useful for writing the `currentPlan` pointer. */
    id: string;
    /** Stable key, and the Stripe price id the plan is sold under. */
    planId: string;
    /** Display name: the tier's ('Free', 'Plus'), never a retired row's own. */
    name: string;
    tier: PlanTier;
    occurrence: PlanOccurrence | null;
    /** False only for the free plan. Add-ons are paid but not subscriptions. */
    isPaid: boolean;
    /** A one-off purchase (import access), not a subscription tier. */
    isAddon: boolean;
    prices: {
        monthly: number | null;
        yearly: number | null;
        oneTime: number | null;
    };
    limits: PlanLimits;
    features: PlanFeatures;
    /** Marketing bullet points. Display only — never gate on these. */
    marketingFeatures: Array<{ id?: string; title: string; description?: string }>;
}

/** One metered allowance and how much of it is spent. */
export interface QuotaResponse {
    used: number;
    /** `null` when the plan grants an unlimited allowance. */
    limit: number | null;
    /** `null` when unlimited. */
    remaining: number | null;
    unlimited: boolean;
    /** True when the next action of this kind would be rejected. */
    exceeded: boolean;
}

/** Live usage for the current calendar month. */
export interface UsageResponse {
    /** `YYYY-MM` of the window `audio` is measured over. */
    month: string;
    /** Lifetime bookmark count against the plan's bookmark limit. */
    bookmarks: QuotaResponse;
    /** Audio generations this month against the plan's monthly limit. */
    audio: QuotaResponse;
    /** Bookmarks added this month. Not metered — shown in the usage card. */
    bookmarksThisMonth: number;
    filesUploaded: number;
}

/**
 * One-time bookmark-import access, which is bought separately from any
 * subscription and deliberately outlives a downgrade.
 */
export interface ImportAccessResponse {
    /** Raw `importAccessStatus`: none | paid | importing | completed | expired | failed. */
    status: string;
    hasAccess: boolean;
    /** Why access was granted or refused; see `validateImportAccess`. */
    accessType: string;
    reason: string;
    /** True when the import may exceed the plan's bookmark limit. */
    unlimited: boolean;
    expiresAt: string | null;
    hasUsedAccess: boolean;
}

/**
 * The Stripe subscription behind a paid plan.
 *
 * Diagnostics only — a client must gate on `plan` and `features`, never on
 * `status`. These fields are a snapshot from the last reconciliation, which is
 * why `syncedAt` travels with them: a mirror that cannot say how old it is will
 * eventually be mistaken for live data.
 */
export interface SubscriptionResponse {
    customerId: string | null;
    subscriptionId: string | null;
    /** Stripe's status at `syncedAt`: active, trialing, past_due, … */
    status: string | null;
    /** When the current period ends — i.e. next renewal, or access end date. */
    currentPeriodEnd: string | null;
    /** When Parse was last reconciled against Stripe. Null means never. */
    syncedAt: string | null;
}

/**
 * Who is billing the current plan.
 *
 * iOS shows a purchase button only when it is not `stripe`: a subscription
 * bought on the web cannot be cancelled or replaced from the App Store, so
 * offering one there charges the same library twice.
 */
export type PlanSourceResponse = 'stripe' | 'app_store' | 'none';

/** `GET /v1/me/entitlements` — everything a client needs to gate its UI. */
export interface EntitlementsResponse {
    success: true;
    userId: string;
    plan: PlanResponse;
    usage: UsageResponse;
    /** Convenience mirror of `plan.features`, so clients read one path. */
    features: PlanFeatures;
    planSource: PlanSourceResponse;
    /** Whether this deployment bills at all. When off, hide pricing, upgrade and billing UI. */
    billing: { enabled: boolean; provider: string };
    importAccess: ImportAccessResponse;
    subscription: SubscriptionResponse;
}

/** `GET /v1/plans` — the catalogue, in display order. */
export interface PlanCatalogResponse {
    success: true;
    plans: PlanResponse[];
}
