/**
 * Run: npm run test:settings
 *
 * Encryption (and that Parse reads what the API writes), the field registry, precedence between the
 * environment and stored settings, and the connection tests against small stand-in servers.
 */
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { encryptSetting, decryptSetting, isEncrypted } from './crypto';
import { FIELDS, GROUPS, PARSE_KEYS, validateChanges, restartNeeded, fieldByKey } from './registry';
import { applyRows, captureEnvOrigin, resetApplyState, sourceOf } from './apply';
import { testAi, testScreenshots, testSearch, testStorage, testMail } from './connectionTests';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.error(`  FAIL ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

const KEY = 'a'.repeat(64);

function serve(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as net.AddressInfo;
            resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
        });
    });
}

async function main() {
    console.log('crypto');
    const c = encryptSetting('p@ss wörd', KEY);
    check('round trip', decryptSetting(c, KEY) === 'p@ss wörd' && isEncrypted(c) && !c.includes('wörd'));
    check('fresh IV every time', encryptSetting('x', KEY) !== encryptSetting('x', KEY));
    check('wrong key refused', throws(() => decryptSetting(c, 'b'.repeat(64))));
    check('tampering refused', throws(() => decryptSetting(c.slice(0, -4) + 'AAAA', KEY)));
    check('refuses to encrypt without a key', throws(() => encryptSetting('x', '')));
    check('Parse wrote-compatible fixture decrypts here', (() => {
        const f = JSON.parse(readFileSync(new URL('../../../../parse/test/fixtures/api-encrypted.json', import.meta.url), 'utf8'));
        return decryptSetting(f.cipher, f.key) === f.plain;
    })());

    console.log('registry');
    check('every field belongs to a group', FIELDS.every((f) => GROUPS.some((g) => g.id === f.group)));
    check('keys are unique', new Set(FIELDS.map((f) => f.key)).size === FIELDS.length);
    check('selects have options', FIELDS.filter((f) => f.kind === 'select').every((f) => (f.options?.length ?? 0) > 1));
    check('only the intended keys are shared with Parse', PARSE_KEYS.includes('SMTP_PASS') && PARSE_KEYS.includes('S3_BUCKET') && !PARSE_KEYS.includes('AI_API_KEY'));
    check('nothing sensitive to the process itself can be set', !FIELDS.some((f) => /^(NODE_|PARSE_MASTER|DATABASE|VITE_PARSE|CUSTOM_API|SETTINGS_|REDIS)/.test(f.key)));

    console.log('validation');
    const v = validateChanges({ SMTP_HOST: ' smtp.example.com ', SMTP_PORT: '587', SMTP_SECURE: 'false', AI_API_BASE_URL: 'https://api.example.com', SMTP_USER: '' });
    check('trims and accepts valid values', v.ok && v.values.SMTP_HOST === 'smtp.example.com' && v.values.SMTP_PORT === '587');
    check('a blank value removes the setting', v.values.SMTP_USER === null);
    check('unknown names are refused', !validateChanges({ NODE_OPTIONS: '--evil' }).ok && !validateChanges({ PARSE_MASTER_KEY: 'x' }).ok);
    check('bad number', !validateChanges({ SMTP_PORT: 'abc' }).ok && !validateChanges({ SMTP_PORT: '70000' }).ok && !validateChanges({ SMTP_PORT: '1.5' }).ok);
    check('bad select', !validateChanges({ MAIL_PROVIDER: 'carrier-pigeon' }).ok);
    check('bad url', !validateChanges({ AI_API_BASE_URL: 'not a url' }).ok && !validateChanges({ AI_API_BASE_URL: 'file:///etc/passwd' }).ok && !validateChanges({ S3_PUBLIC_URL: 'javascript:alert(1)' }).ok);
    check('no multi-line values', !validateChanges({ APP_NAME: 'a\nSMTP_HOST=evil' }).ok);
    check('too long', !validateChanges({ APP_NAME: 'x'.repeat(501) }).ok);
    check('non-text values', !validateChanges({ APP_NAME: { a: 1 } as any }).ok);
    const need = restartNeeded(['SMTP_HOST']);
    check('mail changes restart Parse, not the API', need.parse && !need.api);
    check('search changes restart the API, not Parse', (() => { const n = restartNeeded(['MEILISEARCH_HOST']); return n.api && !n.parse; })());
    check('AI changes need no restart', (() => { const n = restartNeeded(['AI_TEXT_MODEL', 'AI_API_KEY']); return !n.api && !n.parse; })());
    check('a mixed change needs both', (() => { const n = restartNeeded(['SMTP_HOST', 'MEILISEARCH_HOST']); return n.api && n.parse; })());

    console.log('applying stored settings');
    const env: NodeJS.ProcessEnv = { SMTP_HOST: 'from-env', MAIL_FROM: '' };
    resetApplyState();
    captureEnvOrigin(env);
    let report = applyRows([
        { key: 'SMTP_HOST', value: 'stored' },
        { key: 'MAIL_FROM', value: 'Me <me@example.com>' },
        { key: 'SMTP_PASS', value: encryptSetting('secret', KEY) },
        { key: 'NODE_OPTIONS', value: '--evil' },
    ], env, KEY);
    check('the environment wins over a stored value', env.SMTP_HOST === 'from-env' && sourceOf('SMTP_HOST', env) === 'env');
    check('an empty variable counts as unset', env.MAIL_FROM === 'Me <me@example.com>' && sourceOf('MAIL_FROM', env) === 'settings');
    check('secrets are decrypted into the environment', env.SMTP_PASS === 'secret');
    check('names outside the registry are ignored', env.NODE_OPTIONS === undefined);
    check('an unset, unstored setting reports default', sourceOf('APP_NAME', env) === 'default');
    report = applyRows([{ key: 'MAIL_FROM', value: 'Me <me@example.com>' }], env, KEY);
    check('removing a stored setting restores the default', env.SMTP_PASS === undefined && report.removed.includes('SMTP_PASS'));
    check('removing never touches what the environment set', env.SMTP_HOST === 'from-env');
    report = applyRows([{ key: 'SMTP_PASS', value: encryptSetting('x', 'c'.repeat(64)) }], env, KEY);
    check('a secret that cannot be decrypted is reported, not applied', report.failed.length === 1 && env.SMTP_PASS === undefined);

    console.log('connection tests');
    // AI
    const seen: string[] = [];
    const ai = await serve((req, res) => {
        seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
        if (req.headers.authorization !== 'Bearer good') { res.writeHead(401).end('{}'); return; }
        if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}'); return; }
        if (req.url === '/v1/chat/completions') {
            let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
                const model = JSON.parse(body).model;
                if (model === 'missing') res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"model not found"}}');
                else res.writeHead(200, { 'content-type': 'application/json' }).end('{"choices":[{"message":{"content":"OK"}}]}');
            });
            return;
        }
        res.writeHead(404).end();
    });
    check('AI: no address', !(await testAi({})).ok);
    check('AI: wrong key', /rejected the API key/.test((await testAi({ AI_API_BASE_URL: ai.url, AI_API_KEY: 'bad' })).message));
    check('AI: reachable, model not given', (await testAi({ AI_API_BASE_URL: ai.url, AI_API_KEY: 'good' })).ok);
    check('AI: model works', (await testAi({ AI_API_BASE_URL: ai.url, AI_API_KEY: 'good', AI_TEXT_MODEL: 'gpt-x' })).ok);
    const missing = await testAi({ AI_API_BASE_URL: ai.url, AI_API_KEY: 'good', AI_TEXT_MODEL: 'missing' });
    check('AI: unknown model reports why', !missing.ok && /model not found/.test(missing.message));
    check('AI: a trailing slash on the address is fine', (await testAi({ AI_API_BASE_URL: `${ai.url}/`, AI_API_KEY: 'good' })).ok);
    check('AI: unreachable', !(await testAi({ AI_API_BASE_URL: 'http://127.0.0.1:1', AI_API_KEY: 'good' })).ok);
    ai.close();

    // Meilisearch
    const meili = await serve((req, res) => {
        const authed = req.headers.authorization === 'Bearer meili-key';
        if (req.url === '/health') { res.writeHead(200).end('{"status":"available"}'); return; }
        if (!authed) { res.writeHead(401).end('{}'); return; }
        if (req.url === '/stats') { res.writeHead(200).end('{}'); return; }
        if (req.url === '/version') { res.writeHead(200).end(JSON.stringify({ pkgVersion: process.env.FAKE_MEILI_VERSION || '1.12.0' })); return; }
        res.writeHead(404).end();
    });
    check('Search: accepts the key', (await testSearch({ MEILISEARCH_HOST: meili.url, MEILISEARCH_API_KEY: 'meili-key' })).ok);
    check('Search: rejects a wrong key', /rejected the API key/.test((await testSearch({ MEILISEARCH_HOST: meili.url, MEILISEARCH_API_KEY: 'nope' })).message));
    process.env.FAKE_MEILI_VERSION = '1.9.1';
    check('Search: too old a version', /too old/.test((await testSearch({ MEILISEARCH_HOST: meili.url, MEILISEARCH_API_KEY: 'meili-key' })).message));
    delete process.env.FAKE_MEILI_VERSION;
    meili.close();

    // Screenshot service
    const shots = await serve((req, res) => {
        if (req.url === '/health') { res.writeHead(200).end('{"ok":true}'); return; }
        if (req.url === '/screenshot') { res.writeHead(req.headers['x-api-key'] === 'k' ? 400 : 401).end('{}'); return; }
        res.writeHead(404).end();
    });
    check('Screenshots: right key', (await testScreenshots({ SCREENSHOT_SERVICE_URL: shots.url, SCREENSHOT_API_KEY: 'k' })).ok);
    check('Screenshots: wrong key', /rejected the API key/.test((await testScreenshots({ SCREENSHOT_SERVICE_URL: `${shots.url}/screenshot`, SCREENSHOT_API_KEY: 'x' })).message));
    shots.close();

    // Storage
    check('Storage: GridFS needs nothing', (await testStorage({ FILES_DRIVER: 'gridfs' })).ok);
    check('Storage: S3 asks for the bucket and endpoint', !(await testStorage({ FILES_DRIVER: 's3' })).ok);
    const s3 = await testStorage({ FILES_DRIVER: 's3', S3_BUCKET: 'b', S3_ENDPOINT_URL: 'http://127.0.0.1:1', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' });
    check('Storage: an unreachable endpoint is a failure with a reason', !s3.ok && s3.message.length > 0);

    // Mail
    check('Mail: nothing configured', !(await testMail({ MAIL_PROVIDER: 'none' })).ok);
    const mail = await new Promise<{ port: number; received: string[]; close: () => void }>((resolve) => {
        const received: string[] = [];
        const server = net.createServer((socket) => {
            let data = false, buf = '';
            socket.write('220 sink\r\n');
            socket.on('data', (chunk) => {
                buf += chunk.toString();
                for (const line of buf.split('\r\n').slice(0, -1)) {
                    if (data) { if (line === '.') { data = false; socket.write('250 ok\r\n'); } else received.push(line); continue; }
                    const u = line.toUpperCase();
                    if (u.startsWith('EHLO') || u.startsWith('HELO')) socket.write('250 sink\r\n');
                    else if (u === 'DATA') { data = true; socket.write('354 go\r\n'); }
                    else if (u === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
                    else socket.write('250 ok\r\n');
                }
                buf = buf.slice(buf.lastIndexOf('\r\n') + 2);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() }));
    });
    const cfg = { MAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(mail.port), SMTP_SECURE: 'false' };
    check('Mail: connects', (await testMail(cfg)).ok);
    const sent = await testMail(cfg, 'admin@example.com');
    check('Mail: sends a test message to the admin', sent.ok && mail.received.some((l) => /WebBites test email/.test(l)), sent.message);
    check('Mail: a closed port fails with a reason', !(await testMail({ ...cfg, SMTP_PORT: '1' })).ok);
    check('Mail: the candidate does not leak into the process environment', process.env.SMTP_HOST === undefined);
    mail.close();

    void fieldByKey;
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
