// Sponsor budget QA (the synthetic sponsor-budget worksheet, docs/financial/CONTRACT.md): Simple and Detailed, light
// and dark, 1440 and 390 px.
// Guards: the tab label, sub-label and route; the synthetic banner in both modes; every number shown equals the API's
// comparison (scenarios, change against A, budget lines, sites, ledger, reallocation, sensitivity, worksheet totals);
// the payer framing is the API's own sentences; participant cost sharing and access support are never netted;
// scenarios are listed A to E with nothing selected as preferred; every input reachable in both modes; hover cards
// open on hover, keyboard focus and tap; edits clear the result; capacity-short, payer and coverage edits reach the
// API; both exports download; no horizontal page scroll; no page or console errors; text contrast; 44 px touch
// targets on the phone. Review fixes: Simple shows the API's own "sponsor commitment does not fall" sentence next to
// the payer line; the worksheet totals say what they rest on (negotiated-rate multiple, pending coverage analysis,
// stated coinsurance share, supply reserve vs unresolved lines); each responsibility select offers only the API's
// allowed_statuses; Medicaid disables and qualifies participant cost sharing; the hospital figure is "revenue minus
// assumed cost". Also scans the rendered text for time, speed, ranking and saving words and lists every hit.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node financial.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5271'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/F/screens'
const DOWNLOADS = path.resolve(OUT, 'downloads')
fs.mkdirSync(DOWNLOADS, { recursive: true })
const SECTIONS = ['Scenarios', 'Sites and network', 'Ledger', 'Budget reallocation', 'Cost sensitivity', 'Coverage worksheet', 'Report']
// The task's words as substrings ("recommend" and "saving" also catch "recommended" and "savings").
const SCAN = /months|faster|speed|accelerat|sooner|recommend|best|saving|reinvest/gi

// The view's formatting (financialApi.ts).
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const usd = (v) => (finite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` : 'Unknown')
const usd2 = (v) =>
  finite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Unknown'
const signedUsd = (v) => (finite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${usd(Math.abs(v))}` : 'Unknown')
const pct = (v, d = 1) => (finite(v) ? `${(v * 100).toFixed(d)}%` : 'Unknown')
const commitment = (p) => (p.costed ? usd(p.sponsor_total) : 'Not costed')
const firstSentence = (t) => (t ? (t.match(/^.*?\.(?=\s+[A-Z])/)?.[0] ?? t) : null)

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? undefined : detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ` :: ${JSON.stringify(detail).slice(0, 700)}` : ''}`)
}

/** Every hit of the scan words in a text, with 50 characters of context either side. */
const hits = {}
function scan(where, text) {
  for (const m of text.matchAll(SCAN)) {
    const ctx = text
      .slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)
      .replace(/\s+/g, ' ')
      .trim()
    const key = `${m[0].toLowerCase()} :: ${ctx}`
    hits[key] = hits[key] ?? new Set()
    hits[key].add(where)
  }
}

async function openPage(browser, { width, theme, density }, log) {
  const page = await browser.newPage()
  const phone = width < 600
  await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone })
  await page.evaluateOnNewDocument(
    (theme, density) => {
      try {
        localStorage.setItem('concord.theme', theme)
        localStorage.setItem('concord.density', density)
      } catch {
        /* ignore */
      }
    },
    theme,
    density,
  )
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text())
  })
  page.on('pageerror', (e) => log.pageerrors.push(String(e)))
  log.api = []
  page.on('response', async (res) => {
    if (!res.url().includes('/api/financial/')) return
    let body = null
    try {
      body = res.url().includes('/report') ? null : await res.json()
    } catch {
      body = null
    }
    log.api.push({ url: res.url(), status: res.status(), post: res.request().postData() ?? null, body })
  })
  const client = await page.createCDPSession()
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
  return page
}

async function load(page) {
  await page.goto(`${BASE}/#financial`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.financial button')].some((b) => b.innerText.trim() === 'Compare budget scenarios'), {
    timeout: 60000,
  })
  await page.evaluate(() => document.fonts && document.fonts.ready)
}

async function clickText(page, selector, text) {
  const ok = await page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll(selector)].find((b) => b.innerText.trim() === text)
      if (!el) return false
      el.click()
      return true
    },
    selector,
    text,
  )
  if (!ok) throw new Error(`no ${selector} "${text}"`)
}

async function compare(page, log) {
  const before = log.api.filter((a) => a.url.includes('/compare')).length
  await clickText(page, '.financial button', 'Compare budget scenarios')
  await page.waitForFunction(() => /Comparison computed/.test(document.querySelector('.fin-status')?.innerText ?? ''), { timeout: 60000 })
  for (let i = 0; i < 50 && log.api.filter((a) => a.url.includes('/compare')).length === before; i++) await sleep(100)
  await sleep(300)
  return log.api.filter((a) => a.url.includes('/compare')).at(-1)
}

/** Set an input found by its label text (or aria-label) and fire React's input event. */
async function setInput(page, label, value) {
  const ok = await page.evaluate(
    (label, value) => {
      const input =
        [...document.querySelectorAll('.financial input')].find((i) => i.getAttribute('aria-label') === label) ||
        [...document.querySelectorAll('.financial label')].find((l) => l.querySelector('.field-label')?.textContent.trim() === label)?.querySelector('input')
      if (!input) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    label,
    value,
  )
  if (!ok) throw new Error(`no input "${label}"`)
  await sleep(150)
}

async function setPayer(page, value) {
  await page.evaluate((value) => {
    const s = [...document.querySelectorAll('.financial label')].find((l) => l.querySelector('.field-label')?.textContent.trim() === 'Payer type').querySelector('select')
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    set.call(s, value)
    s.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await sleep(200)
}

/** Set a responsibility select (by its aria-label) and fire React's change event. */
async function setSelect(page, label, value) {
  const ok = await page.evaluate(
    (label, value) => {
      const s = [...document.querySelectorAll('.financial select')].find((x) => x.getAttribute('aria-label') === label)
      if (!s) return false
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      set.call(s, value)
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    label,
    value,
  )
  if (!ok) throw new Error(`no select "${label}"`)
  await sleep(200)
}

/** Horizontal page scroll, text contrast and (on a touch screen) small targets, for the current state. */
async function audit(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const bgOf = (el) => {
      for (let a = el; a; a = a.parentElement) {
        const c = parse(getComputedStyle(a).backgroundColor)
        if (c && c.a > 0.5) return c
      }
      return parse(getComputedStyle(document.body).backgroundColor)
    }
    const lowContrast = []
    const root = document.querySelector('.financial')
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    while (walker.nextNode()) {
      const t = walker.currentNode
      if (!t.textContent.trim()) continue
      const el = t.parentElement
      if (seen.has(el)) continue
      seen.add(el)
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (el.closest('[disabled], option, .sr-only, .fin-check-off')) continue
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      const bg = bgOf(el)
      if (!fg || !bg) continue
      const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a)
      const ratio = (L1 + 0.05) / (L2 + 0.05)
      const size = parseFloat(cs.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5)) lowContrast.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${t.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`)
    }
    const small = []
    if (matchMedia('(pointer: coarse)').matches) {
      const sel = '.financial button:not(.hc-trigger), .financial select, .financial input:not([type=checkbox]), .fin-check, .fin-cellcheck, .financial summary'
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.height < 43.5 || (el.matches('button,select') && r.width < 43.5))
          small.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      for (const el of document.querySelectorAll('.financial .hc-info')) {
        const a = getComputedStyle(el, '::after')
        if (parseFloat(a.width) < 43.5 && !el.classList.contains('hc-info-lg')) small.push(`hc-info ::after ${a.width}x${a.height}`)
      }
    }
    return { hscroll: de.scrollWidth > de.clientWidth + 1, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, lowContrast: lowContrast.slice(0, 12), small: small.slice(0, 12) }
  })
}

/** Labels of every input and select in a scope. */
async function controlLabels(page, scope = '.financial') {
  return page.evaluate(
    (scope) =>
      [...document.querySelectorAll(`${scope} input, ${scope} select`)].map((el) => {
        const label = el.getAttribute('aria-label') || el.closest('label')?.querySelector('.field-label')?.innerText.trim() || el.closest('label')?.innerText.trim() || el.id || '?'
        return `${el.tagName.toLowerCase()}:${label.replace(/\s+/g, ' ')}`
      }),
    scope,
  )
}

async function openCardBy(page, how, selector) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.mouse.move(1, 1)
  await sleep(250)
  if (how === 'hover') {
    await page.hover(selector)
    await sleep(450)
  } else if (how === 'tap') {
    await page.tap(selector)
    await sleep(350)
  } else {
    await page.evaluate(() => {
      document.body.tabIndex = -1
      document.body.focus()
    })
    let found = false
    for (let i = 0; i < 500 && !found; i++) {
      await page.keyboard.press('Tab')
      found = await page.evaluate((s) => document.activeElement === document.querySelector(s), selector)
    }
    if (!found) return null
    await sleep(300)
  }
  const text = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.hc-card')].find((x) => !x.hidden && x.getBoundingClientRect().height > 0)
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { text: c.innerText, inView: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1 && r.top >= 0 }
  })
  const closed = await closeCards(page)
  return text && { ...text, closesOnEscape: closed }
}

async function closeCards(page) {
  await page.keyboard.press('Escape')
  await page.mouse.move(1, 1)
  await sleep(250)
  return page.evaluate(() => ![...document.querySelectorAll('.hc-card')].some((x) => !x.hidden && x.getBoundingClientRect().height > 0))
}

/** Mark a hover-card trigger found by its text so a selector can reach it. */
async function markTrigger(page, scope, text, id) {
  return page.evaluate(
    (scope, text, id) => {
      const t = [...document.querySelectorAll(`${scope} .hc-trigger`)].find((b) => b.innerText.trim().startsWith(text))
      if (!t) return false
      t.setAttribute('data-qa', id)
      return true
    },
    scope,
    text,
    id,
  )
}

const cellRows = (page, caption) =>
  page.evaluate((caption) => {
    const t = [...document.querySelectorAll('.fin-section table')].find((x) => x.caption?.innerText.trim().startsWith(caption))
    return t ? [...t.tBodies[0].rows].map((tr) => [...tr.cells].map((c) => c.innerText.replace(/\s+/g, ' ').trim())) : null
  }, caption)

;(async () => {
  const browser = await launch()
  const controls = {}
  try {
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark'])
        for (const density of ['simple', 'detailed']) {
          const tag = `${density}-${width}-${theme}`
          const phone = width < 600
          const log = { console: [], pageerrors: [] }
          const page = await openPage(browser, { width, theme, density }, log)
          await load(page)
          const demo = log.api.find((a) => a.url.endsWith('/api/financial/demo'))?.body

          const pre = await page.evaluate(() => ({
            banner: document.querySelector('.financial .banner')?.innerText ?? '',
            density: document.documentElement.dataset.density,
            theme: document.documentElement.dataset.theme,
            tab: document.querySelector('nav.tabs [aria-selected="true"] .tab-label')?.innerText,
            sub: document.querySelector('nav.tabs [aria-selected="true"] .tab-sub')?.innerText,
            hint: document.querySelector('nav.tabs [aria-selected="true"]')?.getAttribute('title'),
            title: document.title,
            h1: document.querySelector('.financial h1')?.innerText,
            footer: document.querySelector('.footer')?.innerText ?? '',
            totals: [...document.querySelectorAll('.fin-totals .kf-value')].map((k) => k.innerText.trim()),
          }))
          check(`${tag}: density and theme applied`, pre.density === density && pre.theme === theme, pre)
          check(
            `${tag}: tab "Sponsor budget" / "Synthetic worksheet" with its hint; title and h1`,
            pre.tab === 'Sponsor budget' &&
              pre.sub === 'Synthetic worksheet' &&
              pre.hint === "A sponsor-budget worksheet on synthetic site inputs: who pays for each protocol item, and what changes the sponsor's commitment." &&
              pre.title === 'Sponsor budget · Concord' &&
              pre.h1 === 'Sponsor budget',
            pre,
          )
          check(`${tag}: footer names the synthetic worksheet and no time model`, /Sponsor budget is a worksheet on synthetic inputs with no time model/.test(pre.footer), pre.footer)
          check(`${tag}: synthetic banner shown`, /^Synthetic worksheet\./.test(pre.banner) && /no insurer takes part/.test(pre.banner) && /All \d+ limitations/.test(pre.banner), pre.banner)
          if (density === 'simple') {
            const t = demo.coverage.totals
            check(`${tag}: before comparing, the worksheet totals are the demo's`, JSON.stringify(pre.totals) === JSON.stringify([t.sponsor, t.payer, t.patient, t.reserve].map(usd2)), pre.totals)
          }
          await page.screenshot({ path: `${OUT}/${tag}-0-before.png`, fullPage: true })

          const cmp = await compare(page, log)
          const R = cmp?.body
          check(`${tag}: comparison returned 200 with five scenarios`, cmp?.status === 200 && R?.scenarios?.length === 5, cmp?.status)
          if (!R) {
            await page.close()
            continue
          }
          const ref = R.scenarios.find((s) => s.id === R.comparison.reference_scenario_id)

          if (density === 'simple') {
            const ui = await page.evaluate(() => ({
              rows: [...document.querySelectorAll('.fin-scen-row')].map((li) => ({
                name: li.querySelector('.fin-scen-name')?.innerText.trim(),
                amt: li.querySelector('.fin-scen-amt')?.innerText.trim(),
                feas: li.querySelector('.fin-scen-feas')?.innerText.trim(),
                share: li.querySelector('.fin-scen-share')?.innerText.trim() ?? null,
                chg: li.querySelector('.fin-scen-chg')?.innerText.replace(/\s+/g, ' ').trim(),
                pressed: li.querySelector('[aria-pressed]')?.getAttribute('aria-pressed') ?? null,
              })),
              totals: [...document.querySelectorAll('.fin-totals .kf')].map((k) => [k.querySelector('.kf-label')?.innerText.trim(), k.querySelector('.kf-value')?.innerText.trim()]),
              subs: [...document.querySelectorAll('.fin-totals .kf')].map((k) => k.querySelector('.kf-sub')?.innerText.trim()),
              quals: [...document.querySelectorAll('.financial .section')].find((s) => s.querySelector('h2')?.innerText === 'Who pays, per participant')?.querySelector('.section-quals')?.innerText ?? '',
              lede: [...document.querySelectorAll('.financial .section')].find((s) => s.querySelector('h2')?.innerText === 'Who pays, per participant')?.querySelector('.section-lede')?.innerText ?? '',
              all: document.querySelector('.financial').textContent,
              visible: document.querySelector('.financial').innerText,
            }))
            const want = R.scenarios.map((s) => ({
              name: `${s.id}. ${s.label}`,
              amt: commitment(s.plan),
              feas: s.plan.feasible ? 'Feasible under these inputs' : 'Not feasible',
              share: finite(s.plan.budget_utilization) ? `${pct(s.plan.budget_utilization)} of budget` : null,
              chg: s.id === ref.id ? 'Reference: B to E are compared with A.' : `${signedUsd(s.budget_reallocation.incremental_cost)} against A`,
            }))
            check(
              `${tag}: scenarios listed A to E with sponsor commitment, feasibility, budget share and change against A equal to the API`,
              ui.rows.length === 5 &&
                ui.rows.every((r, i) => r.name === want[i].name && r.amt === want[i].amt && r.feas.startsWith(want[i].feas) && r.share === want[i].share && r.chg.startsWith(want[i].chg)),
              { ui: ui.rows, want },
            )
            const byId = Object.fromEntries(R.scenarios.map((s, i) => [s.id, ui.rows[i]?.chg ?? '']))
            check(
              `${tag}: each change names its cause (B administration assumption, D support, C/E no sites added)`,
              /assumed 25% cut in sponsor administration/.test(byId.B) &&
                /participant access support \+\$300 each/.test(byId.D) &&
                /no sites added, because the existing network’s stated capacity covers the target/.test(byId.C) &&
                /assumed 25% cut in sponsor administration \(−\$30,000\); participant access support \+\$300 each \(\+\$18,000\); no sites added/.test(byId.E),
              byId,
            )
            check(`${tag}: no scenario is selected, ranked or marked`, ui.rows.every((r) => r.pressed === null) && !/Selected|preferred scenario|recommended|best/i.test(ui.rows.map((r) => r.name + r.feas).join(' ')), ui.rows)
            const t = R.coverage.totals
            check(
              `${tag}: coverage totals per participant equal the API (sponsor / insurer / participant / contingency)`,
              JSON.stringify(ui.totals) ===
                JSON.stringify([
                  ['Sponsor pays', usd2(t.sponsor)],
                  ['Insurer (illustrative)', usd2(t.payer)],
                  ['Participant cost sharing (illustrative)', usd2(t.patient)],
                  ['Held as sponsor contingency', usd2(t.reserve)],
                ]),
              ui.totals,
            )
            const supply = R.coverage.items.find((i) => i.id === 'drug-contingency').reserve_per_participant
            const wantSubs = [
              `Research items at ${R.request.sponsor_rate_multiplier.toFixed(2)}x the fee-schedule benchmark (synthetic negotiated rate, not an FMV finding)`,
              'Routine care that may be billed to insurance, pending coverage analysis',
              'Routine-care coinsurance at the stated share, before deductibles and secondary coverage',
              `Investigational-supply reserve ${usd2(supply)} (operator assumption, not a drug price); unknown, conditional or review-required lines ${usd2(Math.round((t.reserve - supply) * 100) / 100)}`,
            ]
            check(`${tag}: totals say what they rest on (rate multiple, pending coverage analysis, coinsurance share, supply reserve vs unresolved)`, JSON.stringify(ui.subs) === JSON.stringify(wantSubs), { ui: ui.subs, want: wantSubs })
            const guard = firstSentence(R.assumptions.payer_independence)
            check(
              `${tag}: visible payer line carries the API's "sponsor commitment does not fall" sentence, verbatim`,
              /does not fall because an insurer pays more/.test(guard) &&
                ui.quals.startsWith(`Payer: Medicare; insurer share ${pct(R.request.payer_fraction, 0)} of the benchmark (clinical lab tests: 100% of the CLFS amount). ${guard}`),
              ui.quals,
            )
            check(`${tag}: the payer line is the API's benchmark sentence, verbatim`, ui.lede.includes(R.assumptions.payer_benchmarks) && /How payer amounts are used/.test(ui.lede), ui.lede)
            check(`${tag}: no ledger, net exposure or old wording in Simple (DOM, incl. folded)`, !/net (modeled )?exposure|Reinvestment|pilot|Modeled months|Capacity within horizon/i.test(ui.all), (ui.all.match(/.{40}(net exposure|Reinvestment|pilot|Modeled months).{40}/i) || [])[0])

            // Hover cards: payer framing (the four sentences), limitations (banner), assumptions (section info), a definition.
            const how = phone ? ['tap', 'focus'] : ['hover', 'focus']
            await markTrigger(page, '.financial .section', 'How payer amounts are used', 'framing')
            const noTime = R.limitations.find((l) => /^Nothing here models/.test(l))
            for (const h of how) {
              const f = await openCardBy(page, h, '[data-qa="framing"]')
              if (f) scan(`${tag} payer framing card`, f.text)
              check(
                `${tag}: payer framing card opens on ${h} with the API's four sentences verbatim (in view, closes on Escape)`,
                f && [R.assumptions.payer_benchmarks, R.assumptions.payer_billing, R.assumptions.payer_independence, noTime].every((x) => x && f.text.includes(x)) && f.inView && f.closesOnEscape,
                f,
              )
            }
            const lim = await openCardBy(page, how[0], '.financial .banner .hc-trigger')
            if (lim) scan(`${tag} limitations card`, lim.text)
            check(`${tag}: limitations card lists every limitation`, lim && R.limitations.every((l) => lim.text.includes(l)) && lim.inView, lim && { n: R.limitations.length, inView: lim.inView })
            const as = await openCardBy(page, how[0], '[aria-label="Details: Budget scenarios"]')
            if (as) scan(`${tag} assumptions card`, as.text)
            check(`${tag}: assumptions card opens`, as && /Assumptions/.test(as.text) && as.text.includes(R.assumptions.sponsor_administration) && as.text.includes(R.assumptions.contract_period), as)
            await markTrigger(page, '.fin-scen', 'B.', 'def-b')
            const def = await openCardBy(page, how[0], '[data-qa="def-b"]')
            const b = R.scenarios.find((s) => s.id === 'B')
            for (const sc of R.scenarios) scan(`${tag} definition cards`, sc.definition)
            check(`${tag}: a scenario name opens its API definition`, def && def.text.includes(b.definition), def)
            if (width === 1440 && theme === 'light') {
              await page.hover('[data-qa="framing"]')
              await sleep(500)
              await page.screenshot({ path: `${OUT}/${tag}-card-framing.png` })
              await closeCards(page)
            }
            if (phone && theme === 'dark') {
              await page.tap('[data-qa="framing"]')
              await sleep(400)
              await page.screenshot({ path: `${OUT}/${tag}-card-framing.png` })
              await closeCards(page)
            }
            await page.screenshot({ path: `${OUT}/${tag}-1-compared.png`, fullPage: true })
            await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
            await sleep(400)
            controls[tag] = await controlLabels(page)
            scan(`${tag}`, await page.evaluate(() => document.querySelector('.financial').innerText))
            await page.screenshot({ path: `${OUT}/${tag}-2-all-open.png`, fullPage: true })
          } else {
            const nav = await page.evaluate(() => [...document.querySelectorAll('.fin-nav button')].map((b) => [b.innerText.trim(), b.getAttribute('aria-current')]))
            check(`${tag}: seven section buttons, Scenarios first`, JSON.stringify(nav.map((n) => n[0])) === JSON.stringify(SECTIONS) && nav[0][1] === 'page', nav)
            const labels = await controlLabels(page, '.fin-setup')
            for (const s of SECTIONS) {
              await clickText(page, '.fin-nav button', s)
              await sleep(350)
              const st = await page.evaluate(() => ({
                h2: document.querySelector('.fin-section h2')?.innerText.trim(),
                label: document.querySelector('.fin-section')?.getAttribute('aria-label'),
                text: document.querySelector('.fin-section')?.innerText ?? '',
              }))
              check(`${tag}: ${s} shows its heading`, st.h2 === s && st.label === s, st.h2)
              if (s === 'Scenarios') {
                const rows = await cellRows(page, 'Scenarios A to E')
                const ok = R.scenarios.every((sc, i) => {
                  const r = rows?.[i]
                  const chg = sc.id === ref.id ? 'Reference' : `${signedUsd(sc.budget_reallocation.incremental_cost)} against A`
                  return (
                    r &&
                    r[0].startsWith(`${sc.id}. ${sc.label}`) &&
                    r[0].includes(sc.definition) &&
                    r[2] === commitment(sc.plan) &&
                    r[3].startsWith(chg) &&
                    r[4] === String(sc.plan.selected_ids.length) &&
                    r[5] === String(sc.plan.stated_capacity) &&
                    r[6] === usd(sc.plan.cost_per_participant) &&
                    r[7] === pct(sc.plan.budget_utilization) &&
                    r[8] === usd(sc.plan.unspent_budget)
                  )
                })
                check(`${tag}: scenario table equals the API`, ok, rows)
                const lines = await cellRows(page, 'Budget lines by scenario')
                const keys = ['activation', 'operating', 'site_variable', 'procedures', 'support', 'administration']
                check(
                  `${tag}: budget lines equal the API`,
                  R.scenarios.every((sc, i) => lines?.[i] && keys.every((k, j) => lines[i][j + 1] === usd(sc.plan.breakdown[k])) && lines[i][7] === commitment(sc.plan)),
                  lines,
                )
                check(`${tag}: comparison basis and ordering shown`, st.text.includes(R.comparison.basis) && st.text.includes(R.comparison.ordering))
              }
              if (s === 'Sites and network') {
                const a = R.scenarios[0]
                const rows = await cellRows(page, `${a.id}. ${a.label}: sponsor funds by site`)
                check(
                  `${tag}: A's site rows equal the API`,
                  rows && a.plan.site_rows.every((r, i) => rows[i][0].startsWith(r.name) && rows[i][1] === String(r.participants) && rows[i][2] === String(r.capacity) && rows[i][8] === usd(r.total)),
                  rows,
                )
                check(`${tag}: A's participant split in plain words`, /in proportion to stated capacity/.test(st.text), st.text.slice(0, 300))
                await page.evaluate(() => [...document.querySelectorAll('.fin-picker .seg-btn')].find((b) => b.innerText.trim() === 'C').click())
                await sleep(250)
                const cText = await page.evaluate(() => document.querySelector('.fin-section').innerText)
                const ns = R.scenarios.find((x) => x.id === 'C').plan.network_search
                check(`${tag}: C states that it adds no sites (existing capacity covers the target), with the API rule`, ns.base_has_capacity && cText.includes('C adds no sites: the existing network’s stated capacity covers the target.') && cText.includes(ns.rule))
                await page.screenshot({ path: `${OUT}/${tag}-sites-c.png`, fullPage: true })
                await page.evaluate(() => [...document.querySelectorAll('.fin-picker .seg-btn')].find((b) => b.innerText.trim() === 'A').click())
                await sleep(200)
              }
              if (s === 'Ledger') {
                const rows = await cellRows(page, 'Ledger by scenario')
                const get = [
                  (e) => e.sponsor.expenditure,
                  (e) => e.sponsor.contingency_reserve,
                  (e) => e.sponsor.supply_resource_proxy,
                  (e) => e.hospital.net_contribution,
                  (e) => e.insurer.total,
                  (e) => e.patient.cost_sharing,
                  (e) => e.patient.access_support,
                  (e) => e.consolidated_resource_cost,
                ]
                const heads = await page.evaluate(() => [...document.querySelectorAll('.fin-section table')].map((t) => [...t.tHead.rows[0].cells].map((c) => c.innerText.trim())))
                check(`${tag}: no "contribution" or margin column; "Hospital revenue minus assumed cost" in both ledger tables`, heads.filter((h) => h.includes('Hospital revenue minus assumed cost')).length === 2 && !/contribution|margin/i.test(JSON.stringify(heads)), heads)
                check(`${tag}: ledger by scenario equals the API`, R.scenarios.every((sc, i) => rows?.[i] && get.every((g, j) => rows[i][j + 1] === usd(g(sc.economics)))), rows)
                const d = await cellRows(page, 'Change against A by party')
                const dk = ['sponsor_expenditure', 'resources', 'hospital_contribution', 'insurer_expenditure', 'patient_cost_sharing', 'access_support']
                check(`${tag}: change against A by party equals the API`, R.scenarios.every((sc, i) => d?.[i] && dk.every((k, j) => d[i][j + 1] === signedUsd(sc.delta[k]))), d)
                const e = ref.economics
                const party = await page.evaluate(() => [...document.querySelectorAll('.fin-cards article')].map((a) => a.innerText.replace(/\s+/g, ' ')))
                check(
                  `${tag}: A's party cards equal the API; supply proxy on the sponsor side; participant values separate`,
                  party.length === 4 &&
                    party[0].includes(usd(e.sponsor.budget_commitment)) &&
                    party[0].includes(usd(e.sponsor.supply_resource_proxy)) &&
                    !party[1].includes('supply resource proxy') &&
                    party[1].includes(usd(e.hospital.net_contribution)) &&
                    party[1].startsWith('Hospital revenue minus assumed cost') &&
                    party[1].includes('Not a margin estimate or a fair-market-value test.') &&
                    party[2].includes(usd(e.insurer.total)) &&
                    party[3].includes(`Participant routine cost sharing (illustrative) ${usd(e.patient.cost_sharing)}`) &&
                    party[3].includes(`Sponsor access support ${usd(e.patient.access_support)}`),
                  party,
                )
                const net = usd(e.party_transfer_balances.Participant)
                check(`${tag}: no participant net of cost sharing and support anywhere (${net})`, !st.text.includes(net) && !/net exposure/i.test(st.text))
                const tr = await cellRows(page, 'Transfers in')
                check(`${tag}: transfers equal the API`, tr && e.transfers.every((t, i) => tr[i][0] === t.from && tr[i][1] === t.to && tr[i][2] === usd(t.amount)), tr)
              }
              if (s === 'Budget reallocation') {
                const lc = await cellRows(page, 'Budget line changes against A')
                const keys = ['activation', 'operating', 'site_variable', 'procedures', 'support', 'administration']
                check(
                  `${tag}: budget line changes equal the API`,
                  R.scenarios.every((sc, i) => lc?.[i] && keys.every((k, j) => lc[i][j + 1] === signedUsd(sc.budget_reallocation.line_changes[k])) && lc[i][7] === signedUsd(sc.budget_reallocation.incremental_cost)),
                  lc,
                )
                const ad = await cellRows(page, 'Sites added beyond')
                check(`${tag}: added sites equal the API (none by default)`, R.scenarios.every((sc, i) => ad?.[i] && ad[i][1] === (sc.budget_reallocation.additional_sites.join(', ') || 'None') && ad[i][5] === usd(sc.budget_reallocation.added_sites_cost.site_total)), ad)
              }
              if (s === 'Cost sensitivity') {
                const q = await cellRows(page, 'Sponsor commitment under varied')
                check(
                  `${tag}: sponsor-commitment quantiles and share over budget equal the API`,
                  R.scenarios.every((sc, i) => q?.[i] && sc.sensitivity.sponsor_total_quantiles.every((v, j) => q[i][j + 1] === usd(v)) && q[i][4] === pct(sc.sensitivity.probability_budget_exceeded)),
                  q,
                )
                check(`${tag}: sensitivity method and varied inputs shown`, st.text.includes(R.scenarios[0].sensitivity.method) && R.scenarios[0].sensitivity.varied_inputs.every((v) => st.text.includes(v)))
              }
              if (s === 'Coverage worksheet') {
                const noTime = R.limitations.find((l) => /^Nothing here models/.test(l))
                check(`${tag}: worksheet shows the four payer sentences verbatim`, [R.assumptions.payer_benchmarks, R.assumptions.payer_billing, R.assumptions.payer_independence, noTime].every((x) => st.text.includes(x)))
                const sel = await page.evaluate(() =>
                  [...document.querySelectorAll('.fin-tbl-coverage tbody tr')].map((tr) => ({
                    options: [...tr.querySelectorAll('select option')].map((o) => [o.value, o.disabled]),
                    note: tr.cells[2].querySelector('.fin-sub')?.innerText.trim() ?? null,
                  })),
                )
                const noteFor = (it) =>
                  it.id === 'drug-contingency'
                    ? 'Investigational supply: sponsor only.'
                    : it.allowed_statuses.includes('POTENTIALLY_PAYER_COVERED')
                      ? null
                      : 'Research item: sponsor only; never billed to an insurer or participant (coverage rules).'
                check(
                  `${tag}: each responsibility select offers exactly the API's allowed_statuses (research ${R.coverage.items.filter((i) => i.allowed_statuses.length === 4).length - 1}, supply 1, routine ${R.coverage.items.filter((i) => i.allowed_statuses.length === 6).length})`,
                  sel.length === R.coverage.items.length &&
                    R.coverage.items.every((it, i) => JSON.stringify(sel[i].options) === JSON.stringify(it.allowed_statuses.map((x) => [x, false])) && sel[i].note === noteFor(it)),
                  sel.slice(0, 3),
                )
                const cap = await page.evaluate(() => document.querySelector('.fin-tbl-coverage caption')?.innerText ?? '')
                check(`${tag}: worksheet caption says an edit is an operator interpretation, not a coverage decision`, /follows the coverage analysis and billing grid \(protocol, contract, consent form\); an edit here is an operator interpretation, not a coverage decision\./.test(cap), cap)
                const rows = await page.evaluate(() => [...document.querySelectorAll('.fin-tbl-coverage tbody tr')].map((tr) => [...tr.cells].slice(-4).map((c) => c.innerText.trim())))
                check(
                  `${tag}: worksheet has every line, amounts equal the API`,
                  rows.length === R.coverage.items.length &&
                    R.coverage.items.every((it, i) => JSON.stringify(rows[i]) === JSON.stringify([it.sponsor_per_participant, it.payer_per_participant, it.patient_per_participant, it.reserve_per_participant].map(usd2))),
                  rows.slice(0, 3),
                )
              }
              if (s === 'Report') {
                check(
                  `${tag}: report shows run, hashes, every source, assumption and limitation`,
                  st.text.includes(R.run_id) &&
                    st.text.includes(R.result_sha256) &&
                    R.sources.every((x) => st.text.includes(x.title)) &&
                    Object.values(R.assumptions).every((v) => st.text.includes(v)) &&
                    R.limitations.every((l) => st.text.includes(l)),
                  st.text.slice(0, 200),
                )
              }
              labels.push(...(await controlLabels(page, '.fin-section')))
              scan(`${tag} ${s}`, await page.evaluate(() => document.querySelector('.financial').innerText))
              const au = await audit(page)
              check(`${tag}: ${s} no horizontal page scroll`, !au.hscroll, au)
              check(`${tag}: ${s} text contrast`, au.lowContrast.length === 0, au.lowContrast)
              if (phone) check(`${tag}: ${s} touch targets`, au.small.length === 0, au.small)
              await page.screenshot({ path: `${OUT}/${tag}-${s.toLowerCase().replace(/[^a-z]+/g, '-')}.png`, fullPage: true })
            }
            controls[tag] = labels
            await clickText(page, '.fin-nav button', 'Scenarios')
          }
          scan(`${tag} (tab bar and footer)`, await page.evaluate(() => `${document.querySelector('nav.tabs [aria-selected="true"]')?.innerText} ${document.querySelector('.footer')?.innerText}`))

          const au = await audit(page)
          check(`${tag}: no horizontal page scroll`, !au.hscroll, au)
          check(`${tag}: text contrast >= 4.5:1 (3:1 large)`, au.lowContrast.length === 0, au.lowContrast)
          if (phone) check(`${tag}: touch targets >= 44 px`, au.small.length === 0, au.small)
          check(`${tag}: no page or console errors`, log.console.length + log.pageerrors.length === 0, { console: log.console, pageerrors: log.pageerrors })
          await page.close()
        }

    for (const [w, t] of [
      [1440, 'light'],
      [390, 'dark'],
    ]) {
      const s = [...(controls[`simple-${w}-${t}`] ?? [])].sort()
      const d = [...(controls[`detailed-${w}-${t}`] ?? [])].sort()
      check(
        `every input in Detailed is reachable in Simple (${w} ${t}): ${s.length} vs ${d.length}`,
        s.length > 140 && JSON.stringify(s) === JSON.stringify(d),
        { onlySimple: s.filter((x) => !d.includes(x)), onlyDetailed: d.filter((x) => !s.includes(x)) },
      )
    }

    // Behaviour (Simple, 1440 light).
    {
      const log = { console: [], pageerrors: [] }
      const page = await openPage(browser, { width: 1440, theme: 'light', density: 'simple' }, log)
      await load(page)
      const first = (await compare(page, log)).body
      await setInput(page, 'Sponsor budget (USD)', 1400000)
      const cleared = await page.evaluate(() => ({ status: document.querySelector('.fin-status')?.innerText, rows: document.querySelectorAll('.fin-scen-row').length }))
      check('editing an input clears the comparison and says so', cleared.rows === 0 && /Inputs changed/.test(cleared.status), cleared)
      const r2 = await compare(page, log)
      check('recompute sends the edited budget', JSON.parse(r2.post).budget === 1400000 && r2.status === 200, r2.post?.slice(0, 80))

      // A tight budget: Simple names the infeasible scenarios, lists the violation and draws the meter full.
      await setInput(page, 'Sponsor budget (USD)', 640000)
      const tight = (await compare(page, log)).body
      const bad = tight.scenarios.find((s) => !s.plan.feasible)
      const row = await page.evaluate((id) => {
        const li = [...document.querySelectorAll('.fin-scen-row')].find((x) => x.querySelector('.fin-scen-name').innerText.startsWith(`${id}.`))
        return { feas: li.querySelector('.fin-scen-feas').innerText, amt: li.querySelector('.fin-scen-amt').innerText, share: li.querySelector('.fin-scen-share')?.innerText, meter: li.querySelector('.fin-meter > span')?.style.width }
      }, bad.id)
      check(
        `640,000 budget: ${bad.id} not feasible, violation listed, amount and share equal the API, meter capped`,
        /Not feasible/.test(row.feas) && bad.plan.violations.every((v) => row.feas.includes(v)) && row.amt === usd(bad.plan.sponsor_total) && row.share === `${pct(bad.plan.budget_utilization)} of budget` && row.meter === '100%',
        { row, bad: bad.plan },
      )
      await page.screenshot({ path: `${OUT}/behaviour-1-tight-budget.png`, fullPage: true })
      await setInput(page, 'Sponsor budget (USD)', 1500000)

      // Capacity-short: SYN-A and SYN-B at 20 places. A, B and D are not costed; C and E add SYN-C and state its cost.
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
      await sleep(300)
      await setInput(page, 'Synthetic site A: Stated capacity', 20)
      await setInput(page, 'Synthetic site B: Stated capacity', 20)
      const shortR = (await compare(page, log)).body
      const rows = await page.evaluate(() => [...document.querySelectorAll('.fin-scen-row')].map((li) => [li.querySelector('.fin-scen-amt').innerText.trim(), li.querySelector('.fin-scen-chg').innerText.replace(/\s+/g, ' ').trim()]))
      const c = shortR.scenarios.find((s) => s.id === 'C')
      const ac = c.budget_reallocation.added_sites_cost
      check(
        'capacity-short: A not costed; C adds SYN-C with its own site costs; amounts equal the API',
        rows[0][0] === 'Not costed' &&
          rows[1][0] === 'Not costed' &&
          rows[2][0] === usd(c.plan.sponsor_total) &&
          rows[2][1] === `No change against A to state: A is not costed. Adds SYN-C: site costs ${usd(ac.site_total)} for ${ac.participants} participants.`,
        rows,
      )
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = false)))
      await sleep(200)
      await page.screenshot({ path: `${OUT}/behaviour-2-capacity-short.png`, fullPage: true })
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
      await setInput(page, 'Synthetic site A: Stated capacity', 60)
      await setInput(page, 'Synthetic site B: Stated capacity', 60)

      // Payer: Medicaid disables the payer share and participant cost sharing, and qualifies a line that holds it;
      // commercial without the assumption shows Unknown and leaves the sponsor unchanged.
      await setSelect(page, 'Responsibility for New-patient oncology visit, high complexity', 'POTENTIALLY_PATIENT_COST_SHARING')
      await setPayer(page, 'Medicaid')
      const mc = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('.financial .section')].find((s) => s.querySelector('h2')?.innerText === 'Who pays, per participant')
        const routine = [...document.querySelectorAll('.fin-tbl-coverage select')].find((s) => s.getAttribute('aria-label') === 'Responsibility for New-patient oncology visit, high complexity')
        return {
          quals: sec?.querySelector('.section-quals')?.innerText ?? '',
          value: routine?.value,
          disabled: [...(routine?.options ?? [])].filter((o) => o.disabled).map((o) => o.value),
        }
      })
      check(
        'Medicaid: participant cost sharing disabled; the line holding it is qualified (42 CFR 447.15); payer line names the Medicare benchmark as a stand-in',
        JSON.stringify(mc.disabled) === '["POTENTIALLY_PATIENT_COST_SHARING"]' &&
          mc.value === 'POTENTIALLY_PATIENT_COST_SHARING' &&
          mc.quals.startsWith('Payer: Medicaid; insurer amount uses the Medicare benchmark as a stand-in (state Medicaid rates differ); participant cost sharing shown as 0 on insurer-billed lines.') &&
          mc.quals.includes('1 line assigned to the participant: Medicaid generally bars billing an enrollee beyond nominal cost sharing for a covered service (42 CFR 447.15); review before use.'),
        mc,
      )
      await page.evaluate(() => [...document.querySelectorAll('.financial .section')].find((s) => s.querySelector('h2')?.innerText === 'Who pays, per participant')?.scrollIntoView({ block: 'center' }))
      await sleep(200)
      await page.screenshot({ path: `${OUT}/behaviour-3a-medicaid-participant-line.png`, fullPage: false })
      await setSelect(page, 'Responsibility for New-patient oncology visit, high complexity', 'POTENTIALLY_PAYER_COVERED')
      const med = await page.evaluate(() => {
        const l = [...document.querySelectorAll('.financial label')].find((x) => x.querySelector('.field-label')?.textContent.startsWith('Insurer share'))
        return { disabled: l.querySelector('input').disabled, note: l.querySelector('.fin-field-note')?.innerText ?? '' }
      })
      check(
        'Medicaid: payer share disabled, with the reason',
        med.disabled && med.note === 'Not applied for Medicaid: the insurer amount is the Medicare benchmark as a stand-in and the participant share on insurer-billed lines is 0.',
        med,
      )
      await setPayer(page, 'commercial')
      const comm = (await compare(page, log)).body
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = false)))
      await sleep(200)
      const ui = await page.evaluate(() => ({
        totals: [...document.querySelectorAll('.fin-totals .kf-value')].map((k) => k.innerText.trim()),
        amts: [...document.querySelectorAll('.fin-scen-amt')].map((k) => k.innerText.trim()),
        quals: [...document.querySelectorAll('.financial .section')].find((s) => s.querySelector('h2')?.innerText === 'Who pays, per participant')?.querySelector('.section-quals')?.innerText ?? '',
      }))
      check(
        'commercial without the assumption: insurer and participant Unknown, unknown-line count shown, sponsor commitments unchanged',
        ui.totals[1] === 'Unknown' &&
          ui.totals[2] === 'Unknown' &&
          ui.quals.includes(`${comm.coverage.insurer_amounts_unknown} routine lines: insurer amount unknown`) &&
          JSON.stringify(ui.amts) === JSON.stringify(first.scenarios.map((s) => commitment(s.plan))),
        ui,
      )
      await page.screenshot({ path: `${OUT}/behaviour-3-commercial-unknown.png`, fullPage: true })
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
      await setPayer(page, 'Medicare')

      // A coverage override in the folded worksheet reaches the API.
      const target = await page.evaluate(() => {
        const s = document.querySelector('.fin-tbl-coverage select')
        return { label: s.getAttribute('aria-label'), value: s.value === 'UNKNOWN' ? 'SPONSOR' : 'UNKNOWN' }
      })
      await page.select(`select[aria-label="${target.label}"]`, target.value)
      await sleep(300)
      check('a responsibility edit marks the worksheet pending', await page.evaluate(() => document.querySelector('.financial')?.innerText.includes('Responsibility edits are pending')))
      const r3 = await compare(page, log)
      check('the responsibility edit reaches the API', Object.values(JSON.parse(r3.post).coverage_overrides).includes(target.value) && r3.status === 200, JSON.parse(r3.post).coverage_overrides)

      for (const [label, fmt] of [
        ['Download HTML report', 'html'],
        ['Download JSON', 'json'],
      ]) {
        const file = path.join(DOWNLOADS, `concord-sponsor-budget-${r3.body.run_id}.${fmt}`)
        try {
          fs.unlinkSync(file)
        } catch {
          /* not there */
        }
        const n = log.api.length
        await clickText(page, '.financial button', label)
        await page.waitForFunction((fmt) => new RegExp(`${fmt.toUpperCase()} report downloaded`).test(document.querySelector('.fin-status')?.innerText ?? ''), { timeout: 60000 }, fmt)
        for (let i = 0; i < 50 && !fs.existsSync(file); i++) await sleep(100)
        const rep = log.api.slice(n).find((a) => a.url.includes(`/report?format=${fmt}`))
        const size = fs.existsSync(file) ? fs.statSync(file).size : 0
        let okBody = size > 1000
        if (okBody && fmt === 'json') okBody = JSON.parse(fs.readFileSync(file, 'utf8')).result_sha256 === r3.body.result_sha256
        check(`${fmt.toUpperCase()} export downloads (200, file ${path.basename(file)}, ${size} bytes${fmt === 'json' ? ', same result hash' : ''})`, rep?.status === 200 && okBody, { status: rep?.status, size })
        if (fs.existsSync(file)) scan(`${fmt.toUpperCase()} export`, fmt === 'html' ? fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>|<pre[\s\S]*?<\/pre>/g, '').replace(/<[^>]+>/g, ' ') : '')
      }
      // An empty number field is an input problem, not a failed request, and never reaches the API.
      const n = log.api.length
      await setInput(page, 'Budgeted contract period (months)', '')
      await clickText(page, '.financial button', 'Compare budget scenarios')
      await sleep(600)
      const err = await page.evaluate(() => document.querySelector('.financial [role="alert"]')?.innerText ?? null)
      check('an empty number shows "Check the inputs." and sends nothing', /Check the inputs\./.test(err ?? '') && !log.api.slice(n).some((a) => a.url.includes('/compare')), err)
      check('behaviour run: no page or console errors', log.console.length + log.pageerrors.length === 0, { console: log.console, pageerrors: log.pageerrors })
      await page.close()
    }

    // Unreachable API: the Calm error with "Try again".
    {
      const log = { console: [], pageerrors: [] }
      const page = await openPage(browser, { width: 1440, theme: 'light', density: 'simple' }, log)
      await page.setRequestInterception(true)
      let fail = true
      page.on('request', (req) => (fail && req.url().includes('/api/financial/demo') ? req.respond({ status: 503, contentType: 'application/json', body: '{"detail":"down"}' }) : req.continue()))
      await page.goto(`${BASE}/#financial`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.financial .error', { timeout: 30000 })
      const e = await page.evaluate(() => document.querySelector('.financial .error')?.innerText)
      check('demo failure shows the error with Try again', /Try again/.test(e ?? ''), e)
      await page.screenshot({ path: `${OUT}/behaviour-4-demo-error.png` })
      fail = false
      await clickText(page, '.financial .error button', 'Try again')
      await page.waitForFunction(() => [...document.querySelectorAll('.financial button')].some((b) => b.innerText.trim() === 'Compare budget scenarios'), { timeout: 30000 })
      check('Try again reloads the demo', true)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  const scanList = Object.entries(hits)
    .map(([k, where]) => ({ hit: k, where: [...where] }))
    .sort((a, b) => a.hit.localeCompare(b.hit))
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, controls: Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.length])), scan: scanList }, null, 1))
  console.log(`\nText scan (${SCAN}): ${scanList.length} distinct hits`)
  for (const h of scanList) console.log(`  ${h.hit}\n      in: ${h.where.join(', ')}`)
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length} checks, ${failed.length} failed`)
  process.exitCode = failed.length ? 1 : 0
})()
