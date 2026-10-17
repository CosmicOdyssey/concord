// Deep links that need the clear: wait for it to finish, then check the sub-tab rendered its content.
// Usage: node findings_deeplinks.js <baseUrl>   (NODE_PATH = C:/Users/micha/Projects/concord/data/work/D/node_modules)
const L = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5173'

;(async () => {
  const browser = await L.launch()
  const out = []
  try {
    for (const hash of ['#terms', '#prices/NCT06452277', '#research/map']) {
      const log = {}
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      L.instrument(page, log)
      const t0 = Date.now()
      await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.rs-banner', { timeout: 60000 })
      const tShell = Date.now() - t0
      await L.waitCleared(page, 'US-Northeast')
      await L.waitNoLoading(page)
      await L.settle(page, 1500)
      out.push({
        hash,
        tShellMs: tShell,
        tClearedMs: Date.now() - t0,
        sub: await page.evaluate(() => document.querySelector('.rs-tab-on')?.innerText),
        h1: await page.evaluate(() => document.querySelector('main h1')?.innerText ?? null),
        selects: await page.evaluate(() => [...document.querySelectorAll('main select')].map((s) => s.value)),
        clearCalls: log.api.filter((a) => a.url.includes('/api/clear')).length,
        pageerrors: log.pageerrors,
      })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(JSON.stringify(out, null, 1))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
