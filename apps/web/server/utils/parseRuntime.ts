import Parse from 'parse/node'

export function ensureParseInitialized() {
  const hasMasterKey = Boolean(Parse.masterKey)

  if (Parse.applicationId && hasMasterKey) {
    return Parse
  }

  const config = useRuntimeConfig()
  const appId = config.public.parseAppId as string | undefined
  const jsKey = config.public.parseJsKey as string | undefined
  const serverUrl = parseBaseUrl() || undefined
  const masterKey = config.parseMasterKey as string | undefined

  if (!appId || !jsKey || !serverUrl || !masterKey) {
    throw new Error('Missing Parse runtime config')
  }

  Parse.initialize(appId, jsKey, masterKey)
  Parse.serverURL = serverUrl

  return Parse
}
