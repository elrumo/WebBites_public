'use strict';
/**
 * The classes the browser writes with the user's own session (the web app's Parse SDK saves bookmarks,
 * options and import state directly).
 *
 * Data in them is protected by the per-row ACLs the code sets, so reads and writes keep Parse's
 * defaults. What is different is `addField`: a signed-in client must be able to add a column
 * (the app grows `recentSearches` on `userOptions` the first time it saves, for example), which Parse 9
 * refuses on any class it controls through `schema.definitions`, and on every other class it forces shut at
 * each start. A long-running database has all its columns already; a fresh one does not. So these classes are
 * kept out of the definitions. After Parse is up, every start, a missing class is created with this CLP and
 * an existing one gets this `addField` with its other permissions left exactly as they are.
 *
 * `requiresAuthentication`: signed-in users only, never an anonymous client holding the (public) JS key.
 */
const CLIENT_CLASSES = ['websites', 'userOptions', 'bookmarksToImport', 'ImportSession'];

const CLP = {
  find: { '*': true }, get: { '*': true }, count: { '*': true },
  create: { '*': true }, update: { '*': true }, delete: { '*': true },
  addField: { requiresAuthentication: true },
};

/**
 * Columns on `_User` that sign-up (cloud code, without the master key) and the signed-in app
 * write. `_User` keeps `addField` shut, which is right, but then a fresh database could not
 * create its first account: the sign-up hook sets `websiteUrls` and `bookmarksToImport`, and
 * Parse refused to add the columns. A long-running database already has them; for a fresh one
 * they are added here, with the master key, before anyone signs up. Existing columns are left
 * exactly as they are.
 */
const USER_FIELDS = {
  websiteUrls: { type: 'Pointer', targetClass: 'websiteUrls' },
  bookmarksToImport: { type: 'Array' },
  currentPlan: { type: 'Pointer', targetClass: 'plans' },
  role: { type: 'Pointer', targetClass: '_Role' },
  userOptions: { type: 'Pointer', targetClass: 'userOptions' },
  importedBookmarks: { type: 'File' },
  failedToImport: { type: 'Array' },
  questionnaire: { type: 'Object' },
};

async function ensureUserFields(Parse, log = console) {
  const schema = new Parse.Schema('_User');
  const existing = (await schema.get({ useMasterKey: true })).fields || {};
  const missing = Object.keys(USER_FIELDS).filter((name) => !existing[name]);
  if (missing.length === 0) return;
  for (const name of missing) {
    const { type, targetClass } = USER_FIELDS[name];
    if (type === 'Pointer') schema.addPointer(name, targetClass);
    else schema.addField(name, type);
  }
  await schema.update({ useMasterKey: true });
  log.log(`Added user columns: ${missing.join(', ')}`);
}

/**
 * PARSE_CLIENT_ADD_FIELD=false leaves `addField` shut on classes that already exist (Parse 9 shuts
 * it at every start), for a database whose columns are all there already. Classes that do not
 * exist yet are always created with the CLP above.
 */
async function ensureClientClasses(Parse, log = console) {
  await ensureUserFields(Parse, log);
  const openAddField = String(process.env.PARSE_CLIENT_ADD_FIELD || '').toLowerCase() !== 'false';
  for (const name of CLIENT_CLASSES) {
    const schema = new Parse.Schema(name);
    let existing = null;
    try {
      existing = await schema.get({ useMasterKey: true });
    } catch (error) {
      if (error.code !== Parse.Error.INVALID_CLASS_NAME && error.code !== 103) throw error;
    }
    if (!existing) {
      schema.setCLP(CLP);
      await schema.save({ useMasterKey: true });
      continue;
    }
    if (!openAddField) continue;
    // Only addField changes. The class's other permissions are whatever the database has: this
    // must never loosen a CLP someone tightened (find, create, ... stay exactly as they are).
    schema.setCLP({ ...(existing.classLevelPermissions || {}), addField: CLP.addField });
    await schema.update({ useMasterKey: true });
  }
  log.log(`Client-writable classes ready: ${CLIENT_CLASSES.join(', ')}${openAddField ? '' : ' (addField left as it is)'}`);
}

module.exports = { ensureClientClasses, ensureUserFields, CLIENT_CLASSES, CLP, USER_FIELDS };
