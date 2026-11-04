/**
 * Outgoing email.
 *
 *   MAIL_PROVIDER   smtp | mailgun | none   (default: smtp when SMTP_HOST is set, mailgun when
 *                                            MAILGUN_API_KEY and MAILGUN_DOMAIN are, else none)
 *   MAIL_FROM       "Name <address>"        (default: "<APP_NAME> <noreply@<site host>>")
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE
 *   MAILGUN_API_KEY / MAILGUN_DOMAIN / MAILGUN_API_URL (default https://api.mailgun.net;
 *                                            use https://api.eu.mailgun.net for the EU region)
 *
 * `sendMail` never throws: it answers `{ success, reason? }` so each caller decides whether a
 * failed email matters. The same contract lives in apps/parse/src/mailer.js.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { appName, siteHost } from './site';

export type MailProvider = 'smtp' | 'mailgun' | 'none';

export interface MailMessage {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    from?: string;
    replyTo?: string;
}

export interface MailResult {
    success: boolean;
    id?: string;
    reason?: string;
}

/** Settings by name. Normally the process environment; the admin page's connection test passes the
 *  values it is about to save instead, so they can be tried before they are stored. */
export type MailSettings = Record<string, string | undefined>;
type Reader = (name: string) => string;
const reader = (overrides?: MailSettings): Reader => (name) => (overrides?.[name] ?? process.env[name] ?? '').trim();

export function mailProvider(overrides?: MailSettings): MailProvider {
    const env = reader(overrides);
    const explicit = env('MAIL_PROVIDER').toLowerCase();
    if (explicit === 'smtp' || explicit === 'mailgun' || explicit === 'none') return explicit;
    if (explicit) return 'none'; // an unknown value must not silently pick a provider
    if (env('SMTP_HOST')) return 'smtp';
    if (env('MAILGUN_API_KEY') && env('MAILGUN_DOMAIN')) return 'mailgun';
    return 'none';
}

export function isMailEnabled(): boolean {
    return mailProvider() !== 'none';
}

export function defaultFrom(overrides?: MailSettings): string {
    return reader(overrides)('MAIL_FROM') || `${appName()} <noreply@${siteHost()}>`;
}

let transport: Transporter | null = null;
let transportKey = '';

function smtpTransport(env: Reader, overrides?: MailSettings): Transporter {
    const port = Number(env('SMTP_PORT')) || 587;
    const user = env('SMTP_USER');
    const options = {
        host: env('SMTP_HOST'),
        port,
        secure: ['1', 'true', 'yes', 'on'].includes(env('SMTP_SECURE').toLowerCase()) || (env('SMTP_SECURE') === '' && port === 465),
        auth: user ? { user, pass: overrides?.SMTP_PASS ?? process.env.SMTP_PASS ?? '' } : undefined,
    };
    // Rebuilt when the settings change (the admin settings page can change them while running).
    const key = JSON.stringify(options);
    if (!transport || key !== transportKey) {
        transport = nodemailer.createTransport(options);
        transportKey = key;
    }
    return transport;
}

async function sendViaMailgun(message: MailMessage & { from: string }, env: Reader): Promise<string | undefined> {
    const base = (env('MAILGUN_API_URL') || 'https://api.mailgun.net').replace(/\/+$/, '');
    const body = new URLSearchParams({
        from: message.from,
        to: Array.isArray(message.to) ? message.to.join(',') : message.to,
        subject: message.subject,
    });
    if (message.text) body.set('text', message.text);
    if (message.html) body.set('html', message.html);
    if (message.replyTo) body.set('h:Reply-To', message.replyTo);

    const response = await fetch(`${base}/v3/${env('MAILGUN_DOMAIN')}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`api:${env('MAILGUN_API_KEY')}`).toString('base64')}` },
        body,
    });
    if (!response.ok) throw new Error(`Mailgun answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const result = (await response.json().catch(() => ({}))) as { id?: string };
    return result.id;
}

export async function sendMail(input: MailMessage, overrides?: MailSettings): Promise<MailResult> {
    const provider = mailProvider(overrides);
    if (provider === 'none') return { success: false, reason: 'email is not configured' };

    const message = { ...input, from: input.from || defaultFrom(overrides) };
    try {
        if (provider === 'smtp') {
            const info = await smtpTransport(reader(overrides), overrides).sendMail({
                from: message.from,
                to: message.to,
                subject: message.subject,
                text: message.text,
                html: message.html,
                replyTo: message.replyTo,
            });
            return { success: true, id: info.messageId };
        }
        return { success: true, id: await sendViaMailgun(message, reader(overrides)) };
    } catch (error) {
        return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

/** Check that the configured provider accepts our credentials, without sending anything. */
export async function verifyMail(overrides?: MailSettings): Promise<MailResult> {
    const provider = mailProvider(overrides);
    const env = reader(overrides);
    if (provider === 'none') return { success: false, reason: 'email is not configured' };
    try {
        if (provider === 'smtp') {
            await smtpTransport(env, overrides).verify();
            return { success: true };
        }
        const base = (env('MAILGUN_API_URL') || 'https://api.mailgun.net').replace(/\/+$/, '');
        const response = await fetch(`${base}/v3/domains/${env('MAILGUN_DOMAIN')}`, {
            headers: { Authorization: `Basic ${Buffer.from(`api:${env('MAILGUN_API_KEY')}`).toString('base64')}` },
        });
        return response.ok ? { success: true } : { success: false, reason: `Mailgun answered ${response.status}` };
    } catch (error) {
        return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
