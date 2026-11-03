#!/usr/bin/env node
// The admin page's registry (apps/api) says which settings Parse reads; Parse keeps its own
// allow-list (apps/parse/src/settings.js) so a compromised database can't set arbitrary variables.
// The two files are in separate Docker build contexts and can't share code, so CI checks they agree.
import { readFileSync } from 'node:fs';

const registry = readFileSync(new URL('../apps/api/server/utils/settings/registry.ts', import.meta.url), 'utf8');
const fromRegistry = [...registry.matchAll(/key: '([A-Z0-9_]+)'[^}]*?parse: true/g)].map((m) => m[1]).sort();

const parse = readFileSync(new URL('../apps/parse/src/settings.js', import.meta.url), 'utf8');
const block = parse.match(/const ALLOWED_KEYS = \[([\s\S]*?)\];/)[1];
const fromParse = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]).sort();

const missing = fromRegistry.filter((k) => !fromParse.includes(k));
const extra = fromParse.filter((k) => !fromRegistry.includes(k));
if (missing.length || extra.length) {
  console.error('Parse allow-list and the API registry disagree.');
  if (missing.length) console.error('  marked parse: true but not allowed in Parse:', missing.join(', '));
  if (extra.length) console.error('  allowed in Parse but not marked parse: true:', extra.join(', '));
  process.exit(1);
}
console.log(`ok: ${fromParse.length} settings shared with Parse`);
