import Parse from 'parse/node.js'
import { getMultimodalModel, getOpenAI } from '#root/server/utils/aiClients'
import { imagesOf, unionTags } from '#root/server/utils/bookmarkImages'
import { askJev } from '#root/server/utils/aiClients'
import { jevOn, tagRequest, pickTags, mergeTags, JEV_TAG_POOL } from '#root/server/utils/jevJudgments'
import { imageUrlsFor, prepareImages } from '#root/server/utils/jevImages'
import { userTagCounts } from '#root/server/utils/userTags'
import { automationMessage } from '#root/server/utils/enrichmentMessages'
import { sendToQstash, getPartitionedQueue } from '#root/server/utils/serverUtils.js'

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL

/**
 * The user's own tags that fit the pictures, judged by Jev, so an upload reuses
 * "AI" instead of inventing "Artificial Intelligence". Empty when Jev is off or
 * fails: the vision model's tags still apply.
 */
async function pickUserTags(website: Parse.Object, userId: string | undefined): Promise<{ picked: string[]; userTags: string[] }> {
  const none = { picked: [], userTags: [] }
  if (!userId || !jevOn('JEV_TAGS')) return none
  try {
    const images = await prepareImages(imageUrlsFor(website))
    if (!images) return none
    const userTags = (await userTagCounts(userId))
      .sort((a, b) => b.count - a.count)
      .slice(0, JEV_TAG_POOL)
      .map((tag) => tag.name)
    if (!userTags.length) return none
    const page = { title: website.get('siteTitle') || undefined }
    return { picked: pickTags(await askJev(tagRequest(page, userTags, images), 'getImageTags'), userTags), userTags }
  } catch (error: any) {
    console.error('[getImageTags] Jev tag pick failed, using the vision model only:', error?.message)
    return none
  }
}

async function getTagsForImage(imageUrl: string): Promise<{ imageTags: string[]; imageTitle: string } | { error: string }> {
  try {
    const openai = getOpenAI('getImageTags')

    const prompt = "Return valid JSON only (no markdown, no code blocks), with a title for the image and an array of tags that best describe the image. Use double quotes for all strings and property names. Format: {\"title\": \"...\", \"tags\": [\"Tag1\", \"Tag2\"]}. Use proper capitalization for tags."
    
    const chatCompletion = await openai.chat.completions.create({
      model: getMultimodalModel(),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      max_tokens: 500
    })
    const response = chatCompletion.choices[0].message.content
    const match = response && response.match(/{.*}/gs)

    if (!match || !match[0]) return { error: 'Invalid JSON response' }
    let json: any
    try {
      json = JSON.parse(match[0])
    } catch (e) {
      console.error('[getImageTags] Error parsing JSON:', JSON.stringify(response))
      const err = e as Error
      return { error: err.message || 'Failed to parse response' }
    }
    return { imageTags: json.tags, imageTitle: json.title }
  } catch (error) { 
    const e = error as any
    return { error: JSON.stringify(e) }
  }
}

export default defineEventHandler(async (event) => {
  let imageUrl: string | null = null

  try {
    const rawBody: any = await readBody(event)
    const body: any = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
    
    const { websiteId } = body || {} as { websiteId?: string }

    if (!websiteId) {
      console.error('[getImageTags] websiteId is required')
      throw createError({ statusCode: 400, message: 'websiteId is required' })
    }

    const websiteQuery = new Parse.Query('websites')
    const website: any = await websiteQuery.get(websiteId, { useMasterKey: true })
    
    if (!website) {
      console.error('[getImageTags] Website not found')
      throw createError({ statusCode: 404, message: 'Website not found' })
    }
    
    if (website.get('type') !== 'image') {
      log('[getImageTags] Website is not an image')
      return { success: true, skipped: true }
    }

    // Every image in the bookmark, not just the cover. A single-image bookmark
    // has no `images` array and `imagesOf` reads it as the one-item list
    // [cover], so this is the old behaviour for the old shape.
    const images = imagesOf(website)
    if (images.length === 0) {
      log('[getImageTags] No image URL found')
      return { success: false, error: 'No image URL found' }
    }

    imageUrl = images[0].url
    const isMulti = Array.isArray(website.get('images')) && website.get('images').length > 0

    // The first pass over a bookmark is when its smart boards and automations run.
    const firstPass = images.every((image) => !image.tags?.length)
    const userId: string | undefined = website.get('user')?.id

    // Untagged images only: this reruns on every save, and re-describing
    // pictures that already have tags would burn a vision call each time.
    const [results, { picked, userTags }] = await Promise.all([
      Promise.all(images.map(async (image) => {
        if (Array.isArray(image.tags) && image.tags.length > 0) return image
        const details = await getTagsForImage(image.url)
        if ('error' in details) {
          log(`[getImageTags] Error processing image tags 1: ${details.error}`)
          return image
        }
        return {
          ...image,
          tags: (details as any).imageTags || [],
          title: image.title || (details as any).imageTitle || undefined
        }
      })),
      firstPass ? pickUserTags(website, userId) : { picked: [], userTags: [] }
    ])

    // Bookmark-level tags stay the union, so tag filtering, tag counts and the
    // Meilisearch facets keep working on a multi-image bookmark unchanged.
    // Jev's picks lead, and tags that differ from the user's own only in case take their spelling.
    const existing: string[] = Array.isArray(website.get('tags')) ? website.get('tags') : []
    const newTags = mergeTags(existing, [...picked, ...unionTags(existing, results)], userTags)

    console.log('[getImageTags] newTags:', newTags)

    website.set('tags', newTags)
    if (isMulti) website.set('images', results)

    // The group title comes off the cover, as it always did.
    if (!website.get('siteTitle') || !isMulti) {
      const coverTitle = results[0]?.title
      if (coverTitle) website.set('siteTitle', coverTitle)
    }
    await website.save(null, { useMasterKey: true })

    // Smart boards and automations, which uploaded images never reached: they
    // run once tags are saved, as for a web bookmark after categoriseSite.
    if (firstPass && userId) {
      await sendToQstash(automationMessage(websiteId, userId), { isBatch: false, queueName: getPartitionedQueue('getBookmarkContent') })
        .catch((error: any) => console.error('[getImageTags] Failed to queue automations:', error?.message || error))
    }

    return { success: true, imageCount: results.length }
  } catch (error) {
    const e = error as any
    log(`[getImageTags] Error processing image tags 2: ${e?.message || e}, 'url: ', ${imageUrl}` )
    throw createError({ statusCode: 500, message: `Error processing image tags 3: ${e?.message || e}` })
  }
})
