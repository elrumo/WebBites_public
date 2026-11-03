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

async function ensureClientClasses(Parse, log = console) {
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

module.exports = { ensureClientClasses, CLIENT_CLASSES, CLP };
