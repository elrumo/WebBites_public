import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { SERVICE_TESTS } from '#root/server/utils/settings/connectionTests'
import { FIELDS } from '#root/server/utils/settings/registry'
import { captureEnvOrigin, sourceOf } from '#root/server/utils/settings/apply'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Test a group of settings without saving them (admins only)',
    description: 'Services: mail, ai, storage, search, screenshots. `values` holds the settings to try; a blank one falls back to what is in effect. For mail, `sendTo: "me"` also sends a test message to the admin.',
    responses: { 200: { description: '`{ ok, message }`' } },
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  captureEnvOrigin()

  const service = getRouterParam(event, 'service') || ''
  const test = SERVICE_TESTS[service]
  if (!test) throw createError({ statusCode: 404, statusMessage: 'Unknown service' })

  const body = (await readBody(event)) ?? {}
  const candidate: Record<string, string> = {}
  for (const f of FIELDS) {
    const given = body.values?.[f.key]
    // A value the environment sets cannot be overridden, so it is not either when testing.
    if (typeof given === 'string' && given.trim() !== '' && sourceOf(f.key) !== 'env') candidate[f.key] = given.trim()
  }

  return await test(candidate, body.sendTo === 'me' ? admin.email : undefined)
})
