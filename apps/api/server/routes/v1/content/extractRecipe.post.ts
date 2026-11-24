import Parse from 'parse/node.js'
import { defineEventHandler, readBody, createError } from 'h3'
import { htmlSourceManager } from '../../../utils/htmlSourceManager.js'
import { getSiteById, askGpt } from '../../../utils/serverUtils.js'
import { validateInternalApiKey } from '../../../utils/api-keys'
import { askJev } from '../../../utils/aiClients'
import { jevOn, recipeRequest, readRecipeCheck, RECIPE_AT } from '../../../utils/jevJudgments'
import { applyRecipe, isUsableRecipe, mentionsIngredients, normalizeRecipe, type Recipe } from '../../../utils/recipe'
import { recipeFromHtml } from '../../../utils/recipeJsonLd'

Parse.initialize(process.env.VITE_PARSE_ID as string, process.env.VITE_PARSE_JS_KEY as string, process.env.VITE_PARSE_MASTER_KEY as string)
Parse.serverURL = process.env.VITE_PARSE_URL as string

defineRouteMeta({
  openAPI: {
    tags: ['Content'],
    summary: 'Turn a saved page into a recipe bookmark',
    description: 'Internal pipeline stage. Reads the page\'s schema.org Recipe data, or, when the page has none but reads like a recipe, asks the text model to extract it. On success the row becomes `type: recipe` with `recipe` and `recipeCard`; otherwise it is left as it was. Never overwrites a recipe the user wrote.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['savedSiteId'], properties: { savedSiteId: { type: 'string' } } } } } },
    responses: { 200: { description: '`{ success, extracted, source?, reason? }`' }, 403: { description: 'Internal API key required.' } },
  },
})

/** Types that are not a web page: there is nothing to read a recipe from. */
const NOT_A_PAGE = new Set(['textNote', 'image', 'pdf', 'audio', 'movie', 'game', 'drawing'])

/** How much page text the model reads. */
const TEXT_MAX = 12000

export default defineEventHandler(async (event) => {
  const raw = await readBody(event)
  const body = raw?.websiteData || raw || {}
  // Only the pipeline names a row.
  if (!validateInternalApiKey(event)) throw createError({ statusCode: 403, statusMessage: 'savedSiteId requires the internal API key' })
  if (!body.savedSiteId) throw createError({ statusCode: 400, statusMessage: 'No savedSiteId provided' })

  try {
    const savedSite = await getSiteById(body.savedSiteId, 'extractRecipe')
    if (!savedSite) return { success: false, extracted: false, reason: 'not found' }
    return await extractRecipe(savedSite as Parse.Object, body.userId)
  } catch (error: any) {
    console.error('[extractRecipe] failed:', error?.message || error)
    return { success: false, extracted: false, reason: error?.message || 'failed' }
  }
})

async function extractRecipe(savedSite: Parse.Object, userId?: string) {
  const type = savedSite.get('type') || 'website'
  const existing = savedSite.get('recipe')
  if (NOT_A_PAGE.has(type)) return { success: true, extracted: false, reason: `type ${type}` }
  // Done before, or written by the user: theirs stands.
  if (existing?.source === 'manual' || existing?.ingredients?.length) return { success: true, extracted: false, reason: 'has a recipe' }
  if (savedSite.get('contentWalled')) return { success: true, extracted: false, reason: 'content walled' }

  const url: string = savedSite.get('url') || ''
  // The user (or a client) already called it a recipe: no detection, only extraction.
  const declared = type === 'recipe'

  // 1. The page's own structured recipe: exact, and free.
  const html = await htmlSourceManager.getSharedHtmlContent(savedSite.id, { removeHtml: false, funcName: 'extractRecipe' })
  const fromPage = typeof html === 'string' ? recipeFromHtml(html, url) : null
  if (fromPage && isUsableRecipe(fromPage)) return await save(savedSite, fromPage)

  // 2. No usable JSON-LD: read the page text. Most pages stop here, before any AI.
  const text: string = savedSite.get('siteBody') || ''
  if (!text || (!declared && !mentionsIngredients(text))) return { success: true, extracted: false, reason: 'not a recipe candidate' }

  if (!declared && jevOn('JEV_RECIPE')) {
    try {
      const response = await askJev(recipeRequest(url, savedSite.get('siteTitle'), text), 'extractRecipe')
      const p = readRecipeCheck(response)
      if (p !== undefined && p < RECIPE_AT) return { success: true, extracted: false, reason: 'jev: not a recipe' }
    } catch (error: any) {
      // Jev down: the ingredient-word filter already narrowed it, and the model below can still say no.
      console.warn('[extractRecipe] Jev check failed, asking the text model:', error?.message)
    }
  }

  const answer: any = await askGpt(prompt(text.slice(0, TEXT_MAX)), {
    name: 'extractRecipe',
    userId,
    // Not `savedSite`: a failed extraction is not a failed import.
    // A reasoning model spends part of this thinking; a full recipe needs ~1500 of it.
    maxTokens: 6000,
  })
  if (answer?.result?.error) return { success: false, extracted: false, reason: answer.result.message || 'model error' }
  const result = answer?.result || {}
  if (result.isRecipe === false) return { success: true, extracted: false, reason: 'model: not a recipe' }

  const recipe = normalizeRecipe(result.recipe ?? result, 'ai', url)
  if (!isUsableRecipe(recipe)) return { success: true, extracted: false, reason: 'incomplete' }
  return await save(savedSite, recipe)
}

async function save(savedSite: Parse.Object, recipe: Recipe) {
  applyRecipe(savedSite, recipe)
  await savedSite.save(null, { useMasterKey: true })
  return { success: true, extracted: true, source: recipe.source }
}

const prompt = (text: string) => `You read the text of a web page and decide whether it is ONE recipe (a list of ingredients and steps to prepare a dish or drink).
If it is not, return {"isRecipe": false}.
If it is, return {"isRecipe": true, "recipe": {...}} with exactly these fields:
{"title": "", "description": "", "image": "", "author": "", "yield": "", "prepMinutes": null, "cookMinutes": null, "totalMinutes": null, "cuisine": "", "ingredients": [{"title": "", "items": []}], "steps": [{"title": "", "items": []}], "notes": ""}
Rules:
- Copy the recipe's own words exactly as written, in the page's language. Do NOT translate, summarise, reword or add anything. Never invent ingredients, quantities, steps or times.
- "ingredients": one section per group the page uses ("For the dough"), each ingredient one line with its quantity. A page with no groups has one section with title "".
- "steps": one item per step, in order, grouped the same way.
- Minutes are whole numbers, null when the page does not say. "yield" is the page's own text ("4 servings"), "" when absent.
- "image" is "" (you only have text). "notes" are tips the author gives; "" when none.
RETURN ONLY JSON.

Page text:
${text}`
