/**
 * Transcribing an audio bookmark on a self-hosted install: which stored files
 * count as ours (both file drivers, and what hosted accepted before), what
 * is fetched and from where, and how it ends with no OpenAI key.
 *
 * Parse is stubbed at `Query.get` / `Object.save`, `fetch` is recorded. Nothing
 * leaves the process.
 *
 * Run with:  npm run test:audioTranscription
 */

import Parse from 'parse/node.js';

process.env.VITE_PARSE_ID = 'app';
process.env.VITE_PARSE_JS_KEY = 'js';
process.env.VITE_PARSE_MASTER_KEY = 'master';
process.env.VITE_PARSE_URL = 'http://parse:1337/parse';
delete process.env.BILLING_PROVIDER; // self-hosted default: unlimited

import { ownStorageURL } from './clientMetadata';
import { transcribeAudioBookmark } from './audioTranscription';

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
    if (got === want) pass++; else { fail++; console.log(`FAIL: ${label}\n  got  ${got}\n  want ${want}`); }
};
const env = (vars: Record<string, string>) => {
    for (const k of ['SITE_URL', 'VITE_WEBSITE_URL', 'S3_PUBLIC_URL', 'S3_ENDPOINT_URL', 'STORAGE_LEGACY_HOSTS', 'OPENAI_API_KEY', 'OPENAI_API_AUDIO_KEY']) delete process.env[k];
    Object.assign(process.env, vars);
};

// ── ownStorageURL ────────────────────────────────────────────────────────────
env({ SITE_URL: 'http://localhost:8080' });
eq('gridfs, localhost', ownStorageURL('http://localhost:8080/parse/files/app/n.m4a'), 'http://localhost:8080/parse/files/app/n.m4a');
eq('gridfs, other path', ownStorageURL('http://localhost:8080/parse/classes/_User'), undefined);
eq('gridfs, .. out of /files', ownStorageURL('http://localhost:8080/parse/files/../classes/_User'), undefined);
eq('gridfs, look-alike host', ownStorageURL('http://localhost:8080.evil.test/parse/files/app/n.m4a'), undefined);
eq('gridfs, userinfo', ownStorageURL('http://localhost:8080@evil.test/parse/files/app/n.m4a'), undefined);
eq('gridfs, other port', ownStorageURL('http://localhost:9090/parse/files/app/n.m4a'), undefined);
eq('gridfs, not a URL', ownStorageURL('not a url'), undefined);
eq('gridfs, not a string', ownStorageURL(undefined), undefined);

env({ SITE_URL: 'https://wb.example.com', S3_PUBLIC_URL: 'https://wb.example.com/s3/', S3_ENDPOINT_URL: 'http://rustfs:9000', STORAGE_LEGACY_HOSTS: 'old.example.net' });
eq('s3 public URL', ownStorageURL('https://wb.example.com/s3/webbites/parse/n.m4a'), 'https://wb.example.com/s3/webbites/parse/n.m4a');
eq('s3, sibling path', ownStorageURL('https://wb.example.com/s3other/webbites/n.m4a'), undefined);
eq('legacy host', ownStorageURL('https://old.example.net/webbites/n.m4a'), 'https://old.example.net/webbites/n.m4a');
eq('legacy host, look-alike', ownStorageURL('https://old.example.net.evil.test/webbites/n.m4a'), undefined);
eq('unrelated external', ownStorageURL('https://evil.example.org/n.m4a'), undefined);
eq('webbites.io host, as before', ownStorageURL('https://s3.webbites.io/b/n.m4a'), 'https://s3.webbites.io/b/n.m4a');
eq('webbites.io look-alike, as before', ownStorageURL('https://s3.webbites.io.evil.test/b/n.m4a'), undefined);

// Hosted: Parse is a real hostname and S3 is only what is configured; nothing new is accepted.
env({ SITE_URL: 'https://webbites.io', S3_PUBLIC_URL: 'https://s3.webbites.io' });
process.env.VITE_PARSE_URL = 'https://parse.webbites.io/parse';
eq('hosted: parse file prefix is not ours', ownStorageURL('https://webbites.io/parse/files/app/n.m4a'), undefined);
eq('hosted: s3 host', ownStorageURL('https://s3.webbites.io/b/n.m4a'), 'https://s3.webbites.io/b/n.m4a');
env({ SITE_URL: 'https://webbites.io' });
eq('hosted: nothing configured, s3 host still accepted', ownStorageURL('https://s3.webbites.io/b/n.m4a'), 'https://s3.webbites.io/b/n.m4a');
process.env.VITE_PARSE_URL = 'http://parse:1337/parse';

// ── transcribeAudioBookmark ──────────────────────────────────────────────────
const saved: Record<string, any>[] = [];
const fetched: string[] = [];
let row: Parse.Object;

(Parse.Query.prototype as any).get = async function () {
    return this.className === '_User' || this.className === 'User' ? new Parse.User() : row;
};
(Parse.Object.prototype as any).save = async function () { saved.push({ ...this.attributes }); return this; };
(globalThis as any).fetch = async (url: any) => { fetched.push(String(url)); return new Response('nope', { status: 404 }); };

const run = async (fileUrl: string) => {
    saved.length = 0; fetched.length = 0;
    row = new Parse.Object('websites');
    row.set('fileUrl', fileUrl);
    await transcribeAudioBookmark('w1', 'u1');
    return { status: saved.at(-1)?.transcriptStatus, fetched: [...fetched] };
};
const audio = 'http://localhost:8080/parse/files/app/n.m4a';

env({ SITE_URL: 'http://localhost:8080' });
let r = await run(audio);
eq('no OpenAI key: failed, cleanly', r.status, 'failed');
eq('no OpenAI key: nothing fetched', r.fetched.length, 0);

env({ SITE_URL: 'http://localhost:8080', OPENAI_API_KEY: 'sk-test' });
r = await run(audio);
eq('gridfs audio is fetched by the in-network address', r.fetched[0], 'http://parse:1337/parse/files/app/n.m4a');
eq('unreadable file: failed, no throw', r.status, 'failed');
eq('unlimited plan: not marked quota', r.status === 'quota', false);

r = await run('https://evil.example.org/n.m4a');
eq('foreign URL is never fetched', r.fetched.length, 0);
eq('foreign URL: failed', r.status, 'failed');
r = await run('http://127.0.0.1:7700/indexes');
eq('loopback URL is never fetched', r.fetched.length, 0);

env({ SITE_URL: 'http://localhost:8080', OPENAI_API_KEY: 'sk-test', S3_PUBLIC_URL: 'http://localhost:8080/s3', S3_ENDPOINT_URL: 'http://rustfs:9000' });
r = await run('http://localhost:8080/s3/webbites/parse/n.m4a');
eq('s3 audio is fetched by the in-network address', r.fetched[0], 'http://rustfs:9000/webbites/parse/n.m4a');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
