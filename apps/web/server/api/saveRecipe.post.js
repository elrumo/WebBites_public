import { verifySession } from '../utils/sessionCache'

// Creates or edits a recipe row (`recipe` + `recipeCard`, type 'recipe'). The
// counterpart of saveTextNote: a recipe written by hand has no URL to enrich.
export default defineEventHandler(async (event) => {
    try {
        const body = await readBody(event)
        const toSave = body.recipeToSave || {}

        // Bind the recipe to the authenticated user rather than trusting the
        // body-provided userId (backendFetch only proves "some logged-in user").
        const sessionToken = getCookie(event, 'parse.session')
        const sessionUser = await verifySession(sessionToken)
        if (sessionUser && toSave.userId && toSave.userId !== sessionUser.id) {
            throw createError({ statusCode: 403, statusMessage: 'userId does not match the authenticated user' })
        }

        return await backendFetch(event, 'v1/content/saveRecipe', {
            method: 'POST',
            body: {
                userId: sessionUser ? sessionUser.id : toSave.userId,
                recipe: toSave.recipe,
                tags: toSave.tags,
                savedFrom: toSave.savedFrom,
                customId: toSave.customId,
                id: toSave.id,
            }
        })
    } catch (error) {
        console.log('error saving recipe: ', error)
        return { success: false, error }
    }
})
