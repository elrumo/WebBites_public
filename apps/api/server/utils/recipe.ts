/**
 * The recipe bookmark: its stored shape, the checks that keep it sane, and the
 * small card the grid draws. Pure (no I/O) so the extraction route, the manual
 * entry route and the tests share one definition.
 *
 * A recipe is a `websites` row with `type: 'recipe'` and `subType: ['recipe']`.
 * `recipe` holds the whole thing; `recipeCard` is the summary that goes into the
 * search index (the full `recipe` stays out of it, like `appListing`).
 */

export type RecipeSource = 'jsonld' | 'ai' | 'manual'

/** A group of lines: "For the dough" and its ingredients. `title` is '' when ungrouped. */
export interface RecipeSection { title: string; items: string[] }

export interface Recipe {
  source: RecipeSource
  title: string
  description: string
  /** A picture URL, or ''. */
  image: string
  author: string
  /** Free text: "4 servings", "12 cookies". */
  yield: string
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  cuisine: string
  ingredients: RecipeSection[]
  steps: RecipeSection[]
  notes: string
  sourceUrl: string
}

export interface RecipeCard {
  image: string
  totalMinutes: number | null
  yield: string
  ingredientCount: number
  stepCount: number
}

export const RECIPE_LIMITS = {
  title: 200,
  description: 2000,
  author: 200,
  yield: 100,
  cuisine: 100,
  notes: 5000,
  url: 2000,
  ingredient: 200,
  step: 2000,
  itemsPerSection: 100,
  sections: 30,
  minutes: 60 * 24 * 30,
} as const

const str = (value: unknown, max: number): string =>
  (typeof value === 'string' || typeof value === 'number' ? String(value) : '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Whole minutes, or null when absent, negative or not a number. */
const minutes = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), RECIPE_LIMITS.minutes) : null
}

const httpUrl = (value: unknown): string => {
  const url = str(value, RECIPE_LIMITS.url)
  return /^https?:\/\//i.test(url) ? url : ''
}

/**
 * Sections from whatever a source gave: a list of strings (one ungrouped
 * section), a list of `{ title, items }`, or a mix. Empty lines and empty
 * sections are dropped; sizes are capped.
 */
export function normalizeSections(value: unknown, itemMax: number): RecipeSection[] {
  if (!Array.isArray(value)) return []
  const out: RecipeSection[] = []
  let loose: string[] = []
  const flush = () => {
    if (loose.length) out.push({ title: '', items: loose.slice(0, RECIPE_LIMITS.itemsPerSection) })
    loose = []
  }
  for (const entry of value) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const items = (Array.isArray((entry as any).items) ? (entry as any).items : []).map((i: unknown) => str(i, itemMax)).filter(Boolean)
      if (!items.length) continue
      flush()
      out.push({ title: str((entry as any).title, RECIPE_LIMITS.title), items: items.slice(0, RECIPE_LIMITS.itemsPerSection) })
    } else {
      const item = str(entry, itemMax)
      if (item) loose.push(item)
    }
  }
  flush()
  return out.slice(0, RECIPE_LIMITS.sections)
}

const countItems = (sections: RecipeSection[]) => sections.reduce((sum, s) => sum + s.items.length, 0)

/**
 * The contract object from untrusted input (a request body, a page's JSON-LD,
 * a model's JSON). Never throws; an unusable input becomes an empty recipe, so
 * check `isUsableRecipe` or `hasRecipeTitle` for what the caller needs.
 * `totalMinutes` falls back to prep + cook when the source gave no total.
 */
export function normalizeRecipe(raw: unknown, source: RecipeSource, sourceUrl = ''): Recipe {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const prepMinutes = minutes(r.prepMinutes)
  const cookMinutes = minutes(r.cookMinutes)
  const summed = prepMinutes == null && cookMinutes == null ? null : (prepMinutes ?? 0) + (cookMinutes ?? 0)
  return {
    source,
    title: str(r.title, RECIPE_LIMITS.title),
    description: str(r.description, RECIPE_LIMITS.description),
    image: httpUrl(r.image),
    author: str(r.author, RECIPE_LIMITS.author),
    yield: str(r.yield, RECIPE_LIMITS.yield),
    prepMinutes,
    cookMinutes,
    totalMinutes: minutes(r.totalMinutes) ?? summed,
    cuisine: str(r.cuisine, RECIPE_LIMITS.cuisine),
    ingredients: normalizeSections(r.ingredients, RECIPE_LIMITS.ingredient),
    steps: normalizeSections(r.steps, RECIPE_LIMITS.step),
    // Notes keep their line breaks.
    notes: (typeof r.notes === 'string' ? r.notes : '').trim().slice(0, RECIPE_LIMITS.notes),
    sourceUrl: httpUrl(sourceUrl || r.sourceUrl),
  }
}

/** What extraction needs before it calls a page a recipe: nothing is invented to fill the gaps. */
export const isUsableRecipe = (recipe: Recipe): boolean =>
  Boolean(recipe.title) && countItems(recipe.ingredients) >= 2 && countItems(recipe.steps) >= 1

export const recipeCardOf = (recipe: Recipe): RecipeCard => ({
  image: recipe.image,
  totalMinutes: recipe.totalMinutes,
  yield: recipe.yield,
  ingredientCount: countItems(recipe.ingredients),
  stepCount: countItems(recipe.steps),
})

/** The recipe as plain text: what a manual recipe's `siteBody` holds, so search finds its ingredients. */
export function recipeText(recipe: Recipe): string {
  const lines = (sections: RecipeSection[]) => sections.flatMap((s) => [...(s.title ? [s.title] : []), ...s.items])
  return [recipe.title, recipe.description, ...lines(recipe.ingredients), ...lines(recipe.steps), recipe.notes].filter(Boolean).join('\n')
}

/** A title that says nothing: empty, the URL, or just the site's host. */
const isGenericTitle = (title: string, url: string): boolean => {
  const t = title.trim().toLowerCase()
  if (!t || t === url.trim().toLowerCase()) return true
  try { return t === new URL(url).hostname.replace(/^www\./, '') } catch { return false }
}

type RowLike = { get(key: string): any; set(key: string, value: unknown): unknown }

/**
 * Writes a recipe onto its row: `recipe`, `recipeCard`, the type, and the
 * title, picture and description the card and search read. With `manual` the
 * recipe's own title wins; otherwise the page's stays unless it is generic.
 */
export function applyRecipe(row: RowLike, recipe: Recipe, { manual = false }: { manual?: boolean } = {}): void {
  const url = String(row.get('url') || '')
  row.set('recipe', recipe)
  row.set('recipeCard', recipeCardOf(recipe))
  row.set('type', 'recipe')
  row.set('subType', ['recipe'])
  const title = String(row.get('siteTitle') || '')
  if (recipe.title && (manual || isGenericTitle(title, url))) row.set('siteTitle', recipe.title)
  if (recipe.image && !row.get('OGImage')) row.set('OGImage', recipe.image)
  if (recipe.description && !row.get('siteDescription')) row.set('siteDescription', recipe.description.slice(0, 500))
}

/**
 * Cheap pre-filter before any AI is asked: the page text names an ingredient
 * list, in one of the app's languages. Most pages never get past this.
 */
export const mentionsIngredients = (text: string): boolean =>
  /ingredient|ingrédient|ingrediënt|ingredienti|zutaten|ingredientes|ингредиент|材料|재료|成分表|ingrediens|składniki/i.test(text)
