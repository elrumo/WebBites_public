import Parse from 'parse/node.js'
import { extractTextFromImage } from '#root/server/utils/tesseractScheduler.js'

Parse.initialize(process.env.VITE_PARSE_ID, process.env.VITE_PARSE_JS_KEY, process.env.VITE_PARSE_MASTER_KEY)
Parse.serverURL = process.env.VITE_PARSE_URL

function getImageUrl(site: any): string | null {
  if (site.get('OGImageFile') != null && site.get('OGImageFile') != undefined) {
    return typeof site.get('OGImageFile').url == 'function' ? site.get('OGImageFile').url() : site.get('OGImageFile').url
  }

  if (site.get('OGImage') != null && site.get('OGImage') != undefined) {
    return site.get('OGImage')
  }

  if (site.get('file') != null && site.get('file') != undefined) {
    return typeof site.get('file').url == 'function' ? site.get('file').url() : site.get('file').url
  }

  return null
}

export default defineEventHandler(async (event) => {
  try {
    const rawBody: any = await readBody(event)
    const body: any = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody

    const { websiteId } = body || {} as { websiteId?: string }

    if (!websiteId) throw createError({ statusCode: 400, message: 'websiteId is required' })

    const websiteQuery = new Parse.Query('websites')
    let website: any
    try {
      website = await websiteQuery.get(websiteId, { useMasterKey: true })
    } catch (parseError: any) {
      if (parseError.code === Parse.Error.OBJECT_NOT_FOUND || parseError.message?.includes('Object not found')) {
        throw createError({ statusCode: 404, message: `Website not found for ID: ${websiteId}` })
      }
      throw parseError
    }

    if (website.get('type') !== 'image') {
      return { success: true, skipped: true, message: 'Not an image type' }
    }

    const imageUrl = getImageUrl(website)
    if (!imageUrl) {
      return { success: false, error: 'No image URL found' }
    }

    const imageText = await extractTextFromImage(imageUrl)

    if (!imageText || imageText.trim().length === 0) {
      return { success: true, noTextFound: true, message: 'No text found in image' }
    }

    website.set('imageText', imageText)
    await website.save(null, { useMasterKey: true })

    return {
      success: true,
      imageText,
      websiteId: website.id
    }
  } catch (error) {
    const e = error as any
    log(`[getOcr] Error processing OCR: ${e?.message || e}`)
    throw createError({ statusCode: 500, message: `Error processing OCR: ${e?.message || e}` })
  }
})
