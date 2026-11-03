// Writes apps/parse/test/fixtures/api-encrypted.json: a value encrypted by the API's code, which
// Parse's settings test decrypts with its own. Run once (bun run settings:fixture); the file is committed.
import { writeFileSync } from 'node:fs';
import { encryptSetting } from '../server/utils/settings/crypto';

const key = 'a'.repeat(64);
const plain = 'from-the-api ✓';
const out = new URL('../../parse/test/fixtures/api-encrypted.json', import.meta.url);
writeFileSync(out, JSON.stringify({ key, plain, cipher: encryptSetting(plain, key) }, null, 2) + '\n');
console.log('wrote', out.pathname);
