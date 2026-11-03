import Parse from 'parse/node'
import { ensureParseInitialized } from '../utils/parseRuntime'
import { verifySession } from '../utils/sessionCache'

const websiteColumnsToExclude = [
  'categories',
  'containsAdultContent',
  'done',
  'fromCache',
  'savedFrom',
  'siteBodyFile',
  'siteHtmlFile',
  'tokenUsage',
  'updatedAt',
  'user'
]

export default defineEventHandler(async (event) => {
  ensureParseInitialized()

  // The signed-in user's own pins. (This used to take any `userId` from the body and answer it
  // with the master key, i.e. anyone could read anyone's pinned bookmarks.)
  const sessionUser = await verifySession(getCookie(event, 'parse.session'))
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  try {
    const query = new Parse.Query('websites')
    query.equalTo('user', sessionUser)
    query.exclude(websiteColumnsToExclude)
    query.equalTo('pinned', true)
    // The pinned rail sits above the grid, so a hidden bookmark that happened
    // to be pinned would be the one place it stayed on screen.
    query.notContainedIn('hiddenFrom', ['library', 'everywhere'])
    query.limit(99999)
    return await query.find({ useMasterKey: true })
  } catch (error) {
    console.log('error getting pinned sites: ', error)
    throw error
  }
})
