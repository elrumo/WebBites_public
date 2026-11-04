'use strict';
/**
 * Environment helpers. Everything the Parse server needs comes from here, with
 * required values failing loudly at boot instead of limping on with a default
 * that happens to belong to somebody else's deployment.
 */

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function required(name, hint) {
  const value = str(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}${hint ? ` (${hint})` : ''}`);
  }
  return value;
}

function bool(name, fallback = false) {
  const value = str(name).toLowerCase();
  if (TRUE.has(value)) return true;
  if (FALSE.has(value)) return false;
  return fallback;
}

function int(name, fallback) {
  const value = Number.parseInt(str(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback = []) {
  const value = str(name);
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/** `https://example.com/` -> `https://example.com` */
function trimSlash(value) {
  return value.replace(/\/+$/, '');
}

module.exports = { str, required, bool, int, list, trimSlash };
