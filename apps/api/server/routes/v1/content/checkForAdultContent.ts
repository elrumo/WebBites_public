import Parse from 'parse/node.js'
import { defineEventHandler, readBody } from 'h3'
import { htmlSourceManager } from '#root/server/utils/htmlSourceManager.js'
import { removeHtmlTags, numTokensFromString, askGpt, getSiteById } from '#root/server/utils/serverUtils.js'
import { log } from '#root/server/utils/bookmarkLogger'

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

interface RawRequestBody {
  websiteData?: RequestBody
  savedSiteId?: string
  fromCache?: boolean
}

interface RequestBody {
  savedSiteId: string
  fromCache?: boolean
}

export default defineEventHandler(async (event): Promise<void> => {
  const startTime = performance.now();
  const requestId = `${Date.now()}.${Math.random()}`;

  try {
    const rawBody: RawRequestBody = await readBody(event)
    const body: RequestBody = rawBody.websiteData || (rawBody as RequestBody)
    const { savedSiteId } = body
    const fromCache = body.fromCache === undefined ? true : body.fromCache

    const savedSite = await getSiteById(savedSiteId, 'checkForAdultContent')
    if (savedSite) {
      await checkForAdultContent(savedSite as Parse.Object, fromCache)
    }

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    // log(`[${duration}s] checkForAdultContent______________${requestId}`);
  } catch (error) {
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    log(`[${duration}s] checkForAdultContent______________${requestId} - ERROR: ${error}`)
  }
})

async function checkForAdultContent(savedSite: Parse.Object, fromCache = true): Promise<void | null> {
  const startTime = performance.now()

  try {
    const currentAdult = savedSite.get('containsAdultContent')
    if (currentAdult != null && fromCache) return

    log('[checkForAdultContent] Using shared HTML source for:', savedSite.id)

    let siteBody: string | { error: string } = await htmlSourceManager.getSharedHtmlContent(savedSite.id, {
      removeHtml: true,
      maxLength: 800,
      funcName: 'checkForAdultContent'
    })

    if (typeof siteBody === 'object' && siteBody.error) {
      console.warn('[checkForAdultContent] Shared HTML fetch failed:', savedSite.id, siteBody.error)
      return
    }

    const type = savedSite.get('type')

    if (siteBody && type !== 'textNote' && type !== 'image') {
      const cleaned = removeHtmlTags(siteBody as string, 500)
      let prompt = `You will receive the content of a website and you will need to check if it contains adult content and return a JSON AS PLAIN ENGLISH TEXT with a boolean {adultContent: ... }. And remember to ALWAYS return in a JSON format with no extra text at all. Site content: ${cleaned}`

      const numTokens = await numTokensFromString({ prompt, removeExtraTokens: true })
      prompt = numTokens.newPrompt

      let result: any = await askGpt(prompt, { name: 'checkForAdultContent', showUsage: false, userId: savedSite.get('user').id, savedSite })

      if (result.error) {
        console.log(`[checkForAdultContent] error getting summary from GPT for checkForAdultContent with id ${savedSite.id} `, result.error)
        return
      }

      const timeTaken = Math.floor((performance.now() - startTime) / 1000)
      if (result.usage && result.usage.queries && result.usage.queries[0]) {
        result.usage.queries[0].timeTaken = timeTaken
      }

      const userId = savedSite.get('user').id

      result = result.result?.adultContent ? result.result.adultContent : false

      try {
        savedSite.set('containsAdultContent', result)
        await savedSite.save(null, { useMasterKey: true })
      } catch (error) {
        console.log(`[checkForAdultContent] error saving adult content ${savedSite.get('url')} with id ${savedSite.id} `, error)
        return null
      }
    }

    return
  } catch (error) {
    console.log(`[checkForAdultContent] error checking for adult content for site: ${savedSite.get('url')} with id ${savedSite.id} `, error)
    return null
  }
}