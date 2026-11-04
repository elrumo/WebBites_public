import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'

export default defineNitroPlugin((nitroApp) => {
  try {
    ensureParseInitialized()
    console.log('Parse initialized from runtime config')
  } catch (error) {
    console.warn('Missing Parse runtime config. Parse initialization skipped.')
    console.warn(error instanceof Error ? error.message : error)
  }
})
