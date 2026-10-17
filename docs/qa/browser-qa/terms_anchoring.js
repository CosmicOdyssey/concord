// Browser QA for the Terms budget transparency track: anchored-share bar, range at the Medicare band, overhead
// assumption, RVU basis and lab notes, plain-language GPCI labels, the two-site lead and the category breakdown.
// Simple and Detailed, light and dark, 1440 and 390 px; page and console errors; horizontal page scroll; on-screen
// numbers equal to the API; band, overhead and breakdown interactions; keyboard access to the definitions card.
// Usage (NODE_PATH must reach puppeteer-core): node terms_anchoring.js [baseUrl] [outDir]
const fs = require('fs')
const path = require('path')
const { launch, sleep, layoutCheck, showStep } = require('./lib')

const BASE = process.argv[2] || 'http://localhost:5283'
const OUT = process.argv[3] || 'C:/Users/micha/Projects/concord/data/work/T/anchoring'
const NCT = 'NCT05800015'
fs.mkdirSync(OUT, { recursive: true })
const usd = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const getJson = async (p) => (await fetch(BASE + p)).json()
const fails = []
const notes = []
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`)
  return !!ok
}

;(async () => {
  const browser = await launch()
  const log = { console: [], pageerrors: [], failed: [] }
  const open = async (name, width, { theme = 'light', density = 'simple' } = {}) => {
    const page = await browser.newPage()
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.console.push(`${name}: ${m.text()}`))
    page.on('pageerror', (e) => log.pageerrors.push(`${name}: ${e}`))
    page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && log.failed.push(`${name}: ${r.status()} ${r.url()}`))
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
    await page.waitForFunction(() => document.querySelector('.tfa-bar') && document.querySelector('.tf-decomp-total'), { timeout: 60000, polling: 300 })
    await sleep(800)
    // One step at a time (tabs): everything here is in step 3, Budget, except the compare captures (step 4).
    await showStep(page, 3)
    return page
  }

  const sites = await getJson(`/api/terms-flow/${NCT}/sites`)
  const [A, B] = sites.default_pair
  const bud = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1&band_lo=1&band_hi=1.5`)
  const cmp = await getJson(`/api/terms-flow/${NCT}/compare?site_a=${A}&site_b=${B}&multiplier=1&band_lo=1&band_hi=1.5`)
  const sh = bud.anchoring.shares
  notes.push(
    `site ${bud.site.label}; shares ${sh.map((s) => `${s.id} ${usd(s.amount)} ${s.pct}%`).join(', ')}; range ${usd(bud.totals.per_participant_low)}-${usd(bud.totals.per_participant_high)}`,
  )

  for (const density of ['simple', 'detailed'])
    for (const theme of ['light', 'dark'])
      for (const width of [1440, 390]) {
        const name = `${density}-${width}-${theme}`
        const page = await open(name, width, { theme, density })
        // The sticky app bar would cover element screenshots; let it scroll away for the captures.
        await page.addStyleTag({ content: '.appbar, .tabs { position: static !important; }' })
        await sleep(200)
        await (await page.$('#tf-step-3')).screenshot({ path: path.join(OUT, `budget_${name}.png`) })
        await (await page.$('#tf-step-3 .section-row')).screenshot({ path: path.join(OUT, `budget_top_${name}.png`) })
        await (await page.$('.tfa')).screenshot({ path: path.join(OUT, `budget_transparency_${name}.png`) })
        const lay3 = await layoutCheck(page)
        check(`${name} step 3 no horizontal page scroll`, !lay3.overflow, JSON.stringify(lay3.offenders.slice(0, 3)))
        const r = await page.evaluate(() => {
          const txt = (sel) => document.querySelector(sel)?.innerText ?? ''
          return {
            legend: [...document.querySelectorAll('.tfa-legend li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
            range: txt('.tfa-range-v'),
            rangeLede: document.querySelector('.tfa-range-v')?.nextElementSibling?.innerText ?? '',
            payerSub: [...document.querySelectorAll('#tf-step-3 .tf-payer-sub')].map((e) => e.innerText),
            basis: txt('.tfa-basis'),
            bdRows: [...document.querySelectorAll('.tfa-bd tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ')),
            quals3: txt('#tf-step-3 .section-quals'),
            bandInputs: document.querySelectorAll('.tfa-band input').length,
            overInput: document.querySelectorAll('.tfa-over input').length,
            tblShown: !!document.querySelector('.tfa-tbl:not(.tfa-bd)'),
            step3: txt('#tf-step-3'),
          }
        })
        await showStep(page, 4)
        await (await page.$('#tf-step-4')).screenshot({ path: path.join(OUT, `compare_${name}.png`) })
        await (await page.$('#tf-step-4 .section-row')).screenshot({ path: path.join(OUT, `compare_top_${name}.png`) })
        Object.assign(
          r,
          await page.evaluate(() => ({
            lede4: document.querySelector('#tf-step-4 .section-lede')?.innerText ?? '',
            decomp: [...document.querySelectorAll('.tf-decomp-name')].map((e) => e.innerText),
          })),
        )
        const lay = await layoutCheck(page)
        check(`${name} no horizontal page scroll`, !lay.overflow, JSON.stringify(lay.offenders.slice(0, 3)))
        sh.forEach((s, i) => check(`${name} legend ${s.id}`, r.legend[i]?.includes(usd(s.amount)) && r.legend[i]?.includes(`${s.pct.toFixed(1)}%`), r.legend[i]))
        check(`${name} range`, r.range.replace(/\s+/g, ' ') === `${usd(bud.totals.per_participant_low)} – ${usd(bud.totals.per_participant_high)}`, r.range)
        check(`${name} range assumption label`, r.rangeLede.includes('assumption'), r.rangeLede)
        check(`${name} payer range`, r.payerSub.some((x) => x.includes(usd(bud.totals.per_participant_high)) && x.includes('assumption')))
        check(`${name} basis non-facility + OPPS + lab`, /non-facility/.test(r.basis) && /OPPS/.test(r.basis) && /not vary by site/.test(r.basis), r.basis)
        check(`${name} breakdown rows`, r.bdRows.length === bud.breakdowns.cost_type.length, String(r.bdRows.length))
        check(
          `${name} compare lead why`,
          r.lede4.includes('differ by') && r.lede4.includes('doctor’s time') && r.lede4.includes('practice costs') && /national amount/.test(r.lede4),
          r.lede4,
        )
        check(`${name} compare lead not which is cheaper`, !/cheaper|lower|higher/i.test(r.lede4), r.lede4)
        check(
          `${name} decomposition plain labels`,
          r.decomp[0]?.startsWith('Doctor’s time') && r.decomp[1]?.startsWith('Practice costs') && r.decomp[2]?.startsWith('Malpractice insurance'),
          JSON.stringify(r.decomp),
        )
        check(`${name} overhead labelled assumption in quals`, /Overhead \d+% is an assumption/.test(r.quals3), r.quals3)
        check(`${name} band and overhead inputs`, r.bandInputs === 2 && r.overInput === 1)
        check(`${name} anchor table only in detailed`, r.tblShown === (density === 'detailed'))
        check(`${name} no forecast words`, !/time-to-fill|time to fill|enrollment rate|speedup|faster|months saved/i.test(r.step3))
        await page.close()
      }

  // ---------------------------------------------------------------- interactions (Simple, 1440, light)
  {
    const page = await open('interact', 1440)
    // Keyboard: a key press first, so the focus that follows counts as keyboard focus (:focus-visible).
    await page.keyboard.press('Shift')
    await page.focus('.tfa-card-head .hc-info')
    await sleep(600)
    const card = await page.evaluate(() => [...document.querySelectorAll('.hc-card')].map((c) => c.innerText).join('\n'))
    check('anchor definitions card via keyboard', card.includes('Anchored to public rates') && card.includes('Open to negotiation'), card.slice(0, 200))
    await page.screenshot({ path: path.join(OUT, 'anchor_definitions_card_simple-1440-light.png') })
    await page.keyboard.press('Escape')
    // Band: set the high end to 120%.
    const hi = await page.$('input[aria-label="Range high, percent of Medicare"]')
    await hi.click({ clickCount: 3 })
    await hi.type('120')
    await page.keyboard.press('Tab')
    const want = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1&band_lo=1&band_hi=1.2`)
    await page
      .waitForFunction((t) => document.querySelector('.tfa-range-v')?.innerText.includes(t), { timeout: 20000 }, usd(want.totals.per_participant_high))
      .catch(() => {})
    const rng = await page.evaluate(() => document.querySelector('.tfa-range-v')?.innerText)
    check('band edit updates range', rng?.includes(usd(want.totals.per_participant_high)), `${rng} vs ${usd(want.totals.per_participant_high)}`)
    // Overhead: set 10%.
    const ov = await page.$('.tfa-over input')
    await ov.click({ clickCount: 3 })
    await ov.type('10')
    await page.keyboard.press('Tab')
    const want2 = await getJson(
      `/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1&band_lo=1&band_hi=1.2&standard=${encodeURIComponent(JSON.stringify({ overhead: 0.1 }))}`,
    )
    await page.waitForFunction((t) => document.querySelector('.tf-payer-value')?.innerText === t, { timeout: 20000 }, usd(want2.totals.per_participant)).catch(() => {})
    await sleep(400)
    const st = await page.evaluate(() => ({
      v: document.querySelector('.tf-payer-value')?.innerText,
      legend: [...document.querySelectorAll('.tfa-legend li')].map((l) => l.innerText.replace(/\s+/g, ' ')),
      q: document.querySelector('#tf-step-3 .section-quals')?.innerText,
    }))
    check('overhead edit updates total', st.v === usd(want2.totals.per_participant), `${st.v} vs ${usd(want2.totals.per_participant)}`)
    check('overhead edit updates open share', st.legend[2]?.includes(usd(want2.anchoring.shares[2].amount)), st.legend[2])
    check('overhead qualifier follows edit', /Overhead 10% is an assumption/.test(st.q ?? ''), st.q)
    notes.push(`after band 100-120% and overhead 10%: total ${st.v}; legend ${st.legend.join(' | ')}`)
    await (await page.$('#tf-step-3')).screenshot({ path: path.join(OUT, 'budget_edited_band120_overhead10_simple-1440-light.png') })
    // Breakdown toggle: by visit, then who pays.
    await page.evaluate(() => [...document.querySelectorAll('.tfa-seg button')].find((b) => b.innerText === 'Visit')?.click())
    await sleep(300)
    const vis = await page.evaluate(() => [...document.querySelectorAll('.tfa-bd tbody th')].map((t) => t.innerText))
    check('breakdown by visit', vis.join('|') === 'Screening|Treatment cycles|End of treatment|Follow-up', vis.join('|'))
    await (await page.$('.tfa-card-wide')).screenshot({ path: path.join(OUT, 'breakdown_by_visit_simple-1440-light.png') })
    await page.evaluate(() => [...document.querySelectorAll('.tfa-seg button')].find((b) => b.innerText === 'Who pays')?.click())
    await sleep(300)
    const pay = await page.evaluate(() => document.querySelector('.tfa-card-wide')?.innerText ?? '')
    check('breakdown who pays', pay.includes('not one total') && pay.includes('Sponsor') && pay.includes('insurance'), pay.slice(0, 200))
    // GPCI tooltip carries the technical term (the decomposition is in step 4, Compare).
    await showStep(page, 4)
    await page.hover('.tf-decomp-name button')
    await sleep(600)
    const tip = await page.evaluate(() => [...document.querySelectorAll('.hc-card,[role="tooltip"]')].map((c) => c.innerText).join('\n'))
    check('GPCI tooltip technical term', /Work GPCI/.test(tip), tip.slice(0, 200))
    await page.close()
  }
  // Detailed: the line table shows the anchor chip and range per line.
  {
    const page = await open('detailed-lines', 1440, { density: 'detailed' })
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tf-lines tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ')))
    check(
      'detailed lines carry anchor',
      rows.some((r) => r.includes('public rates')) && rows.some((r) => r.includes('proposed standard')),
      rows.slice(0, 4).join(' || '),
    )
    const t = await page.$('.tf-lines')
    if (t) await t.screenshot({ path: path.join(OUT, 'lines_anchor_range_detailed-1440-light.png') })
    await page.close()
  }

  // Rejected typing never commits a partial value; arrow keys step live; Enter commits; the public share names its
  // CMS files; a term-sheet % of Medicare outside the band is said in one sentence (Simple view).
  {
    const page = await open('inputs', 1440)
    const range0 = await page.evaluate(() => document.querySelector('.tfa-range-v')?.innerText)
    const lo = await page.$('input[aria-label="Range low, percent of Medicare"]')
    await lo.click({ clickCount: 3 })
    await lo.type('200')
    const invalidWhileTyping = await page.evaluate((el) => el.getAttribute('aria-invalid'), lo)
    await page.keyboard.press('Tab')
    await sleep(1200)
    const s1 = await page.evaluate(() => ({
      lo: document.querySelector('input[aria-label="Range low, percent of Medicare"]')?.value,
      range: document.querySelector('.tfa-range-v')?.innerText,
      note: document.querySelector('.tfa-band .tfa-input-note')?.innerText,
    }))
    check('typed 200 in low: box back to 100', s1.lo === '100', s1.lo)
    check('typed 200 in low: range unchanged', s1.range === range0, `${s1.range} vs ${range0}`)
    check('typed 200 in low: note says why', /200% is outside 10% to 150%.*kept 100%/.test(s1.note ?? ''), s1.note)
    check('typed 200 in low: aria-invalid while typing', invalidWhileTyping === 'true', String(invalidWhileTyping))
    await (await page.$('.tf-controls')).screenshot({ path: path.join(OUT, 'band_rejected_200_simple-1440-light.png') }).catch(() => {})
    const ov = await page.$('.tfa-over input')
    await ov.click({ clickCount: 3 })
    await ov.type('150')
    await page.keyboard.press('Tab')
    await sleep(1200)
    const s2 = await page.evaluate(() => ({
      v: document.querySelector('.tfa-over input')?.value,
      note: document.querySelector('.tfa-over .tfa-input-note')?.innerText,
      q: document.querySelector('#tf-step-3 .section-quals')?.innerText,
    }))
    check('typed 150 in overhead: box back to 25', s2.v === '25', s2.v)
    check('typed 150 in overhead: note says why', /150% is outside 0% to 100%.*kept 25%/.test(s2.note ?? ''), s2.note)
    check('typed 150 in overhead: qualifier still 25%', /Overhead 25% is an assumption/.test(s2.q ?? ''), s2.q)
    // Arrow key steps commit live.
    await lo.focus()
    await page.keyboard.press('ArrowUp')
    const want105 = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1&band_lo=1.05&band_hi=1.5`)
    await page
      .waitForFunction((t) => document.querySelector('.tfa-range-v')?.innerText.startsWith(t), { timeout: 20000 }, usd(want105.totals.per_participant_low))
      .catch(() => {})
    const s3 = await page.evaluate(() => document.querySelector('.tfa-range-v')?.innerText)
    check('arrow up on low commits 105%', s3?.startsWith(usd(want105.totals.per_participant_low)), `${s3} vs ${usd(want105.totals.per_participant_low)}`)
    // Enter commits a typed value without leaving the box.
    const hi = await page.$('input[aria-label="Range high, percent of Medicare"]')
    await hi.click({ clickCount: 3 })
    await hi.type('130')
    await page.keyboard.press('Enter')
    const want130 = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=1&band_lo=1.05&band_hi=1.3`)
    await page
      .waitForFunction((t) => document.querySelector('.tfa-range-v')?.innerText.endsWith(t), { timeout: 20000 }, usd(want130.totals.per_participant_high))
      .catch(() => {})
    const s4 = await page.evaluate(() => document.querySelector('.tfa-range-v')?.innerText)
    check('Enter on high commits 130%', s4?.endsWith(usd(want130.totals.per_participant_high)), `${s4} vs ${usd(want130.totals.per_participant_high)}`)
    // Public share hover names the CMS files and the locality.
    await page.hover('.tfa-legend li:first-child button')
    await sleep(600)
    const hc = await page.evaluate(() => [...document.querySelectorAll('.hc-card')].map((c) => c.innerText).join('\n'))
    check('public share hover names PFS file and locality', /Source: CMS PFS 2026/.test(hc) && /locality 01/.test(hc), hc.slice(0, 300))
    check('public share hover names CLFS file', !bud.clfs_loaded || /CLFS .*RATE column/.test(hc), hc.slice(0, 300))
    await page.screenshot({ path: path.join(OUT, 'public_share_sources_card_simple-1440-light.png') })
    // Term sheet at 200% of Medicare, outside the 105%-130% band: one sentence says so.
    const mult = await page.$('input[aria-label="Percent of Medicare applied to coded items"]')
    await mult.click({ clickCount: 3 })
    await mult.type('200')
    await page.keyboard.press('Tab')
    const want200 = await getJson(`/api/terms-flow/${NCT}/budget?site_id=${A}&multiplier=2&band_lo=1.05&band_hi=1.3`)
    await page.waitForFunction((t) => document.querySelector('.tf-payer-value')?.innerText === t, { timeout: 20000 }, usd(want200.totals.per_participant)).catch(() => {})
    await sleep(400)
    const s5 = await page.evaluate(() => ({
      sub: document.querySelector('#tf-step-3 .tf-payer-sponsor .tf-payer-sub')?.innerText ?? '',
      out: document.querySelector('.tfa-outside')?.innerText ?? '',
    }))
    const sentence = `The term sheet’s 200% of Medicare (${usd(want200.totals.per_participant)}) is outside this range`
    check('payer figure says term sheet is outside the range', s5.sub.includes(sentence), s5.sub)
    check('range card says term sheet is outside the range', s5.out.includes(sentence), s5.out)
    await (await page.$('#tf-step-3 .section-row')).screenshot({ path: path.join(OUT, 'mult200_outside_band_simple-1440-light.png') })
    // Back inside the band: the sentence goes away.
    await mult.click({ clickCount: 3 })
    await mult.type('120')
    await page.keyboard.press('Tab')
    await sleep(1500)
    const s6 = await page.evaluate(() => !!document.querySelector('.tfa-outside'))
    check('outside sentence gone at 120% (inside the band)', !s6)
    await page.close()
  }

  await browser.close()
  check('no page errors', log.pageerrors.length === 0, log.pageerrors.join(' | '))
  check('no console errors', log.console.length === 0, log.console.join(' | '))
  check('no failed API calls', log.failed.length === 0, log.failed.join(' | '))
  fs.writeFileSync(path.join(OUT, 'qa_result.json'), JSON.stringify({ fails, notes, log, compare: cmp.summary }, null, 2))
  console.log(notes.join('\n'))
  console.log(fails.length ? `FAIL ${fails.length}\n${fails.join('\n')}` : 'ALL CHECKS PASSED')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
