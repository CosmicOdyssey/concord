// Helpers for the 2026-10-18 demo-path QA (qa1018_*.js): screenshot size fitting and direct API fetches.
// puppeteer-core is required by absolute path through ./lib.
const fs = require('fs')
const L = require('./lib')

const API = process.env.API || 'http://localhost:8000'
const SCREENS = process.env.SCREENS || 'C:/Users/micha/Projects/concord/.claude/worktrees/agent-a3db634e3f8c2f850/docs/handoff/screens'
const OUT = process.env.QA_OUT || 'C:/Users/micha/AppData/Local/Temp/claude/C--Users-micha/a9b36e49-315a-45e3-915c-93da81b45caa/scratchpad/qa1018'
fs.mkdirSync(SCREENS, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const MAX_BYTES = 600 * 1024

/** Make a PNG fit under maxBytes: first crop to maxH (keeping the top), then downscale in steps. */
async function fit(browser, file, { maxBytes = MAX_BYTES, maxH = 0 } = {}) {
  const buf = fs.readFileSync(file)
  const h = buf.readUInt32BE(20)
  if (buf.length <= maxBytes && (!maxH || h <= maxH)) return { file, bytes: buf.length, scale: 1, cropped: false }
  const page = await browser.newPage()
  try {
    const res = await page.evaluate(
      async (b64, maxBytes, maxH) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const W = img.naturalWidth
        const H0 = img.naturalHeight
        const H = maxH && H0 > maxH ? maxH : H0
        for (const s of [1, 0.85, 0.75, 0.66, 0.58, 0.5, 0.42]) {
          const c = document.createElement('canvas')
          c.width = Math.round(W * s)
          c.height = Math.round(H * s)
          const g = c.getContext('2d')
          g.imageSmoothingQuality = 'high'
          g.drawImage(img, 0, 0, W, H, 0, 0, c.width, c.height)
          const url = c.toDataURL('image/png')
          const bytes = Math.round(((url.length - 22) * 3) / 4)
          if (bytes <= maxBytes || s === 0.42) return { url, scale: s, cropped: H < H0, bytes }
        }
      },
      buf.toString('base64'),
      maxBytes,
      maxH,
    )
    fs.writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'))
    return { file, bytes: fs.statSync(file).size, scale: res.scale, cropped: res.cropped }
  } finally {
    await page.close()
  }
}

/** Screenshot (page or element) into SCREENS/<name>.png, then fit it under the size limit. */
async function snap(browser, target, name, opts = {}) {
  const file = `${SCREENS}/${name}.png`
  if (target.screenshot && opts.element) await target.screenshot({ path: file })
  else await target.screenshot({ path: file, fullPage: opts.fullPage ?? false })
  const r = await fit(browser, file, opts)
  console.log('shot', name, r.bytes, 'bytes', r.scale !== 1 ? `scaled ${r.scale}` : '', r.cropped ? 'cropped' : '')
  return r
}

async function apiGet(path) {
  const res = await fetch(API + path)
  const text = await res.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: res.status, body }
}

async function apiPost(path, json) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
  const text = await res.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: res.status, body }
}

// The app's own formatting (frontend/src/format.ts), so expected strings match what the views render.
const fmt = {
  num: (x, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'),
  int: (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—'),
  pct: (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—'),
  usd: (x) => (typeof x === 'number' && Number.isFinite(x) ? `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'),
  signedUsd: (x) => {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—'
    if (Math.abs(x) < 0.005) return '$0.00'
    const s = fmt.usd(Math.abs(x))
    return x > 0 ? `+${s}` : `−${s}`
  },
}

/** Checks accumulate as {step, check, expected, got, ok}. */
function checker(step, list) {
  return (check, expected, got, ok = expected === got) => {
    list.push({ step, check, expected, got, ok })
    if (!ok) console.log('MISMATCH', step, check, '| expected', JSON.stringify(expected), '| got', JSON.stringify(got))
  }
}

module.exports = { ...L, API, SCREENS, OUT, fit, snap, apiGet, apiPost, fmt, checker }
