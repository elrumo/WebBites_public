/**
 * The email that carries a board invite to an address without an account. Same card as the email-change emails (their layout helpers are
 * reused); everything interpolated is escaped — `inviterName` and `boardName`
 * are whatever people typed.
 */

import { emailBrand } from '#root/server/utils/emailBrand';
import { signOff, signOffText, button, escapeHtml, layout, type RenderedEmail } from './emailChangeTemplates';

export function boardInviteEmail(params: {
  inviterName: string;
  boardName: string;
  role: 'viewer' | 'editor';
  link: string;
  expiresInDays: number;
}): RenderedEmail {
  const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 100);
  const inviterName = oneLine(params.inviterName) || 'Someone';
  const boardName = oneLine(params.boardName) || 'a board';
  const { role, link, expiresInDays } = params;
  const can = role === 'editor' ? 'view and add to' : 'view';
  const { appName } = emailBrand();
  const subject = `${inviterName} shared “${boardName}” with you on ${appName}`;

  const body = `
    <h1 style="margin:8px 0 16px 0; font-size:24px; line-height:1.3; text-align:center; color:#ffffff;">${escapeHtml(inviterName)} shared a board with you</h1>
    <p style="margin:0 0 12px 0;">You can ${can} <b>${escapeHtml(boardName)}</b> on ${escapeHtml(appName)}. Open the link, then sign in or create an account to see it.</p>
    ${button(link, 'Open the board')}
    <p style="margin:0 0 12px 0; font-size:14px; color:#cccccc;">The link is for you and works once. It expires in ${expiresInDays} days.</p>
    <p style="margin:0 0 12px 0; font-size:13px; color:#aaaaaa;">Button not working? Paste this into your browser:<br><a href="${escapeHtml(link)}" style="color:#05D792; text-decoration:none; word-break:break-all;">${escapeHtml(link)}</a></p>
    <hr style="border:0; border-top:1px solid #444444; margin:20px 0;">
    <p style="margin:0; font-size:13px; color:#aaaaaa;">Don't know ${escapeHtml(inviterName)}? Ignore this email and nothing happens.</p>
    ${signOff()}`;

  const text = [
    `${inviterName} shared “${boardName}” with you on ${appName}.`,
    '',
    `You can ${can} the board. Open this link, then sign in or create an account:`,
    link,
    '',
    `The link is for you and works once. It expires in ${expiresInDays} days.`,
    `Don't know ${inviterName}? Ignore this email and nothing happens.`,
    '',
    signOffText(),
  ].join('\n');

  return {
    subject,
    html: layout({
      preheader: `${inviterName} invited you to “${boardName}”.`,
      title: subject,
      body,
      footer: `You're receiving this because someone shared a ${appName} board with this address.`,
    }),
    text,
  };
}
