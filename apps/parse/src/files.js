'use strict';
/**
 * File storage for Parse.
 *
 *   FILES_DRIVER=gridfs (default)   Files live in MongoDB (Parse's GridFS adapter). Nothing else to run; URLs are
 *                                   <PARSE_PUBLIC_URL>/files/<appId>/<name> and
 *                                   Parse serves them.
 *   FILES_DRIVER=s3                 Any S3-compatible store (RustFS, MinIO, AWS,
 *                                   R2...). Uploads go to the store; browsers fetch
 *                                   them from S3_PUBLIC_URL.
 *
 * With no FILES_DRIVER, setting S3_BUCKET selects s3.
 */
const env = require('./env');
const { keyForFileName } = require('./fileKeys');

const ALLOWED_FILE_EXTENSIONS = ['html', 'txt', 'csv', 'json', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp3', 'wav', 'mp4', 'webm', 'zip', 'gz', 'xls', 'xlsx', 'rtf'];

function driver() {
  const explicit = env.str('FILES_DRIVER').toLowerCase();
  if (explicit) return explicit;
  return env.str('S3_BUCKET') ? 's3' : 'gridfs';
}

/**
 * Parse's own filename check. The extension comparison has to drop the dot:
 * ALLOWED_FILE_EXTENSIONS has none.
 */
function validateFilename(filename) {
  try {
    if (typeof filename !== 'string') return 'Invalid filename';
    let candidate = filename;
    const withParams = candidate.match(/^(?:parseUser|parseuser)=([^_]+)_(?:fileName|filename)=(.+)$/i);
    if (withParams) candidate = withParams[2];
    const legacy = candidate.match(/^(?:parseUser|parseuser)=([^_]+)_(.+)$/i);
    if (legacy) candidate = legacy[2];
    const lower = candidate.toLowerCase();
    const idx = lower.lastIndexOf('.');
    const ext = idx >= 0 ? lower.substring(idx + 1) : '';
    if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) return 'File type not allowed';
    return null;
  } catch (e) {
    return 'Filename validation error';
  }
}

/** Parse's own file router expects a Parse.Error (a string would surface as a 500). */
function asParseError(message) {
  if (!message) return null;
  const Parse = require('parse/node');
  return new Parse.Error(Parse.Error.INVALID_FILE_NAME, message);
}

/**
 * Parse's GridFS adapter, with our filename check. Its default check refuses the `=` in the
 * `parseUser=<id>_fileName=<name>` names every client uploads with (the S3 adapter is given
 * the same check below).
 */
function buildGridFsAdapter(databaseURI) {
  // Not exported from the package root; no package `exports` map blocks the deep path.
  const { GridFSBucketAdapter } = require('parse-server/lib/Adapters/Files/GridFSBucketAdapter');
  class WebBitesGridFSAdapter extends GridFSBucketAdapter {
    validateFilename(filename) {
      return asParseError(validateFilename(filename));
    }
  }
  return new WebBitesGridFSAdapter(databaseURI);
}

/** The adapter to hand to ParseServer. */
function buildFilesAdapter({ databaseURI }) {
  const chosen = driver();
  if (chosen === 'gridfs') return buildGridFsAdapter(databaseURI);
  if (chosen !== 's3') throw new Error(`Unknown FILES_DRIVER "${chosen}" (use gridfs or s3)`);

  const S3Adapter = require('@parse/s3-files-adapter');
  const bucket = env.required('S3_BUCKET');
  const prefix = env.str('S3_PREFIX', 'parse/').replace(/^\/+/, '');
  const publicUrl = env.trimSlash(env.required('S3_PUBLIC_URL', 'the URL browsers use to reach the storage, e.g. https://example.com/s3'));

  return new S3Adapter({
    bucket,
    region: env.str('S3_REGION', 'auto'),
    bucketPrefix: prefix,
    directAccess: true,
    baseUrlDirect: true,
    baseUrl: `${publicUrl}/${bucket}/${prefix.replace(/\/+$/, '')}`,
    s3overrides: {
      endpoint: env.required('S3_ENDPOINT_URL', 'e.g. http://rustfs:9000'),
      forcePathStyle: env.bool('S3_FORCE_PATH_STYLE', true),
      credentials: {
        accessKeyId: env.required('S3_ACCESS_KEY'),
        secretAccessKey: env.required('S3_SECRET_KEY'),
      },
    },
    /**
     * The object key for an upload: `parseUser=<id>_fileName=<name>` goes under
     * `user/<id>/`, anything else is kept as named. A pure function of the name on
     * purpose: Parse builds the URL it returns from the name before this runs, so a
     * key that differs from the name is an object nobody can reach. The random
     * segment that keeps keys unguessable is added to the name in front of Parse
     * instead; see src/fileKeys.js.
     */
    generateKey(filename) {
      if (typeof filename !== 'string') return filename;
      return keyForFileName(filename);
    },
    validateFilename: (filename) => asParseError(validateFilename(filename)),
  });
}

module.exports = { driver, buildFilesAdapter, validateFilename, ALLOWED_FILE_EXTENSIONS };
