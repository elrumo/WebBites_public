/**
 * Run: npm run test:recipe
 *
 * A page's schema.org Recipe JSON-LD becomes the stored recipe: durations,
 * @graph, the several shapes of image / yield / instructions, and the pages
 * that have no recipe at all.
 */
import { durationMinutes, recipeFromHtml } from './recipeJsonLd';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) pass++; else { fail++; console.log(`FAIL: ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};
const page = (json: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;

// Durations
check('PT1H30M', durationMinutes('PT1H30M') === 90);
check('PT45M', durationMinutes('PT45M') === 45);
check('P0DT20M', durationMinutes('P0DT20M') === 20);
check('P1DT2H', durationMinutes('P1DT2H') === 1560);
check('PT0M is nothing', durationMinutes('PT0M') === null);
check('garbage is nothing', durationMinutes('1 hour') === null && durationMinutes(undefined) === null);

// A full recipe inside @graph, with HTML in the strings
{
    const r = recipeFromHtml(page({
        '@context': 'https://schema.org',
        '@graph': [
            { '@type': 'WebSite', name: 'Site' },
            {
                '@type': ['Recipe', 'Thing'],
                name: 'Panellets &amp; coffee',
                description: '<p>Little <b>almond</b> cakes.</p>',
                image: [{ '@type': 'ImageObject', url: 'https://x.test/a.jpg' }],
                author: { '@type': 'Person', name: 'Ana' },
                recipeYield: ['24', '24 panellets'],
                prepTime: 'PT30M',
                cookTime: 'PT15M',
                recipeCuisine: ['Catalan', 'Spanish'],
                recipeIngredient: ['250 g almond flour', '200 g sugar', ' '],
                recipeInstructions: [
                    { '@type': 'HowToSection', name: 'Dough', itemListElement: [{ '@type': 'HowToStep', text: 'Mix.' }, { '@type': 'HowToStep', text: 'Rest.' }] },
                    { '@type': 'HowToStep', text: 'Bake &amp; cool.' },
                ],
            },
        ],
    }), 'https://x.test/p')!;
    check('graph: found', !!r);
    check('title decoded', r.title === 'Panellets & coffee', r.title);
    check('description stripped', r.description === 'Little almond cakes.', r.description);
    check('image from ImageObject', r.image === 'https://x.test/a.jpg');
    check('author name', r.author === 'Ana');
    check('yield prefers the descriptive one', r.yield === '24 panellets', r.yield);
    check('minutes and summed total', r.prepMinutes === 30 && r.cookMinutes === 15 && r.totalMinutes === 45);
    check('cuisine joined', r.cuisine === 'Catalan, Spanish');
    check('blank ingredient dropped', r.ingredients.length === 1 && r.ingredients[0].items.length === 2);
    check('sections kept, loose steps after', r.steps.length === 2 && r.steps[0].title === 'Dough' && r.steps[0].items.join() === 'Mix.,Rest.' && r.steps[1].items[0] === 'Bake & cool.', r.steps);
    check('source and url', r.source === 'jsonld' && r.sourceUrl === 'https://x.test/p');
}

// A bare number is servings; a string of instructions splits on lines; top-level array of nodes
{
    const r = recipeFromHtml(page([{ '@type': 'Article' }, { '@type': 'Recipe', name: 'Toast', recipeYield: 2, image: 'https://x.test/t.png', recipeIngredient: ['bread', 'butter'], recipeInstructions: 'Toast the bread.\nButter it.', totalTime: 'PT5M' }]))!;
    check('numeric yield', r.yield === '2 servings', r.yield);
    check('string instructions split', r.steps[0].items.length === 2, r.steps);
    check('image string, total as given', r.image === 'https://x.test/t.png' && r.totalMinutes === 5);
}

// Not a recipe: other types, broken JSON, no script, a Recipe with nothing in it
check('article only', recipeFromHtml(page({ '@type': 'Article', name: 'x' })) === null);
check('broken json skipped, next script read', (() => {
    const html = `<script type="application/ld+json">{oops</script>${page({ '@type': 'Recipe', name: 'Ok', recipeIngredient: ['a', 'b'], recipeInstructions: ['c'] })}`;
    return recipeFromHtml(html)?.title === 'Ok';
})());
check('no script', recipeFromHtml('<html><body>hello</body></html>') === null);
check('empty recipe node', recipeFromHtml(page({ '@type': 'Recipe', name: 'Hollow' })) === null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
