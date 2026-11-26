#!/usr/bin/env node
// Guards deploy/docker-compose.yml against two ways settings go wrong. Needs `docker compose` (v2),
// no images and no running Docker daemon.
//
// 1. Compose resolves ${VAR} from the shell BEFORE .env, so a developer's exported S3_BUCKET or
//    SENTRY_DSN used to replace what .env said (and leak into the containers). Optional settings now
//    come in through `env_file`, which the shell cannot override. This renders a fresh install.sh .env
//    clean and again with every setting name exported in the shell, and fails if anything differs.
//    SHELL_SENSITIVE lists the names Compose itself still interpolates (generated secrets, image tag,
//    ports); growing that list needs a reason.
// 2. Every service sees the whole .env through env_file, so each blanks the secrets it must not have.
//    EXPECTED_SECRET_HOLDERS says who may see which secret (docs/configuration.md); a new secret in
//    .env.example has to be added here, which is the moment to decide.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHELL_SENSITIVE = new Set([
  'PUBLIC_URL', 'SITE_ADDRESS', 'HTTP_PORT', 'HTTPS_PORT', 'WEBBITES_VERSION', 'COMPOSE_PROFILES',
  'PARSE_APP_ID', 'PARSE_JS_KEY', 'PARSE_MASTER_KEY', 'CUSTOM_API_KEY', 'MEILI_MASTER_KEY',
  'AUDIO_TOKEN_SECRET', 'MONGO_PASSWORD', 'SCREENSHOT_API_KEY', 'SCREENSHOT_CONCURRENCY',
  'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY',
  'S3_BUCKET', // only the rustfs-init job (profile rustfs) falls back to it
]);

const EXPECTED_SECRET_HOLDERS = {
  MONGO_PASSWORD: ['mongo', 'parse'],
  PARSE_JS_KEY: ['web', 'api', 'parse'],
  PARSE_MASTER_KEY: ['web', 'api', 'parse'],
  CUSTOM_API_KEY: ['web', 'api', 'parse'],
  AUDIO_TOKEN_SECRET: ['api'],
  SHARE_LINK_SECRET: ['api'],
  BACKUP_ENCRYPTION_KEY: ['api'],
  SETTINGS_ENCRYPTION_KEY: ['api', 'parse'],
  MEILI_MASTER_KEY: ['meilisearch', 'api'],
  SCREENSHOT_API_KEY: ['screenshot', 'api'],
  RUSTFS_ACCESS_KEY: ['rustfs', 'rustfs-init'],
  RUSTFS_SECRET_KEY: ['rustfs', 'rustfs-init'],
  SMTP_PASS: ['api', 'parse'],
  S3_ACCESS_KEY: ['api', 'parse'],
  S3_SECRET_KEY: ['api', 'parse'],
  SENTRY_DSN: ['api', 'parse'],
  AI_API_KEY: ['api'],
  TMDB_API_KEY: ['web', 'api'],
  TWITCH_CLIENT_SECRET: ['web', 'api'],
};

const deploy = new URL('../deploy/', import.meta.url).pathname;
const example = readFileSync(deploy + '.env.example', 'utf8');
const compose = readFileSync(deploy + 'docker-compose.yml', 'utf8');
const names = [...new Set([
  ...[...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  ...[...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
])];

const failures = [];
const fail = (msg) => failures.push(msg);

// Only PATH and HOME: nothing from the caller's shell gets in unless a check adds it.
const render = (cwd, extra = {}) => JSON.parse(execFileSync('docker', ['compose', '--profile', '*', 'config', '--format', 'json'],
  { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }));

const work = mkdtempSync(join(tmpdir(), 'wb-compose-'));
try {
  const folder = (name, installArgs) => {
    const dir = join(work, name);
    execFileSync('mkdir', [dir]);
    for (const f of ['docker-compose.yml', 'Caddyfile', 'install.sh', '.env.example']) copyFileSync(deploy + f, join(dir, f));
    execFileSync('sh', ['install.sh', '--yes', '--domain', 'localhost', ...installArgs], { cwd: dir, stdio: 'ignore' });
    return dir;
  };

  // 1. The shell cannot change what a stock install renders.
  for (const [name, args] of [['plain', []], ['rustfs', ['--rustfs']]]) {
    const dir = folder(name, args);
    const polluted = Object.fromEntries(names.filter((n) => !SHELL_SENSITIVE.has(n)).map((n) => [n, `polluted-${n}`]));
    const clean = JSON.stringify(render(dir));
    if (JSON.stringify(render(dir, polluted)) !== clean) {
      const bad = names.filter((n) => !SHELL_SENSITIVE.has(n) && JSON.stringify(render(dir, { [n]: polluted[n] })) !== clean);
      fail(`${name}: an exported shell variable changes the rendered config: ${bad.join(', ') || '(only in combination)'}`);
    }
    // The values that still can be overridden must at least be the ones listed.
    for (const n of SHELL_SENSITIVE) if (!names.includes(n)) fail(`SHELL_SENSITIVE lists ${n}, which neither .env.example nor the compose file uses`);
  }

  // 2. Each secret reaches only the services that need it.
  const dir = folder('secrets', ['--rustfs']);
  const secretKeys = names.filter((n) => /(KEY|SECRET|PASS|PASSWORD|DSN)$/.test(n));
  for (const n of secretKeys) if (!EXPECTED_SECRET_HOLDERS[n]) fail(`${n} looks like a secret but EXPECTED_SECRET_HOLDERS does not say who may see it`);
  for (const n of Object.keys(EXPECTED_SECRET_HOLDERS)) if (!names.includes(n)) fail(`EXPECTED_SECRET_HOLDERS lists ${n}, which is not a setting any more`);
  appendFileSync(join(dir, '.env'), Object.keys(EXPECTED_SECRET_HOLDERS).map((n) => `\n${n}=SENTINEL_${n}`).join('') + '\n');
  const services = render(dir).services;
  for (const [n, allowed] of Object.entries(EXPECTED_SECRET_HOLDERS)) {
    const holders = Object.entries(services)
      .filter(([, s]) => Object.values(s.environment ?? {}).some((v) => String(v).includes(`SENTINEL_${n}`)))
      .map(([svc]) => svc).sort();
    if (holders.join() !== [...allowed].sort().join()) fail(`${n} reaches [${holders}] but should reach [${[...allowed].sort()}]`);
  }

  // 3. A missing required value still stops with a message that names it.
  for (const n of ['PARSE_MASTER_KEY', 'MONGO_PASSWORD']) {
    execFileSync('sh', ['-c', `grep -v '^${n}=' .env > .env.missing`], { cwd: dir });
    try {
      execFileSync('docker', ['compose', '--env-file', '.env.missing', 'config', '--quiet'],
        { cwd: dir, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
      fail(`${n} missing from .env was not reported`);
    } catch (e) {
      if (!String(e.stderr).includes(n)) fail(`${n} missing from .env gave an error that does not name it: ${String(e.stderr).trim()}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error('docker-compose.yml settings check failed:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`ok: ${names.length} settings checked; shell cannot override .env except ${SHELL_SENSITIVE.size} Compose-level names; ${Object.keys(EXPECTED_SECRET_HOLDERS).length} secrets scoped`);
