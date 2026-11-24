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
 * kept out of the definitions and given this CLP after Parse is up, every start.
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

async function ensureClientClasses(Parse, log = console) {
  await ensureUserFields(Parse, log);
  for (const name of CLIENT_CLASSES) {
    const schema = new Parse.Schema(name);
    schema.setCLP(CLP);
    try {
      await schema.update({ useMasterKey: true });
    } catch (error) {
      if (error.code !== Parse.Error.INVALID_CLASS_NAME && error.code !== 103) throw error;
      await schema.save({ useMasterKey: true });
    }
  }
  log.log(`Client-writable classes ready: ${CLIENT_CLASSES.join(', ')}`);
}

module.exports = { ensureClientClasses, ensureUserFields, CLIENT_CLASSES, CLP, USER_FIELDS };
