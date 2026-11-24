#!/usr/bin/env node
// Generates public/images/grain-tile.png, the seamless film-grain tile behind
// `.grain-overlay` (app/assets/css/main.css).
//
// It replaces public/images/grain_2.webp, a 1624×1136, 541 KB still that every
// marketing page stretched over the viewport as an <img>: the largest asset on
// the landing page. The tile is matched to that image's grain — grayscale,
// mean ≈ 173.5, and, once its large-scale mottling is filtered out, a spread
// of ≈ 21.6 with neighbouring pixels correlated ≈ 0.48 and the next ones not
// at all — so at the same opacity and blend mode it reads the same. The
// mottling itself (blotches hundreds of pixels across) cannot live in a small
// tile and is left out.
//
// Usage: node scripts/generate-grain-tile.mjs [size] [out]
// Deterministic: the same arguments always write the same bytes.

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SIZE = Number(process.argv[2]) || 128
const OUT = process.argv[3]
  || resolve(dirname(fileURLToPath(import.meta.url)), '../public/images/grain-tile.png')

const TARGET_MEAN = 173.5
const TARGET_STD = 21.6
// Gaussian blur of white noise has lag-1 correlation exp(-1 / (4σ²));
// 0.48 → σ ≈ 0.58 px (and lag-2 ≈ 0.05, as in the original).
const BLUR_SIGMA = 0.58
// Grey levels are rounded to steps of this size. Invisible at 40 % opacity
// under `multiply`, and it keeps the PNG near 10 KB.
const QUANT_STEP = 5

// mulberry32: small, seeded, good enough for noise.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = rng(0x6a7e5)
function gaussian() {
  // Box–Muller
  let u = 0
  while (u === 0) u = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

const n = SIZE * SIZE
let field = new Float64Array(n)
for (let i = 0; i < n; i++) field[i] = gaussian()

// Separable Gaussian blur with wrap-around edges, so the tile is seamless.
const radius = Math.ceil(BLUR_SIGMA * 3)
const kernel = []
let kernelSum = 0
for (let k = -radius; k <= radius; k++) {
  const w = Math.exp(-(k * k) / (2 * BLUR_SIGMA * BLUR_SIGMA))
  kernel.push(w)
  kernelSum += w
}
for (let k = 0; k < kernel.length; k++) kernel[k] /= kernelSum

const wrap = (v) => ((v % SIZE) + SIZE) % SIZE
function blur(src, horizontal) {
  const dst = new Float64Array(n)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = horizontal ? wrap(x + k) : x
        const sy = horizontal ? y : wrap(y + k)
        acc += src[sy * SIZE + sx] * kernel[k + radius]
      }
      dst[y * SIZE + x] = acc
    }
  }
  return dst
}
field = blur(blur(field, true), false)

// Rescale to the original's mean and spread.
let mean = 0
for (const v of field) mean += v
mean /= n
let variance = 0
for (const v of field) variance += (v - mean) ** 2
const std = Math.sqrt(variance / n)

const pixels = new Uint8Array(n)
for (let i = 0; i < n; i++) {
  const v = TARGET_MEAN + ((field[i] - mean) / std) * TARGET_STD
  const q = Math.round(v / QUANT_STEP) * QUANT_STEP
  pixels[i] = Math.max(0, Math.min(255, q))
}

// ── PNG, 8-bit grayscale, best filter per row ──────────────────────────────
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const raw = Buffer.alloc((SIZE + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  const row = pixels.subarray(y * SIZE, (y + 1) * SIZE)
  const prev = y > 0 ? pixels.subarray((y - 1) * SIZE, y * SIZE) : new Uint8Array(SIZE)
  let best = null
  let bestScore = Infinity
  for (let type = 0; type <= 4; type++) {
    const out = new Uint8Array(SIZE)
    let score = 0
    for (let x = 0; x < SIZE; x++) {
      const a = x > 0 ? row[x - 1] : 0
      const b = prev[x]
      const c = x > 0 ? prev[x - 1] : 0
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type]
      out[x] = (row[x] - predictor) & 0xff
      score += out[x] < 128 ? out[x] : 256 - out[x]
    }
    if (score < bestScore) {
      bestScore = score
      best = { type, out }
    }
  }
  raw[y * (SIZE + 1)] = best.type
  raw.set(best.out, y * (SIZE + 1) + 1)
}

const crcTable = new Uint32Array(256).map((_, i) => {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // grayscale
ihdr[10] = 0 // deflate
ihdr[11] = 0 // adaptive filtering
ihdr[12] = 0 // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync(OUT, png)

let outMean = 0
for (const p of pixels) outMean += p
outMean /= n
let outVar = 0
for (const p of pixels) outVar += (p - outMean) ** 2
console.log(`${OUT}: ${SIZE}×${SIZE}, ${png.length} bytes, mean ${outMean.toFixed(1)}, std ${Math.sqrt(outVar / n).toFixed(1)}`)
