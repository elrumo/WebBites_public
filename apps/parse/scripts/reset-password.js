#!/usr/bin/env node
'use strict';
// Sets a new password for an account when email is not configured (or the owner is locked out):
//
//   docker compose exec parse node scripts/reset-password.js someone@example.com [new-password]
//
// With no password given, a random one is generated and printed. Runs inside the Parse container,
// talks to the local Parse Server with the master key it already has, and signs the user out
// everywhere (existing sessions are deleted).
const crypto = require('node:crypto');
const Parse = require('parse/node');

const [email, given] = process.argv.slice(2);
if (!email) {
  console.error('usage: node scripts/reset-password.js <email> [new-password]');
  process.exit(2);
}

(async () => {
  const port = process.env.PORT || 1337;
  const mount = process.env.PARSE_MOUNT_PATH || '/parse';
  Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JS_KEY, process.env.PARSE_MASTER_KEY);
  Parse.serverURL = `http://127.0.0.1:${port}${mount}`;

  const user = await new Parse.Query(Parse.User).equalTo('email', email.trim().toLowerCase()).first({ useMasterKey: true });
  if (!user) {
    console.error(`No account with the email ${email}.`);
    process.exit(1);
  }

  const password = given || crypto.randomBytes(12).toString('base64url');
  if (password.length < 8) {
    console.error('The password must be at least 8 characters.');
    process.exit(2);
  }
  user.set('password', password);
  await user.save(null, { useMasterKey: true });

  const sessions = await new Parse.Query(Parse.Session).equalTo('user', user).limit(1000).find({ useMasterKey: true });
  await Parse.Object.destroyAll(sessions, { useMasterKey: true });

  console.log(`Password for ${email} changed${given ? '' : `. New password: ${password}`}`);
  console.log('Ask them to change it after signing in (Settings).');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
