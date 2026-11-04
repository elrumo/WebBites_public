const express = require('express');
const ParseServer = require('parse-server').ParseServer;
const Parse = require('parse/node');
const { keyForFileName, saltUploadUrl } = require('./fileKeys');
const settings = require('./settings');
const { ensureClientClasses } = require('./clientSchema');

const BASE_PORT = parseInt(process.env.PORT || '1337', 10);

async function startServer(port) {
  // Settings saved on the admin page go into process.env first, because config.js reads the
  // environment when it is loaded.
  await settings.load();
  const config = require('./config.js');
  const { driver: filesDriver } = require('./files');

  // Create Express app
  const app = express();
  
  // Create config with dynamic port
  const instanceConfig = {
    ...config,
    port: port,
    serverURL: `http://localhost:${port}/parse`
  };
  // The S3 adapter stores objects under salted `user/<id>/…` keys and Parse has to be told the
  // resulting URL. GridFS serves the name Parse picked, so it needs none of that.
  const rewriteS3Uploads = filesDriver() === 's3';
  console.log(`Files: ${filesDriver()}`);

  // Create Parse Server instance
  const parseServer = new ParseServer(instanceConfig);

  // Start Parse Server (required before mounting)
  await parseServer.start();

  // Initialize Parse SDK for database updates
  Parse.initialize(instanceConfig.appId, instanceConfig.javascriptKey, instanceConfig.masterKey);
  Parse.serverURL = instanceConfig.serverURL;

  // Behind the reverse proxy the real client address is in X-Forwarded-For. Parse reads
  // `req.ip` for its master-key IP allow-list, and Express only honours the header when
  // told to trust the proxy. ParseServer sets this on an app of its own; the app we
  // mount it in, and the mounted one, need it too, or every request looks like it came
  // from the proxy's private address and the allow-list protects nothing.
  if (instanceConfig.trustProxy) {
    app.set('trust proxy', instanceConfig.trustProxy);
    parseServer.app.set('trust proxy', instanceConfig.trustProxy);
  }

  // Internal endpoints for the admin page (apps/api). Not routed by the reverse proxy: they
  // are reachable only from inside the compose network, and still need the master key.
  const masterOnly = (req, res, next) => {
    const given = Buffer.from(String(req.get('x-parse-master-key') || ''));
    const expected = Buffer.from(String(instanceConfig.masterKey));
    if (given.length === expected.length && require('crypto').timingSafeEqual(given, expected)) return next();
    res.status(403).json({ error: 'forbidden' });
  };
  app.get('/_internal/status', masterOnly, async (req, res) => {
    try { res.json(await settings.status()); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/_internal/restart', masterOnly, async (req, res) => {
    try {
      // ?retry=1: try the saved settings again even if the last start with them failed.
      if (req.query.retry === '1') await settings.clearFailure();
    } catch (e) { console.warn('[settings] clearFailure:', e.message); }
    res.status(202).json({ restarting: true });
    res.on('finish', () => {
      console.log('Restart requested from the admin page; exiting so the container restarts.');
      setTimeout(() => process.exit(0), 200);
    });
  });

  // Mount Parse Server FIRST
  const mountPath = instanceConfig.mountPath || '/parse';
  app.use(mountPath, parseServer.app);

  // Intercept at a lower level - wrap the parseServer.app
  const originalHandle = parseServer.app.handle.bind(parseServer.app);
  parseServer.app.handle = function(req, res, next) {
    if (req.method === 'POST' && req.url && req.url.startsWith('/files')) {
      // Salt the name before Parse reads it, so the URL Parse builds from the name and
      // the key the adapter writes agree (src/fileKeys.js). Files are served without any
      // authentication, so the name has to be unguessable whichever store holds them.
      req.url = saltUploadUrl(req.url);
    }

    if (rewriteS3Uploads && req.method === 'POST' && req.url && req.url.startsWith('/files')) {
      const originalJson = res.json;
      const originalSend = res.send;
      const originalEnd = res.end;
      
      let intercepted = false;
      
      const fixUrl = async (body) => {
        try {
          let data = body;
          if (typeof body === 'string') {
            try {
              data = JSON.parse(body);
            } catch (e) {
              return body;
            }
          }

          // Parse names the file as it was uploaded; the object is at
          // `keyForFileName` of that, which is what the row has to store.
          if (data && data.name && data.url) {
            const key = keyForFileName(data.name);
            if (key !== data.name) {
              data.name = key;
              data.url = await config.filesAdapter.getFileLocation(instanceConfig, key);
            }
          }
          
          return typeof body === 'string' ? JSON.stringify(data) : data;
        } catch (error) {
          console.error('Error in fixUrl:', error);
          return body;
        }
      };
      
      res.json = async function(body) {
        if (!intercepted) {
          intercepted = true;
          const fixed = await fixUrl(body);
          return originalJson.call(this, fixed);
        }
        return originalJson.call(this, body);
      };
      
      res.send = async function(body) {
        if (!intercepted) {
          intercepted = true;
          const fixed = await fixUrl(body);
          return originalSend.call(this, fixed);
        }
        return originalSend.call(this, body);
      };
      
      res.end = async function(body) {
        if (!intercepted && body) {
          intercepted = true;
          const fixed = await fixUrl(body);
          return originalEnd.call(this, fixed);
        }
        return originalEnd.call(this, body);
      };
    }
    
    return originalHandle(req, res, next);
  };

  // Start the Express server
  const httpServer = require('http').createServer(app);

  httpServer.listen(port, function() {
    console.log(`Parse Server running on port ${port} (PID: ${process.pid})`);
    console.log(`Server URL: ${instanceConfig.serverURL}`);
    console.log(`Public Server URL: ${instanceConfig.publicServerURL}`);
    ensureClientClasses(Parse)
      .catch((e) => console.error('Could not prepare the client-writable classes:', e))
      .then(() => settings.markStarted());
  });

  // LiveQuery (the web app's live updates), on the same port
  ParseServer.createLiveQueryServer(httpServer, instanceConfig.liveQuery.redisURL
    ? { redisURL: instanceConfig.liveQuery.redisURL }
    : {});

  console.log(`LiveQuery server initialized on port ${port}${instanceConfig.liveQuery.redisURL ? ' with Redis pub/sub' : ''}`);

  // Handle graceful shutdown
  const shutdown = () => {
    console.log(`Shutting down server on port ${port} (PID: ${process.pid})`);
    httpServer.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return httpServer;
}

// Main entry point
startServer(BASE_PORT).catch(err => {
  console.error('Failed to start Parse Server:', err);
  process.exit(1);
});
