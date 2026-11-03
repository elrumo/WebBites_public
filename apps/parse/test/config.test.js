// node test/config.test.js
// Loads src/config.js in a child process with a controlled environment, so nothing from the
// machine running the test (real S3 or mail credentials, for instance) can leak in.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n       ${detail}` : ''}`);
};

const BASE = {
  PARSE_APP_ID: 'app',
  PARSE_JS_KEY: 'js',
  PARSE_MASTER_KEY: 'master',
  DATABASE_URI: 'mongodb://127.0.0.1:27017/parse',
  PARSE_PUBLIC_URL: 'https://example.com/parse/',
};

function load(env, expr = 'JSON.stringify(c)') {
  const result = spawnSync(process.execPath, ['-e', `const c = require('./src/config'); console.log(${expr})`], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: 'utf8',
  });
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr };
}

// --- required values fail loudly -------------------------------------------------------------
for (const name of Object.keys(BASE)) {
  const env = { ...BASE };
  delete env[name];
  const r = load(env);
  check(`${name} is required`, !r.ok && r.err.includes(`Missing required environment variable ${name}`), r.err.split('\n').slice(-3).join(' '));
}

// --- defaults for a minimal install ----------------------------------------------------------
{
  const r = load(BASE, "JSON.stringify({ips: c.masterKeyIps, trust: c.trustProxy, files: !!c.filesAdapter, cache: !!c.cacheAdapter, email: !!c.emailAdapter, lq: c.liveQuery.redisURL || null, pub: c.publicServerURL, rest: c.restAPIKey, create: c.allowClientClassCreation, apple: !!c.auth})");
  const c = r.ok ? JSON.parse(r.out) : {};
  check('a minimal config loads', r.ok, r.err);
  check('master key is limited to private networks by default', Array.isArray(c.ips) && !c.ips.includes('0.0.0.0/0') && c.ips.includes('172.16.0.0/12'));
  check('the proxy is trusted for one hop', c.trust === 1);
  check('files default to GridFS (an adapter object, not S3)', c.files === true);
  check('no Redis means no cache adapter and no LiveQuery Redis', c.cache === false && c.lq === null);
  check('no mailer means no email adapter (password reset answers honestly)', c.email === false);
  check('the public URL loses its trailing slash', c.pub === 'https://example.com/parse');
  check('REST key defaults to the JS key', c.rest === 'js');
  check('clients cannot create classes on their own', c.create === false);
  check('Apple sign-in is off unless configured', c.apple === false);
}

// --- files -----------------------------------------------------------------------------------
{
  const r = load({ ...BASE, S3_BUCKET: 'b' });
  check('S3_BUCKET alone selects S3 and then demands the rest', !r.ok && r.err.includes('S3_PUBLIC_URL'));
  const ok = load({ ...BASE, S3_BUCKET: 'b', S3_PUBLIC_URL: 'https://example.com/s3/', S3_ENDPOINT_URL: 'http://rustfs:9000', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' },
    'c.filesAdapter._baseUrl');
  check('S3 file URLs are <public url>/<bucket>/<prefix>', ok.ok && ok.out === 'https://example.com/s3/b/parse', ok.err || ok.out);
  const forced = load({ ...BASE, S3_BUCKET: 'b', FILES_DRIVER: 'gridfs' }, 'c.filesAdapter.constructor.name');
  check('FILES_DRIVER=gridfs wins over S3_BUCKET', forced.ok && /GridFS/.test(forced.out), forced.err || forced.out);
  const bad = load({ ...BASE, FILES_DRIVER: 'ftp' });
  check('an unknown FILES_DRIVER is rejected', !bad.ok && bad.err.includes('Unknown FILES_DRIVER'));
}

// --- mail ------------------------------------------------------------------------------------
{
  const smtp = load({ ...BASE, SMTP_HOST: 'smtp.example.com', SITE_URL: 'https://wb.example.com' }, 'JSON.stringify({sender: c.emailAdapter && c.emailAdapter.options.sender})');
  check('SMTP_HOST turns the email adapter on, with a from address on the site host', smtp.ok && JSON.parse(smtp.out).sender === 'WebBites <noreply@wb.example.com>', smtp.err || smtp.out);
  const named = load({ ...BASE, SMTP_HOST: 'h', MAIL_FROM: 'Me <me@x.io>' }, 'c.emailAdapter.options.sender');
  check('MAIL_FROM overrides the sender', named.out === 'Me <me@x.io>', named.err || named.out);
  const none = load({ ...BASE, MAIL_PROVIDER: 'none', SMTP_HOST: 'h' }, '!!c.emailAdapter');
  check('MAIL_PROVIDER=none switches mail off even when SMTP is set', none.out === 'false', none.err || none.out);
}

// --- redis and apple -------------------------------------------------------------------------
{
  const r = load({ ...BASE, REDIS_CACHE_URL: 'redis://redis:6379/0', REDIS_LIVEQUERY_URL: 'redis://redis:6379/1', APPLE_CLIENT_IDS: 'a.b, c.d' },
    "JSON.stringify({cache: !!c.cacheAdapter, lq: c.liveQuery.redisURL, apple: c.auth && c.auth.apple.clientId})");
  const c = r.ok ? JSON.parse(r.out) : {};
  check('Redis URLs switch the cache and LiveQuery Redis on', c.cache === true && c.lq === 'redis://redis:6379/1', r.err);
  check('Apple client ids are split and trimmed', JSON.stringify(c.apple) === '["a.b","c.d"]', r.err);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
