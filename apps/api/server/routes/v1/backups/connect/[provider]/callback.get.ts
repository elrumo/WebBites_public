import { defineEventHandler, getQuery, getRouterParam, sendRedirect, createError } from 'h3';
import { initParseForBoards } from '#root/server/utils/boardUtils';
import { saveBackupDestination } from '#root/server/utils/backups';
import { takeOAuthState } from '#root/server/utils/importConnectors';
import { exchangeOAuthCode, isOAuthProvider, oauthProviderName } from '#root/server/utils/backupDestinations';
import { siteUrl } from '#root/server/utils/site';

defineRouteMeta({
  openAPI: {
    tags: ['Backups'],
    summary: 'Google Drive / Dropbox OAuth callback',
    description: 'The provider redirects here. The refresh token is stored encrypted and the browser goes back to `/app?backupConnect={provider}`.',
    responses: { 302: { description: 'Back to the web app' } },
  },
});

const WEBSITE = () => siteUrl();

export default defineEventHandler(async (event) => {
  const provider = String(getRouterParam(event, 'provider'));
  if (!isOAuthProvider(provider)) throw createError({ statusCode: 404, statusMessage: `Unknown provider "${provider}"` });

  const { code, state, error } = getQuery(event);
  const pending = state ? await takeOAuthState(String(state)) : null;
  if (!pending) throw createError({ statusCode: 400, statusMessage: 'That sign-in link has expired — start again from Settings › Backups.' });

  const back = `${WEBSITE()}/app?backupConnect=${provider}`;
  if (error || !code) return sendRedirect(event, `${back}&error=denied`);

  try {
    initParseForBoards();
    const { secret, folderId } = await exchangeOAuthCode(provider, String(code));
    await saveBackupDestination(pending.userId, provider, secret, oauthProviderName(provider), folderId);
  } catch (err: any) {
    console.error(`[backups] ${provider} connect failed for ${pending.userId}:`, err?.message || err);
    return sendRedirect(event, `${back}&error=failed`);
  }
  return sendRedirect(event, back);
});
