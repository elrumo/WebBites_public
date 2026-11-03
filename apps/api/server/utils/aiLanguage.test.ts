/**
 * The only branch worth pinning: an unset or unknown `aiLanguage` must read as
 * English, and 'same' must become the phrase — not the literal word "same",
 * which would ask the model to answer in a language called "same".
 *
 *   npm run test:aiLanguage
 */
import assert from 'node:assert';
import { aiLanguageName, contentLanguageName, DEFAULT_AI_LANGUAGE } from './aiLanguage.js';

assert.equal(aiLanguageName('es-ES'), 'Spanish');
assert.equal(aiLanguageName('ja'), 'Japanese');
assert.equal(aiLanguageName('es-419'), 'Latin American Spanish');
assert.equal(aiLanguageName('fr'), 'French');
assert.equal(aiLanguageName('de'), 'German');
assert.equal(aiLanguageName('same'), 'the same language as the content');
assert.equal(aiLanguageName(undefined), DEFAULT_AI_LANGUAGE);
assert.equal(aiLanguageName('kl'), DEFAULT_AI_LANGUAGE);
assert.equal(DEFAULT_AI_LANGUAGE, 'English');

// 'same' follows the page's language once it is known; a named language never does.
assert.equal(aiLanguageName('same', 'de'), 'German');
assert.equal(aiLanguageName('same', 'xx'), 'the same language as the content');
assert.equal(aiLanguageName('same', 'constructor'), 'the same language as the content');
assert.equal(aiLanguageName('ja', 'de'), 'Japanese');
assert.equal(contentLanguageName('fr'), 'French');
assert.equal(contentLanguageName(undefined), undefined);

console.log('aiLanguage: ok');
