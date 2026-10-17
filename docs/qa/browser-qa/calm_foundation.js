// Calm foundation QA: screenshots of the landing page and every tab, light and dark, at 1440 and 390 px; page and
// console errors; horizontal page scroll; header height across widths and tabs; touch target sizes on the phone.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node calm_foundation.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5201'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/foundation'
fs.mkdirSync(OUT, { recursive: true })

// #research/model: the Research tab without starting the two-minute clear.
// The tabs in their header order (Protocol to terms first), then the Sponsor budget screen: it is out of the main
// navigation but still opens at #financial.
const ROUTES = [
  ['landing', '#home'],
  ['terms-flow', '#terms-flow'],
  ['overlap', '#overlap'],
  ['findings', '#findings'],
  ['site-scores', '#site-scores'],
  ['financial', '#financial'],
  ['research', '#research/model'],
  ['dev', '#dev/components'],
]
const WIDTHS = [1440, 390]
const THEMES = ['light', 'dark']
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

async function settle(page) {
  try {
    await page.waitForFunction(() => !document.querySelector('main .loading, main [role="status"].loading'), { timeout: 90000, polling: 300 })
  } catch {
    /* recorded below */
  }
  try {
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 30000 })
  } catch {
    /* keep going */
  }
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await sleep(700)
}

async function openPage(browser, width, theme, log) {
  const page = await browser.newPage()
  const phone = width < 600
  await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone })
  await page.evaluateOnNewDocument((theme) => {
    try {
      localStorage.setItem('concord.theme', theme)
    } catch {
      /* ignore */
    }
  }, theme)
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text())
  })
  page.on('pageerror', (e) => log.pageerrors.push(String(e)))
  page.on('requestfailed', (r) => {
    const f = r.failure()
    if (f && !/ERR_ABORTED/.test(f.errorText)) log.failed.push(`${r.url()} ${f.errorText}`)
  })
  return page
}

;(async () => {
  const browser = await launch()
  const report = { base: BASE, runs: [], header: [] }
  try {
    for (const width of WIDTHS)
      for (const theme of THEMES)
        for (const [name, hash] of ROUTES) {
          if (ONLY && !ONLY.includes(name)) continue
          const log = { name, width, theme, console: [], pageerrors: [], failed: [] }
          const page = await openPage(browser, width, theme, log)
          await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
          await settle(page)
          Object.assign(
            log,
            await page.evaluate(() => {
              const de = document.documentElement
              const over = []
              if (de.scrollWidth > de.clientWidth + 1) {
                for (const el of document.querySelectorAll('body *')) {
                  const r = el.getBoundingClientRect()
                  if (r.right > de.clientWidth + 1 && r.width > 0) {
                    let a = el.parentElement
                    let clipped = false
                    while (a && a !== document.body) {
                      const ox = getComputedStyle(a).overflowX
                      if (ox !== 'visible') {
                        clipped = true
                        break
                      }
                      a = a.parentElement
                    }
                    if (!clipped) over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`)
                  }
                }
              }
              const hdr = document.querySelector('.appbar-top') || document.querySelector('.lp-head')
              const tabs = document.querySelector('nav.tabs')
              const theme = de.dataset.theme
              const density = de.dataset.density
              const fontOk = document.fonts.check('17px "Atkinson Hyperlegible Next"') && document.fonts.check('17px "Atkinson Hyperlegible Mono"')
              const bodyFont = getComputedStyle(document.body).fontFamily
              // Touch targets: every visible button, link-button, select and input in the header and the page's controls.
              const small = []
              for (const el of document.querySelectorAll('header button, header a, .appbar-top button, nav.tabs button, .seg-btn, .btn, select, input:not([type=checkbox]):not([type=radio]):not([type=range])')) {
                const r = el.getBoundingClientRect()
                if (r.width === 0 || r.height === 0) continue
                if (getComputedStyle(el).visibility === 'hidden') continue
                if (r.height < 43.5 || (el.matches('button,select') && r.width < 43.5)) small.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
              }
              return {
                scrollWidth: de.scrollWidth,
                clientWidth: de.clientWidth,
                hscroll: de.scrollWidth > de.clientWidth + 1,
                overflow: over.slice(0, 12),
                headerTop: hdr ? Math.round(hdr.getBoundingClientRect().height * 10) / 10 : null,
                tabsH: tabs ? Math.round(tabs.getBoundingClientRect().height * 10) / 10 : null,
                theme,
                density,
                fontOk,
                bodyFont,
                coarse: matchMedia('(pointer: coarse)').matches,
                smallTargets: small.slice(0, 20),
                title: document.title,
                h1: document.querySelector('h1')?.innerText.slice(0, 80) ?? null,
              }
            }),
          )
          const file = path.join(OUT, `${name}-${width}-${theme}.png`).replace(/\\/g, '/')
          await page.screenshot({ path: file, fullPage: true })
          log.shot = file
          report.runs.push(log)
          console.log(
            `${name} ${width} ${theme}: errors ${log.console.length + log.pageerrors.length}, hscroll ${log.hscroll}, header ${log.headerTop}/${log.tabsH}, fonts ${log.fontOk}, small ${log.smallTargets.length}`,
          )
          await page.close()
        }

    // Header height on every tab across widths (the plumbing review's Research issue): one height per width.
    if (!ONLY || ONLY.includes('header')) {
      const widths = [320, 360, 390, 414, 480, 600, 641, 700, 768, 800, 1024, 1280, 1319, 1320, 1366, 1440]
      const page = await openPage(browser, 1440, 'light', { console: [], pageerrors: [], failed: [] })
      for (const [name, hash] of ROUTES.filter(([n]) => n !== 'landing' && n !== 'dev')) {
        await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
        await sleep(1200)
        const row = { name }
        for (const w of widths) {
          await page.setViewport({ width: w, height: 900 })
          await sleep(150)
          row[w] = await page.evaluate(() => {
            const top = document.querySelector('.appbar-top')
            const tabs = document.querySelector('nav.tabs')
            const appbar = document.querySelector('.appbar')
            const one = appbar && getComputedStyle(appbar).display !== 'contents'
            const h = one ? appbar.getBoundingClientRect().height : (top?.getBoundingClientRect().height ?? 0) + (tabs?.getBoundingClientRect().height ?? 0)
            const hidden = tabs ? tabs.scrollWidth > tabs.clientWidth + 1 : null
            return `${Math.round(h * 10) / 10}${one ? ' one-row' : ''}${hidden ? ' tabs-scroll' : ''}${document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? ' HSCROLL' : ''}`
          })
        }
        report.header.push(row)
        console.log(name, JSON.stringify(row))
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  const bad = report.runs.filter((r) => r.console.length || r.pageerrors.length || r.hscroll)
  console.log(`\n${report.runs.length} runs; ${bad.length} with errors or horizontal scroll`)
  for (const b of bad) console.log(b.name, b.width, b.theme, JSON.stringify({ console: b.console.slice(0, 3), pageerrors: b.pageerrors.slice(0, 3), overflow: b.overflow }))
})()
