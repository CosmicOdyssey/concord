// Site proposal check (Protocol to terms, step 5): Simple and Detailed, light and dark, 1440 and 390 px. Loads the
// SYNTHETIC sample with the keyboard, compares the on-screen counts with the API, checks the always-visible labels
// (synthetic, assumption, disclaimer, illustrative), no forecast wording, no horizontal page scroll, hover cards on
// focus, a messy CSV upload with markup in an item (rendered as text), and the counter-proposal download (Simple:
// flagged lines; Detailed: every line), which is opened and screenshotted too.
// Usage (NODE_PATH must reach puppeteer-core): node terms_proposal.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5284'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/proposal'
const NCT = 'NCT05800015'
const DISCLAIMER = 'Decision support. Not a fair-market-value legal opinion.'
const ILLUSTRATIVE = 'Illustrative, authored from public trial information'
const FORBIDDEN = ['time-to-fill', 'time to fill', 'enrollment rate', 'speedup', 'speed-up', 'faster', 'months saved', 'savings']
fs.mkdirSync(OUT, { recursive: true })

const fails = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [], runs: {} }
  const sample = await (await fetch(`${BASE}/api/terms-flow/${NCT}/proposal-sample`)).json()
  const sites = await (await fetch(`${BASE}/api/terms-flow/${NCT}/sites`)).json()
  const site = sites.default_pair[0]
  const api = await (
    await fetch(`${BASE}/api/terms-flow/${NCT}/proposal-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: site, csv: sample.csv }),
    })
  ).json()

  const open = async (name, width, theme, density) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
    page.on('dialog', async (d) => {
      log.pageerrors.push(`${name}: unexpected dialog ${d.message()}`)
      await d.dismiss()
    })
    await page.evaluateOnNewDocument(
      (theme, density) => {
        try {
          if (!sessionStorage.getItem('qa-cleared')) {
            localStorage.clear()
            sessionStorage.setItem('qa-cleared', '1')
          }
          localStorage.setItem('concord.theme', theme)
          localStorage.setItem('concord.density', density)
        } catch {
          /* ignore */
        }
      },
      theme,
      density,
    )
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${BASE}/#terms-flow/${NCT}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#tf-step-5 .tp', { timeout: 60000 })
    await page.waitForFunction(() => [...document.querySelectorAll('#tf-step-5 button')].some((b) => b.textContent.includes('Load synthetic sample')), {
      timeout: 60000,
    })
    return page
  }

  const step5 = (page) => page.$eval('#tf-step-5', (el) => el.innerText)

  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${width}-${theme}`
        const page = await open(name, width, theme, density)
        // keyboard: focus the sample button and press Enter
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('#tf-step-5 button')].find((x) => x.textContent.includes('Load synthetic sample'))
          b.scrollIntoView({ block: 'center' })
          b.focus()
        })
        await page.keyboard.press('Enter')
        await page.waitForSelector('#tf-step-5 .tp-summary', { timeout: 60000 })
        await sleep(900)
        const text = await step5(page)
        const tally = await page.$$eval('#tf-step-5 .tp-tally li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ').trim()))
        const c = api.summary.counts
        const want = [`${c.above} above range`, `${c.below} below range`, `${c.justify} needs itemized justification`, `${c.unmatched} not in this protocol’s schedule`, `${c.in_range} in range`]
        check(`${name}: tally equals API`, JSON.stringify(tally) === JSON.stringify(want), `${JSON.stringify(tally)} vs ${JSON.stringify(want)}`)
        const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        check(`${name}: total ask shown`, text.includes(usd(api.summary.coded.total_ask)))
        check(`${name}: range shown`, text.includes(`${usd(api.summary.coded.range_low)}–${usd(api.summary.coded.range_high)}`))
        check(`${name}: SYNTHETIC label`, text.includes('SYNTHETIC sample') && text.includes('Synthetic sample.'))
        check(`${name}: assumption label`, /assumption/i.test(text))
        check(`${name}: disclaimer`, text.includes(DISCLAIMER))
        check(`${name}: illustrative strip`, text.includes(ILLUSTRATIVE))
        check(`${name}: proposed standard label`, text.includes('proposed standard (not market data)'))
        // routine-only codes (sponsor pays none) carry a visible insurance marker wherever they are listed
        const nIns = api.rows.filter((r) => r.coverage && r.coverage.sponsor_visits === 0 && r.flag !== 'in_range').length
        if (nIns) check(`${name}: insurance marker on routine-only lines`, text.includes('billed to insurance (NCD 310.1)'))
        const low = text.toLowerCase()
        check(`${name}: no forecast wording`, !FORBIDDEN.some((w) => low.includes(w)), FORBIDDEN.filter((w) => low.includes(w)).join(','))
        const nRows = await page.$$eval('#tf-step-5 .tp-table tbody tr', (r) => r.length)
        const flagged = api.rows.filter((r) => r.flag !== 'in_range').length
        check(`${name}: rows listed`, nRows === (density === 'detailed' ? api.rows.length : flagged), `${nRows}`)
        if (density === 'detailed') check(`${name}: CMS source inline`, text.includes('CMS PFS 2026') && text.includes('CMS CLFS 2026'))
        const lay = await layoutCheck(page)
        check(`${name}: no horizontal page scroll`, !lay.overflow && lay.docScrollWidth <= lay.innerWidth, `${lay.docScrollWidth}`)
        // Elements of this step that stick out of the viewport outside a scroll box that fits. (Step 1's timeline SVG
        // children show up in layoutCheck's offender list at 390 px; they sit in their own scroller and predate this step.)
        const stepOff = await page.evaluate(() => {
          const vw = innerWidth
          const out = []
          for (const el of document.querySelectorAll('#tf-step-5 *')) {
            const r = el.getBoundingClientRect()
            if (!r.width || (r.right <= vw + 1 && r.left >= -1)) continue
            let ok = false
            for (let a = el.parentElement; a && a.id !== 'tf-step-5'; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX
              const ar = a.getBoundingClientRect()
              if ((ox === 'auto' || ox === 'scroll') && ar.right <= vw + 1 && ar.left >= -1) ok = true
            }
            if (!ok) out.push(`${el.tagName}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)}`)
          }
          return out
        })
        check(`${name}: step 5 fits the viewport`, stepOff.length === 0, stepOff.slice(0, 3).join(' | '))
        // hover card on keyboard focus (Simple: sources in hover cards)
        if (density === 'simple') {
          const trig = await page.$('#tf-step-5 .tp-top .hc-trigger')
          if (check(`${name}: hover-card trigger present`, !!trig)) {
            await trig.focus()
            await sleep(500)
            const card = await page.evaluate(() => [...document.querySelectorAll('.hc-card, [role="tooltip"]')].map((e) => e.innerText).join(' | '))
            check(`${name}: hover card shows the CMS source on focus`, /CMS (PFS|CLFS) 2026/.test(card), card.slice(0, 200))
            await page.keyboard.press('Escape')
          }
        }
        const el = await page.$('#tf-step-5')
        await el.screenshot({ path: path.join(OUT, `step5-${name}.png`) })
        log.runs[name] = { tally, nRows, layout: { overflow: lay.overflow, offenders: lay.offenders.length } }
        await page.close()
      }

  // ---------------------------------------------------------------- band edits: invalid then valid again
  // The debounced band lags the typed one; going invalid long enough for the debounce to catch up and then valid
  // again must not send the stale invalid band (an HTTP 400 and a console error).
  {
    const name = 'band-race-simple-1440-light'
    const page = await open(name, 1440, 'light', 'simple')
    await page.evaluate(() => [...document.querySelectorAll('#tf-step-5 button')].find((x) => x.textContent.includes('Load synthetic sample')).click())
    await page.waitForSelector('#tf-step-5 .tp-summary', { timeout: 60000 })
    const setHigh = async (v) => {
      const inp = await page.$('#tf-step-5 input[aria-label^="Band high"]')
      await inp.click({ clickCount: 3 })
      await page.keyboard.press('Backspace')
      await inp.type(String(v))
    }
    await setHigh(120)
    await sleep(700)
    await setHigh(50)
    await sleep(900)
    check(`${name}: invalid band alert`, (await step5(page)).includes('Use a band from 10% to 500%'))
    await setHigh(150)
    await sleep(1500)
    const text = await step5(page)
    const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    check(`${name}: back to the default range`, text.includes(`${usd(api.summary.coded.range_low)}–${usd(api.summary.coded.range_high)}`))
    check(`${name}: no error shown`, !(await page.$('#tf-step-5 div.error[role="alert"]')))
    await page.close()
  }

  // ---------------------------------------------------------------- messy upload with markup in an item
  {
    const name = 'upload-detailed-1440-light'
    const page = await open(name, 1440, 'light', 'detailed')
    const file = path.join(OUT, 'qa-messy-upload.csv')
    fs.writeFileSync(file, '\ufeff# messy\nCode,Price\n71260,"$1,000"\n"<img src=x onerror=alert(1)>",50\nStudy start-up fee,$15,000\n93000,abc\n')
    const input = await page.$('#tf-step-5 input[type=file]')
    await input.uploadFile(file)
    await page.waitForFunction(() => document.querySelector('#tf-step-5 .tp-table') && document.querySelector('#tf-step-5').innerText.includes('<img src=x'), { timeout: 30000 })
    await sleep(600)
    const text = await step5(page)
    check('upload: markup rendered as text', text.includes('<img src=x onerror=alert(1)>'))
    check('upload: no injected img', (await page.$$('#tf-step-5 img')).length === 0)
    check('upload: unreadable row listed', text.includes('Rows that could not be read') && text.includes('abc'))
    check('upload: unquoted thousands read', text.includes('$15,000.00'))
    await (await page.$('#tf-step-5')).screenshot({ path: path.join(OUT, `step5-${name}.png`) })
    await page.close()
  }

  // ---------------------------------------------------------------- counter-proposal download, both densities
  for (const density of ['simple', 'detailed']) {
    const name = `export-${density}`
    const page = await open(name, 1440, 'light', density)
    const dl = path.join(OUT, `dl-${density}`)
    fs.rmSync(dl, { recursive: true, force: true })
    fs.mkdirSync(dl, { recursive: true })
    const cdp = await page.createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
    await page.evaluate(() => [...document.querySelectorAll('#tf-step-5 button')].find((x) => x.textContent.includes('Load synthetic sample')).click())
    await page.waitForSelector('#tf-step-5 .tp-summary', { timeout: 60000 })
    await sleep(800)
    await page.evaluate(() => [...document.querySelectorAll('#tf-step-5 button')].find((x) => x.textContent.includes('Download counter-proposal')).click())
    let files = []
    for (let i = 0; i < 40 && !files.some((f) => f.endsWith('.html')); i++) {
      await sleep(250)
      files = fs.readdirSync(dl)
    }
    const f = files.find((x) => x.endsWith('.html'))
    if (check(`${name}: downloaded`, !!f, files.join(','))) {
      const html = fs.readFileSync(path.join(dl, f), 'utf8')
      check(`${name}: SYNTHETIC in filename`, f.includes('SYNTHETIC'), f)
      check(`${name}: SYNTHETIC in the document`, html.includes('<h1>SYNTHETIC: ') && html.includes('SYNTHETIC sample proposal: invented prices'))
      check(`${name}: routine-only line answered as insurance`, html.includes('Routine care billed to insurance'))
      check(`${name}: disclaimer + illustrative`, html.includes(DISCLAIMER) && html.includes('Illustrative protocol'))
      check(`${name}: band assumption`, html.includes('Assumption: the justified range'))
      const main = (html.match(/<tr class='main'>/g) || []).length
      const want = density === 'detailed' ? api.rows.length : api.rows.filter((r) => r.flag !== 'in_range').length
      check(`${name}: lines`, main === want, `${main} vs ${want}`)
      fs.copyFileSync(path.join(dl, f), path.join(OUT, `counter-proposal-${density}.html`))
      for (const width of [1440, 390]) {
        const p2 = await browser.newPage()
        await p2.setViewport({ width, height: 900, deviceScaleFactor: 1 })
        await p2.goto('file:///' + path.join(dl, f).replace(/\\/g, '/'), { waitUntil: 'load' })
        const lay = await layoutCheck(p2)
        check(`${name}-${width}: export no horizontal page scroll`, !lay.overflow && lay.offenders.length === 0, JSON.stringify(lay.offenders.slice(0, 3)))
        await p2.screenshot({ path: path.join(OUT, `counter-proposal-${density}-${width}.png`), fullPage: true })
        await p2.close()
      }
    }
    await page.close()
  }

  await browser.close()
  check('no page errors', log.pageerrors.length === 0, log.pageerrors.join(' | '))
  check('no console errors or warnings', log.console.length === 0, log.console.join(' | '))
  check('no failed API calls', log.failed.length === 0, log.failed.join(' | '))
  fs.writeFileSync(path.join(OUT, 'qa-result.json'), JSON.stringify({ fails, log }, null, 1))
  console.log(fails.length ? `FAIL (${fails.length})\n- ${fails.join('\n- ')}` : 'PASS')
  console.log(JSON.stringify(log.runs))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
