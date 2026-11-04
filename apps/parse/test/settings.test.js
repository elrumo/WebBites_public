'use strict';
// Run: node test/settings.test.js   (set TEST_MONGO_URI=mongodb://127.0.0.1:27017/wb_settings_test to also run the database part)
const assert = require('node:assert/strict');
const settings = require('../src/settings');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok  ', name); }
  catch (e) { failures++; console.log('  FAIL', name, '\n      ', e.message); }
};
const quiet = { log() {}, warn() {}, error() {} };
const SECRET = 'a'.repeat(64);

(async () => {
  console.log('encryption');
  await check('round trip', () => {
    const c = settings.encrypt('hunter2 with spaces & ünïcode', SECRET);
    assert.ok(settings.isEncrypted(c));
    assert.ok(!c.includes('hunter2'));
    assert.equal(settings.decrypt(c, SECRET), 'hunter2 with spaces & ünïcode');
  });
  await check('same text encrypts differently each time', () => {
    assert.notEqual(settings.encrypt('x', SECRET), settings.encrypt('x', SECRET));
  });
  await check('wrong key and tampering are refused', () => {
    const c = settings.encrypt('x', SECRET);
    assert.throws(() => settings.decrypt(c, 'b'.repeat(64)));
    const parts = c.split('.');
    parts[2] = Buffer.from('tampered').toString('base64');
    assert.throws(() => settings.decrypt(parts.join('.'), SECRET));
  });
  await check('plain values pass through; missing key is an error for encrypted ones', () => {
    assert.equal(settings.decrypt('smtp.example.com', undefined), 'smtp.example.com');
    assert.throws(() => settings.decrypt(settings.encrypt('x', SECRET), undefined), /SETTINGS_ENCRYPTION_KEY/);
  });
  await check('format is the one the API writes (apps/api/server/utils/settings/crypto.ts)', () => {
    // Produced by the API's encryptSetting('from-the-api', 'a'*64); see that file's test.
    const fromApi = require('./fixtures/api-encrypted.json');
    assert.equal(settings.decrypt(fromApi.cipher, fromApi.key), fromApi.plain);
  });

  console.log('applyRows');
  await check('applies allowed keys, decrypts secrets', () => {
    const env = {};
    const r = settings.applyRows([
      { key: 'SMTP_HOST', value: 'mail.example.com' },
      { key: 'SMTP_PASS', value: settings.encrypt('pw', SECRET) },
    ], env, SECRET);
    assert.deepEqual(env, { SMTP_HOST: 'mail.example.com', SMTP_PASS: 'pw' });
    assert.deepEqual(r.applied.sort(), ['SMTP_HOST', 'SMTP_PASS']);
  });
  await check('the real environment wins, empty counts as unset', () => {
    const env = { SMTP_HOST: 'from-env', SMTP_USER: '' };
    settings.applyRows([{ key: 'SMTP_HOST', value: 'stored' }, { key: 'SMTP_USER', value: 'u' }], env, SECRET);
    assert.equal(env.SMTP_HOST, 'from-env');
    assert.equal(env.SMTP_USER, 'u');
  });
  await check('keys outside the allow-list never reach the environment', () => {
    const env = {};
    const r = settings.applyRows([
      { key: 'NODE_OPTIONS', value: '--require /tmp/evil.js' },
      { key: 'PARSE_MASTER_KEY', value: 'x' },
      { key: 'DATABASE_URI', value: 'mongodb://elsewhere' },
    ], env, SECRET);
    assert.deepEqual(env, {});
    assert.equal(r.skipped.length, 3);
  });
  await check('one undecryptable row does not stop the others', () => {
    const env = {};
    const r = settings.applyRows([
      { key: 'SMTP_PASS', value: settings.encrypt('pw', 'c'.repeat(64)) },
      { key: 'SMTP_HOST', value: 'h' },
    ], env, SECRET);
    assert.deepEqual(env, { SMTP_HOST: 'h' });
    assert.match(r.skipped[0].reason, /decrypted/);
  });

  console.log('chooseRows (the fall-back to the last good settings)');
  const rowsA = [{ key: 'SMTP_HOST', value: 'a' }];
  const rowsB = [{ key: 'SMTP_HOST', value: 'b' }];
  await check('revision does not depend on order', () => {
    const x = [{ key: 'A', value: '1' }, { key: 'B', value: '2' }];
    assert.equal(settings.revisionOf(x), settings.revisionOf([...x].reverse()));
    assert.notEqual(settings.revisionOf(rowsA), settings.revisionOf(rowsB));
  });
  await check('first start: uses the saved rows', () => {
    const c = settings.chooseRows(rowsA, null);
    assert.equal(c.usedLastGood, false);
    assert.deepEqual(c.rows, rowsA);
  });
  await check('a start that did not finish falls back to the last good rows', () => {
    const state = { attempt: { revision: settings.revisionOf(rowsB), ok: false }, lastGood: { rows: rowsA } };
    const c = settings.chooseRows(rowsB, state);
    assert.equal(c.usedLastGood, true);
    assert.deepEqual(c.rows, rowsA);
    assert.ok(c.lastError);
  });
  await check('with no last good set it falls back to the environment alone', () => {
    const state = { attempt: { revision: settings.revisionOf(rowsB), ok: false } };
    assert.deepEqual(settings.chooseRows(rowsB, state).rows, []);
  });
  await check('a known-bad revision stays bad until the settings change', () => {
    const state = { failedRevision: settings.revisionOf(rowsB), attempt: { ok: true }, lastGood: { rows: rowsA } };
    assert.equal(settings.chooseRows(rowsB, state).usedLastGood, true);
    assert.equal(settings.chooseRows([{ key: 'SMTP_HOST', value: 'c' }], state).usedLastGood, false);
  });
  await check('an interrupted start of other settings does not matter', () => {
    const state = { attempt: { revision: 'something-else', ok: false }, lastGood: { rows: rowsA } };
    assert.equal(settings.chooseRows(rowsB, state).usedLastGood, false);
  });

  const uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    console.log('database part skipped (TEST_MONGO_URI not set)');
  } else {
    console.log('against MongoDB');
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db();
    await db.dropDatabase();
    const start = async (env) => {
      const r = await settings.load(env, quiet);
      return r;
    };

    await check('settings stored by the API are applied at start', async () => {
      await db.collection('AppSettings').insertMany([
        { key: 'SMTP_HOST', value: 'stored.example.com', secret: false },
        { key: 'SMTP_PASS', value: settings.encrypt('pw', SECRET), secret: true },
      ]);
      const env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      const r = await start(env);
      assert.equal(env.SMTP_HOST, 'stored.example.com');
      assert.equal(env.SMTP_PASS, 'pw');
      assert.equal(r.usedLastGood, false);
      await settings.markStarted(quiet);
      await settings.close();
      const state = await db.collection('WebBitesSettingsState').findOne({ _id: 'state' });
      assert.equal(state.attempt.ok, true);
      assert.equal(state.lastGood.rows.length, 2);
    });

    await check('new settings whose start never finishes are replaced by the last good ones', async () => {
      await db.collection('AppSettings').updateOne({ key: 'SMTP_HOST' }, { $set: { value: 'broken.example.com' } });
      let env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      await start(env);                      // the start with the new settings...
      assert.equal(env.SMTP_HOST, 'broken.example.com');
      await settings.close();                // ...dies before markStarted()
      env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      const r = await start(env);            // next start
      assert.equal(r.usedLastGood, true);
      assert.equal(env.SMTP_HOST, 'stored.example.com');
      assert.match((await settings.status()).lastError, /previous ones/);
      await settings.markStarted(quiet);
      await settings.close();
      // and it stays on the last good ones, even though that start finished
      env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      assert.equal((await start(env)).usedLastGood, true);
      await settings.markStarted(quiet);
      await settings.close();
    });

    await check('"try again" (retry) uses the saved settings once more', async () => {
      let env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      await start(env);
      await settings.clearFailure();
      await settings.close();
      env = { DATABASE_URI: uri, SETTINGS_ENCRYPTION_KEY: SECRET };
      const r = await start(env);
      assert.equal(r.usedLastGood, false);
      assert.equal(env.SMTP_HOST, 'broken.example.com');
      await settings.markStarted(quiet);
      await settings.close();
    });

    await check('an unreachable database is not fatal: the environment alone is used', async () => {
      const env = { DATABASE_URI: 'mongodb://127.0.0.1:1/x', SETTINGS_MONGO_TIMEOUT_MS: '500' };
      const r = await Promise.race([settings.load(env, quiet), new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 30000))]);
      assert.deepEqual(r.applied, []);
    });

    await db.dropDatabase();
    await client.close();
  }

  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
