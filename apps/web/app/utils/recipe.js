/**
 * A saved recipe, read out of the `recipe` column (and the small `recipeCard`
 * that rides in search hits). The backend writes it from schema.org JSON-LD or
 * the AI (`source: 'jsonld' | 'ai'`); the form here writes `source: 'manual'`.
 *
 * recipe: { source, title, description, image, author, yield, prepMinutes,
 *   cookMinutes, totalMinutes, cuisine, ingredients: Section[], steps: Section[],
 *   notes, sourceUrl }   Section: { title: '' when ungrouped, items: string[] }
 */

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const link = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : '')
const minutes = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null)

function sectionsOf(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((section) => ({
      title: text(section?.title),
      items: (Array.isArray(section?.items) ? section.items : []).map(text).filter(Boolean),
    }))
    .filter((section) => section.items.length)
}

/** Normalised recipe for a website row, or null when the row has none (yet). */
export function recipeOf(website) {
  let raw = website?.recipe
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object') return null
  const ingredients = sectionsOf(raw.ingredients)
  const steps = sectionsOf(raw.steps)
  if (!ingredients.length && !steps.length) return null
  return {
    source: text(raw.source) || 'ai',
    title: text(raw.title) || text(website?.siteTitle),
    description: text(raw.description),
    image: link(raw.image),
    author: text(raw.author),
    yield: text(raw.yield),
    prepMinutes: minutes(raw.prepMinutes),
    cookMinutes: minutes(raw.cookMinutes),
    totalMinutes: minutes(raw.totalMinutes),
    cuisine: text(raw.cuisine),
    ingredients,
    steps,
    notes: text(raw.notes),
    sourceUrl: link(raw.sourceUrl),
  }
}

/** The grid card's summary, or null. */
export function recipeCardOf(website) {
  const card = website?.recipeCard
  if (!card || typeof card !== 'object') return null
  return {
    image: link(card.image),
    totalMinutes: minutes(card.totalMinutes),
    yield: text(card.yield),
    ingredientCount: Number.isFinite(card.ingredientCount) ? card.ingredientCount : 0,
    stepCount: Number.isFinite(card.stepCount) ? card.stepCount : 0,
  }
}

/** "45 min", "1 h 30 min", "2 h". Units are passed in so each locale can spell them. */
export function formatMinutes(total, units = { h: 'h', m: 'min' }) {
  const value = minutes(total)
  if (!value) return ''
  const h = Math.floor(value / 60)
  const m = value % 60
  return [h ? `${h} ${units.h}` : '', m ? `${m} ${units.m}` : ''].filter(Boolean).join(' ')
}

/**
 * Textarea text to sections: one item per line; a line ending in ":" starts a
 * named group ("For the sauce:"); lines before any heading are ungrouped.
 */
export function textToSections(value) {
  const sections = []
  let current = null
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.endsWith(':')) {
      const title = trimmed.slice(0, -1).trim()
      if (title) { current = { title, items: [] }; sections.push(current); continue }
    }
    if (!current) { current = { title: '', items: [] }; sections.push(current) }
    current.items.push(trimmed)
  }
  return sections.filter((section) => section.items.length)
}

/** The inverse of textToSections, for the edit form. */
export function sectionsToText(sections) {
  return (Array.isArray(sections) ? sections : [])
    .flatMap((section) => [...(section.title ? [`${section.title}:`] : []), ...section.items])
    .join('\n')
}

const wholeMinutes = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * What the form submits (and what POST /api/saveRecipe sends as `recipe`).
 * `base` is the recipe being edited: what the form has no field for (author,
 * description, cuisine, an extracted total time) and its `source` carry over.
 */
export function recipeFromForm(form, base = {}) {
  const prepMinutes = wholeMinutes(form.prepMinutes)
  const cookMinutes = wholeMinutes(form.cookMinutes)
  return {
    source: base.source || 'manual',
    title: text(form.title),
    description: base.description || '',
    image: link(form.image),
    author: base.author || '',
    yield: text(form.yield),
    prepMinutes,
    cookMinutes,
    totalMinutes: prepMinutes != null || cookMinutes != null ? (prepMinutes ?? 0) + (cookMinutes ?? 0) : (base.totalMinutes ?? null),
    cuisine: base.cuisine || '',
    ingredients: textToSections(form.ingredients),
    steps: textToSections(form.steps),
    notes: text(form.notes),
    sourceUrl: link(form.sourceUrl),
  }
}

/** A recipe (or none) as the form's fields, all strings. */
export function formFromRecipe(recipe) {
  return {
    title: recipe?.title ?? '',
    yield: recipe?.yield ?? '',
    prepMinutes: recipe?.prepMinutes ?? '',
    cookMinutes: recipe?.cookMinutes ?? '',
    ingredients: sectionsToText(recipe?.ingredients),
    steps: sectionsToText(recipe?.steps),
    notes: recipe?.notes ?? '',
    sourceUrl: recipe?.sourceUrl ?? '',
    image: recipe?.image ?? '',
  }
}
