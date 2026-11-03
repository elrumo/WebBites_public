import { appName, siteUrl } from './site';

/**
 * The words and links every email shares, read when the email is built so they follow the
 * installation's settings (APP_NAME, SITE_URL, SUPPORT_EMAIL, LOGO_URL).
 */
export interface EmailBrand {
    appName: string;
    siteUrl: string;
    logoUrl: string;
    /** Where to write if something looks wrong; empty when the operator has not set one. */
    supportEmail: string;
    year: string;
}

export function emailBrand(): EmailBrand {
    const site = siteUrl();
    return {
        appName: appName(),
        siteUrl: site,
        logoUrl: (process.env.LOGO_URL || '').trim() || `${site}/webbites-logo-medium.png`,
        supportEmail: (process.env.SUPPORT_EMAIL || '').trim(),
        year: String(new Date().getFullYear()),
    };
}

/** Fill the {{appName}} / {{siteUrl}} / {{logoUrl}} / {{supportEmail}} / {{year}} placeholders. */
export function applyBrand(html: string, brand: EmailBrand = emailBrand()): string {
    return html
        .replaceAll('{{appName}}', brand.appName)
        .replaceAll('{{siteUrl}}', brand.siteUrl)
        .replaceAll('{{logoUrl}}', brand.logoUrl)
        .replaceAll('{{supportEmail}}', brand.supportEmail)
        .replaceAll('{{year}}', brand.year);
}
