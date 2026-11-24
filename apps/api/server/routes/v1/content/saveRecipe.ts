import { captureException } from '#root/server/utils/sentry.js'
import { defineEventHandler, readBody, createError } from 'h3'
import { validateInternalApiKey } from '#root/server/utils/api-keys'
import { requireUserId } from '#root/server/utils/requireUser'
import { saveRecipeBookmark } from '#root/server/utils/recipeBookmark'

defineRouteMeta({
  openAPI: {
    tags: ['Recipes'],
    description: "Save a recipe the user wrote to their collection, or edit one (send `id`). The recipe is normalised and capped: title 200 characters, ingredient lines 200, steps 2000, 100 lines per section, 30 sections.",
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['recipe'],
            properties: {
              userId: { type: 'string', description: 'Only the internal pipeline may name another user; everyone else is who their credential says.' },
              id: { type: 'string', description: 'objectId of one of the user\'s recipe bookmarks to edit instead of creating one.' },
              recipe: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' }, description: { type: 'string' }, image: { type: 'string' }, author: { type: 'string' },
                  yield: { type: 'string', example: '4 servings' },
                  prepMinutes: { type: 'integer', nullable: true }, cookMinutes: { type: 'integer', nullable: true }, totalMinutes: { type: 'integer', nullable: true },
                  cuisine: { type: 'string' },
                  ingredients: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
                  steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
                  notes: { type: 'string' }, sourceUrl: { type: 'string' },
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              savedFrom: { type: 'string' },
              customId: { type: 'string', description: 'A client-made id, so its placeholder card is matched to the saved row.' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: '`{ success: true, id }`' },
      400: { description: 'No title, or `id` is not a recipe' },
      402: { description: 'Bookmark quota reached (`data.errorType` is `UsageError`)' },
      404: { description: 'No such recipe for this user' },
    },
  },
})

export default defineEventHandler(async (event) => {
  try {
    const rawBody = await readBody(event)
    const body = (typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody) || {}

    // Users save as themselves; only the pipeline may name another user.
    const userId: string = validateInternalApiKey(event) && body.userId ? String(body.userId) : await requireUserId(event)
    if (!body.recipe || typeof body.recipe !== 'object') throw createError({ statusCode: 400, statusMessage: 'No recipe provided' })

    const row = await saveRecipeBookmark({
      userId,
      recipe: body.recipe,
      tags: body.tags,
      savedFrom: body.savedFrom,
      customId: body.customId,
      id: typeof body.id === 'string' && body.id ? body.id : undefined,
    })
    return { success: true, id: row.id }
  } catch (error: any) {
    if (error?.statusCode) throw error
    console.log('error saving recipe: ', error)
    captureException(error)
    throw createError({ statusCode: 500, statusMessage: 'Error saving recipe' })
  }
})
