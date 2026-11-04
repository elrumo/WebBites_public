'use strict';
// Starts the service twice (one that may reach private addresses so there is something local to
// capture, one that may not) and checks the contract. Needs Chromium, i.e. `npx playwright install chromium`.
const { spawn } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkUrl, isBlockedAddress } = require('../src/netguard');

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log('  ok  ', name); }
  catch (e) { failures++; console.log('  FAIL', name, '\n      ', e.message); }
};

const KEY = 'test-key';
const post = (port, p, body, key = KEY) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

function start(port, extra) {
  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
    env: { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', HOME: process.env.HOME || '/tmp',
      PORT: String(port), SCREENSHOT_API_KEY: KEY, ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}), ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(child); });
    child.on('exit', (c) => reject(new Error('exited ' + c)));
  });
}

async function main() {
  console.log('netguard');
  await check('blocks private, loopback, metadata and mapped addresses', async () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '0.0.0.0'])
      assert.equal(isBlockedAddress(a), true, a);
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      assert.equal(isBlockedAddress(a), false, a);
  });
  await check('refuses internal names and odd schemes', async () => {
    for (const u of ['http://mongo/', 'http://api:3000/', 'http://foo.internal/', 'http://x.local/', 'file:///etc/passwd', 'ftp://example.com', 'http://[::1]/', 'http://2130706433/'])
      assert.ok('error' in (await checkUrl(u)), u);
  });

  // a local page to capture
  const site = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest/' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Hello</title><body style="margin:0"><h1 id=a>Rendered</h1><script>document.getElementById("a").textContent="Rendered by JS"</script><div style="height:3000px;background:linear-gradient(red,blue)"></div>');
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const sitePort = site.address().port;
  const pageUrl = `http://127.0.0.1:${sitePort}/`;

  const open = await start(4101, { ALLOW_PRIVATE_URLS: 'true' });
  const strict = await start(4102, {});
  try {
    console.log('service (private URLs allowed, for the test page)');
    await check('/health answers without a key', async () => {
      const r = await fetch('http://127.0.0.1:4101/health');
      assert.equal(r.status, 200);
    });
    await check('rejects a missing or wrong key', async () => {
      assert.equal((await post(4101, '/screenshot', { url: pageUrl }, null)).status, 401);
      assert.equal((await post(4101, '/screenshot', { url: pageUrl }, 'nope')).status, 401);
    });
    await check('400 without a url', async () => {
      assert.equal((await post(4101, '/screenshot', {})).status, 400);
    });
    await check('viewport screenshot is a JPEG', async () => {
      const r = await post(4101, '/screenshot', { url: pageUrl });
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
      const buf = Buffer.from(r.body.base64, 'base64');
      assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
      assert.equal(r.body.mime, 'image/jpeg');
    });
    await check('full page is taller than the viewport', async () => {
      const a = await post(4101, '/screenshot', { url: pageUrl });
      const b = await post(4101, '/screenshot', { url: pageUrl, fullPage: true });
      assert.equal(b.status, 200);
      assert.ok(Buffer.from(b.body.base64, 'base64').length > 0);
      // JPEG SOF0/SOF2 marker carries the height
      const dims = (buf) => { for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); } };
      const da = dims(Buffer.from(a.body.base64, 'base64')), db = dims(Buffer.from(b.body.base64, 'base64'));
      assert.equal(da.h, 900); assert.ok(db.h > 2500, 'full page height ' + db.h);
    });
    await check('/render runs the page JavaScript', async () => {
      const r = await post(4101, '/render', { url: pageUrl });
      assert.equal(r.status, 200);
      assert.match(r.body.html, /Rendered by JS/);
    });

    console.log('service (strict, as deployed)');
    await check('refuses a loopback page', async () => {
      const r = await post(4102, '/screenshot', { url: pageUrl });
      assert.equal(r.status, 422); assert.match(r.body.error, /Blocked/);
    });
    await check('refuses the metadata address and internal names', async () => {
      for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://redis:6379/', 'http://10.0.0.5/', 'file:///etc/passwd']) {
        const r = await post(4102, '/render', { url: u });
        assert.equal(r.status, 422, u);
      }
    });
  } finally {
    open.kill(); strict.kill(); site.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
