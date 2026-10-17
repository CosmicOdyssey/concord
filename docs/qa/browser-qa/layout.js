// Layout pass at a given width: every view, overflow check + screenshots (viewport and full page).
// Usage: node layout.js <baseUrl> <outName> <width> <height> [mobile=1]
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5173'
const NAME = process.argv[3] || 'phone'
const W = Number(process.argv[4] || 380)
const H = Number(process.argv[5] || 800)
const MOBILE = (process.argv[6] ?? '1') === '1'
const DIR = `${L.WORK}/${NAME}`
const PRICE_TRIAL = process.env.PRICE_TRIAL || 'NCT06452277'
fs.mkdirSync(DIR, { recursive: true })

;(async () => {
  const log = { base: BASE, width: W, views: {}, layout: {}, shots: [], steps: [] }
  const browser = await L.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, isMobile: MOBILE, hasTouch: MOBILE, deviceScaleFactor: MOBILE ? 2 : 1 })
  L.instrument(page, log)
  const step = (s) => {
    log.steps.push({ t: new Date().toISOString(), s })
    console.log(new Date().toISOString(), s)
  }
  const check = async (name) => {
    // scroll through the page once so lazy layout settles, then measure
    log.layout[name] = await L.layoutCheck(page)
    log.views[name] = await L.grab(page)
    log.shots.push(await L.shot(page, DIR, name, true))
    log.shots.push(await L.shot(page, DIR, name + '_top', false))
    const lc = log.layout[name]
    console.log(`  ${name}: innerWidth ${lc.innerWidth} docScrollWidth ${lc.docScrollWidth} overflow ${lc.overflow} offenders ${lc.offenders.length} scrollers ${lc.scrollers.length}`)
  }
  try {
    step('open app')
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await L.waitCleared(page, 'US-Northeast')
    await L.settle(page, 2000)
    await check('01_map')
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.map-wrap .seg-btn')].find((x) => x.innerText.trim() === 'Joint optimum')
      b && b.click()
    })
    await L.settle(page, 800)
    await check('01_map_joint')

    step('clear it')
    await L.clickTab(page, 'Clear it')
    await page.evaluate(() => {
      const d = document.querySelector('details.assumptions')
      if (d) d.open = true
    })
    await L.sleep(600)
    await check('02_clear')

    step('robustness')
    await L.clickTab(page, 'Robustness')
    await L.waitNoLoading(page)
    await check('03_robustness')
    await L.clickButton(page, 'Regeneron portfolio, Sept 2024')
    await L.waitNoLoading(page)
    await check('03_robustness_regeneron')

    step('price tags')
    await L.clickTab(page, 'Price tags')
    await page.select('main .controls select', PRICE_TRIAL)
    await L.sleep(800)
    await L.waitNoLoading(page)
    await check('04_pricetags')
    step('slot values')
    await L.clickButton(page, 'Compute slot values')
    await L.sleep(800)
    await L.waitNoLoading(page)
    await check('05_slotvalues')

    step('terms')
    await L.clickTab(page, 'Pre-cleared terms')
    await page.waitForFunction(() => document.querySelector('main .kv-grid') || document.querySelector('main .error'), { timeout: L.LONG, polling: 500 })
    await L.waitNoLoading(page)
    await check('06_terms')

    step('model')
    await L.clickTab(page, 'Model & data')
    await page.waitForFunction(() => document.querySelector('main .coefplot') || document.querySelector('main .error'), { timeout: L.LONG, polling: 500 })
    await L.waitNoLoading(page)
    await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true)))
    await L.clickButton(page, 'Compile criteria')
    await page.waitForFunction(() => document.querySelector('main .compiled') || document.querySelector('main .error'), { timeout: L.LONG, polling: 500 })
    await L.sleep(500)
    await check('07_model')

    step('portfolio')
    await L.clickTab(page, 'Portfolio')
    await L.sleep(1200)
    await check('08_portfolio_before')
    await L.clickButton(page, 'Preset: Regeneron, Sept 2024')
    await L.waitCleared(page, 'Regeneron')
    await L.waitNoLoading(page)
    await L.sleep(1200)
    await check('08_portfolio_regeneron')
    step('done')
  } catch (e) {
    log.error = String(e && e.stack ? e.stack : e)
    console.error(e)
    try {
      await L.shot(page, DIR, 'zz_error')
    } catch {}
  } finally {
    L.save(`${L.WORK}/${NAME}_log.json`, log)
    await browser.close()
  }
})()
