import { defineEventHandler, readBody, createError } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { restartNeeded, validateChanges, fieldByKey } from '#root/server/utils/settings/registry'
import { sourceOf, captureEnvOrigin } from '#root/server/utils/settings/apply'
import { writeChanges } from '#root/server/utils/settings/store'
import { loadSettings } from '#root/server/utils/settings'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Change installation settings (admins only)',
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { values: { type: 'object', description: 'Setting name to new value. An empty value or null removes the stored setting.' } } } } } },
    responses: { 200: { description: '`{ changed, restart: { parse, api } }`' }, 400: { description: 'Some values are invalid' } },
  },
})

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  captureEnvOrigin()

  const body = await readBody(event)
  const changes = body?.values
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw createError({ statusCode: 400, statusMessage: '`values` must be an object' })
  }

  const checked = validateChanges(changes)
  if (!checked.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Some values are not valid', data: { errors: checked.errors } })
  }

  // The environment wins over anything stored, so a change to such a setting would do nothing.
  const locked = Object.keys(checked.values).filter(k => sourceOf(k) === 'env')
  if (locked.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Some settings are set by the environment and cannot be changed here',
      data: { locked },
    })
  }

  const hasSecret = Object.entries(checked.values).some(([k, v]) => v !== null && fieldByKey(k)?.kind === 'secret')
  if (hasSecret && !process.env.SETTINGS_ENCRYPTION_KEY) {
    throw createError({ statusCode: 409, statusMessage: 'SETTINGS_ENCRYPTION_KEY is not set, so secrets cannot be stored. Set it in .env and restart.' })
  }

  const changed = await writeChanges(checked.values, admin)
  await loadSettings()

  return { changed, restart: restartNeeded(changed) }
})
