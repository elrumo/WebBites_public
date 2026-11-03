const crypto = require('crypto');

/**
 * Where an upload is stored, and the name Parse hands back for it.
 *
 * Parse's FilesController builds a file's URL from its name *before* the S3
 * adapter's `generateKey` runs, and returns that same name to the client, which
 * stores it on the row; every later read rebuilds the URL from it. So the name
 * Parse sees has to map to the key that is written — `generateKey` must be a
 * pure function of the name. When `generateKey` added its random segment itself
 * (9ea251d), the object went to `user/<id>/<rand>_<name>` while the URL and the
 * row said `user/<id>/<name>`, and every upload came back NoSuchKey.
 *
 * The random segment is now added to the upload's name in front of Parse
 * (`saltUploadUrl`, from `src/index.js`), so Parse, the adapter and the row all
 * see the salted name. `scripts/relink-salted-uploads.ts` in webbites-backend
 * repairs the rows written in between.
 */

/**
 * `parseUser=<id>_fileName=<name>` (`createFileName` in webbites-backend) and
 * the older `parseUser=<id>_<name>`: group 1 is everything up to the name.
 */
const USER_NAME = /^(parseuser=([^_]+)_(?:filename=)?)(.+)$/i;

/**
 * The name with a random segment in front of the part the user chose. With
 * `preserveFileName: true` the key used to be exactly what the client named
 * the file, so:
 *
 *   - two people uploading `image.png` or `bookmarks.html` shared one object,
 *     and the second upload silently replaced the first (S3 PUT overwrites);
 *   - anyone could read someone else's file by guessing an ordinary name —
 *     browser bookmark exports are called `bookmarks.html` — because objects
 *     are public-read through the CDN;
 *   - and anyone could overwrite a known key on purpose, including with
 *     `Content-Type: text/html`.
 *
 * The random segment makes a key neither guessable nor reproducible, so an
 * upload can only ever create its own object. 16 hex characters, the shape
 * `relink-salted-uploads.ts` matches.
 */
function saltFileName(filename) {
  const rand = crypto.randomBytes(8).toString('hex');
  const match = filename.match(USER_NAME);
  return match ? `${match[1]}${rand}_${match[3]}` : `${rand}_${filename}`;
}

/**
 * The bucket key (under `bucketPrefix`) for a name: `parseUser=<id>_…` uploads
 * are filed under `user/<id>/`, which account deletion sweeps
 * (`userStoragePrefixes` in webbites-backend's `server/utils/userStorageKeys.ts`).
 * The `<id>` comes from the client, so it says where a file was filed, never
 * who owns it.
 */
function keyForFileName(filename) {
  const match = filename.match(USER_NAME);
  return match ? `user/${match[2]}/${match[3]}` : filename;
}

/**
 * `req.url` (relative to Parse's mount) with an upload's name salted, or
 * unchanged when it is not an upload. Parse reads the name from the
 * `/files/:filename` route param, so rewriting the path is enough.
 *
 * A name that does not decode is left alone: Express fails to decode the param
 * too and answers 400 before Parse stores anything.
 */
function saltUploadUrl(url) {
  const match = url.match(/^\/files\/([^/?]+)(\?.*)?$/);
  if (!match) return url;
  let filename;
  try {
    filename = decodeURIComponent(match[1]);
  } catch (e) {
    return url;
  }
  return `/files/${encodeURIComponent(saltFileName(filename))}${match[2] || ''}`;
}

module.exports = { saltFileName, keyForFileName, saltUploadUrl };
