/**
 * A page's own recipe, from its schema.org `Recipe` JSON-LD: most recipe sites
 * ship one for search engines, and it is exact where a model would only guess.
 * Pure: HTML in, a normalised `Recipe` (or null) out.
 */
import { normalizeRecipe, type Recipe } from './recipe'

const SCRIPT = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Tags out, entities decoded, whitespace folded. JSON-LD strings often carry both. */
const plain = (value: string): string =>
  value
    .replace(/<br\s*\/?>|<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim()

/** ISO 8601 duration ("PT1H30M", "P0DT45M") in whole minutes, or null. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!m) return null
  const [d, h, min, s] = [1, 2, 3, 4].map((i) => Number(m[i] ?? 0))
  const total = Math.round(d * 1440 + h * 60 + min + s / 60)
  return total > 0 ? total : null
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null ? [] : [value])

/** A name from a string, a `{ name }` object or a list of either. */
const name = (value: unknown): string =>
  asArray(value)
    .map((v) => (typeof v === 'string' ? v : (v as any)?.name))
    .filter((v): v is string => typeof v === 'string')
    .map(plain)
    .filter(Boolean)
    .join(', ')

/** The first picture URL from a string, an `ImageObject` or a list of either. */
const image = (value: unknown): string => {
  for (const v of asArray(value)) {
    const url = typeof v === 'string' ? v : (v as any)?.url ?? (v as any)?.contentUrl
    if (typeof url === 'string' && url.trim()) return url.trim()
    const nested = v && typeof v === 'object' && !Array.isArray(v) ? image((v as any).image) : ''
    if (nested) return nested
  }
  return ''
}

/** "4", 4, ["4", "4 servings"] → the most descriptive: a bare number reads as servings. */
const servings = (value: unknown): string => {
  const parts = asArray(value).map((v) => plain(String(v ?? ''))).filter(Boolean)
  const best = parts.find((p) => /\D/.test(p)) ?? parts[0] ?? ''
  return /^\d+(\.\d+)?$/.test(best) ? `${best} servings` : best
}

type Section = { title: string; items: string[] }

/**
 * `recipeInstructions` is a string, a list of strings, `HowToStep`s (`text` or
 * `name`), `HowToSection`s holding steps, or a mix. A single string with line
 * breaks is split into steps.
 */
function steps(value: unknown): Section[] {
  const sections: Section[] = []
  let loose: string[] = []
  const flush = () => { if (loose.length) sections.push({ title: '', items: loose }); loose = [] }
  const text = (v: any): string => plain(String(typeof v === 'string' ? v : v?.text ?? v?.name ?? ''))
  const push = (value: string) => value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => loose.push(l))

  for (const entry of asArray(value)) {
    const type = asArray((entry as any)?.['@type'])
    if (type.includes('HowToSection') || (entry && typeof entry === 'object' && Array.isArray((entry as any).itemListElement) && !type.includes('HowToStep'))) {
      flush()
      const items = asArray((entry as any).itemListElement).map(text).flatMap((t) => t.split('\n')).map((l) => l.trim()).filter(Boolean)
      if (items.length) sections.push({ title: plain(String((entry as any).name ?? '')), items })
    } else {
      push(text(entry))
    }
  }
  flush()
  return sections
}

/** Every node in the parsed JSON-LD, through arrays and `@graph`. */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) { for (const v of value) yield* nodes(v); return }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  yield node
  if (node['@graph']) yield* nodes(node['@graph'])
}

const isRecipeNode = (node: Record<string, unknown>) => asArray(node['@type']).some((t) => t === 'Recipe' || (typeof t === 'string' && /\/Recipe$/.test(t)))

/** The page's first `Recipe` with enough in it to be one, or null. */
export function recipeFromHtml(html: string, sourceUrl = ''): Recipe | null {
  if (!html || !/ld\+json/i.test(html)) return null
  for (const match of html.matchAll(SCRIPT)) {
    let json: unknown
    try {
      json = JSON.parse(match[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, '').trim())
    } catch { continue }
    for (const node of nodes(json)) {
      if (!isRecipeNode(node)) continue
      const recipe = normalizeRecipe({
        title: plain(String(node.name ?? '')),
        description: plain(String(node.description ?? '')),
        image: image(node.image),
        author: name(node.author),
        yield: servings(node.recipeYield),
        prepMinutes: durationMinutes(node.prepTime),
        cookMinutes: durationMinutes(node.cookTime),
        totalMinutes: durationMinutes(node.totalTime),
        cuisine: name(node.recipeCuisine),
        ingredients: asArray(node.recipeIngredient ?? node.ingredients).map((i) => plain(String(i ?? ''))),
        steps: steps(node.recipeInstructions),
      }, 'jsonld', sourceUrl)
      if (recipe.ingredients.length || recipe.steps.length) return recipe
    }
  }
  return null
}
