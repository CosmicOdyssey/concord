// Shared helpers for the browser QA scripts (puppeteer-core driving installed Chrome).
// puppeteer-core is installed in C:/Users/micha/Projects/concord/data/work/D (run with NODE_PATH set there).
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const WORK = 'C:/Users/micha/Projects/concord/data/work/D'
const LONG = 400_000

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 900_000,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu'],
  })
}

/** Record every /api response body the page receives, plus console errors and page errors. */
function instrument(page, log) {
  log.api = []
  log.console = []
  log.pageerrors = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.console.push({ type: m.type(), text: m.text() })
  })
  page.on('pageerror', (e) => log.pageerrors.push(String(e && e.stack ? e.stack : e)))
  page.on('response', async (res) => {
    const url = res.url()
    if (!url.includes('/api/')) return
    const req = res.request()
    let body = null
    try {
      body = await res.json()
    } catch {
      try {
        body = await res.text()
      } catch {
        body = null
      }
    }
    log.api.push({ url, method: req.method(), post: req.postData() ?? null, status: res.status(), body, t: Date.now() })
  })
}

// Pre-pivot tab labels that now name a Research sub-tab.
const TAB_ALIASES = { 'Pre-cleared terms': 'Term sheet', Portfolio: 'Portfolio clearing' }
const RESEARCH_SUBTABS = ['Clear it', 'Robustness', 'Map', 'Portfolio clearing', 'Price tags', 'Term sheet', 'Model & data']

/** Click a top-level tab (Findings, Portfolio overlap, Protocol to terms, Research) or a Research sub-tab by
 *  its label; a sub-tab opens Research first. Old labels from the 7-tab app map through TAB_ALIASES. */
async function clickTab(page, label) {
  const want = TAB_ALIASES[label] ?? label
  const top = await page.evaluate((want) => {
    const name = (b) => [...b.childNodes].filter((n) => !(n.classList && n.classList.contains('tab-num'))).map((n) => n.textContent).join('').trim()
    const b = [...document.querySelectorAll('nav.tabs button')].find((x) => name(x) === want)
    if (!b) return false
    b.click()
    return true
  }, want)
  if (!top && RESEARCH_SUBTABS.includes(want)) {
    if (!(await page.$('.rs-tabs'))) {
      await clickTab(page, 'Research')
      await page.waitForSelector('.rs-tabs', { timeout: 60000 })
    }
    await page.evaluate((want) => {
      const b = [...document.querySelectorAll('.rs-tabs button')].find((x) => x.innerText.trim() === want)
      if (!b) throw new Error('research sub-tab not found ' + want)
      b.click()
    }, want)
  } else if (!top) {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll('nav.tabs button')].find((x) => x.innerText.includes(label))
      if (!b) throw new Error('tab not found ' + label)
      b.click()
    }, label)
  }
  await sleep(500)
}

/** The research views' starting point (the old app opened on the map and cleared on load). */
const RESEARCH_START = '/#research/map'

async function clickButton(page, text, scope = 'main') {
  await page.evaluate(
    (text, scope) => {
      const b = [...document.querySelectorAll(`${scope} button`)].find((x) => x.innerText.trim().startsWith(text))
      if (!b) throw new Error('button not found ' + text)
      b.click()
    },
    text,
    scope,
  )
  await sleep(400)
}

async function waitCleared(page, mustInclude = '') {
  await page.waitForFunction(
    (inc) => {
      const t = document.querySelector('.run-status')?.innerText ?? ''
      return t.includes('Cleared') && t.includes(inc)
    },
    { timeout: LONG, polling: 500 },
    mustInclude,
  )
  await sleep(600)
}

async function waitNoLoading(page, timeout = LONG) {
  await page.waitForFunction(() => !document.querySelector('main .loading'), { timeout, polling: 500 })
  await sleep(500)
}

async function settle(page, ms = 1500) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 })
  } catch {
    /* map tiles may keep the network busy */
  }
  await sleep(ms)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function shot(page, dir, name, fullPage = true) {
  const p = path.join(dir, `${name}.png`).replace(/\\/g, '/')
  await page.screenshot({ path: p, fullPage })
  return p
}

/** Structured dump of what is on screen: main text, every table's cells, stat tiles. */
async function grab(page) {
  return page.evaluate(() => {
    const txt = (el) => (el ? el.innerText.replace(/\u00a0/g, ' ').trim() : null)
    const tables = [...document.querySelectorAll('main table')].map((t) => ({
      cls: t.className,
      head: [...t.querySelectorAll('thead tr')].map((r) => [...r.children].map(txt)),
      rows: [...t.querySelectorAll('tbody tr')].map((r) => [...r.children].map(txt)),
      foot: [...t.querySelectorAll('tfoot tr')].map((r) => [...r.children].map(txt)),
    }))
    const stats = [...document.querySelectorAll('main .stat')].map((s) => ({
      label: txt(s.querySelector('.stat-label')),
      value: txt(s.querySelector('.stat-value')),
      sub: txt(s.querySelector('.stat-sub')),
    }))
    return {
      runstatus: txt(document.querySelector('.run-status')),
      main: txt(document.querySelector('main')),
      tables,
      stats,
    }
  })
}

/** Phone-width layout check: page-level overflow and elements that stick out of the viewport
 *  without being inside a horizontal scroll container that itself fits (i.e. cut off, or
 *  forcing page scroll). */
async function layoutCheck(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const de = document.documentElement
    const res = {
      innerWidth: vw,
      docScrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflow: de.scrollWidth > vw,
      offenders: [],
      scrollers: [],
    }
    const scroller = (el) => {
      for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return a
      }
      return null
    }
    const desc = (el) => {
      let s = el.tagName.toLowerCase()
      if (el.id) s += '#' + el.id
      if (el.className && typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).join('.')
      return s
    }
    const off = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.closest('.leaflet-container')) continue
      if (r.right > vw + 1 || r.left < -1) {
        const sc = scroller(el)
        if (sc) {
          const sr = sc.getBoundingClientRect()
          const ox = getComputedStyle(sc).overflowX
          // Reachable by scrolling a box that fits on screen: fine.
          if ((ox === 'auto' || ox === 'scroll') && sr.right <= vw + 1 && sr.left >= -1) continue
        }
        off.push(el)
      }
    }
    // Keep only outermost offenders.
    const set = new Set(off)
    for (const el of off) {
      let a = el.parentElement
      let nested = false
      while (a) {
        if (set.has(a)) {
          nested = true
          break
        }
        a = a.parentElement
      }
      if (nested) continue
      const r = el.getBoundingClientRect()
      res.offenders.push({ el: desc(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 70) })
    }
    for (const el of document.querySelectorAll('main *')) {
      const ox = getComputedStyle(el).overflowX
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        res.scrollers.push({ el: desc(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })
    }
    res.offenders = res.offenders.slice(0, 40)
    return res
  })
}

function save(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 1))
}

module.exports = { launch, instrument, clickTab, RESEARCH_START, clickButton, waitCleared, waitNoLoading, settle, sleep, shot, grab, layoutCheck, save, WORK, LONG }
