import { defineEventHandler } from 'h3'
import { requireAdmin } from '#root/server/utils/requireAdmin'
import { FIELDS, GROUPS } from '#root/server/utils/settings/registry'
import { readStoredRows } from '#root/server/utils/settings/store'
import { captureEnvOrigin, sourceOf } from '#root/server/utils/settings/apply'
import { settingsLastReport } from '#root/server/utils/settings'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Installation settings (admins only)',
    description: 'The settings that can be changed on the admin page, where each one comes from, and its value. Secrets are never returned, only whether one is set.',
    responses: { 200: { description: '`{ groups, fields, encryptionConfigured }`' } },
  },
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  captureEnvOrigin()

  const stored = new Map((await readStoredRows()).map(r => [r.key, r]))
  const { report, error } = settingsLastReport()

  return {
    groups: GROUPS,
    encryptionConfigured: Boolean(process.env.SETTINGS_ENCRYPTION_KEY),
    loadError: error,
    problems: report?.failed ?? [],
    fields: FIELDS.map((f) => {
      const source = sourceOf(f.key)
      const isSecret = f.kind === 'secret'
      const current = process.env[f.key] ?? ''
      return {
        ...f,
        source,
        // Secrets are write-only. Everything else is shown, including values set by the environment.
        value: isSecret ? '' : current,
        isSet: current !== '',
        stored: stored.has(f.key),
        locked: source === 'env',
      }
    }),
  }
})
