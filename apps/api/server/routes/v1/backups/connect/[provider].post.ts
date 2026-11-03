import { defineEventHandler, getRouterParam, createError } from 'h3';
import { randomBytes } from 'crypto';
import { initParseForBoards, requireAuth } from '#root/server/utils/boardUtils';
import { backupsRefusal } from '#root/server/utils/backups';
import { rememberOAuthState } from '#root/server/utils/importConnectors';
import { assertOAuthConfigured, isOAuthProvider, oauthAuthorizeUrl } from '#root/server/utils/backupDestinations';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Connect Google Drive or Dropbox',
    description: 'Answers `{ authorizeUrl }`. After the user approves, the provider redirects to the callback, which stores the grant and sends the browser back to `/app?backupConnect={provider}` (with `&error=` if it failed).',
    parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['gdrive', 'dropbox'] } }],
    responses: { '200': { description: '`{ authorizeUrl }`' }, '403': { description: 'UsageError: needs Plus' }, '503': { description: 'Provider not configured' } },
  },
});

export default defineEventHandler(async (event) => {
  initParseForBoards();
  const auth = await requireAuth(event);
  const provider = String(getRouterParam(event, 'provider'));
  if (!isOAuthProvider(provider)) throw createError({ statusCode: 404, statusMessage: `Unknown provider "${provider}"` });
  assertOAuthConfigured(provider);

  const refusal = await backupsRefusal(event, auth.userId);
  if (refusal) return refusal;

  const state = randomBytes(16).toString('base64url');
  await rememberOAuthState(state, { userId: auth.userId, client: 'web' });
  return { success: true, authorizeUrl: oauthAuthorizeUrl(provider, state) };
});
