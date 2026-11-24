/**
 * Run: npm run test:recipeModel
 *
 * The stored recipe: normalising untrusted input, the grid card, when a page
 * counts as a recipe, and how a recipe lands on its row.
 */
import { applyRecipe, isUsableRecipe, mentionsIngredients, normalizeRecipe, recipeCardOf, recipeText, RECIPE_LIMITS } from './recipe';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

const row = (fields: Record<string, unknown>) => {
    const data = { ...fields };
    return { data, get: (k: string) => data[k], set: (k: string, v: unknown) => { data[k] = v; } };
};

// Normalising
{
    const r = normalizeRecipe({
        title: `  ${'x'.repeat(300)} `, image: 'javascript:alert(1)', prepMinutes: '20', cookMinutes: -5, yield: 4,
        ingredients: ['flour', '', { title: 'Sauce', items: ['tomato', 7, ''] }, { title: 'Empty', items: [] }],
        steps: ['Mix', 'Bake'], notes: 'line 1\nline 2', sourceUrl: 'ftp://nope',
    }, 'manual');
    check('title capped', r.title.length === RECIPE_LIMITS.title);
    check('non-http image dropped', r.image === '');
    check('minutes coerced, negatives dropped', r.prepMinutes === 20 && r.cookMinutes === null);
    check('total falls back to prep + cook', r.totalMinutes === 20);
    check('numbers become text', r.yield === '4');
    check('loose lines group, sections kept, empties dropped', r.ingredients.length === 2 && r.ingredients[0].title === '' && r.ingredients[1].items.join() === 'tomato,7', r.ingredients);
    check('notes keep line breaks', r.notes === 'line 1\nline 2');
    check('bad source url dropped', r.sourceUrl === '');
    check('garbage in, empty recipe out', normalizeRecipe(null, 'ai').title === '' && normalizeRecipe('x', 'ai').ingredients.length === 0);
}
{
    const many = normalizeRecipe({ ingredients: [{ title: 't', items: Array.from({ length: 150 }, (_, i) => `i${i}`) }], steps: Array.from({ length: 40 }, (_, i) => ({ title: `s${i}`, items: ['x'] })) }, 'ai');
    check('items per section capped', many.ingredients[0].items.length === RECIPE_LIMITS.itemsPerSection);
    check('sections capped', many.steps.length === RECIPE_LIMITS.sections);
}

// Usable: a title, two ingredients, a step
const good = normalizeRecipe({ title: 'Toast', ingredients: ['bread', 'butter'], steps: ['Toast it'], image: 'https://x.test/t.jpg', yield: '2 slices', totalMinutes: 5 }, 'ai');
check('usable', isUsableRecipe(good));
check('one ingredient is not a recipe', !isUsableRecipe(normalizeRecipe({ title: 'T', ingredients: ['bread'], steps: ['x'] }, 'ai')));
check('no steps is not a recipe', !isUsableRecipe(normalizeRecipe({ title: 'T', ingredients: ['a', 'b'] }, 'ai')));
check('no title is not a recipe', !isUsableRecipe(normalizeRecipe({ ingredients: ['a', 'b'], steps: ['x'] }, 'ai')));

// Card and text
{
    const card = recipeCardOf(good);
    check('card', card.ingredientCount === 2 && card.stepCount === 1 && card.totalMinutes === 5 && card.yield === '2 slices' && card.image === 'https://x.test/t.jpg', card);
    check('text has title, ingredients and steps', recipeText(good) === 'Toast\nbread\nbutter\nToast it', recipeText(good));
}

// Applying to a row
{
    const web = row({ url: 'https://x.test/toast', siteTitle: 'x.test', type: 'website', subType: ['article'] });
    applyRecipe(web, good);
    check('type and subtype flip', web.data.type === 'recipe' && JSON.stringify(web.data.subType) === '["recipe"]');
    check('generic title replaced', web.data.siteTitle === 'Toast');
    check('picture filled', web.data.OGImage === 'https://x.test/t.jpg');
    check('recipe and card set', (web.data.recipe as any).title === 'Toast' && (web.data.recipeCard as any).ingredientCount === 2);

    const titled = row({ url: 'https://x.test/toast', siteTitle: 'Best Toast Ever | x.test', OGImage: 'https://x.test/og.jpg', siteDescription: 'kept' });
    applyRecipe(titled, good);
    check('real title, picture and description are kept', titled.data.siteTitle === 'Best Toast Ever | x.test' && titled.data.OGImage === 'https://x.test/og.jpg' && titled.data.siteDescription === 'kept');
    applyRecipe(titled, good, { manual: true });
    check('manual: the recipe title wins', titled.data.siteTitle === 'Toast');
}

// The pre-filter
check('ingredient words in several languages', ['Ingredients', 'Ingredientes', 'Zutaten', 'Ingrédients', '材料', '재료'].every(mentionsIngredients));
check('an ordinary article is not a candidate', !mentionsIngredients('Why the new phone is fast. It has a good screen.'));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
