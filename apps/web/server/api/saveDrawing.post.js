import Parse from 'parse/node';
import { ensureParseInitialized } from '../utils/parseRuntime'
import { verifySession } from '../utils/sessionCache'
import { MAX_DRAWING_BYTES, drawingByteSize } from '../utils/drawing'

/**
 * Create a drawing bookmark.
 *
 * Mirrors the backend's v1/content/saveNote — a drawing is authored in-app and has no
 * URL to enrich, so like a text note it is a plain row written straight to `websites`
 * rather than anything that goes near the scrape/summarise fan-out. Nothing is enqueued
 * to QStash: there is no page to fetch. The Parse afterSave trigger still fires, so
 * search indexing, the savedSites relation and bookmark counters keep working untouched.
 *
 * `siteTitle` is set here deliberately, not for looks. `setSiteTitle` in the backend
 * (parse-server/cloud/newMain.js) returns early unless `type === 'website'`, and the
 * search mappers fall back to parsing the URL — which for a drawing is ' '. Without a
 * title written at creation the drawing indexes as Untitled.
 */
export default defineEventHandler(async (event) => {
    ensureParseInitialized()

    try {
        const body = await readBody(event)
        const drawingToSave = body.drawingToSave || {}

        // Bind the row to the authenticated user rather than trusting the body-provided
        // userId (a logged-in caller proves "some user", not "this user").
        const sessionUser = await verifySession(getCookie(event, 'parse.session'))
        if (!sessionUser) {
            throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
        }
        if (drawingToSave.userId && drawingToSave.userId !== sessionUser.id) {
            throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
        }

        const snapshot = drawingToSave.drawing
        if (!snapshot?.document?.store) {
            throw createError({ statusCode: 400, statusMessage: 'No drawing snapshot provided' })
        }

        const size = drawingByteSize(snapshot)
        if (size > MAX_DRAWING_BYTES) {
            throw createError({
                statusCode: 413,
                statusMessage: `Drawing is ${Math.round(size / 1024 / 1024)}MB, over the ${MAX_DRAWING_BYTES / 1024 / 1024}MB limit`,
            })
        }

        const userQuery = new Parse.Query(Parse.User)
        const user = await userQuery.get(sessionUser.id, { useMasterKey: true })
        if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

        const Websites = Parse.Object.extend('websites')
        const website = new Websites()

        website.setACL(new Parse.ACL(user))
        website.set('user', user)
        website.set('type', 'drawing')
        website.set('url', ' ')
        website.set('siteTitle', (drawingToSave.siteTitle || '').trim() || 'Drawing')
        website.set('drawing', snapshot)
        website.set('tags', drawingToSave.tags || [])
        website.set('savedFrom', drawingToSave.savedFrom || 'website')

        if (drawingToSave.customId) website.set('customId', drawingToSave.customId)
        // The exported PNG. OGImage is a plain string column (the card does a
        // .replace() on it), so we store the file's URL rather than the file itself.
        if (drawingToSave.thumbnailUrl) website.set('OGImage', drawingToSave.thumbnailUrl)

        await website.save(null, { useMasterKey: true })

        return { status: 'ok', websiteId: website.id }
    } catch (error) {
        if (error.statusCode) throw error
        console.log('error saving drawing: ', error);
        throw createError({ statusCode: 500, statusMessage: 'Error saving drawing' })
    }
})
