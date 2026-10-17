// Protocol to terms view: screenshots at 1440x900 and 390 px, console/page errors, horizontal overflow,
// and the print view as PDF.  Usage: node terms_flow.js [baseUrl] [outDir]
// puppeteer-core lives in C:/Users/micha/Projects/concord/data/work/D (required by absolute path).
const puppeteer = require('C:/Users/micha/Projects/concord/data/work/D/node_modules/puppeteer-core')
const fs = require('fs')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:5182'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/W2/screens'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ready(page) {
  await page.waitForSelector('.tf-grid', { timeout: 60000 })
  await page.waitForFunction(
    () => document.querySelectorAll('.tf-stats .stat-value').length >= 4 && document.querySelector('.tf-decomp-total'),
    { timeout: 60000, polling: 300 },
  )
  await sleep(800)
}

;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-gpu'] })
  const log = { console: [], pageerrors: [], failed: [] }
  const run = async (name, width, height, fn) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/terms-flow') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await fn(page)
    await page.close()
  }

  await run('desktop', 1440, 900, async (page) => {
    await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.screenshot({ path: path.join(OUT, 'terms-flow_1440_top.png') })
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.tf-grid button.tf-cell')].find((x) => x.title.startsWith('Cycle 7 Day 1, CT chest'))
      b?.click()
    })
    await sleep(500)
    for (const [id, name] of [
      ['#tf-step-2', 'schedule'],
      ['#tf-step-3', 'coverage'],
      ['#tf-step-4', 'budget'],
      ['#tf-step-5', 'standard'],
    ]) {
      const el = await page.$(id)
      await el.screenshot({ path: path.join(OUT, `terms-flow_1440_${name}.png`) })
    }
    await page.evaluate(() => {
      const r = [...document.querySelectorAll('.tf-cmp-tbl tbody tr.clickable')][0]
      r?.click()
    })
    await sleep(400)
    await (await page.$('#tf-step-6')).screenshot({ path: path.join(OUT, 'terms-flow_1440_compare.png') })
    await (await page.$('#tf-step-7')).screenshot({ path: path.join(OUT, 'terms-flow_1440_termsheet.png') })
    await page.screenshot({ path: path.join(OUT, 'terms-flow_1440_full.png'), fullPage: true })
    log.desktopText = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
    log.desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    log.stepLabels = await page.evaluate(() =>
      [4, 6].map((n) => {
        const t = document.querySelector(`#tf-step-${n} .tf-step-head`)?.textContent ?? ''
        return { step: n, illustrative: t.includes('Illustrative, authored from public trial information'), disclaimer: t.includes('Decision support. Not a fair-market-value legal opinion.') }
      }),
    )
    log.statsText = await page.evaluate(() => document.querySelector('.tf-stats')?.innerText ?? '')
    log.composeText = await page.evaluate(() => document.querySelector('.tf-compose')?.innerText ?? '')
    log.compareText = await page.evaluate(() => document.querySelector('#tf-step-6')?.innerText ?? '')
  })

  await run('mobile', 390, 844, async (page) => {
    await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.screenshot({ path: path.join(OUT, 'terms-flow_390_top.png') })
    await page.screenshot({ path: path.join(OUT, 'terms-flow_390_full.png'), fullPage: true })
    log.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    log.mobileWide = await page.evaluate(() =>
      [...document.querySelectorAll('main *')]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.table-scroll, .tf-timeline-wrap'))
        .slice(0, 10)
        .map((e) => `${e.tagName}.${e.className}`),
    )
  })

  await run('interact', 1440, 900, async (page) => {
    await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const perParticipant = () => page.evaluate(() => document.querySelector('.tf-stats .stat-emph .stat-value')?.textContent)
    const before = await perParticipant()
    // reviewer override: flip the week-18 CT chest to routine via its coverage chip
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.tf-vchip')].find((b) => b.textContent.startsWith('C7') && b.closest('.tf-cov-row')?.textContent.includes('CT chest'))
      chip?.click()
    })
    await page.waitForFunction((b) => document.querySelector('.tf-stats .stat-emph .stat-value')?.textContent !== b, { timeout: 15000 }, before)
    await sleep(600)
    const afterOverride = await perParticipant()
    const badge = await page.evaluate(() => document.querySelector('#tf-step-3 .tf-ovcount')?.textContent ?? '')
    // multiplier 120%
    const input = await page.$('.tf-mult-input input')
    await input.click({ clickCount: 3 })
    await input.type('120')
    await page.waitForFunction((b) => document.querySelector('.tf-stats .stat-emph .stat-value')?.textContent !== b, { timeout: 15000 }, afterOverride)
    await sleep(600)
    const afterMult = await perParticipant()
    const mdHref = await page.evaluate(() => document.querySelector('.tf-sheet-actions a[download]')?.getAttribute('href'))
    const md = await (await fetch(BASE + mdHref)).text()
    log.interact = {
      before,
      afterOverride,
      afterMult,
      badge,
      mdHasOverride: md.includes('reviewer override (rule R4 said research)'),
      mdHas120: md.includes('120% of Medicare'),
      mdHasDisclaimer: md.includes('Decision support. Not a fair-market-value legal opinion.'),
    }
    await page.evaluate(() => {
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
    })
  })

  await run('light', 1440, 900, async (page) => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    await page.goto(`${BASE}/#terms-flow/NCT05800015`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.screenshot({ path: path.join(OUT, 'terms-flow_1440_light_top.png') })
    await (await page.$('#tf-step-6')).screenshot({ path: path.join(OUT, 'terms-flow_1440_light_compare.png') })
  })

  await run('az', 1440, 900, async (page) => {
    await page.goto(`${BASE}/#terms-flow/NCT06627647`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    await page.screenshot({ path: path.join(OUT, 'terms-flow_1440_NCT06627647_top.png') })
    await (await page.$('#tf-step-6')).screenshot({ path: path.join(OUT, 'terms-flow_1440_NCT06627647_compare.png') })
    log.azText = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
  })

  await run('print', 1100, 900, async (page) => {
    const sites = await (await fetch(`${BASE}/api/terms-flow/NCT05800015/sites`)).json()
    const [a, b] = sites.default_pair
    await page.goto(`${BASE}/api/terms-flow/NCT05800015/termsheet.html?site_id=${a}&compare_site=${b}&multiplier=1`, { waitUntil: 'load' })
    await page.screenshot({ path: path.join(OUT, 'termsheet_print_view.png') })
    await page.pdf({ path: path.join(OUT, 'termsheet_print_view.pdf'), format: 'Letter', printBackground: true })
    const md = await (await fetch(`${BASE}/api/terms-flow/NCT05800015/termsheet.md?site_id=${a}&compare_site=${b}&multiplier=1`)).text()
    fs.writeFileSync(path.join(OUT, 'termsheet_NCT05800015_NYU_vs_Hattiesburg.md'), md)
  })

  // The print view must not scroll sideways on a phone: wide tables scroll inside their own wrappers.
  await run('print390', 390, 844, async (page) => {
    const sites = await (await fetch(`${BASE}/api/terms-flow/NCT05800015/sites`)).json()
    const [a, b] = sites.default_pair
    await page.goto(`${BASE}/api/terms-flow/NCT05800015/termsheet.html?site_id=${a}&compare_site=${b}&multiplier=1`, { waitUntil: 'load' })
    log.print390 = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    await page.screenshot({ path: path.join(OUT, 'termsheet_print_view_390.png') })
  })

  // Leaving the tab and coming back keeps the trial; the address bar carries it.
  await run('persist', 1440, 900, async (page) => {
    await page.goto(`${BASE}/#terms-flow/NCT06627647`, { waitUntil: 'domcontentloaded' })
    await ready(page)
    const tabBtn = async (label) =>
      page.evaluate((l) => {
        // tab buttons render "<number><label>"
        const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent.trim().endsWith(l))
        b?.click()
        return !!b
      }, label)
    const left = await tabBtn('Model & data')
    await sleep(800)
    const hashAway = await page.evaluate(() => window.location.hash)
    const back = await tabBtn('Protocol to terms')
    await ready(page)
    log.persist = {
      left,
      hashAway,
      back,
      hash: await page.evaluate(() => window.location.hash),
      selected: await page.evaluate(() => document.querySelector('.tf-trial-on a')?.textContent ?? ''),
    }
    await page.evaluate(() => {
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
    })
  })

  await browser.close()
  fs.writeFileSync(path.join(OUT, 'qa_log.json'), JSON.stringify(log, null, 1))
  console.log(
    JSON.stringify(
      {
        console: log.console,
        pageerrors: log.pageerrors,
        failed: log.failed,
        desktopOverflow: log.desktopOverflow,
        mobileOverflow: log.mobileOverflow,
        mobileWide: log.mobileWide,
        interact: log.interact,
        stepLabels: log.stepLabels,
        print390: log.print390,
        persist: log.persist,
        stats: log.statsText,
        compose: log.composeText,
      },
      null,
      1,
    ),
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
