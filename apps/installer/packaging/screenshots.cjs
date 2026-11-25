// Screenshots of the setup page for the docs (apps/web/public/self-hosting/app/*.webp).
//
//   webbites-server ui                       # prints http://127.0.0.1:<port>/?t=<key>
//   node packaging/screenshots.cjs '<that address>' ../web/public/self-hosting/app
//
// Needs Playwright (require('playwright') must resolve). The page's API is faked, so every state can
// be shown without Docker or an install. Each picture is the card (plus the header on the first
// one) at 2x, scaled to 1200 px wide and saved as WebP by the browser itself: no image tools needed.
// If a picture's height changes, update SIZES in
// apps/web/app/components/developers/DevSectionSelfHostingApp.vue (the script prints them).
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const [url, outDir = '.'] = process.argv.slice(2)
if (!url || !url.includes('?t=')) {
  console.error('usage: node screenshots.cjs <setup page address with ?t=…> [out dir]')
  process.exit(1)
}

const base = {
  app: '0.7.0', os: 'darwin', dir: '/Users/you/WebBites', installed: false, latest: '0.7.0', services: [], running: false, suggestedPort: 8080,
  docker: { installed: true, running: true, compose: true, version: '27.3.1', installUrl: 'https://www.docker.com/products/docker-desktop/' },
}
const services = [['caddy', ''], ['web', 'healthy'], ['api', 'healthy'], ['parse', 'healthy'], ['mongo', 'healthy'], ['redis', 'healthy'], ['meilisearch', 'healthy'], ['screenshot', '']]
  .map(([name, health]) => ({ name, state: 'running', health, status: health ? 'Up 2 hours (healthy)' : 'Up 2 hours' }))
const installed = { ...base, installed: true, version: '0.7.0', publicUrl: 'https://bookmarks.example.com', services, running: true }
const installLines = ['Downloading WebBites 0.7.0 deployment files...', 'Writing .env with new secrets...', 'Downloading the images (the first time takes a few minutes)...', ' Image elrumo/webbites-web:0.7.0 Pulling']
const logs = 'web-1  | Listening on http://0.0.0.0:3000\napi-1  | [meilisearch] index ready\napi-1  | GET /health 200 2ms\nparse-1  | Parse Server running on port 1337'

// [file name, fake /api/state, what to click first, show the header]
const SHOTS = [
  ['docker', { ...base, docker: { installed: false, running: false, compose: false, problem: 'Docker is not installed.', installUrl: base.docker.installUrl } }],
  ['where', base, null, true],
  ['details-computer', base, async (p) => { await p.click('.tile[data-where=local]'); await p.click('details.advanced summary') }],
  ['details-server', base, async (p) => { await p.click('.tile[data-where=domain]') }],
  ['installing', { ...base, job: { name: 'Installing WebBites', running: true, lines: installLines } }],
  ['failed', { ...base, job: { name: 'Installing WebBites', running: false, error: 'docker compose pull --quiet failed: exit status 1', lines: [...installLines, 'Nothing was started. Check your connection and try again.'] } },
    async (p) => { await p.evaluate(() => { following = true; render(state) }) }], // eslint-disable-line no-undef
  ['ready', { ...installed, publicUrl: 'http://localhost:8080' }, async (p) => { await p.evaluate(() => { showDone = true; view = ''; render(state) }) }], // eslint-disable-line no-undef
  ['home', { ...installed, version: '0.6.9' }],
  ['logs', installed, async (p) => { await p.click('.tabs button[data-tab=logs]'); await p.waitForTimeout(300) }],
  ['settings', installed, async (p) => { await p.click('.tabs button[data-tab=settings]') }],
  ['stopped', { ...installed, publicUrl: 'http://localhost', running: false, services: services.map((s) => ({ ...s, state: 'exited', health: '', status: 'Exited (0) 5 minutes ago' })) }],
]

;(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch()
  for (const [name, state, act, header] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 })
    await page.route('**/api/state', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(state) }))
    await page.route('**/api/logs**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ logs }) }))
    await page.route('**/api/events**', (r) => r.fulfill({ contentType: 'text/event-stream', body: ': hi\n\n' }))
    await page.goto(url)
    await page.waitForTimeout(600)
    if (act) await act(page)
    await page.waitForTimeout(500)

    const box = await page.evaluate((withHeader) => {
      const cards = [...document.querySelectorAll('.card')].filter((e) => e.offsetParent !== null)
      const els = withHeader ? [document.querySelector('.brand'), ...cards] : cards
      const rects = els.map((e) => e.getBoundingClientRect())
      const card = cards[0].getBoundingClientRect()
      const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - (withHeader ? 36 : 28))
      const bottom = Math.max(...rects.map((r) => r.bottom)) + 26
      return { x: card.left - 56, y: top, width: card.width + 112, height: bottom - top }
    }, !!header)
    await page.setViewportSize({ width: 1100, height: Math.ceil(box.y + box.height + 20) })
    await page.waitForTimeout(150)
    const png = await page.screenshot({ clip: box })

    // PNG -> 1200 px wide WebP, in the browser.
    const webp = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = Math.round(img.height * 1200 / img.width)
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return { data: canvas.toDataURL('image/webp', 0.86).split(',')[1], width: canvas.width, height: canvas.height }
    }, png.toString('base64'))
    fs.writeFileSync(path.join(outDir, `${name}.webp`), Buffer.from(webp.data, 'base64'))
    console.log(`${name}: [${webp.width}, ${webp.height}]`)
    await page.close()
  }
  await browser.close()
})()
