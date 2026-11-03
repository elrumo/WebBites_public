'use strict';
/**
 * Settings entered on the admin page, applied to this process before Parse reads its own
 * configuration.
 *
 * The API stores them in the `AppSettings` class (apps/api/server/utils/settings). Parse reads that
 * collection straight from MongoDB at start-up (not through itself: it is not running yet) and
 * puts the values into process.env, so config.js, files.js and mailer.js need no idea where a
 * value came from. Precedence: a variable set in the real environment wins, then the stored
 * setting, then the built-in default.
 *
 * Applying a change means restarting Parse: the admin page calls POST /_internal/restart
 * (src/index.js), the process exits, and Docker's restart policy brings it back.
 *
 * Safety net: a start that never reaches "listening" with a given set of settings is remembered.
 * The next start then uses the last set that did work instead of crash-looping on a typo
 * (a bad SMTP host cannot do that, but a malformed S3 URL can).
 */
const crypto = require('node:crypto');

const PREFIX = 'enc:v1:';

// The only variables settings may set. A compromised database must not be able to inject
// NODE_OPTIONS or a master key. Keep in step with the `parse` fields of
// apps/api/server/utils/settings/registry.ts (scripts/check-settings-keys.mjs checks it).
const ALLOWED_KEYS = [
  'MAIL_PROVIDER', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
  'MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_API_URL',
  'FILES_DRIVER', 'S3_BUCKET', 'S3_ENDPOINT_URL', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL',
  'APP_NAME',
];

function deriveKey(secret) {
  return crypto.createHash('sha256').update(`webbites-settings-v1:${secret}`).digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plain, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

function decrypt(value, secret) {
  if (!isEncrypted(value)) return value;
  if (!secret) throw new Error('SETTINGS_ENCRYPTION_KEY is not set');
  const [iv, tag, body] = value.slice(PREFIX.length).split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

/** Same rows in, same revision out, whatever order they came in. */
function revisionOf(rows) {
  const lines = rows.map((r) => `${r.key}=${r.value}`).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Put rows into `env` for the allowed keys that the real environment has not set.
 * Returns { applied: [keys], skipped: [{key, reason}] }. Never throws on one bad row.
 */
function applyRows(rows, env, secret) {
  const applied = [];
  const skipped = [];
  for (const row of rows) {
    if (!ALLOWED_KEYS.includes(row.key)) { skipped.push({ key: row.key, reason: 'not a setting Parse reads' }); continue; }
    if ((env[row.key] ?? '') !== '') { skipped.push({ key: row.key, reason: 'set by the environment' }); continue; }
    try {
      env[row.key] = decrypt(row.value, secret);
      applied.push(row.key);
    } catch (e) {
      skipped.push({ key: row.key, reason: `cannot be decrypted (${e.message})` });
    }
  }
  return { applied, skipped };
}

/**
 * Which rows to use at this start. `state` is the stored bookkeeping (see markStarted).
 * Pure, so it is tested without a database.
 */
function chooseRows(rows, state) {
  const revision = revisionOf(rows);
  const failed = state && state.failedRevision === revision;
  const crashedBefore = state && state.attempt && state.attempt.revision === revision && state.attempt.ok === false;
  if (failed || crashedBefore) {
    const lastGood = state.lastGood && Array.isArray(state.lastGood.rows) ? state.lastGood.rows : [];
    return {
      rows: lastGood,
      revision,
      usedLastGood: true,
      failedRevision: revision,
      lastError: `Starting with the saved settings (${revision}) did not work, so Parse is running on the previous ones.`,
    };
  }
  return { rows, revision, usedLastGood: false, failedRevision: null, lastError: null };
}

const COLLECTION = 'AppSettings';
const STATE_COLLECTION = 'WebBitesSettingsState';

let runtime = null; // { client, db, choice }

async function load(env = process.env, log = console) {
  const uri = env.DATABASE_URI;
  if (!uri) return { applied: [], skipped: [], usedLastGood: false };
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: Number(env.SETTINGS_MONGO_TIMEOUT_MS) || 20000 });
  try {
    await client.connect();
  } catch (e) {
    log.error(`[settings] cannot reach MongoDB (${e.message}); starting on the environment alone`);
    await client.close().catch(() => {});
    return { applied: [], skipped: [], usedLastGood: false };
  }
  const db = client.db();
  const rows = await db.collection(COLLECTION).find({}, { projection: { _id: 0, key: 1, value: 1 } }).toArray();
  const state = await db.collection(STATE_COLLECTION).findOne({ _id: 'state' });
  const choice = chooseRows(rows, state);
  const result = applyRows(choice.rows, env, env.SETTINGS_ENCRYPTION_KEY);

  // Remember that this start is in progress; markStarted() clears it.
  await db.collection(STATE_COLLECTION).updateOne(
    { _id: 'state' },
    { $set: {
        attempt: { revision: choice.usedLastGood ? revisionOf(choice.rows) : choice.revision, ok: false, at: new Date() },
        failedRevision: choice.failedRevision,
        lastError: choice.lastError,
        current: { revision: choice.revision, rows: choice.rows },
      } },
    { upsert: true },
  );
  runtime = { client, db, choice };
  if (result.applied.length) log.log(`[settings] applied from the admin page: ${result.applied.join(', ')}`);
  for (const s of result.skipped) if (/decrypted/.test(s.reason)) log.warn(`[settings] ${s.key}: ${s.reason}`);
  if (choice.usedLastGood) log.warn(`[settings] ${choice.lastError}`);
  return { ...result, usedLastGood: choice.usedLastGood };
}

/** Called once Parse is listening: these settings work, so they become the fallback. */
async function markStarted(log = console) {
  if (!runtime) return;
  const { db, choice } = runtime;
  try {
    const update = { 'attempt.ok': true, 'attempt.at': new Date() };
    if (!choice.usedLastGood) {
      update.lastGood = { revision: choice.revision, rows: choice.rows };
      update.lastError = null;
    }
    await db.collection(STATE_COLLECTION).updateOne({ _id: 'state' }, { $set: update }, { upsert: true });
  } catch (e) {
    log.warn(`[settings] could not record a good start: ${e.message}`);
  }
}

/** What the admin page shows. */
async function status() {
  if (!runtime) return { usedLastGood: false, lastError: null };
  const state = await runtime.db.collection(STATE_COLLECTION).findOne({ _id: 'state' });
  return {
    revision: runtime.choice.revision,
    usedLastGood: runtime.choice.usedLastGood,
    lastError: (state && state.lastError) || null,
  };
}

/** "Try the saved settings again": forget that this revision failed. */
async function clearFailure() {
  if (!runtime) return;
  await runtime.db.collection(STATE_COLLECTION).updateOne({ _id: 'state' }, { $set: { failedRevision: null, attempt: { ok: true } } });
}

async function close() {
  if (runtime) await runtime.client.close().catch(() => {});
  runtime = null;
}

module.exports = {
  ALLOWED_KEYS, encrypt, decrypt, isEncrypted, revisionOf, applyRows, chooseRows,
  load, markStarted, status, clearFailure, close,
};
