'use strict';
// Run: node test/clientSchema.test.js
const assert = require('node:assert/strict');
const { ensureUserFields, USER_FIELDS } = require('../src/clientSchema');

// A stand-in for Parse.Schema: `_User` starts with `existing` fields and records what update() adds.
const fake = (existing) => {
  const added = {};
  class Schema {
    async get() { return { fields: existing }; }
    addPointer(name, targetClass) { added[name] = { type: 'Pointer', targetClass }; }
    addField(name, type) { added[name] = { type }; }
    async update() {}
  }
  return { Parse: { Schema }, added };
};
const quiet = { log() {} };

(async () => {
  assert.deepEqual(USER_FIELDS.isFirstTime, { type: 'Boolean' });

  // An old database: has some columns, lacks isFirstTime. Only the missing ones are added,
  // an existing one keeps its type even when it differs from ours.
  let { Parse, added } = fake({ websiteUrls: { type: 'Pointer' }, questionnaire: { type: 'String' } });
  await ensureUserFields(Parse, quiet);
  assert.deepEqual(added.isFirstTime, { type: 'Boolean' });
  assert.ok(!('websiteUrls' in added) && !('questionnaire' in added));

  // Everything there already (hosted): nothing is touched.
  ({ Parse, added } = fake(Object.fromEntries(Object.keys(USER_FIELDS).map((k) => [k, { type: 'Whatever' }]))));
  await ensureUserFields(Parse, quiet);
  assert.deepEqual(added, {});

  console.log('  ok   clientSchema');
})().catch((e) => { console.log('  FAIL', e.message); process.exit(1); });
