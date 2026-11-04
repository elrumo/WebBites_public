'use strict';
// WebBites screenshot + render service.
//
//   POST /screenshot  { url, quality?: 'standard'|'high', fullPage?, removeAds? }  -> { base64, mime, width, height }
//   POST /render      { url, blockAds? }                                          -> { html, finalUrl }
//   GET  /health
//
// Both POSTs need the X-API-Key header. Only public http(s) addresses are loaded (see netguard.js).

const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { checkUrl } = require('./netguard');

const env = process.env;
const PORT = Number(env.PORT || 3000);
const API_KEY = env.SCREENSHOT_API_KEY || '';
const MAX_CONCURRENCY = Math.max(1, Number(env.MAX_CONCURRENCY || 3));
const MAX_QUEUE = Math.max(0, Number(env.MAX_QUEUE || 50));
const NAV_TIMEOUT = Number(env.NAV_TIMEOUT_MS || 30000);
const REQUEST_TIMEOUT = Number(env.REQUEST_TIMEOUT_MS || 80000);
const MAX_FULLPAGE_HEIGHT = Number(env.MAX_FULLPAGE_HEIGHT || 12000);
const ALLOW_PRIVATE = env.ALLOW_PRIVATE_URLS === 'true'; // tests only
const USER_AGENT = env.USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

if (!API_KEY && env.ALLOW_NO_AUTH !== 'true') {
  console.error('SCREENSHOT_API_KEY is required (set ALLOW_NO_AUTH=true to run without, only for local tests).');
  process.exit(1);
}

// ---- concurrency ---------------------------------------------------------------------------
let running = 0;
const waiting = [];
function acquire() {
  if (running < MAX_CONCURRENCY) { running++; return Promise.resolve(); }
  if (waiting.length >= MAX_QUEUE) return Promise.reject(Object.assign(new Error('Busy'), { status: 503 }));
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

// ---- browser -------------------------------------------------------------------------------
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
    }).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com',
  'googletagmanager.com', 'adservice.google.com', 'adnxs.com', 'taboola.com', 'outbrain.com',
  'criteo.com', 'scorecardresearch.com', 'facebook.net', 'hotjar.com', 'quantserve.com',
  'amazon-adsystem.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
];
const HIDE_CSS = `
  [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i],
  [id*="gdpr" i], [class*="gdpr" i], [aria-label*="cookie" i],
  [class*="advert" i], [id*="google_ads" i], ins.adsbygoogle, iframe[src*="doubleclick"]
  { display: none !important; }
  html, body { overflow: visible !important; }`;

async function withPage(url, { blockAds, viewport, scale }, fn) {
  const pre = await checkUrl(url, { allowPrivate: ALLOW_PRIVATE });
  if ('error' in pre) throw Object.assign(new Error(pre.error), { status: 422 });

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport,
    deviceScaleFactor: scale,
    locale: 'en-US',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  try {
    // Every request the page makes, redirects and sub-resources included.
    await context.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (blockAds) {
        try {
          const h = new URL(reqUrl).hostname;
          if (AD_HOSTS.some((d) => h === d || h.endsWith('.' + d))) return route.abort('blockedbyclient');
        } catch { /* fall through to the guard */ }
      }
      const verdict = await checkUrl(reqUrl, { allowPrivate: ALLOW_PRIVATE });
      if ('error' in verdict) return route.abort('blockedbyclient');
      return route.continue();
    });

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => {
      throw Object.assign(new Error(`Navigation failed: ${e.message.split('\n')[0]}`), { status: 502 });
    });
    if (response && response.status() >= 400 && response.status() !== 404) {
      // keep going: many sites send a 403/4xx wall with a usable page; the caller judges the result
    }
    // Give client-side rendering a moment, but never wait for a chatty page to go fully idle.
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    if (blockAds) await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

async function scrollForLazyContent(page, limit) {
  await page.evaluate(async (max) => {
    await new Promise((resolve) => {
      let y = 0;
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      const timer = setInterval(() => {
        y += step;
        window.scrollTo(0, y);
        if (y >= Math.min(document.documentElement.scrollHeight, max)) { clearInterval(timer); resolve(); }
      }, 120);
      setTimeout(() => { clearInterval(timer); resolve(); }, 6000);
    });
    window.scrollTo(0, 0);
  }, limit).catch(() => {});
  await page.waitForTimeout(300);
}

async function screenshot({ url, quality, fullPage, removeAds }) {
  const high = quality === 'high';
  const viewport = { width: 1440, height: 900 };
  return withPage(url, { blockAds: removeAds !== false, viewport, scale: high ? 2 : 1 }, async (page) => {
    if (fullPage) await scrollForLazyContent(page, MAX_FULLPAGE_HEIGHT);
    let buf;
    if (fullPage) {
      const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
      const clipH = Math.min(Math.max(height, viewport.height), MAX_FULLPAGE_HEIGHT);
      buf = await page.screenshot({
        type: 'jpeg', quality: high ? 90 : 80, fullPage: true,
        clip: { x: 0, y: 0, width: viewport.width, height: clipH },
      });
    } else {
      buf = await page.screenshot({ type: 'jpeg', quality: high ? 90 : 80, fullPage: false });
    }
    return { base64: buf.toString('base64'), mime: 'image/jpeg', bytes: buf.length };
  });
}

async function render({ url, blockAds }) {
  return withPage(url, { blockAds: blockAds !== false, viewport: { width: 1280, height: 800 }, scale: 1 }, async (page) => ({
    html: await page.content(),
    finalUrl: page.url(),
  }));
}

// ---- http ----------------------------------------------------------------------------------
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function authorised(req) {
  if (!API_KEY) return true; // ALLOW_NO_AUTH
  const given = String(req.headers['x-api-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, running, queued: waiting.length });
    if (req.method !== 'POST' || (path !== '/screenshot' && path !== '/render')) return send(res, 404, { error: 'Not found' });
    if (!authorised(req)) return send(res, 401, { error: 'Unauthorized' });

    const body = await readJson(req);
    if (typeof body.url !== 'string' || !body.url) return send(res, 400, { error: 'url is required' });

    await acquire();
    let timer;
    try {
      const work = path === '/screenshot' ? screenshot(body) : render(body);
      const result = await Promise.race([
        work,
        new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('Timed out'), { status: 504 })), REQUEST_TIMEOUT); }),
      ]);
      return send(res, 200, result);
    } finally {
      clearTimeout(timer);
      release();
    }
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503 && status !== 504) console.error('[screenshot] error:', e);
    if (!res.headersSent) send(res, status, { error: e.message || 'Error' });
  }
});

server.requestTimeout = REQUEST_TIMEOUT + 5000;
server.listen(PORT, () => console.log(`screenshot service listening on :${PORT} (concurrency ${MAX_CONCURRENCY})`));

const shutdown = async () => {
  server.close();
  try { (await browserPromise)?.close(); } catch { /* already gone */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
