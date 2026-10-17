// Desktop (1400x900) pass: open every view, wait for data, screenshot, dump on-screen text and
// every /api response the page received.  Usage: node desktop.js [baseUrl] [outName]
const L = require('./lib')
const fs = require('fs')

const BASE = process.argv[2] || 'http://localhost:5173'
const NAME = process.argv[3] || 'desktop'
const DIR = `${L.WORK}/${NAME}`
const PRICE_TRIAL = process.env.PRICE_TRIAL || 'NCT06452277' // SOHO-02: top months-saved trial in the default clear
fs.mkdirSync(DIR, { recursive: true })

;(async () => {
  const log = { base: BASE, views: {}, shots: [], steps: [] }
  const browser = await L.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })
  // The Calm redesign starts a new visitor in Simple; these grabs (and compare.js) read the full Detailed content.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('concord.density', 'detailed')
    } catch {
      /* storage off */
    }
  })
  L.instrument(page, log)
  const step = (s) => {
    log.steps.push({ t: new Date().toISOString(), s })
    console.log(new Date().toISOString(), s)
  }
  const snap = async (name) => {
    log.shots.push(await L.shot(page, DIR, name))
    log.views[name] = await L.grab(page)
  }
  try {
    step('open app')
    await page.goto(BASE + L.RESEARCH_START, { waitUntil: 'domcontentloaded' }) // research views; the landing page does not clear
    await L.waitCleared(page, 'US-Northeast')
    await L.settle(page, 2500)

    // 1. Map, each allocation toggle
    for (const [key, label] of [
      ['actual', 'Registered'],
      ['indep', 'Best response'],
      ['coord', 'Coordinated (no losers)'],
      ['coord_free', 'Joint optimum'],
    ]) {
      step('map ' + key)
      await page.evaluate((label) => {
        const b = [...document.querySelectorAll('.map-wrap .seg-btn')].find((x) => x.innerText.trim() === label)
        if (!b) throw new Error('alloc toggle not found ' + label)
        b.click()
      }, label)
      await L.settle(page, 1200)
      await snap(`01_map_${key}`)
    }

    // 2. Clear it, assumptions open
    step('clear it')
    await L.clickTab(page, 'Clear it')
    await page.evaluate(() => {
      const d = document.querySelector('details.assumptions')
      if (d) d.open = true
    })
    await L.sleep(600)
    await snap('02_clear_default')

    // 3. Robustness: current, default preset, Regeneron preset
    step('robustness')
    await L.clickTab(page, 'Robustness')
    await L.waitNoLoading(page)
    await snap('03_robustness_current')
    await L.clickButton(page, 'US-Northeast (default)')
    await L.waitNoLoading(page)
    await snap('03_robustness_default')
    await L.clickButton(page, 'Regeneron portfolio, Sept 2024')
    await L.waitNoLoading(page)
    await snap('03_robustness_regeneron')

    // 4. Price tags for one trial, then slot values
    step('price tags')
    await L.clickTab(page, 'Price tags')
    await page.select('main .controls select', PRICE_TRIAL)
    await L.sleep(800)
    await L.waitNoLoading(page)
    await snap('04_pricetags')
    step('slot values')
    await L.clickButton(page, 'Compute slot values')
    await L.sleep(800)
    await L.waitNoLoading(page)
    await snap('05_slotvalues')

    // 5. Terms (default: busiest coordinated site, its first trial)
    step('terms')
    await L.clickTab(page, 'Pre-cleared terms')
    await page.waitForFunction(() => document.querySelector('main .kv-grid') || document.querySelector('main .error'), {
      timeout: L.LONG,
      polling: 500,
    })
    await L.waitNoLoading(page)
    await snap('06_terms')

    // 6. Model & data: congestion card, backtest, all specifications, compiler on the sample
    step('model')
    await L.clickTab(page, 'Model & data')
    await page.waitForFunction(() => document.querySelector('main .coefplot') || document.querySelector('main .error'), {
      timeout: L.LONG,
      polling: 500,
    })
    await L.waitNoLoading(page)
    await page.evaluate(() => document.querySelectorAll('main details').forEach((d) => (d.open = true)))
    await L.clickButton(page, 'Compile criteria')
    await page.waitForFunction(() => document.querySelector('main .compiled') || document.querySelector('main .error'), {
      timeout: L.LONG,
      polling: 500,
    })
    await L.sleep(500)
    await snap('07_model')

    // 7. Portfolio: Regeneron, Sept 2024 preset (last: it replaces the cleared scenario)
    step('portfolio')
    await L.clickTab(page, 'Portfolio')
    await L.sleep(1500)
    await snap('08_portfolio_before')
    await L.clickButton(page, 'Preset: Regeneron, Sept 2024')
    await L.waitCleared(page, 'Regeneron')
    await L.waitNoLoading(page)
    await L.sleep(1500)
    await snap('08_portfolio_regeneron')

    // Robustness "current scenario" after the portfolio clear
    step('robustness current = regeneron')
    await L.clickTab(page, 'Robustness')
    await L.waitNoLoading(page)
    await snap('09_robustness_current_after_portfolio')
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
