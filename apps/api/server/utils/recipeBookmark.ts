import Parse from 'parse/node.js'
import { createError } from 'h3'
import { getUserWithPlan, getBookmarkQuota } from './plans'
import { initParseForBoards } from './boardUtils'
import { applyRecipe, normalizeRecipe, recipeText } from './recipe'

/**
 * Creating or editing a recipe the user wrote by hand. `routes/v1/content/saveRecipe.ts`
 * comes through here, so the bookmark quota is checked in one place, as for notes.
 */

export interface SaveRecipeInput {
  userId: string
  /** The recipe object as clients send it (`utils/recipe.ts`); normalised here. */
  recipe: unknown
  tags?: unknown
  savedFrom?: string
  customId?: string
  /** An existing recipe row to edit instead of creating one. */
  id?: string
}

const cleanTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? [...new Set(tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 100)).filter(Boolean))].slice(0, 50) : []

export async function saveRecipeBookmark(input: SaveRecipeInput): Promise<Parse.Object> {
  initParseForBoards()
  const recipe = normalizeRecipe(input.recipe, 'manual')
  if (!recipe.title) throw createError({ statusCode: 400, statusMessage: 'A recipe needs a title' })

  if (input.id) {
    const row = await new Parse.Query('websites').get(input.id, { useMasterKey: true }).catch(() => null)
    // Someone else's row looks the same as one that is not there.
    if (!row || row.get('user')?.id !== input.userId || row.get('isDeleted')) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
    if (row.get('type') !== 'recipe') throw createError({ statusCode: 400, statusMessage: 'That bookmark is not a recipe' })
    // An edit keeps where the recipe came from.
    if (!recipe.sourceUrl) recipe.sourceUrl = row.get('recipe')?.sourceUrl || ''
    applyRecipe(row, recipe, { manual: true })
    row.set('siteBody', recipeText(recipe))
    if (input.tags !== undefined) row.set('tags', cleanTags(input.tags))
    await row.save(null, { useMasterKey: true })
    return row
  }

  const { user, plan } = await getUserWithPlan(input.userId)
  if (getBookmarkQuota(user, plan).exceeded) {
    throw createError({
      statusCode: 402,
      statusMessage: 'You have reached your bookmark limit. Upgrade your plan to save more.',
      data: { errorType: 'UsageError', quotaKind: 'bookmarks' },
    })
  }

  const row = new Parse.Object('websites')
  row.setACL(new Parse.ACL(user as Parse.User))
  // A recipe with no source is URL-less, as a note is.
  row.set('url', recipe.sourceUrl || ' ')
  row.set('user', user)
  row.set('tags', cleanTags(input.tags))
  row.set('savedFrom', input.savedFrom || '')
  if (input.customId) row.set('customId', input.customId)
  // The recipe as text, so search finds its ingredients (no page was fetched to give it a body).
  row.set('siteBody', recipeText(recipe))
  applyRecipe(row, recipe, { manual: true })
  await row.save(null, { useMasterKey: true })
  return row
}
