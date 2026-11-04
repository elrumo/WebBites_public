/**
 * Billing providers.
 *
 * The self-hosted edition has no payment plans: every account is unlimited and nothing
 * here does anything. A hosted deployment adds a provider (Stripe, the App Store...) from
 * a separate, private overlay: it calls `registerBillingProvider()` from a Nitro plugin and
 * sets BILLING_PROVIDER to that provider's name.
 *
 *   BILLING_PROVIDER=none (default)   unlimited quotas, every feature on, no plans needed
 *   BILLING_PROVIDER=<name>           plans, quotas and features come from the `plans` class
 *
 * A provider only has to implement the hooks it needs; none may throw into the caller.
 */
import type Parse from 'parse/node.js';

export interface BillingProvider {
    readonly name: string;
    /** A new account was created (set up a customer, welcome plan...). */
    onUserCreated?(user: Parse.Object): Promise<void>;
    /** An account is about to be deleted (cancel subscriptions, close customers...). */
    onUserDeleted?(user: Parse.Object, context: { email?: string }): Promise<void>;
    /**
     * Just before a verified address change is applied. Whatever it returns is handed back to
     * `afterEmailChange`. Throwing here aborts the change (billing must still find the user).
     */
    beforeEmailChange?(user: Parse.Object): Promise<unknown>;
    /** After the address changed. May throw; the change is already done. */
    afterEmailChange?(user: Parse.Object, newEmail: string, state: unknown): Promise<void>;
}

const providers = new Map<string, BillingProvider>();

export function registerBillingProvider(provider: BillingProvider): void {
    providers.set(provider.name, provider);
}

/** Read on every call so tests (and a settings change) can flip it. */
export function billingProviderName(): string {
    return (process.env.BILLING_PROVIDER || 'none').trim().toLowerCase() || 'none';
}

/** False for the self-hosted default: no plans, no limits. */
export function isBillingEnabled(): boolean {
    return billingProviderName() !== 'none';
}

/** The registered provider for the configured name, or null (none, or not registered). */
export function getBillingProvider(): BillingProvider | null {
    if (!isBillingEnabled()) return null;
    return providers.get(billingProviderName()) ?? null;
}

/** Run one hook on the active provider, swallowing and logging any failure. */
export async function runBillingHook<K extends 'onUserCreated' | 'onUserDeleted'>(
    hook: K,
    ...args: Parameters<NonNullable<BillingProvider[K]>>
): Promise<void> {
    const provider = getBillingProvider();
    const fn = provider?.[hook] as ((...a: unknown[]) => Promise<void>) | undefined;
    if (!provider || !fn) return;
    try {
        await fn.apply(provider, args as unknown[]);
    } catch (error) {
        console.error(`[billing:${provider.name}] ${hook} failed:`, error);
    }
}
