import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'
import { verifySession } from '../utils/sessionCache'
import { MAX_DRAWING_BYTES, drawingByteSize } from '../utils/drawing'

/**
 * Autosave a drawing snapshot onto an existing row.
 *
 * A text note autosaves straight from the client through `saveUpdatedSite`, relying on
 * the row's ACL. Drawings go through a route instead for two reasons: the native app
 * shares this write path, and a snapshot needs a size check before it reaches Mongo.
 * Because we write with the master key we have to re-establish what the ACL would have
 * given us for free — hence the explicit owner check below.
 */
export default defineEventHandler(async (event) => {
    ensureParseInitialized()

    try {
        const body = await readBody(event)
        const { websiteId, drawing, thumbnailUrl } = body

        const sessionUser = await verifySession(getCookie(event, 'parse.session'))
        if (!sessionUser) {
            throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
        }
        if (!websiteId) {
            throw createError({ statusCode: 400, statusMessage: 'No websiteId provided' })
        }
        if (!drawing?.document?.store) {
            throw createError({ statusCode: 400, statusMessage: 'No drawing snapshot provided' })
        }

        const size = drawingByteSize(drawing)
        if (size > MAX_DRAWING_BYTES) {
            throw createError({
                statusCode: 413,
                statusMessage: `Drawing is ${Math.round(size / 1024 / 1024)}MB, over the ${MAX_DRAWING_BYTES / 1024 / 1024}MB limit`,
            })
        }

        const Websites = Parse.Object.extend('websites')
        const query = new Parse.Query(Websites)
        const website = await query.get(websiteId, { useMasterKey: true })

        if (!website) {
            throw createError({ statusCode: 404, statusMessage: 'Drawing not found' })
        }
        if (website.get('user')?.id !== sessionUser.id) {
            throw createError({ statusCode: 403, statusMessage: 'Not your drawing' })
        }

        website.set('drawing', drawing)
        if (thumbnailUrl) website.set('OGImage', thumbnailUrl)

        await website.save(null, { useMasterKey: true })

        return { status: 'ok', websiteId: website.id }
    } catch (error) {
        if (error.statusCode) throw error
        console.log('error updating drawing: ', error);
        throw createError({ statusCode: 500, statusMessage: 'Error updating drawing' })
    }
})
