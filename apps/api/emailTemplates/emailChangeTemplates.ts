/**
 * The two emails behind an email change.
 *
 *  1. `verifyEmailChangeEmail` goes to the NEW address and carries the link.
 *     Nothing about the account changes until it is clicked.
 *  2. `emailChangedNoticeEmail` goes to the OLD address once the change has
 *     happened, so an owner whose session was hijacked hears about it at the
 *     address they still control.
 *
 * Same dark card, green button and sign-off as the other emails, but
 * laid out with tables: Outlook and Gmail ignore the flexbox the older
 * templates lean on. Everything interpolated is escaped — `name` in particular
 * is whatever the user typed into Settings.
 */

import { emailBrand } from '#root/server/utils/emailBrand';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function greeting(name?: string | null): string {
  const trimmed = (name ?? '').trim();
  // Email sign-ups have their address as the username; "Hi elias@ibm.com" reads
  // like a form letter, so fall back to a plain "Hi".
  return trimmed && !trimmed.includes('@') ? `Hi ${trimmed},` : 'Hi,';
}

export function layout({ preheader, title, body, footer }: { preheader: string; title: string; body: string; footer?: string }): string {
  const brand = emailBrand();
  footer ??= `You're receiving this because of a change to a ${brand.appName} account.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0; padding:0; background-color:#222222; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#ffffff;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#222222;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background-color:#333333; border-radius:16px;">
          <tr>
            <td align="center" style="padding:28px 28px 8px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;"><img width="32" height="32" src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.appName)}" style="display:block; border:0;"></td>
                  <td style="vertical-align:middle; padding-left:8px; font-weight:800; font-size:16px; color:#ffffff;">${escapeHtml(brand.appName)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px 28px; font-size:16px; line-height:1.55; color:#ffffff;">
              ${body}
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding:20px 28px; font-size:13px; line-height:1.5; color:#888888;">
              ${escapeHtml(footer)}<br>
              &copy; ${new Date().getFullYear()} ${escapeHtml(brand.appName)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** A labelled pair of addresses, old above new, the way Settings shows them. */
function addressBox(rows: Array<{ label: string; value: string; highlight?: boolean }>): string {
  const cells = rows
    .map(
      ({ label, value, highlight }) => `
        <tr>
          <td style="padding:10px 16px; font-size:13px; color:#aaaaaa; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:10px 16px; font-size:15px; font-weight:${highlight ? '700' : '400'}; color:${highlight ? '#05D792' : '#ffffff'}; word-break:break-all;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#2a2a2a; border:1px solid #444444; border-radius:12px; margin:20px 0;">${cells}</table>`;
}

export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 20px auto;">
    <tr>
      <td align="center" style="background-color:#08c586; border-radius:8px;">
        <a href="${escapeHtml(href)}" style="display:inline-block; padding:12px 24px; font-size:16px; font-weight:800; color:#ffffff; text-decoration:none; border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export function signOff(): string {
  return `
  <p style="margin:24px 0 0 0;">Thank you,</p>
  <p style="margin:12px 0 0 0;">The ${escapeHtml(emailBrand().appName)} team</p>`;
}

/** The plain-text twin of signOff(). */
export function signOffText(): string {
  return `Thank you,\nThe ${emailBrand().appName} team`;
}

/** "write to hello@…" when the operator set a support address, otherwise just "reply to this email". */
function supportLine(html: boolean): string {
  const support = emailBrand().supportEmail;
  if (!support) return 'reply to this email';
  return html
    ? `reply to this email or write to <a href="mailto:${escapeHtml(support)}" style="color:#05D792; text-decoration:none;">${escapeHtml(support)}</a>`
    : `reply to this email or write to ${support}`;
}

export function verifyEmailChangeEmail(params: {
  name?: string | null;
  currentEmail: string;
  newEmail: string;
  link: string;
  expiresInHours: number;
}): RenderedEmail {
  const { name, currentEmail, newEmail, link, expiresInHours } = params;
  const subject = `Confirm your new ${emailBrand().appName} email address`;

  const body = `
    <h1 style="margin:8px 0 16px 0; font-size:24px; line-height:1.3; text-align:center; color:#ffffff;">Confirm your new email</h1>
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting(name))}</p>
    <p style="margin:0 0 12px 0;">Someone — hopefully you — asked to move a ${emailBrand().appName} account to this address. Confirm it's yours and we'll make the switch.</p>
    ${addressBox([
      { label: 'Current', value: currentEmail },
      { label: 'New', value: newEmail, highlight: true },
    ])}
    ${button(link, 'Confirm new email')}
    <p style="margin:0 0 12px 0; font-size:14px; color:#cccccc;">Until you do, nothing changes: you keep signing in with <b>${escapeHtml(currentEmail)}</b>. The link works once and expires in ${expiresInHours} hours.</p>
    <p style="margin:0 0 12px 0; font-size:13px; color:#aaaaaa;">Button not working? Paste this into your browser:<br><a href="${escapeHtml(link)}" style="color:#05D792; text-decoration:none; word-break:break-all;">${escapeHtml(link)}</a></p>
    <hr style="border:0; border-top:1px solid #444444; margin:20px 0;">
    <p style="margin:0; font-size:13px; color:#aaaaaa;">Didn't ask for this? Ignore this email and the account stays exactly as it is.</p>
    ${signOff()}`;

  const text = [
    greeting(name),
    '',
    `Someone — hopefully you — asked to move a ${emailBrand().appName} account to this address.`,
    '',
    `Current email: ${currentEmail}`,
    `New email:     ${newEmail}`,
    '',
    'Confirm the change by opening this link:',
    link,
    '',
    `Until you do, nothing changes: you keep signing in with ${currentEmail}. The link works once and expires in ${expiresInHours} hours.`,
    '',
    "Didn't ask for this? Ignore this email and the account stays exactly as it is.",
    '',
    signOffText(),
  ].join('\n');

  return {
    subject,
    html: layout({ preheader: `Confirm ${newEmail} as your ${emailBrand().appName} email.`, title: subject, body }),
    text,
  };
}

export function emailChangedNoticeEmail(params: {
  name?: string | null;
  oldEmail: string;
  newEmail: string;
  changedAt: Date;
}): RenderedEmail {
  const { name, oldEmail, newEmail, changedAt } = params;
  const subject = `Your ${emailBrand().appName} email address was changed`;
  const when = changedAt.toUTCString();

  const body = `
    <h1 style="margin:8px 0 16px 0; font-size:24px; line-height:1.3; text-align:center; color:#ffffff;">Your email was changed</h1>
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting(name))}</p>
    <p style="margin:0 0 12px 0;">The email address on your ${emailBrand().appName} account was just changed. From now on, sign in and receive account emails at the new address.</p>
    ${addressBox([
      { label: 'Old', value: oldEmail },
      { label: 'New', value: newEmail, highlight: true },
      { label: 'When', value: when },
    ])}
    <p style="margin:0 0 12px 0;">If this was you, there's nothing else to do.</p>
    <p style="margin:0 0 12px 0;"><b>If it wasn't you</b>, ${supportLine(true)} straight away and we'll help you get your account back.</p>
    ${signOff()}`;

  const text = [
    greeting(name),
    '',
    `The email address on your ${emailBrand().appName} account was just changed.`,
    '',
    `Old email: ${oldEmail}`,
    `New email: ${newEmail}`,
    `When:      ${when}`,
    '',
    "If this was you, there's nothing else to do.",
    `If it wasn't you, ${supportLine(false)} straight away and we'll help you get your account back.`,
    '',
    signOffText(),
  ].join('\n');

  return {
    subject,
    html: layout({ preheader: `Your ${emailBrand().appName} email is now ${newEmail}.`, title: subject, body }),
    text,
  };
}
