import Parse from 'parse/node.js'
import { defineEventHandler, readBody } from 'h3'
import { htmlSourceManager } from '../../../utils/htmlSourceManager.js'
import { getSiteById, askGpt, numTokensFromString } from '../../../utils/serverUtils.js'
import { getAiLanguage } from '../../../utils/aiLanguage.js'
import { askJev, withImageFallback } from '../../../utils/aiClients'
import { jevOn, tagRequest, pickTags, mergeTags, JEV_TAG_POOL } from '../../../utils/jevJudgments'
import { imageUrlsFor, prepareImages } from '../../../utils/jevImages'
import { userTagCounts } from '../../../utils/userTags'

// How many picks make the text model unnecessary.
const JEV_TAGS_ENOUGH = 3

Parse.initialize(
  process.env.VITE_PARSE_ID as string,
  process.env.VITE_PARSE_JS_KEY as string,
  process.env.VITE_PARSE_MASTER_KEY as string
)
Parse.serverURL = process.env.VITE_PARSE_URL as string

interface RequestBody {
  savedSiteId: string
}

defineRouteMeta({
  openAPI: {
    tags: ["Content"],
    summary: "Categorise a saved site into tags",
    description: "Generates up to 10 descriptive tags for a website using its title, description, and shared HTML content, then saves them to the site record.",
    requestBody: {
      description: "Target website to categorise",
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              savedSiteId: {
                type: "string",
                description: "ID of the saved site to categorise",
                example: "abc123xyz"
              }
            },
            required: ["savedSiteId"]
          }
        }
      }
    },
    responses: {
      "200": {
        description: "Tags generated and saved successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: { type: "boolean", example: true },
                tags: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      },
      "500": {
        description: "Error during categorisation",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", description: "Error message" }
              }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event): Promise<void> => {
  const startTime = performance.now();
  const requestId = `${Date.now()}.${Math.random()}`;

  try {
    const body: RequestBody = await readBody(event)
    const { savedSiteId } = body

    const savedSite = await getSiteById(savedSiteId, 'categoriseSite')
    if (savedSite) {
      await categoriseSite(savedSite as Parse.Object, savedSiteId)
    }

    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    // log(`[${duration}s] categoriseSite______________${requestId}`);
  } catch (error) {
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);
    log(`[${duration}s] categoriseSite______________${requestId} - ERROR: ${error}`)
  }
})

async function categoriseSite(savedSite: Parse.Object, siteId: string): Promise<void | { error: string } | []> {
  const startTime = performance.now()

  try {
    await savedSite.fetch({ useMasterKey: true })

    const title: string = savedSite.get('siteTitle') ? savedSite.get('siteTitle') : savedSite.get('url')
    const description: string = savedSite.get('siteDescription')

    log(`[categoriseSite] Using shared HTML source for: ${siteId}`)

    // getPageContent runs before this stage; its plain-text siteBody is a
    // better prompt input than raw HTML and costs no fetch. When it found only
    // a wall, the raw HTML is that wall too: title and description it is.
    const walled = Boolean(savedSite.get('contentWalled'))
    const storedBody: string | undefined = walled ? undefined : savedSite.get('siteBody')

    const existingTags: string[] = Array.isArray(savedSite.get('tags')) ? savedSite.get('tags') : []
    const userId: string | undefined = savedSite.get('user')?.id

    // Pick from the tags the user already has before inventing new ones, so
    // "AI" doesn't sit next to "Artificial Intelligence" and "Ai Tools".
    let userTags: string[] = []
    let picked: string[] = []
    if (jevOn('JEV_TAGS') && userId) {
      try {
        userTags = (await userTagCounts(userId))
          .sort((a, b) => b.count - a.count)
          .slice(0, JEV_TAG_POOL)
          .map((tag) => tag.name)
        if (userTags.length) {
          const page = { title, description, url: savedSite.get('url'), text: storedBody }
          const images = await prepareImages(imageUrlsFor(savedSite))
          const response = await withImageFallback(images, (img) => askJev(tagRequest(page, userTags, img), 'categoriseSite'))
          picked = pickTags(response, userTags)
        }
      } catch (error: any) {
        console.error('[categoriseSite] Jev tag pick failed, using the text model only:', error?.message)
      }
    }

    // Enough fitting tags of their own: no text model, no HTML fetch.
    if (picked.length >= JEV_TAGS_ENOUGH) {
      savedSite.set('tags', mergeTags(existingTags, picked, userTags))
      await savedSite.save(null, { useMasterKey: true })
      return
    }

    let siteHtml: string | { error: string } = walled
      ? ''
      : storedBody && storedBody.length >= 300
      ? storedBody.substring(0, 6000)
      : await htmlSourceManager.getSharedHtmlContent(siteId, {
          removeHtml: true,
          maxLength: 6000,
          funcName: 'categoriseSite'
        })

    if (typeof siteHtml === 'object' && siteHtml.error) {
      console.warn('[categoriseSite] Shared HTML fetch failed:', siteId, siteHtml.error)
      return { error: siteHtml.error }
    }

    const siteHtmlStr = (siteHtml as string) || title
    let content: string

    if (siteHtmlStr && siteHtmlStr.length >= 300) {
      content = ` title: ${title}.
                        description: ${description}.
                        siteContent: ${siteHtmlStr}.
                        url: ${savedSite.get('url')}
                    `
    } else {
      content = ` title: ${title}
                        description: ${description}
                    `
    }

    const language = await getAiLanguage(userId, savedSite.get('language'))

    let prompt = `
            Given the title and description of a website, return 10 tags at most that best describe what the website is about into an array, capitalise the first letter of each word. The tags MUST be written in ${language}. Return the output as json with an array: tags: {[Tag1', 'Tag2'...]}. 
            siteContent: ${content}
            `

    const numTokens = await numTokensFromString({ prompt, removeExtraTokens: true })
    prompt = numTokens.newPrompt

    let result: any = await askGpt(prompt, {
      name: 'categoriseSite',
      showUsage: false,
      userId,
      savedSite
    })

    if (result.error) {
      console.log(`error getting summary from GPT for categoriseSite with id ${savedSite.id} `, result.error)
      if (!picked.length) return
    }

    const timeTaken = Math.floor((performance.now() - startTime) / 1000)
    if (result.usage && result.usage.queries && result.usage.queries[0]) {
      result.usage.queries[0].timeTaken = timeTaken
    }

    // Union, not replace: tags the user (or the public API) supplied must survive.
    const generated: string[] = Array.isArray(result.result?.tags) ? result.result.tags : []
    savedSite.set('tags', mergeTags(existingTags, [...picked, ...generated], userTags))
    await savedSite.save(null, { useMasterKey: true })
  } catch (error) {
    console.error('error categorising site 1: ', error)
    console.error('error categorising site 1 savedSite: ', savedSite)
    return []
  }
}
