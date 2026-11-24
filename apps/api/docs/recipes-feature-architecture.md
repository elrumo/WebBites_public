# Recipe bookmarks

A recipe is a `websites` row with `type: 'recipe'` and `subType: ['recipe']`. Clients read it from two
columns (both schemaless, created on first save; no migration):

| Column | What | Indexed in Meilisearch |
|---|---|---|
| `recipe` | The whole recipe (below). | No |
| `recipeCard` | `{ image, totalMinutes, yield, ingredientCount, stepCount }` for the grid. | Yes (`attributesToRetrieve`) |

```ts
recipe = {
  source: 'jsonld' | 'ai' | 'manual',
  title, description, image /* URL or '' */, author,
  yield /* free text: "4 servings" */, prepMinutes, cookMinutes, totalMinutes /* int | null */,
  cuisine,
  ingredients: { title /* '' when ungrouped */, items: string[] }[],
  steps:       { title, items: string[] }[],
  notes, sourceUrl,
}
```

The shape, its caps (title 200, ingredient lines 200, steps 2000, 100 lines per section, 30 sections) and the
card are defined once in `server/utils/recipe.ts`. `applyRecipe` also fills `siteTitle` (when the page's is
empty or just the URL/host), `OGImage` and `siteDescription` (when empty).

## Where a recipe comes from

1. **A saved page, detected.** `enrichmentMessages.aiMessages` sends `extractRecipe` with the other AI stages;
   `qstash-webhook.post.js` calls `v1/content/extractRecipe` (internal key only). The stage:
   - skips non-page types (note, image, pdf, audio, movie, game, drawing), walled pages, and rows that already
     have a `recipe` (so a recipe the user wrote or edited is never overwritten);
   - reads the page's schema.org `Recipe` JSON-LD from the stored HTML (`recipeJsonLd.ts`, source `jsonld`);
   - otherwise, only if the page text names an ingredient list (`mentionsIngredients`, a free filter), asks Jev
     (`recipeRequest`, flag `JEV_RECIPE`, on unless set to `false`; below `RECIPE_AT` = 0.6 it stops), then asks
     the text model for the contract JSON (source `ai`, copied as written, never translated);
   - turns the row into a recipe only with a title, at least 2 ingredient lines and 1 step. Anything less leaves
     the row a plain website. A row a client already saved as `type: 'recipe'` skips the detection and is only
     extracted; if that fails it stays a recipe with no `recipe` column.
2. **Written by hand.** `POST /v1/content/saveRecipe` (`{ recipe, tags?, savedFrom?, customId? }`) creates the
   row (quota-checked, 402 `UsageError` when full; `url` is `' '` unless `recipe.sourceUrl` is set; `siteBody` is
   the recipe as text, so search finds its ingredients). With `id` it edits one of the caller's recipes. Returns
   `{ success, id }`. Clients pass `customId` so their placeholder card is matched to the saved row.
3. **Backfill.** `scripts/backfill-recipes.ts` (dry run by default) queues `extractRecipe` for old rows.

The public API returns `recipe` on a bookmark that has one; `type=recipe` filters the list. The MCP search tool
accepts `type: "recipe"`; `get_bookmark` does not return the recipe yet.

Search: `recipeCard` is in `meilisearchDocumentMapper.ts`, `search/index.post.ts` and the afterSave
`SEARCH_RELEVANT_KEYS`. Older app builds decode an unknown `type` as a website, so the order is backend first.

Tests: `npm run test:recipe` (JSON-LD parser), `npm run test:recipeModel` (shape, card, apply),
`npm run test:enrichmentMessages`, `npm run test:jevJudgments`.
