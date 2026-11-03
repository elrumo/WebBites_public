/**
 * End-to-end check of the MCP server and its OAuth sign-in against a running
 * backend. Does what a connector does — registers a client, signs in with
 * PKCE, approves on the user's behalf, swaps the code for tokens — then calls
 * every tool, in both protocol eras, and checks a read-only connection, token
 * refresh and revocation. It creates a note and a board in the account and
 * trashes the note again; point it at a test account.
 *
 *   MCP_SMOKE_URL=http://localhost:3003 WEBBITES_API_KEY=wb_live_… bun run scripts/mcp-smoke.ts
 *
 * MCP_SMOKE_URL is the backend (default http://localhost:3003). Its
 * MCP_ISSUER must be the same origin, or the token audience won't match.
 * WEBBITES_API_KEY is the test user's own key: it stands in for their browser
 * session on the consent step.
 */

import { createHash, randomBytes } from 'node:crypto'

const BASE = (process.env.MCP_SMOKE_URL || 'http://localhost:3003').replace(/\/+$/, '')
const USER_KEY = process.env.WEBBITES_API_KEY
if (!USER_KEY) {
  console.error('Set WEBBITES_API_KEY to a test user\'s wb_live_ key.')
  process.exit(2)
}

const MODERN = '2026-07-28'
const REDIRECT = 'http://127.0.0.1:53682/callback'
let failures = 0
const ok = (name: string, condition: unknown, detail?: unknown) => {
  if (condition) console.log(`  ✓ ${name}`)
  else { failures++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}

async function json(response: Response) {
  const text = await response.text()
  try { return JSON.parse(text) } catch { return text }
}

async function signIn(allowWrite: boolean, clientId: string) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(8).toString('hex')
  const authorize = new URL(`${BASE}/oauth/authorize`)
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: 'S256', state, scope: 'bookmarks:read bookmarks:write', resource: `${BASE}/mcp`,
  }).toString()
  const start = await fetch(authorize, { redirect: 'manual' })
  const consent = new URL(start.headers.get('location') || 'about:blank')
  const requestId = consent.searchParams.get('request')
  ok(`authorize redirects to the consent page (${allowWrite ? 'read+write' : 'read-only'})`, start.status === 302 && requestId, consent.toString())

  const userHeaders = { Authorization: `Bearer ${USER_KEY}`, 'Content-Type': 'application/json' }
  const pending = await json(await fetch(`${BASE}/v1/oauth/requests/${requestId}`, { headers: userHeaders }))
  ok('consent API describes the request', pending?.request?.client?.name && pending?.request?.csrf, pending)

  const confirm = await json(await fetch(`${BASE}/v1/oauth/authorize/confirm`, {
    method: 'POST', headers: userHeaders,
    body: JSON.stringify({ request: requestId, csrf: pending.request.csrf, approve: true, allowWrite }),
  }))
  const back = new URL(confirm.redirectTo)
  ok('approval returns to the client with code, state and iss', back.searchParams.get('code') && back.searchParams.get('state') === state
    && back.searchParams.get('iss') === BASE, confirm)

  const replay = await fetch(`${BASE}/v1/oauth/authorize/confirm`, {
    method: 'POST', headers: userHeaders, body: JSON.stringify({ request: requestId, csrf: pending.request.csrf, approve: true }),
  })
  ok('a request can only be answered once', replay.status === 410, replay.status)

  const token = await json(await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier,
      redirect_uri: REDIRECT, client_id: clientId, resource: `${BASE}/mcp`,
    }),
  }))
  ok('code exchanges for tokens', token.access_token?.startsWith('wbo_at_') && token.refresh_token?.startsWith('wbo_rt_'), token)
  ok('scope reflects the approval', token.scope === (allowWrite ? 'bookmarks:read bookmarks:write' : 'bookmarks:read'), token.scope)
  return token as { access_token: string; refresh_token: string }
}

function mcp(accessToken: string) {
  let id = 0
  return async (method: string, params: Record<string, unknown> = {}, name?: string) => {
    const response = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': method,
        ...(name ? { 'Mcp-Name': name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: ++id, method,
        params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientInfo': { name: 'mcp-smoke', version: '1' } } },
      }),
    })
    return { status: response.status, headers: response.headers, body: await json(response) }
  }
}

async function main() {
  console.log(`MCP smoke test against ${BASE}\n`)

  console.log('Discovery')
  const unauth = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const challenge = unauth.headers.get('www-authenticate') || ''
  ok('401 without a token, with resource_metadata', unauth.status === 401 && challenge.includes('resource_metadata='), challenge)
  const prm = await json(await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`))
  ok('protected resource metadata', prm.resource === `${BASE}/mcp`, prm)
  const as = await json(await fetch(`${BASE}/.well-known/oauth-authorization-server`))
  ok('authorization server metadata', as.issuer === BASE && as.code_challenge_methods_supported?.includes('S256'), as)

  console.log('\nRegistration')
  const registration = await json(await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'MCP smoke test', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  }))
  ok('dynamic client registration', registration.client_id?.startsWith('wbo_client_'), registration)
  const clientId: string = registration.client_id

  console.log('\nSign-in (read + write)')
  const tokens = await signIn(true, clientId)
  const call = mcp(tokens.access_token)

  console.log('\nModern protocol')
  const discover = await call('server/discover')
  ok('server/discover', discover.body?.result?.supportedVersions?.includes(MODERN), discover.body)
  const list = await call('tools/list')
  ok('all eleven tools listed', list.body?.result?.tools?.length === 11, list.body?.result?.tools?.map((t: any) => t.name))
  const tool = (name: string, args: Record<string, unknown>) => call('tools/call', { name, arguments: args }, name)

  const note = await tool('save_note', { text: 'MCP smoke test note\n\nSafe to delete.', title: 'Smoke test', tags: ['mcp-smoke'] })
  const noteId = note.body?.result?.structuredContent?.bookmark?.id
  ok('save_note', note.body?.result?.isError === false && noteId, note.body)
  const got = await tool('get_bookmark', { id: noteId, include_content: true })
  ok('get_bookmark', got.body?.result?.structuredContent?.bookmark?.title === 'Smoke test', got.body)
  const updated = await tool('update_bookmark', { id: noteId, add_tags: ['mcp-smoke-2'], pinned: true })
  ok('update_bookmark', updated.body?.result?.structuredContent?.bookmark?.tags?.includes('mcp-smoke-2'), updated.body)
  const board = await tool('create_board', { name: `MCP smoke ${Date.now()}` })
  const boardId = board.body?.result?.structuredContent?.board?.id
  ok('create_board', boardId, board.body)
  const added = await tool('add_to_board', { board_id: boardId, bookmark_ids: [noteId, 'not-a-real-id'] })
  ok('add_to_board (one added, one not found)', added.body?.result?.structuredContent?.added === 1
    && added.body?.result?.structuredContent?.not_found?.[0] === 'not-a-real-id', added.body)
  const boards = await tool('list_boards', {})
  ok('list_boards', boards.body?.result?.structuredContent?.boards?.some((b: any) => b.id === boardId), boards.body)
  const inBoard = await tool('list_board_bookmarks', { board_id: boardId })
  ok('list_board_bookmarks', inBoard.body?.result?.structuredContent?.bookmarks?.some((b: any) => b.id === noteId), inBoard.body)
  const search = await tool('search_bookmarks', { limit: 5 })
  ok('search_bookmarks answers', search.body?.result?.isError === false && Array.isArray(search.body?.result?.structuredContent?.bookmarks), search.body)
  const tags = await tool('list_tags', { limit: 10 })
  ok('list_tags answers', tags.body?.result?.isError === false, tags.body)
  const invalid = await tool('get_bookmark', { id: noteId, bogus: true })
  ok('bad arguments are a tool error', invalid.body?.result?.isError === true, invalid.body)
  const missing = await tool('get_bookmark', { id: 'nope' })
  ok('unknown id is a tool error', missing.body?.result?.isError === true, missing.body)
  const trashed = await tool('delete_bookmark', { id: noteId })
  ok('delete_bookmark moves it to the trash', trashed.body?.result?.structuredContent?.status === 'trashed', trashed.body)
  const gone = await tool('get_bookmark', { id: noteId })
  ok('a trashed bookmark is invisible', gone.body?.result?.isError === true, gone.body)
  const mismatch = await call('tools/call', { name: 'list_tags', arguments: {} }, 'list_boards')
  ok('Mcp-Name mismatch is -32020', mismatch.status === 400 && mismatch.body?.error?.code === -32020, mismatch.body)

  console.log('\nLegacy protocol')
  const legacy = async (body: unknown, version?: string) => json(await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', ...(version ? { 'MCP-Protocol-Version': version } : {}) },
    body: JSON.stringify(body),
  }))
  const init = await legacy({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })
  ok('initialize', init.result?.protocolVersion === '2025-06-18', init)
  const legacyList = await legacy({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, '2025-06-18')
  ok('legacy tools/list', legacyList.result?.tools?.length === 11, legacyList)

  console.log('\nRead-only connection')
  const readOnly = await signIn(false, clientId)
  const readCall = mcp(readOnly.access_token)
  const readList = await readCall('tools/list')
  ok('only the five read tools', readList.body?.result?.tools?.length === 5, readList.body?.result?.tools?.map((t: any) => t.name))
  const denied = await readCall('tools/call', { name: 'save_note', arguments: { text: 'x' } }, 'save_note')
  ok('a write tool is 403 insufficient_scope', denied.status === 403 && (denied.headers.get('www-authenticate') || '').includes('insufficient_scope'), denied.status)

  console.log('\nRefresh and revoke')
  const refreshed = await json(await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }),
  }))
  ok('refresh rotates the pair', refreshed.access_token && refreshed.refresh_token !== tokens.refresh_token, refreshed)
  const afterRefresh = await mcp(refreshed.access_token)('tools/list')
  ok('the new access token works', afterRefresh.status === 200, afterRefresh.status)
  await fetch(`${BASE}/oauth/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshed.refresh_token, client_id: clientId }),
  })
  const revoked = await mcp(refreshed.access_token)('tools/list')
  ok('revoking ends the connection at once', revoked.status === 401, revoked.status)

  const grants = await json(await fetch(`${BASE}/v1/oauth/grants`, { headers: { Authorization: `Bearer ${USER_KEY}` } }))
  const readGrant = grants.grants?.find((g: any) => g.scopes.length === 1)
  ok('the read-only connection is listed', readGrant, grants)
  if (readGrant) {
    const removed = await fetch(`${BASE}/v1/oauth/grants/${readGrant.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${USER_KEY}` } })
    ok('disconnecting from Settings works', removed.status === 200, removed.status)
    const after = await readCall('tools/list')
    ok('…and its token stops working', after.status === 401, after.status)
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
