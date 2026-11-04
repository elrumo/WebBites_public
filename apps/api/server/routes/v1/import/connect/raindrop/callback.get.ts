import { defineEventHandler, getQuery, sendRedirect, createError } from 'h3'
import { raindropExchangeCode, storeConnectorToken, takeOAuthState } from '#root/server/utils/importConnectors'
import { siteUrl } from '#root/server/utils/site';

defineRouteMeta({
  openAPI: {
    tags: ['Bookmark Import'],
    summary: 'Raindrop OAuth callback',
    description: 'Raindrop redirects here. The token is kept for an hour and the browser is sent back to the app that started the flow.',
    responses: { 302: { description: 'Back to the web app or `webbites://import/raindrop`' } },
  },
})

const WEBSITE = () => siteUrl()

export default defineEventHandler(async (event) => {
  const { code, state, error } = getQuery(event)
  const pending = state ? await takeOAuthState(String(state)) : null
  if (!pending) throw createError({ statusCode: 400, statusMessage: 'That sign-in link has expired — start again from Import.' })

  const back = pending.client === 'native' ? 'webbites://import/raindrop' : `${WEBSITE()}/app?importConnect=raindrop`
  if (error || !code) return sendRedirect(event, `${back}${back.includes('?') ? '&' : '?'}error=denied`)

  await storeConnectorToken('raindrop', pending.userId, await raindropExchangeCode(String(code)))
  return sendRedirect(event, back)
})
