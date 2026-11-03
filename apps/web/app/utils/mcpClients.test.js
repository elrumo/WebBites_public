// node app/utils/mcpClients.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MCP_CLIENTS, LOCAL_MCP, stepText } from './mcpClients.js';
import { MCP_URL } from './devApi.js';

const LOCALES = ['en', 'es', 'es-419', 'ca', 'zh', 'ja', 'ko', 'fr', 'de'];
const messages = Object.fromEntries(LOCALES.map(code => [
  code,
  JSON.parse(readFileSync(new URL(`../../i18n/locales/${code}.json`, import.meta.url), 'utf8')),
]));
const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();

// Each step's prose lives twice — `text` for the English-only docs, the locale
// files for Settings — so the English copies must agree, and every language
// must have the step with the same placeholders.
for (const client of MCP_CLIENTS) {
  for (const step of client.steps) {
    assert.equal(messages.en.settings.assistants.clients[client.id]?.[step.key], step.text, `${client.id}.${step.key} drifted from en.json`);
    for (const code of LOCALES) {
      const message = messages[code].settings.assistants.clients[client.id]?.[step.key];
      assert.ok(message, `${code} is missing ${client.id}.${step.key}`);
      assert.deepEqual(placeholders(message), placeholders(step.text), `${code} ${client.id}.${step.key} placeholders`);
    }
  }
  // Settings translates the names that aren't an app's own.
  if (client.generic) {
    for (const code of LOCALES) assert.ok(messages[code].settings.assistants.clients[client.id]?.name, `${code} is missing ${client.id}.name`);
  }
}

// Every placeholder a step uses is filled from its entry.
for (const client of MCP_CLIENTS) {
  for (const step of client.steps) assert.doesNotMatch(stepText(step, client), /\{(path|file)\}/, `${client.id}.${step.key}`);
}

// The JSON snippets people paste into config files have to parse.
const snippets = [...MCP_CLIENTS.flatMap(c => c.steps.flatMap(s => s.snippets || [])), ...LOCAL_MCP.snippets];
for (const snippet of snippets.filter(s => s.language === 'json')) assert.doesNotThrow(() => JSON.parse(snippet.code), snippet.label);

// And the hosted ones all point at the one server.
for (const snippet of MCP_CLIENTS.flatMap(c => c.steps.flatMap(s => s.snippets || [])).filter(s => s.label !== 'Header')) {
  assert.ok(snippet.code.includes(MCP_URL), snippet.label);
}

console.log('mcpClients: ok');
