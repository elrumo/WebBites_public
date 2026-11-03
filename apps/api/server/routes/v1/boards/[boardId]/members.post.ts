import { defineEventHandler, readBody, getRouterParam, createError } from 'h3';
import { initParseForBoards, requireAuth, getOwnedBoardOrThrow, getSharingState } from '#root/server/utils/boardUtils';
import { INVITE_TTL_MS, MAX_MEMBERS_PER_BOARD, parseInvites } from '#root/server/utils/boardAccessRules';
import { displayName, inviteMember, listMembers, recentInviteEmails } from '#root/server/utils/boardSharing';
import { notifyBoardAudience } from '#root/server/utils/boardNotifications';
import { sendEmail } from '#root/server/utils/serverUtils.js';
import { boardInviteEmail } from '#root/emailTemplates/boardInviteTemplate';
import { siteUrl } from '#root/server/utils/site';

/** Invitation emails one person may send in a day: each goes to an address they typed. */
const MAX_INVITE_EMAILS_PER_DAY = 30;

const websiteUrl = () => siteUrl();

defineRouteMeta({
  openAPI: {
    tags: ['Board Sharing'],
    summary: 'Invite people to a board',
    description: 'Owner only. Shares the board with each email as `viewer` or `editor`. An address with an account gets access at once and a notification; any other gets an emailed single-use link (valid 30 days) and shows as `pending` until they open it. Inviting an address again changes its role.',
    parameters: [{ name: 'boardId', in: 'path', required: true, schema: { type: 'string' } }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['invites'],
            properties: {
              invites: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string' }, role: { type: 'string', enum: ['viewer', 'editor'], default: 'viewer' } },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      '200': { description: 'The updated members, and any addresses the email could not be sent to' },
      '400': { description: 'Invalid emails or too many people' },
      '429': { description: 'Too many invitation emails today' },
    },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const boardId = getRouterParam(event, 'boardId')!;
  const body = await readBody(event);

  let invites;
  try {
    invites = parseInvites(body?.invites, auth.email);
  } catch (error: any) {
    throw createError({ statusCode: 400, statusMessage: error.message });
  }

  const board = await getOwnedBoardOrThrow(auth.user, boardId);

  const current = await listMembers(board.id);
  const known = new Set(current.map((row) => row.get('email')));
  const added = invites.filter((invite) => !known.has(invite.email)).length;
  if (current.length + added > MAX_MEMBERS_PER_BOARD) {
    throw createError({ statusCode: 400, statusMessage: `A board can be shared with at most ${MAX_MEMBERS_PER_BOARD} people` });
  }
  if ((await recentInviteEmails(auth.userId)) + invites.length > MAX_INVITE_EMAILS_PER_DAY) {
    throw createError({ statusCode: 429, statusMessage: 'You have sent a lot of invitations today. Try again tomorrow.' });
  }

  const inviterName = displayName(auth.user);
  const notEmailed: string[] = [];
  // Invite links for people who could not be emailed (no mail server set up, or it refused).
  // The link works for whoever holds it, so the person who made the invite hands it over themselves.
  const inviteLinks: Array<{ email: string; link: string }> = [];

  for (const invite of invites) {
    const { token, user, isNew, changed } = await inviteMember(board, auth.user, invite);

    if (user && changed) {
      await notifyBoardAudience(board, auth.userId, isNew ? 'board_shared' : 'role_changed', { recipients: [user.id] });
    }
    if (token) {
      const link = `${websiteUrl()}/invite/${token}`;
      const mail = boardInviteEmail({
        inviterName,
        boardName: String(board.get('name') ?? ''),
        role: invite.role,
        link,
        expiresInDays: Math.round(INVITE_TTL_MS / 86_400_000),
      });
      const sent = await sendEmail({ userEmail: invite.email, emailHtml: mail.html, subject: mail.subject, text: mail.text, name: '' })
        .catch((error: unknown) => { console.error('[boardInvite] email failed:', error); return null; });
      if (!sent?.success) {
        notEmailed.push(invite.email);
        inviteLinks.push({ email: invite.email, link });
      }
    }
  }

  return { success: true, notEmailed, inviteLinks, ...(await getSharingState(board, 'owner')) };
});
