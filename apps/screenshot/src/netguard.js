'use strict';
// Decides whether a URL may be fetched on behalf of a user. Everything the browser asks for goes
// through this: the page itself, redirects, and every sub-resource, so a public page cannot pull
// in http://169.254.169.254/ or an internal service name.

const dns = require('node:dns').promises;
const net = require('node:net');

const blocked = new net.BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) {
  blocked.addSubnet(addr, bits, 'ipv6');
}

function isBlockedAddress(address) {
  let a = address.replace(/^\[|\]$/g, '');
  // ::ffff:10.0.0.1 -> the IPv4 behind it
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) a = mapped[1];
  const family = net.isIP(a);
  if (!family) return true;
  return blocked.check(a, family === 4 ? 'ipv4' : 'ipv6');
}

const cache = new Map(); // hostname -> { ok, until }
const TTL_MS = 30_000;

/** @returns {Promise<{ok:true}|{error:string}>} */
async function checkUrl(rawUrl, { allowPrivate = false } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { return { error: 'Invalid URL' }; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { ok: true };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Unsupported protocol' };
  if (allowPrivate) return { ok: true };

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { error: 'Missing hostname' };
  if (net.isIP(host)) return isBlockedAddress(host) ? { error: 'Blocked address' } : { ok: true };
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { error: 'Blocked host' };
  }

  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.ok ? { ok: true } : { error: 'Blocked address' };

  let addrs;
  try {
    addrs = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('DNS lookup timeout')), 3000)),
    ]);
  } catch (e) {
    return { error: e && e.code === 'ENOTFOUND' ? 'DNS_PROBE_FINISHED_NXDOMAIN' : (e && e.message) || 'DNS lookup failed' };
  }
  if (!addrs.length) return { error: 'DNS lookup failed' };
  const ok = addrs.every((x) => !isBlockedAddress(x.address));
  cache.set(host, { ok, until: Date.now() + TTL_MS });
  if (cache.size > 5000) cache.clear();
  return ok ? { ok: true } : { error: 'Blocked address' };
}

module.exports = { checkUrl, isBlockedAddress };
