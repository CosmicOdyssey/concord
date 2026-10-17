// Financial Coordination QA (Calm pass): Simple and Detailed, light and dark, 1440 and 390 px.
// Guards: the synthetic banner in both modes; no modeled months or time changes in Simple; every number shown equals
// the API's comparison; every input reachable in both modes (same set of controls); hover cards open on hover, keyboard
// focus and tap; edits clear the result; coverage overrides reach the API; both exports download; no horizontal page
// scroll; no page or console errors; text contrast; 44 px touch targets on the phone.
// usage: NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node financial.js [base] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep } = require('./lib')

const BASE = process.argv[2] || 'http://127.0.0.1:5215'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/R/financial'
fs.mkdirSync(OUT, { recursive: true })
const SECTIONS = ['Overview', 'Allocation Comparison', 'Three-Party Economics', 'Reinvestment Lab', 'Coverage Review', 'Evidence Report']
const H2 = {
  Overview: 'Overview',
  'Allocation Comparison': 'Allocation and site assumptions',
  'Three-Party Economics': 'Payments, economic effects, and resource costs',
  'Reinvestment Lab': 'Reinvestment under a fixed sponsor budget',
  'Coverage Review': 'Preliminary coverage worksheet',
  'Evidence Report': 'Traceable evidence report',
}

// The view's formatting (FinancialView.tsx).
const usd = (v) =>
  typeof v === 'number' && Number.isFinite(v)
    ? `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
    : 'Unknown'
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'Unknown')
const num1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : 'Unknown')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ` :: ${JSON.stringify(detail).slice(0, 600)}` : ''}`)
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
  const client = await page.target().createCDPSession()
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'downloads').replace(/\\/g, '/') })
  return page
}

async function load(page) {
  await page.goto(`${BASE}/#financial`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.financial button')].some((b) => b.innerText.trim() === 'Compare funding scenarios'), {
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
  await clickText(page, '.financial button', 'Compare funding scenarios')
  await page.waitForFunction(() => /Comparison computed/.test(document.querySelector('.fin-status')?.innerText ?? ''), { timeout: 60000 })
  for (let i = 0; i < 50 && log.api.filter((a) => a.url.includes('/compare')).length === before; i++) await sleep(100)
  await sleep(300)
  return log.api.filter((a) => a.url.includes('/compare')).at(-1)
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
      if (el.closest('[disabled], option, .sr-only')) continue
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
      const sel =
        '.financial button:not(.hc-trigger):not(.fin-scen-pick), .financial select, .financial input:not([type=checkbox]), .fin-check, .fin-cellcheck, .fin-scen-row, .financial summary'
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.height < 43.5 || (el.matches('button,select') && r.width < 43.5))
          small.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      // InfoTips draw a 44 px hit area with ::after.
      for (const el of document.querySelectorAll('.financial .hc-info')) {
        const a = getComputedStyle(el, '::after')
        if (parseFloat(a.width) < 43.5 && !el.classList.contains('hc-info-lg')) small.push(`hc-info ::after ${a.width}x${a.height}`)
      }
    }
    return { hscroll: de.scrollWidth > de.clientWidth + 1, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, lowContrast: lowContrast.slice(0, 12), small: small.slice(0, 12) }
  })
}

/** Labels of every input and select in the Financial view (open disclosures first). */
async function controlLabels(page, scope = '.financial') {
  return page.evaluate(
    (scope) =>
      [...document.querySelectorAll(`${scope} input, ${scope} select`)].map((el) => {
        const label = el.getAttribute('aria-label') || el.closest('label')?.innerText.trim() || el.id || '?'
        return `${el.tagName.toLowerCase()}:${label.replace(/\s+/g, ' ')}`
      }),
    scope,
  )
}

async function openCardBy(page, how, selector) {
  // Returns the visible card's text after hover, keyboard focus or tap, or null.
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
    // Keyboard: Tab until the trigger has focus.
    await page.evaluate(() => {
      document.body.tabIndex = -1
      document.body.focus()
    })
    let found = false
    for (let i = 0; i < 400 && !found; i++) {
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

/** Escape closes any open card (a tap "outside" can land on the card itself on a phone). */
async function closeCards(page) {
  await page.keyboard.press('Escape')
  await page.mouse.move(1, 1)
  await sleep(250)
  return page.evaluate(() => ![...document.querySelectorAll('.hc-card')].some((x) => !x.hidden && x.getBoundingClientRect().height > 0))
}

;(async () => {
  const browser = await launch()
  const shots = []
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

          // Before any comparison.
          const pre = await page.evaluate(() => ({
            banner: document.querySelector('.financial .banner')?.innerText ?? '',
            density: document.documentElement.dataset.density,
            theme: document.documentElement.dataset.theme,
          }))
          check(`${tag}: density and theme applied`, pre.density === density && pre.theme === theme, pre)
          check(
            `${tag}: synthetic banner shown`,
            /Synthetic financial demo\./.test(pre.banner) && /No verified financial inputs or insurer partnership/.test(pre.banner) && /No realized savings/.test(pre.banner),
            pre.banner,
          )
          await page.screenshot({ path: `${OUT}/${tag}-0-before.png`, fullPage: true })

          const cmp = await compare(page, log)
          const R = cmp?.body
          check(`${tag}: comparison returned 200`, cmp?.status === 200 && R?.scenarios?.length, cmp?.status)
          if (!R) {
            await page.close()
            continue
          }
          const sel = R.scenarios.find((s) => s.id === (R.recommended_scenario_id ?? R.scenarios[0].id))

          if (density === 'simple') {
            const ui = await page.evaluate(() => ({
              rows: [...document.querySelectorAll('.fin-scen-row')].map((li) => ({
                name: li.querySelector('.fin-scen-pick')?.innerText.trim(),
                pressed: li.querySelector('.fin-scen-pick')?.getAttribute('aria-pressed'),
                amt: li.querySelector('.fin-scen-amt')?.innerText.trim(),
                feas: li.querySelector('.fin-scen-feas')?.innerText.trim(),
                share: li.querySelector('.fin-scen-share')?.innerText.trim() ?? null,
                meter: li.querySelector('.fin-meter > span')?.style.width ?? null,
              })),
              ledger: [...document.querySelectorAll('.fin-ledger .kf')].map((k) => ({
                label: k.querySelector('.kf-label')?.innerText.trim(),
                value: k.querySelector('.kf-value')?.innerText.trim(),
                q: k.querySelector('.kf-q')?.innerText.trim() ?? null,
                sub: k.querySelector('.kf-sub')?.innerText.trim() ?? null,
              })),
              all: document.querySelector('.financial').textContent,
              visible: document.querySelector('.financial').innerText,
            }))
            const want = R.scenarios.map((s) => ({
              amt: usd(s.plan.sponsor_total),
              feas: s.plan.feasible ? 'Feasible under assumptions' : 'Infeasible',
              share: Number.isFinite(s.plan.budget_utilization) ? `${pct(s.plan.budget_utilization)} of entered budget` : null,
            }))
            check(
              `${tag}: each scenario's sponsor commitment, feasibility and budget share equal the API`,
              ui.rows.length === want.length && ui.rows.every((r, i) => r.amt === want[i].amt && r.feas.startsWith(want[i].feas) && r.share === want[i].share),
              { ui: ui.rows, want },
            )
            check(
              `${tag}: the API's recommended scenario is the selected one`,
              ui.rows.filter((r) => r.pressed === 'true').length === 1 && ui.rows.find((r) => r.pressed === 'true').name.startsWith(`${sel.id}. ${sel.label}`),
              ui.rows.map((r) => [r.name, r.pressed]),
            )
            const e = sel.economics
            const wantLedger = [usd(e.sponsor.expenditure), usd(e.hospital.net_contribution), usd(e.insurer.total), usd(e.patient.net_cash_exposure)]
            check(`${tag}: ledger summary equals the API`, JSON.stringify(ui.ledger.map((l) => l.value)) === JSON.stringify(wantLedger), { ui: ui.ledger, wantLedger })
            check(
              `${tag}: ledger qualifiers visible`,
              ui.ledger[0]?.sub?.includes(usd(e.sponsor.contingency_reserve)) && /Downstream clinical cost unknown/.test(ui.ledger[2]?.q) && /Specified lines only/.test(ui.ledger[3]?.q) && /Unresolved exposure unknown/.test(ui.ledger[3]?.sub),
              ui.ledger,
            )
            check(`${tag}: no modeled months or time changes in Simple (DOM, incl. folded content)`, !/Modeled months|Modeled time change|Capacity within horizon/i.test(ui.all), (ui.all.match(/.{40}(Modeled months|Modeled time change|Capacity within horizon).{40}/i) || [])[0])
            check(`${tag}: no-promise qualifier visible`, /No promise that every party benefits/.test(ui.visible))

            // Hover cards: assumptions (section info), transfers (ledger info), limitations (banner).
            const how = phone ? ['tap', 'focus'] : ['hover', 'focus']
            for (const h of how) {
              const a = await openCardBy(page, h, '[aria-label="Details: Funding scenarios"]')
              check(
                `${tag}: assumptions card opens on ${h} (in view, every assumption, closes on Escape)`,
                a && /Explicit modeling assumptions/.test(a.text) && a.inView && a.closesOnEscape && Object.values(R.assumptions).every((v) => a.text.includes(v)),
                a,
              )
            }
            const b = await openCardBy(page, how[0], '[aria-label="Details: Who pays what"]')
            check(`${tag}: transfers card opens on ${how[0]}`, b && /are transfers/.test(b.text), b)
            const limSel = '.financial .banner .hc-trigger'
            const lim = await openCardBy(page, how[0], limSel)
            check(`${tag}: limitations card lists every limitation`, lim && R.limitations.every((l) => lim.text.includes(l)) && lim.inView, lim && { n: R.limitations.length, inView: lim.inView })
            if (width === 1440 && theme === 'light') {
              await page.hover('[aria-label="Details: Funding scenarios"]')
              await sleep(500)
              await page.screenshot({ path: `${OUT}/${tag}-card-assumptions.png` })
              await closeCards(page)
            }
            if (phone && theme === 'dark') {
              await page.tap(limSel)
              await sleep(400)
              await page.screenshot({ path: `${OUT}/${tag}-card-limitations.png` })
              await closeCards(page)
            }

            // Select another scenario: the ledger follows.
            const other = R.scenarios.find((s) => s.id !== sel.id && s.plan.feasible)
            if (other) {
              await page.evaluate((id) => [...document.querySelectorAll('.fin-scen-pick')].find((b) => b.innerText.startsWith(`${id}.`)).click(), other.id)
              await sleep(250)
              const v = await page.evaluate(() => document.querySelector('.fin-ledger .kf-value')?.innerText.trim())
              check(`${tag}: selecting scenario ${other.id} updates the ledger`, v === usd(other.economics.sponsor.expenditure), { v, want: usd(other.economics.sponsor.expenditure) })
            }

            // Keyboard: a scenario row takes focus and shows a ring around the whole row.
            if (!phone) {
              await page.evaluate(() => {
                document.body.tabIndex = -1
                document.body.focus()
              })
              let ring = null
              for (let i = 0; i < 80 && !ring; i++) {
                await page.keyboard.press('Tab')
                ring = await page.evaluate(() => {
                  const a = document.activeElement
                  if (!a?.classList.contains('fin-scen-pick')) return null
                  const after = getComputedStyle(a, '::after')
                  const li = a.closest('li').getBoundingClientRect()
                  return { style: after.outlineStyle, width: after.outlineWidth, rowH: Math.round(li.height), y: li.top + window.scrollY }
                })
              }
              check(`${tag}: a scenario row shows a keyboard focus ring`, ring && ring.style === 'solid' && ring.width === '2px', ring)
              if (ring) {
                await page.evaluate((y) => window.scrollTo(0, y - 200), ring.y)
                await sleep(150)
                await page.screenshot({ path: `${OUT}/${tag}-focus-row.png`, clip: { x: 560, y: Math.max(0, ring.y - 120), width: 880, height: 420 } })
              }
              await page.evaluate(() => document.activeElement?.blur())
            }

            await page.screenshot({ path: `${OUT}/${tag}-1-compared.png`, fullPage: true })
            // Every folded input, then the full control set.
            await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
            await sleep(400)
            controls[tag] = await controlLabels(page)
            await page.screenshot({ path: `${OUT}/${tag}-2-all-open.png`, fullPage: true })
          } else {
            const nav = await page.evaluate(() => [...document.querySelectorAll('.fin-nav button')].map((b) => [b.innerText.trim(), b.getAttribute('aria-current')]))
            check(`${tag}: six section buttons`, JSON.stringify(nav.map((n) => n[0])) === JSON.stringify(SECTIONS) && nav[0][1] === 'page', nav)
            // The setup window once, then each section's own controls (a list, not a set: coverage rows repeat labels).
            const labels = await controlLabels(page, '.fin-setup')
            for (const s of SECTIONS) {
              await clickText(page, '.fin-nav button', s)
              await sleep(350)
              const st = await page.evaluate(() => ({
                h2: document.querySelector('.fin-section h2')?.innerText.trim(),
                label: document.querySelector('.fin-section')?.getAttribute('aria-label'),
                rows: [...document.querySelectorAll('.fin-section table')].map((t) => t.querySelector('caption')?.innerText.trim() + ' :: ' + t.tBodies[0]?.rows.length),
                scen: [...(document.querySelector('.fin-section table caption')?.innerText.startsWith('Fixed-target') ? document.querySelector('.fin-section table').tBodies[0].rows : [])].map((tr) =>
                  [...tr.cells].map((c) => c.innerText.trim()),
                ),
                text: document.querySelector('.fin-section')?.innerText ?? '',
              }))
              check(`${tag}: ${s} shows "${H2[s]}"`, st.h2 === H2[s] && st.label === s, st.h2)
              if (st.scen.length) {
                const ok = R.scenarios.every((sc, i) => {
                  const row = st.scen[i]
                  return row && row[2] === usd(sc.plan.sponsor_total) && row[3] === String(sc.plan.selected_ids.length) && row[4] === num1(sc.plan.projected_capacity) && row[5] === num1(sc.plan.modeled_months) && row[6] === usd(sc.plan.unspent_budget)
                })
                check(`${tag}: ${s} scenario table equals the API (incl. modeled months)`, ok, st.scen)
              }
              if (s === 'Three-Party Economics') {
                const e = sel.economics
                check(
                  `${tag}: party ledger equals the API`,
                  [e.sponsor.expenditure, e.hospital.net_contribution, e.insurer.total, e.patient.net_cash_exposure, e.consolidated_resource_cost].every((v) => st.text.includes(usd(v))),
                  st.text.slice(0, 400),
                )
              }
              if (s === 'Reinvestment Lab' && sel.reinvestment)
                check(`${tag}: modeled time change shown in Detailed`, st.text.includes(`Modeled time change: ${num1(sel.reinvestment.modeled_time_change)} months`), st.text.slice(0, 300))
              if (s === 'Coverage Review') check(`${tag}: coverage worksheet has every item`, st.rows.some((r) => r.endsWith(`:: ${R.coverage.items.length}`)), st.rows)
              if (s === 'Evidence Report') check(`${tag}: evidence shows run id and every limitation`, st.text.includes(R.run_id) && R.limitations.every((l) => st.text.includes(l)), st.text.slice(0, 200))
              labels.push(...(await controlLabels(page, '.fin-section')))
              const au = await audit(page)
              check(`${tag}: ${s} no horizontal page scroll`, !au.hscroll, au)
              check(`${tag}: ${s} text contrast`, au.lowContrast.length === 0, au.lowContrast)
              if (phone) check(`${tag}: ${s} touch targets`, au.small.length === 0, au.small)
              const file = `${OUT}/${tag}-${s.toLowerCase().replace(/[^a-z]+/g, '-')}.png`
              await page.screenshot({ path: file, fullPage: true })
            }
            controls[tag] = labels
            await clickText(page, '.fin-nav button', 'Overview')
          }

          const au = await audit(page)
          check(`${tag}: no horizontal page scroll`, !au.hscroll, au)
          check(`${tag}: text contrast >= 4.5:1 (3:1 large)`, au.lowContrast.length === 0, au.lowContrast)
          if (phone) check(`${tag}: touch targets >= 44 px`, au.small.length === 0, au.small)
          check(`${tag}: demo fixture loaded`, !!demo?.request)
          check(`${tag}: no page or console errors`, log.console.length + log.pageerrors.length === 0, { console: log.console, pageerrors: log.pageerrors })
          await page.close()
        }

    // Same inputs in both modes.
    for (const [w, t] of [
      [1440, 'light'],
      [390, 'dark'],
    ]) {
      const s = [...(controls[`simple-${w}-${t}`] ?? [])].sort()
      const d = [...(controls[`detailed-${w}-${t}`] ?? [])].sort()
      check(
        `every input in Detailed is reachable in Simple (${w} ${t}): ${s.length} vs ${d.length}`,
        s.length > 150 && JSON.stringify(s) === JSON.stringify(d),
        { onlySimple: s.filter((x) => !d.includes(x)), onlyDetailed: d.filter((x) => !s.includes(x)) },
      )
    }

    // Behaviour (Simple, 1440 light): an edit clears the comparison; a coverage override reaches the API; both exports.
    {
      const log = { console: [], pageerrors: [] }
      const page = await openPage(browser, { width: 1440, theme: 'light', density: 'simple' }, log)
      await load(page)
      await compare(page, log)
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('.fin-setup label')].find((l) => /Total sponsor budget/.test(l.innerText)).querySelector('input')
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(input, '1400000')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await sleep(300)
      const cleared = await page.evaluate(() => ({
        status: document.querySelector('.fin-status')?.innerText,
        rows: document.querySelectorAll('.fin-scen-row').length,
      }))
      check('editing an input clears the comparison and says so', cleared.rows === 0 && /Inputs changed/.test(cleared.status), cleared)
      const r2 = await compare(page, log)
      check('recompute sends the edited budget', JSON.parse(r2.post).budget === 1400000 && r2.status === 200, r2.post?.slice(0, 80))

      // A tight budget makes a scenario infeasible: Simple names it, lists the violation and draws the meter full.
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('.fin-setup label')].find((l) => /Total sponsor budget/.test(l.innerText)).querySelector('input')
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(input, '640000')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await sleep(200)
      const tight = (await compare(page, log)).body
      const bad = tight.scenarios.find((s) => !s.plan.feasible)
      if (bad) {
        const row = await page.evaluate((id) => {
          const li = [...document.querySelectorAll('.fin-scen-row')].find((x) => x.querySelector('.fin-scen-pick').innerText.startsWith(`${id}.`))
          return { feas: li.querySelector('.fin-scen-feas').innerText, amt: li.querySelector('.fin-scen-amt').innerText, share: li.querySelector('.fin-scen-share')?.innerText, meter: li.querySelector('.fin-meter > span')?.style.width }
        }, bad.id)
        check(
          `infeasible scenario ${bad.id}: named, violations listed, amount and share equal the API, meter capped`,
          /Infeasible/.test(row.feas) && bad.plan.violations.every((v) => row.feas.includes(v)) && row.amt === usd(bad.plan.sponsor_total) && row.share === `${pct(bad.plan.budget_utilization)} of entered budget` && row.meter === '100%',
          { row, bad: bad.plan },
        )
        await page.evaluate((id) => [...document.querySelectorAll('.fin-scen-pick')].find((b) => b.innerText.startsWith(`${id}.`)).click(), bad.id)
        await sleep(250)
        const led = await page.evaluate(() => ({ figs: document.querySelectorAll('.fin-ledger .kf').length, text: document.querySelector('.financial').innerText }))
        check('selecting an infeasible scenario shows no ledger, with the reason', led.figs === 0 && /select a feasible scenario to inspect its ledger/.test(led.text), led.figs)
        await page.screenshot({ path: `${OUT}/simple-1440-light-5-infeasible.png`, fullPage: true })
        // Width only: switching isMobile/hasTouch would reload the page and drop the state.
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
        await sleep(400)
        const au = await audit(page)
        check('infeasible state at 390: no horizontal page scroll', !au.hscroll, au)
        await page.screenshot({ path: `${OUT}/simple-390-light-5-infeasible.png`, fullPage: true })
        await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
        await sleep(300)
      } else check('a 640,000 budget makes a scenario infeasible', false, tight.scenarios.map((s) => s.plan.feasible))

      // Coverage override in the folded worksheet.
      await page.evaluate(() => document.querySelectorAll('.fin-more details').forEach((d) => (d.open = true)))
      await sleep(300)
      const target = await page.evaluate(() => {
        const s = document.querySelector('.fin-tbl-coverage select')
        const next = [...s.options].find((o) => o.value !== s.value && o.value === 'SPONSOR') || [...s.options].find((o) => o.value !== s.value)
        return { label: s.getAttribute('aria-label'), value: next.value }
      })
      await page.select(`select[aria-label="${target.label}"]`, target.value)
      await sleep(300)
      const pending = await page.evaluate(() => document.querySelector('.financial')?.innerText.includes('Coverage edits are pending'))
      check('a coverage override marks the worksheet pending', pending)
      const r3 = await compare(page, log)
      const overrides = JSON.parse(r3.post).coverage_overrides
      check('the coverage override reaches the API', Object.values(overrides).includes(target.value) && r3.status === 200, overrides)

      for (const [label, fmt] of [
        ['Download readable HTML report', 'html'],
        ['Download JSON evidence', 'json'],
      ]) {
        const n = log.api.length
        await clickText(page, '.financial button', label)
        await page.waitForFunction((fmt) => new RegExp(`${fmt.toUpperCase()} report downloaded`).test(document.querySelector('.fin-status')?.innerText ?? ''), { timeout: 60000 }, fmt)
        const rep = log.api.slice(n).find((a) => a.url.includes(`/report?format=${fmt}`))
        check(`${fmt.toUpperCase()} export downloads (200)`, rep?.status === 200, rep?.status)
      }
      // An empty number field is an input problem, not a failed request, and never reaches the API.
      const n = log.api.length
      await page.evaluate(() => {
        const input = [...document.querySelectorAll('.fin-setup label')].find((l) => /Planning horizon/.test(l.innerText)).querySelector('input')
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(input, '')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await sleep(200)
      await clickText(page, '.financial button', 'Compare funding scenarios')
      await sleep(600)
      const err = await page.evaluate(() => document.querySelector('.financial [role="alert"]')?.innerText ?? null)
      check('an empty number shows "Check the inputs." and sends nothing', /Check the inputs\./.test(err ?? '') && !log.api.slice(n).some((a) => a.url.includes('/compare')), err)
      await page.screenshot({ path: `${OUT}/simple-1440-light-3-input-error.png` })
      check('behaviour run: no page or console errors', log.console.length + log.pageerrors.length === 0, { console: log.console, pageerrors: log.pageerrors })
      await page.close()
    }

    // Unreachable API: the Calm error with "Try again" (demo request aborted by the test).
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
      await page.screenshot({ path: `${OUT}/simple-1440-light-4-demo-error.png` })
      fail = false
      await clickText(page, '.financial .error button', 'Try again')
      await page.waitForFunction(() => [...document.querySelectorAll('.financial button')].some((b) => b.innerText.trim() === 'Compare funding scenarios'), { timeout: 30000 })
      check('Try again reloads the demo', true)
      await page.close()
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, results, controls: Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.length])) }, null, 1))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length} checks, ${failed.length} failed`)
  process.exitCode = failed.length ? 1 : 0
})()
