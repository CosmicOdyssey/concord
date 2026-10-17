// Research tab screenshots: each sub-route at one width, theme and density, full page, with the page's horizontal
// scroll width and any page or console errors.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node research_snap.js <outDir> [width] [light|dark] [simple|detailed] [subs,comma]
const path = require('path')
const fs = require('fs')
const { launch, sleep } = require('./lib')

const BASE = process.env.BASE || 'http://127.0.0.1:5216'
const [, , OUT = 'C:/Users/micha/Projects/concord/data/work/R/research', W = '1440', THEME = 'light', DENS = 'simple', SUBS = 'clear,robustness,map,portfolio,prices,terms,model'] = process.argv
fs.mkdirSync(OUT, { recursive: true })

;(async () => {
  const browser = await launch()
  const page = await browser.newPage()
  const w = Number(W)
  await page.setViewport({ width: w, height: 900, isMobile: w < 600, hasTouch: w < 600 })
  await page.evaluateOnNewDocument(
    (t, d) => {
      localStorage.setItem('concord.theme', t)
      localStorage.setItem('concord.density', d)
    },
    THEME,
    DENS,
  )
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.text()))
  for (const sub of SUBS.split(',')) {
    const hash = sub.includes('/') ? sub : `research/${sub}`
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    try {
      await page.waitForFunction(() => !document.querySelector('main .loading'), { timeout: 240000, polling: 300 })
    } catch {
      /* screenshot shows it */
    }
    try {
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 })
    } catch {
      /* map tiles */
    }
    await sleep(800)
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
    const name = `${hash.replace(/\//g, '_')}-${W}-${THEME}-${DENS}.png`
    await page.screenshot({ path: path.join(OUT, name).replace(/\\/g, '/'), fullPage: true })
    console.log(name, 'scrollWidth/innerWidth', sw.join('/'))
  }
  console.log('errors', errs.length, JSON.stringify(errs.slice(0, 10)))
  await browser.close()
})()
