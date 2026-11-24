// node app/utils/recipe.test.js
import assert from 'node:assert/strict';
import { formatMinutes, recipeFromForm, recipeOf, sectionsToText, textToSections } from './recipe.js';

// "Name:" lines start a group; lines before one are ungrouped; blanks are dropped.
const sections = textToSections('2 eggs\n\nFor the sauce:\n1 cup milk\n  salt  ');
assert.deepEqual(sections, [
  { title: '', items: ['2 eggs'] },
  { title: 'For the sauce', items: ['1 cup milk', 'salt'] },
]);
// Round trip through the edit form.
assert.deepEqual(textToSections(sectionsToText(sections)), sections);
// A heading with nothing under it is not kept.
assert.deepEqual(textToSections('Sauce:'), []);

assert.equal(formatMinutes(45), '45 min');
assert.equal(formatMinutes(90), '1 h 30 min');
assert.equal(formatMinutes(120, { h: 'Std.', m: 'Min.' }), '2 Std.');
assert.equal(formatMinutes(null), '');

// The form's recipe: total is prep + cook, junk numbers become null, source is manual.
const made = recipeFromForm({ title: ' Pancakes ', prepMinutes: '10', cookMinutes: 'abc', ingredients: 'flour', steps: 'mix', sourceUrl: 'nope' });
assert.equal(made.source, 'manual');
assert.equal(made.title, 'Pancakes');
assert.equal(made.totalMinutes, 10);
assert.equal(made.cookMinutes, null);
assert.equal(made.sourceUrl, '');

// Editing keeps what the form has no field for, and a total time it was not given parts of.
const edited = recipeFromForm({ title: 'Soup', ingredients: 'water' }, { source: 'jsonld', author: 'Ana', totalMinutes: 30 });
assert.equal(edited.source, 'jsonld');
assert.equal(edited.author, 'Ana');
assert.equal(edited.totalMinutes, 30);

// A row with no recipe yet (still extracting) normalises to null; a JSON string column is read too.
assert.equal(recipeOf({ type: 'recipe' }), null);
assert.equal(recipeOf({ recipe: { ingredients: [], steps: [] } }), null);
const read = recipeOf({ siteTitle: 'Soup', recipe: JSON.stringify({ source: 'jsonld', ingredients: [{ title: '', items: ['water'] }], steps: [] }) });
assert.equal(read.title, 'Soup');
assert.deepEqual(read.ingredients, [{ title: '', items: ['water'] }]);
console.log('recipe: ok');
