/**
 * Web port of the native app's delete "vaporise" (DisintegrationParticles.swift):
 * a frozen clone of the card fades while dust lifts off it, so the grid can
 * reflow underneath without the card simply blinking out.
 *
 * Same numbers as the native emitter. Pixel sampling comes from the card's
 * image (when CORS allows) plus its background colour, not a real snapshot.
 */

const EMISSION = 0.32
const LIFETIME = 0.46
const LIFETIME_RANGE = 0.12
const SNAPSHOT_FADE = 440
const MAX_TARGETS = 4
const PER_TARGET = 160
const CALL_BUDGET = 900
const REFLOW = 420
// Pinned cards sit in a TransitionGroup that already animates its own moves.
const CARDS = '[id^="bookmarkCard-"]:not([id$="-pinned"])'

let canvas, ctx, particles = [], raf, last

export function vaporize(elements) {
  if (typeof document === 'undefined') return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  reflow()
  const targets = elements.filter(Boolean).slice(0, MAX_TARGETS)
  if (!targets.length) return
  const budget = Math.min(PER_TARGET, Math.max(24, Math.floor(CALL_BUDGET / targets.length)))
  for (const el of targets) {
    const rect = el.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    fadeClone(el, rect)
    emit(rect, colorsOf(el), budget)
  }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) }
}

/**
 * FLIP for the cards that stay. Callers vaporize right before dropping the
 * cards from the store, so this remembers where every card is now; the rAF
 * runs after Vue's microtask re-render but before paint, and slides each card
 * from where it was to where the grid put it. Matched by id, not element, so
 * cards the virtual scroller re-mounts in another row still glide over.
 */
function reflow() {
  const before = new Map()
  for (const el of document.querySelectorAll(CARDS)) before.set(el.id, el.getBoundingClientRect())
  requestAnimationFrame(() => {
    for (const el of document.querySelectorAll(CARDS)) {
      const from = before.get(el.id)
      if (!from) continue
      // The card's root, so its checkbox and reactions travel with it.
      const root = el.parentElement
      // A previous reflow still in flight would skew the measurement; `from`
      // already holds where it visually was, so it picks up from there.
      root.getAnimations().forEach(a => a.cancel())
      const to = el.getBoundingClientRect()
      const dx = from.left - to.left, dy = from.top - to.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      if ((from.bottom < 0 || from.top > innerHeight) && (to.bottom < 0 || to.top > innerHeight)) continue
      root.animate(
        { transform: [`translate(${dx}px, ${dy}px)`, 'none'] },
        { duration: REFLOW, easing: 'cubic-bezier(.2, .8, .2, 1)' }
      )
    }
  })
}

function fadeClone(el, rect) {
  const clone = el.cloneNode(true)
  clone.removeAttribute('id')
  Object.assign(clone.style, {
    position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
    width: rect.width + 'px', height: rect.height + 'px', margin: 0,
    pointerEvents: 'none', zIndex: 9998,
  })
  document.body.appendChild(clone)
  clone.animate({ opacity: [1, 1, 0], offset: [0, 0.25, 1] }, { duration: SNAPSHOT_FADE, fill: 'forwards' })
    .finished.finally(() => clone.remove())
}

function colorsOf(el) {
  const colors = []
  const cs = getComputedStyle(el)
  for (const c of [cs.backgroundColor, cs.color]) if (c && !c.endsWith(', 0)')) colors.push(c)
  const img = el.querySelector('img')
  if (img?.complete && img.naturalWidth) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 6
      c.getContext('2d').drawImage(img, 0, 0, 6, 6)
      const d = c.getContext('2d').getImageData(0, 0, 6, 6).data
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) colors.push(`rgb(${d[i]},${d[i + 1]},${d[i + 2]})`)
    } catch { /* cross-origin image taints the canvas; fall back to css colours */ }
  }
  return colors.length ? colors : ['#888']
}

function emit(rect, colors, count) {
  const side = 7
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (2 * Math.PI / 3)
    const speed = 86 + (Math.random() - 0.5) * 96
    const life = LIFETIME + (Math.random() - 0.5) * LIFETIME_RANGE
    particles.push({
      x: rect.left + Math.random() * rect.width,
      y: rect.top + Math.random() * rect.height,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      born: Math.random() * EMISSION, age: 0, life,
      scale: side * (0.78 + (Math.random() - 0.5) * 1.44),
      alpha: 1 + (Math.random() - 0.5) * 0.36,
      rot: 0, spin: (Math.random() - 0.5) * 4.4,
      color: colors[(Math.random() * colors.length) | 0],
    })
  }
}

function ensureCanvas() {
  if (canvas) return
  canvas = document.createElement('canvas')
  Object.assign(canvas.style, { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 })
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
}

function tick(now) {
  ensureCanvas()
  const dpr = devicePixelRatio || 1
  if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr
  }
  const dt = Math.min((now - last) / 1000, 0.05); last = now
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  for (const p of particles) {
    if (p.born > 0) { p.born -= dt; continue }
    p.age += dt
    p.vy -= 14 * dt
    p.x += p.vx * dt; p.y += p.vy * dt
    p.scale -= 0.72 * 7 * dt
    p.alpha -= 2.1 * dt
    p.rot += p.spin * dt
    if (p.alpha <= 0 || p.scale <= 0) continue
    ctx.globalAlpha = Math.min(1, p.alpha)
    ctx.fillStyle = p.color
    ctx.setTransform(dpr, 0, 0, dpr, p.x, p.y)
    ctx.rotate(p.rot)
    ctx.fillRect(-p.scale / 2, -p.scale / 2, p.scale, p.scale)
  }
  particles = particles.filter(p => p.born > 0 || (p.age < p.life && p.alpha > 0 && p.scale > 0))
  if (particles.length) raf = requestAnimationFrame(tick)
  else { raf = null; canvas.remove(); canvas = ctx = null }
}
