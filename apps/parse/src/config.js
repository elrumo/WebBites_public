'use strict';
/**
 * Parse Server configuration. Everything comes from the environment; see
 * docs/configuration.md for the full list. Required values fail loudly at boot.
 */
const path = require('path');
const env = require('./env');
const mailer = require('./mailer');
const schema = require('./schema');
const { buildFilesAdapter, ALLOWED_FILE_EXTENSIONS } = require('./files');

// Running in Docker the app lives in /app; locally it is next to src/.
const baseDir = env.bool('DOCKER_ENV') ? '/app' : path.resolve(__dirname, '..');

const appId = env.required('PARSE_APP_ID');
const javascriptKey = env.required('PARSE_JS_KEY');
const publicServerURL = env.trimSlash(env.required('PARSE_PUBLIC_URL', 'the URL browsers use, e.g. https://example.com/parse'));
const mountPath = env.str('PARSE_MOUNT_PATH', '/parse');
const port = env.int('PORT', env.int('BASE_PORT', 1337));

// The master key bypasses every permission, so it only works from private networks
// by default (the other containers). Behind the reverse proxy Parse must read the real
// client address from X-Forwarded-For (trustProxy), otherwise every request would look
// like it comes from the proxy's private address.
const masterKeyIps = env.list('PARSE_MASTER_KEY_IPS', [
  '127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7',
]);

// Redis is optional for Parse: it only shares cache and LiveQuery pub/sub between
// several Parse instances. One instance does not need it.
const redisCacheUrl = env.str('REDIS_CACHE_URL');
const redisLiveQueryUrl = env.str('REDIS_LIVEQUERY_URL');
const RedisCacheAdapter = redisCacheUrl ? require('parse-server').RedisCacheAdapter : null;

// Every audience a Sign in with Apple identity token may be issued to. Empty when
// Apple sign-in is not configured.
const appleClientIds = env.list('APPLE_CLIENT_IDS', env.list('APPLE_CLIENT_ID'));

const config = {
  appId,
  masterKey: env.required('PARSE_MASTER_KEY'),
  javascriptKey,
  restAPIKey: env.str('PARSE_REST_KEY', javascriptKey),
  clientKey: env.str('PARSE_CLIENT_KEY', javascriptKey),
  databaseURI: env.required('DATABASE_URI', 'e.g. mongodb://user:pass@mongo:27017/parse?authSource=admin'),
  databaseOptions: {
    maxPoolSize: env.int('MONGO_MAX_POOL_SIZE', 20),
    minPoolSize: env.int('MONGO_MIN_POOL_SIZE', 2),
    maxIdleTimeMS: 60000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 5000,
    readConcernLevel: 'local',
    readPreference: 'primary',
    retryReads: true,
    retryWrites: env.bool('MONGO_RETRY_WRITES', true),
  },
  serverURL: `http://localhost:${port}${mountPath}`,
  publicServerURL,
  appName: mailer.appName(),
  port,
  mountPath,
  masterKeyIps,
  trustProxy: env.int('PARSE_TRUST_PROXY', 1),
  allowClientClassCreation: env.bool('PARSE_ALLOW_CLIENT_CLASS_CREATION', false),
  preserveFileName: true,
  maxUploadSize: env.int('MAX_UPLOAD_MB', 500) * 1024 * 1024,
  fileUpload: {
    fileExtensions: ALLOWED_FILE_EXTENSIONS,
    // Uploads need a session: anyone holding the public app id and JS key (both ship
    // in every client) must not be able to store files.
    enableForPublic: false,
    enableForAnonymousUser: false,
    enableForAuthenticatedUser: true,
  },
  liveQuery: {
    classNames: ['_User', '_Session', 'bookmarksToImport', 'feedback', 'ImportSession', 'plans', 'spaces', 'userOptions', 'waitlist', 'websites'],
    ...(redisLiveQueryUrl ? { redisURL: redisLiveQueryUrl } : {}),
  },
  startLiveQueryServer: true,
  logLevel: env.str('LOG_LEVEL', 'info'),
  // Node.js requires compiled JavaScript, not TypeScript
  cloud: path.join(baseDir, 'dist/cloud/main.js'),
  schema,
};

config.filesAdapter = buildFilesAdapter({ databaseURI: config.databaseURI });
if (RedisCacheAdapter) config.cacheAdapter = new RedisCacheAdapter({ url: redisCacheUrl });

// Password-reset and verification mail. Without a mailer there is no adapter, so Parse
// answers a reset request with an honest error instead of pretending it sent one.
if (mailer.isEnabled()) {
  config.emailAdapter = {
    module: 'parse-server-api-mail-adapter',
    options: {
      sender: mailer.defaultFrom(),
      templates: {
        passwordResetEmail: {
          subjectPath: path.join(baseDir, 'email_templates/password_reset_subject.txt'),
          textPath: path.join(baseDir, 'email_templates/password_reset_text.txt'),
          htmlPath: path.join(baseDir, 'email_templates/password_reset_html.html'),
        },
        verificationEmail: {
          subjectPath: path.join(baseDir, 'email_templates/verification_subject.txt'),
          textPath: path.join(baseDir, 'email_templates/verification_text.txt'),
          htmlPath: path.join(baseDir, 'email_templates/verification_html.html'),
        },
      },
      apiCallback: mailer.apiCallback,
    },
  };
}

// Parse's public pages (the page a password-reset link opens) are off unless the router is enabled.
// The link opens the web app's own "choose a new password" page, which posts the new password back
// to Parse, instead of Parse's bare built-in form.
config.pages = {
  enableRouter: true,
  ...(mailer.siteUrl()
    ? {
        customUrls: {
          passwordReset: `${mailer.siteUrl()}/passwordReset`,
          passwordResetSuccess: `${mailer.siteUrl()}/login`,
          passwordResetLinkInvalid: `${mailer.siteUrl()}/login`,
        },
      }
    : {}),
};

if (appleClientIds.length > 0) {
  // An array: the adapter hands it to jsonwebtoken as `audience`, which accepts a token
  // issued to any one of the ids.
  config.auth = { apple: { clientId: appleClientIds } };
}

module.exports = config;
