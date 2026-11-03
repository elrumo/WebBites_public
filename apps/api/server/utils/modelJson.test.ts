/**
 * Run: npm run test:modelJson
 *
 * Reading a text model's JSON reply, fenced or not. No network.
 */
import { parseModelJson } from './modelJson';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const json = '{"tags":["A","B"]}';
check('plain JSON', parseModelJson(json).tags.length === 2);
check('```json fence', parseModelJson('```json\n' + json + '\n```').tags[1] === 'B');
check('bare ``` fence', parseModelJson('```\n' + json + '\n```').tags[0] === 'A');
check('text around the fence', parseModelJson('Here you go:\n```json\n' + json + '\n```\nDone.').tags.length === 2);
check('truncated reply still throws', (() => { try { parseModelJson('{"tags":["A",'); return false; } catch { return true; } })());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
