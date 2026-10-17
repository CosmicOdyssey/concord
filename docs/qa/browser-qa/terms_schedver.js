// Protocol to terms, an added trial's schedule versions and the line detail: on NCT07564414 (added by NCT ID), upload
// the unmodified SoA CSV template and then go back to the registry draft, with step 6 (term sheet) open. Every
// GET /line-detail must carry a schedule version (import.updated, the ver parameter) and name a node of that
// schedule, the last ones the final schedule's, and none may fail (the bug: a 404 for SCR:office_visit_new_patient, a node of
// the CSV schedule, after going back to the draft). Step 6 shows the new schedule's line, or no PFS line, never an
// error. Simple and Detailed, light and dark, 1440 and 390 px; page and console errors; horizontal page scroll.
// Writes to the gitignored added-trial cache only (the same writes as terms_anytrial.js).
// Usage (NODE_PATH must reach puppeteer-core): node terms_schedver.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck, showStep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5291'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/integfix'
const NCT = 'NCT07564414'
fs.mkdirSync(OUT, { recursive: true })
const getJson = async (p) => (await fetch(BASE + p)).json()
const fails = []
const notes = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

;(async () => {
  // Make sure the trial is added (idempotent) and starts on the registry draft.
  await fetch(`${BASE}/api/terms-flow/add-trial`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nct_id: NCT }) })
  await fetch(`${BASE}/api/terms-flow/${NCT}/soa-draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const tpl = await (await fetch(`${BASE}/api/terms-flow/soa-template.csv`)).text()
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [], requests: [] }

  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${theme}-${width}`
        const page = await browser.newPage()
        // every schedule version the server has had in this run: version -> node ids
        const versions = new Map()
        const learn = async () => {
          const p = await getJson(`/api/terms-flow/${NCT}/protocol`)
          versions.set(p.import.updated, new Set(p.nodes.map((n) => n.id)))
          return p.import.updated
        }
        let last = await learn()
        const sent = []
        page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
        page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
        page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
        page.on('request', (r) => {
          if (!r.url().includes('/line-detail?')) return
          const q = new URL(r.url()).searchParams
          sent.push({ node: q.get('node_id'), ver: q.get('ver') })
        })
        await page.evaluateOnNewDocument(
          (theme, density) => {
            try {
              localStorage.clear()
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
        await page.goto(`${BASE}/#terms-flow/${NCT}/term-sheet`, { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => document.querySelector('.ta-panel') && document.querySelector('#tf-step-3 .tf-payer-value'), { timeout: 90000, polling: 300 })

        const step6 = async (label) => {
          await showStep(page, 'term-sheet')
          const ok = await page
            .waitForFunction(
              () => {
                const s = document.querySelector('#tf-step-6')
                if (!s || s.querySelector('.error')) return false
                const wrap = s.querySelector('.lb-wrap')
                return !wrap || (!!wrap.querySelector('.lb-tbl') && !wrap.querySelector('.lb-stale'))
              },
              { timeout: 30000, polling: 250 },
            )
            .then(
              () => true,
              () => false,
            )
          await sleep(400)
          const tail = sent.at(-1)
          if (tail) check(`${name} ${label}: the last line-detail request is for the current schedule`, tail.ver === last, `${tail.node}@${tail.ver} want ${last}`)
          const r = await page.evaluate(() => ({
            h: document.querySelector('#tf-step-6 .lb-wrap h3')?.innerText ?? '(no physician-fee-schedule line)',
            line: document.querySelector('#tf-step-6 .tf-featured')?.innerText.split('\n').slice(0, 3).join(' | ') ?? '',
            err: document.querySelector('#tf-step-6 .error')?.innerText ?? '',
            disclaimer: document.querySelector('main').innerText.includes('Decision support. Not a fair-market-value legal opinion.'),
          }))
          check(`${name} ${label}: step 6 line breakdown loads, no error`, ok && !r.err, r.err || r.h)
          check(`${name} ${label}: disclaimer visible`, r.disclaimer)
          const lay = await layoutCheck(page)
          check(`${name} ${label}: no horizontal page scroll`, !lay.overflow, `${lay.docScrollWidth} > ${lay.innerWidth}`)
          const el = await page.$('#tf-step-6')
          await el.screenshot({ path: path.join(OUT, `schedver_${label.replace(/\W+/g, '-')}_${name}.png`) })
          notes.push(`${name} ${label}: ${r.h}`)
        }
        const change = async (button, badge) => {
          await showStep(page, 'protocol')
          if (button === 'Use this schedule') {
            await page.$eval('.ta-csv-text', (el) => el.focus())
            // paste rather than type: same text, far fewer events
            await page.evaluate((t) => {
              const el = document.querySelector('.ta-csv-text')
              const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
              set.call(el, t)
              el.dispatchEvent(new Event('input', { bubbles: true }))
            }, tpl)
          }
          await page.evaluate((b) => [...document.querySelectorAll('.ta-actions button')].find((x) => x.innerText.includes(b)).click(), button)
          await page.waitForFunction((w) => document.querySelector('.ta-panel .badge')?.innerText.includes(w), { timeout: 60000, polling: 300 }, badge)
          last = await learn()
        }

        await step6('draft')
        await change('Use this schedule', 'Uploaded')
        await step6('after CSV upload')
        await change('Back to the registry draft', 'Draft')
        await step6('back on the draft')

        const badVer = sent.filter((s) => !versions.has(s.ver))
        const bad = sent.filter((s) => versions.has(s.ver) && !versions.get(s.ver).has(s.node))
        check(`${name}: line-detail requests sent`, sent.length > 0, String(sent.length))
        check(`${name}: every line-detail request carries a schedule version`, badVer.length === 0, badVer.map((b) => `${b.node}@${b.ver}`).join(', '))
        check(`${name}: every line-detail node is in the schedule of its version`, bad.length === 0, bad.map((b) => `${b.node}@${b.ver}`).join(', '))
        check(`${name}: three schedule versions seen`, versions.size === 3, String(versions.size))
        log.requests.push(`${name}: ${sent.length} line-detail requests (${[...new Set(sent.map((s) => s.node))].join(', ')})`)
        await page.close()
      }

  await browser.close()
  check('no page errors', log.pageerrors.length === 0, log.pageerrors.join(' | '))
  check('no console errors or warnings', log.console.length === 0, log.console.join(' | '))
  check('no failed API calls', log.failed.length === 0, log.failed.join(' | '))
  const res = { fails, notes, requests: log.requests, console: log.console, pageerrors: log.pageerrors, failed: log.failed }
  fs.writeFileSync(path.join(OUT, 'schedver_result.json'), JSON.stringify(res, null, 1))
  console.log(fails.length ? `FAIL (${fails.length})\n- ${fails.join('\n- ')}` : 'PASS')
  console.log(JSON.stringify({ notes, requests: log.requests }, null, 1))
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
