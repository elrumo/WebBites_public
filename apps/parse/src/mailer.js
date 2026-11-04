'use strict';
/**
 * The one place Parse sends email from: its own password-reset mail and the
 * cloud-code emails. Same environment contract as the API's mailer
 * (apps/api/server/utils/mailer.ts).
 *
 *   MAIL_PROVIDER   smtp | mailgun | none   (default: smtp if SMTP_HOST is set,
 *                                            mailgun if MAILGUN_API_KEY+DOMAIN, else none)
 *   MAIL_FROM       "Name <address>"        (default: "<APP_NAME> <noreply@<site host>>")
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE
 *   MAILGUN_API_KEY / MAILGUN_DOMAIN / MAILGUN_API_URL (default https://api.mailgun.net)
 */
const nodemailer = require('nodemailer');
const env = require('./env');

function provider() {
  const explicit = env.str('MAIL_PROVIDER').toLowerCase();
  if (explicit) return explicit;
  if (env.str('SMTP_HOST')) return 'smtp';
  if (env.str('MAILGUN_API_KEY') && env.str('MAILGUN_DOMAIN')) return 'mailgun';
  return 'none';
}

function isEnabled() {
  return provider() !== 'none';
}

function appName() {
  return env.str('APP_NAME', 'WebBites');
}

function siteUrl() {
  return env.trimSlash(env.str('SITE_URL', env.str('APP_URL', '')));
}

function defaultFrom() {
  const configured = env.str('MAIL_FROM');
  if (configured) return configured;
  let host = 'localhost';
  try { host = new URL(siteUrl()).hostname; } catch { /* keep localhost */ }
  return `${appName()} <noreply@${host}>`;
}

let transport = null;
function smtpTransport() {
  if (!transport) {
    const port = env.int('SMTP_PORT', 587);
    const user = env.str('SMTP_USER');
    transport = nodemailer.createTransport({
      host: env.required('SMTP_HOST'),
      port,
      secure: env.bool('SMTP_SECURE', port === 465),
      auth: user ? { user, pass: env.str('SMTP_PASS') } : undefined,
    });
  }
  return transport;
}

async function sendViaMailgun({ from, to, subject, text, html, replyTo }) {
  const domain = env.required('MAILGUN_DOMAIN');
  const base = env.trimSlash(env.str('MAILGUN_API_URL', 'https://api.mailgun.net'));
  const body = new URLSearchParams({ from, to, subject });
  if (text) body.set('text', text);
  if (html) body.set('html', html);
  if (replyTo) body.set('h:Reply-To', replyTo);
  const response = await fetch(`${base}/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${env.required('MAILGUN_API_KEY')}`).toString('base64')}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`Mailgun answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const result = await response.json().catch(() => ({}));
  return result.id;
}

/**
 * Send one message. Never throws: returns `{ success, reason?, id? }` so callers
 * decide whether a failure matters (a feedback notification) or not.
 */
async function sendMail({ from, to, subject, text, html, replyTo }) {
  const chosen = provider();
  if (chosen === 'none') return { success: false, reason: 'email is not configured' };
  const message = { from: from || defaultFrom(), to, subject, text, html, replyTo };
  try {
    if (chosen === 'smtp') {
      const info = await smtpTransport().sendMail(message);
      return { success: true, id: info.messageId };
    }
    if (chosen === 'mailgun') {
      return { success: true, id: await sendViaMailgun(message) };
    }
    return { success: false, reason: `unknown MAIL_PROVIDER "${chosen}"` };
  } catch (error) {
    return { success: false, reason: error && error.message ? error.message : String(error) };
  }
}

/** Mail-adapter callback for parse-server-api-mail-adapter: throws so Parse logs the failure. */
async function apiCallback({ payload }) {
  const result = await sendMail(payload);
  if (!result.success) throw new Error(`Could not send email: ${result.reason}`);
  return result;
}

module.exports = { provider, isEnabled, appName, siteUrl, defaultFrom, sendMail, apiCallback };
