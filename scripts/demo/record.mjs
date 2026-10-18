#!/usr/bin/env node
// Concord demo video: a one-command scripted screen recording of the running app, driven by docs/demo/scenes.json.
//
//   PowerShell:  $env:NODE_PATH = 'C:/Users/micha/Projects/concord/data/work/D/node_modules'; node scripts/demo/record.mjs
//   bash:        NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules node scripts/demo/record.mjs
//
// Needs: the frontend on http://localhost:5173 (Vite), the backend virtualenv (backend/.venv), installed Chrome,
// puppeteer-core and ffmpeg-static (npm packages, in data/work/D/node_modules or anywhere on NODE_PATH).
//
// What it does, in order:
//  1. Starts a private copy of the API (port 8017, or the next free port) with its own registry cache in
//     data/work/demo/registry_cache, and sends the browser's /api calls there. The take never writes the live cache,
//     and Protocol to terms always opens with the three authored trials. With --api live, the browser uses the app's
//     own /api instead (the live cache then decides which trial cards show).
//  2. Rehearsal, off camera: plays every scene once at full speed in a throwaway browser context. It checks every
//     target and warms every route, API call and Vite module, so no spinner appears on camera. Missing targets stop
//     the run here, before anything is recorded.
//  3. The take: a fresh browser context at 1920 x 1080 (device scale factor 1), light theme, Simple density. An
//     injected cursor glides with easing to each target, clicks show a soft ripple, scrolls are eased with the
//     scene's duration, and hovered elements get a brief highlight ring. Each scene starts at its start_s on the video
//     clock and each action at its at_s. Cuts (goto) and slow loads happen with the capture paused, so the video clock
//     stops while the app loads and no spinner reaches the video.
//  4. Encodes the frames at a constant frame rate (30 fps) to H.264 (yuv420p) with ffmpeg-static, and writes the
//     narration as subtitles (.srt, for reading along while recording the voiceover), the chapter list and a timing log.
//
// Options (all optional):
//   --base URL          frontend (default http://localhost:5173)
//   --scenes FILE       scene list (default docs/demo/scenes.json)
//   --out DIR           output folder (default data/work/demo)
//   --viewport WxH      CSS viewport, 16:9 (default 1920x1080; 1440x810 renders the same frame 4/3 larger)
//   --fps N             output frame rate (default 30)
//   --api scratch|live  scratch: private API copy with its own cache (default); live: the app's own /api
//   --api-port N        first port to try for the private API (default 8017)
//   --no-fade           no 0.5 s fade-in and 1.5 s fade-out
//   --no-ring           no highlight ring on hovered elements
//   --rehearse-only     check targets and warm the app, record nothing
//   --keep-frames       keep the captured JPEG frames (data/work/demo/.capture)
//   --headful           show the browser window (debugging; the take is still captured by the screencast)

import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DEPS = path.join(ROOT, 'data', 'work', 'D', 'node_modules')

/** A package from NODE_PATH, else from data/work/D/node_modules. */
function dep(name) {
  try {
    return require(name)
  } catch {
    return require(path.join(DEPS, name))
  }
}
const puppeteer = dep('puppeteer-core')
const FFMPEG = dep('ffmpeg-static')

// ------------------------------------------------------------------------------------------------ options

const OUT_W = 1920
const OUT_H = 1080
const opt = {
  base: 'http://localhost:5173',
  scenes: path.join(ROOT, 'docs', 'demo', 'scenes.json'),
  out: path.join(ROOT, 'data', 'work', 'demo'),
  viewport: '1920x1080',
  fps: 30,
  api: 'scratch',
  apiPort: 8017,
  fade: true,
  ring: true,
  rehearseOnly: false,
  keepFrames: false,
  headful: false,
  chrome: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  quality: 92,
  crf: 17,
}
{
  const a = process.argv.slice(2)
  const val = (i) => {
    if (a[i + 1] === undefined) throw new Error(`${a[i]} needs a value`)
    return a[i + 1]
  }
  for (let i = 0; i < a.length; i++) {
    const k = a[i]
    if (k === '--base') opt.base = val(i++).replace(/\/$/, '')
    else if (k === '--scenes') opt.scenes = path.resolve(val(i++))
    else if (k === '--out') opt.out = path.resolve(val(i++))
    else if (k === '--viewport') opt.viewport = val(i++)
    else if (k === '--fps') opt.fps = Number(val(i++))
    else if (k === '--api') opt.api = val(i++)
    else if (k === '--api-port') opt.apiPort = Number(val(i++))
    else if (k === '--chrome') opt.chrome = val(i++)
    else if (k === '--quality') opt.quality = Number(val(i++))
    else if (k === '--crf') opt.crf = Number(val(i++))
    else if (k === '--no-fade') opt.fade = false
    else if (k === '--no-ring') opt.ring = false
    else if (k === '--rehearse-only') opt.rehearseOnly = true
    else if (k === '--keep-frames') opt.keepFrames = true
    else if (k === '--headful') opt.headful = true
    else if (k === '--help' || k === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
      process.exit(0)
    } else throw new Error(`unknown option ${k} (try --help)`)
  }
}
const [VW, VH] = opt.viewport.split('x').map(Number)
if (!(VW > 0 && VH > 0) || Math.abs(VW / VH - 16 / 9) > 0.01) throw new Error('--viewport must be 16:9, e.g. 1920x1080 or 1440x810')
const DSF = OUT_W / VW
const SCENES = JSON.parse(fs.readFileSync(opt.scenes, 'utf8'))
const TOTAL = Math.max(...SCENES.map((s) => s.start_s + s.duration_s))
const FILES = {
  mp4: path.join(opt.out, 'concord-demo.mp4'),
  srt: path.join(opt.out, 'concord-demo.srt'),
  chapters: path.join(opt.out, 'chapters.txt'),
  log: path.join(opt.out, 'record-log.json'),
  apiLog: path.join(opt.out, 'api.log'),
  capture: path.join(opt.out, '.capture'),
  downloads: path.join(opt.out, 'downloads'),
  rehearsal: path.join(opt.out, '.rehearsal'),
  cache: path.join(opt.out, 'registry_cache'),
}
// Chapter titles; a scene can carry its own "title".
const TITLES = {
  hook: 'Why budgets stall',
  'open-terms': 'Protocol to terms',
  coverage: 'Routine care or research',
  'budget-anchored': 'The anchored share',
  'line-detail': 'Every line shows its math',
  'compare-sites': 'Why two sites differ',
  'proposal-check': 'Site proposal check (synthetic sample)',
  'any-trial': 'Any trial by NCT ID',
  overlap: 'Portfolio overlap',
  compares: 'How Concord compares',
  tested: 'What we tested',
  close: 'Decision support, and our ask',
}
const MOUSE_PARK = { x: VW - 2, y: Math.round(VH / 2) } // empty margin: where the real pointer waits during scrolls
const START_CURSOR = { x: Math.round(VW * 0.77), y: Math.round(VH * 0.76) }
const EASE_X = [0.55, 0, 0.25, 1] // cursor glide: x and y ease differently, which bends the path into a soft arc
const EASE_Y = [0.3, 0, 0.35, 1]

// ------------------------------------------------------------------------------------------------ small helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const nowS = () => (performance.timeOrigin + performance.now()) / 1000
const mmss = (s, ms = true) => {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${(ms ? r.toFixed(1) : String(Math.floor(r))).padStart(ms ? 4 : 2, '0')}`
}
const say = (...a) => console.log(...a)
const describe = (t) => (typeof t === 'string' ? t : typeof t === 'number' ? `${t}px` : `"${t.text}" in ${t.scope || 'body'}`)

function cubicBezier([x1, y1, x2, y2]) {
  const bx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3
  const by = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
  return (k) => {
    if (k <= 0) return 0
    if (k >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (bx(mid) < k) lo = mid
      else hi = mid
    }
    return by((lo + hi) / 2)
  }
}
const easeX = cubicBezier(EASE_X)
const easeY = cubicBezier(EASE_Y)

async function httpOk(url, ms = 3000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
    return r.ok
  } catch {
    return false
  }
}

function portFree(port) {
  return new Promise((res) => {
    const s = net.createServer()
    s.once('error', () => res(false))
    s.once('listening', () => s.close(() => res(true)))
    s.listen(port, '127.0.0.1')
  })
}

// ------------------------------------------------------------------------------------------------ private API

async function startScratchApi() {
  let port = opt.apiPort
  while (!(await portFree(port))) port++
  const py = process.platform === 'win32' ? path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe') : path.join(ROOT, 'backend', '.venv', 'bin', 'python')
  if (!fs.existsSync(py)) throw new Error(`backend virtualenv not found at ${py} (see README: python -m venv .venv), or use --api live`)
  await fsp.mkdir(FILES.cache, { recursive: true })
  const log = fs.createWriteStream(FILES.apiLog)
  const child = spawn(py, ['-m', 'uvicorn', 'concord.api.main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, CONCORD_REGISTRY_CACHE: FILES.cache },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const origin = `http://127.0.0.1:${port}`
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`the private API exited (code ${child.exitCode}); see ${FILES.apiLog}`)
    if (await httpOk(`${origin}/api/terms-flow/trials`, 5000)) return { origin, port, child }
    await sleep(500)
  }
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else child.kill()
  throw new Error(`the private API did not answer on ${origin} within 2 minutes; see ${FILES.apiLog}`)
}

/** NCT IDs a scene types into the add-trial box: the take must start without them, as a fresh profile would. */
const ADDED = [...new Set(SCENES.flatMap((s) => s.actions).filter((a) => a.type === 'type' && /^NCT\d{8}$/.test(a.text || '')).map((a) => a.text))]
const protocolFile = (dir, nct) => path.join(dir, `${nct}.protocol.json`)

// ------------------------------------------------------------------------------------------------ in-page helpers

/** Injected into every document before the app runs: storage defaults, the cursor overlay, hidden scrollbars, eased
 *  scrolling, the highlight ring and the target finder. Everything lives on window.__demo. */
function demoInit(cfg) {
  try {
    if (/^https?:$/.test(location.protocol) && !localStorage.getItem('concord.demo.init')) {
      localStorage.setItem('concord.theme', cfg.theme)
      localStorage.setItem('concord.density', cfg.density)
      localStorage.setItem('concord.demo.init', '1')
    }
  } catch {
    /* storage unavailable */
  }
  if (window.__demo) return
  const SIZE = 30
  const TIP = { x: (3 * SIZE) / 24, y: (2 * SIZE) / 24 }
  const css = `
    html, html * { scrollbar-width: none !important; }
    html::-webkit-scrollbar, html *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
    html { scroll-behavior: auto !important; }
    #__demo { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; overflow: hidden; }
    #__demo .cx, #__demo .cy { position: absolute; left: 0; top: 0; will-change: transform; }
    #__demo svg { display: block; width: ${SIZE}px; height: ${SIZE}px; overflow: visible; transform-origin: ${TIP.x}px ${TIP.y}px;
      transition: transform 110ms ease-out; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.35)) drop-shadow(0 2px 6px rgba(0,0,0,.12)); }
    #__demo svg.down { transform: scale(.84); }
    #__demo .rip { position: absolute; left: 0; top: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
      background: rgba(28,102,132,.22); box-shadow: 0 0 0 2px rgba(28,102,132,.45); animation: __demo_rip 560ms cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes __demo_rip { from { transform: scale(.25); opacity: 1 } to { transform: scale(1.3); opacity: 0 } }
    #__demo .tick { position: absolute; right: 0; bottom: 0; width: 2px; height: 2px; background: #000; opacity: 0; }
    .__demo_ring { position: absolute; pointer-events: none; z-index: 900; border-radius: 9px; opacity: 0;
      box-shadow: 0 0 0 2px rgba(28,102,132,.55), 0 0 0 7px rgba(28,102,132,.13); transition: opacity 280ms ease; }
    .__demo_ring.on { opacity: 1; }`
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2 L3 20.2 L7.7 15.9 L10.8 22.9 L14.1 21.5 L11 14.6 L17.4 14.6 Z"
    fill="#ffffff" stroke="#14232b" stroke-width="1.35" stroke-linejoin="round"/></svg>`
  const st = { x: cfg.x, y: cfg.y }
  let root = null
  let cx = null
  let cy = null
  let ptr = null
  let tick = null
  const set = (x, y) => {
    cx.style.transform = `translateX(${x - TIP.x}px)`
    cy.style.transform = `translateY(${y - TIP.y}px)`
  }
  function mount() {
    if (root && root.isConnected) return true
    const host = document.documentElement
    if (!host || !(document.head || document.body)) return false
    const style = document.createElement('style')
    style.id = '__demo_css'
    style.textContent = css
    ;(document.head || host).appendChild(style)
    root = document.createElement('div')
    root.id = '__demo'
    root.setAttribute('aria-hidden', 'true')
    root.innerHTML = `<div class="cx"><div class="cy">${svg}</div></div><div class="tick"></div>`
    host.appendChild(root)
    cx = root.querySelector('.cx')
    cy = root.querySelector('.cy')
    ptr = root.querySelector('svg')
    tick = root.querySelector('.tick')
    place(st.x, st.y)
    return true
  }
  function place(x, y) {
    st.x = x
    st.y = y
    if (!mount()) return
    cx.style.transition = 'none'
    cy.style.transition = 'none'
    set(x, y)
    void cx.offsetWidth
  }
  function glide(x, y, ms, ex, ey) {
    st.x = x
    st.y = y
    if (!mount()) return
    cx.style.transition = `transform ${ms}ms cubic-bezier(${ex.join(',')})`
    cy.style.transition = `transform ${ms}ms cubic-bezier(${ey.join(',')})`
    set(x, y)
  }
  // A visual click: the pointer dips and a ripple spreads from the tip (real pointer events, so app clicks are real).
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!mount()) return
      ptr.classList.add('down')
      const r = document.createElement('div')
      r.className = 'rip'
      r.style.left = `${e.clientX}px`
      r.style.top = `${e.clientY}px`
      root.insertBefore(r, root.firstChild)
      setTimeout(() => r.remove(), 700)
    },
    true,
  )
  window.addEventListener('pointerup', () => ptr && ptr.classList.remove('down'), true)
  // Forces one repaint (a new screencast frame) without any visible change.
  function nudge() {
    if (!mount()) return
    tick.style.opacity = tick.style.opacity === '0.004' ? '0.002' : '0.004'
  }
  const ease = (k, long) => (long ? -(Math.cos(Math.PI * k) - 1) / 2 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
  function maxScroll() {
    const se = document.scrollingElement || document.documentElement
    return Math.max(0, se.scrollHeight - innerHeight)
  }
  function scrollToY(y, ms) {
    return new Promise((res) => {
      const y0 = window.scrollY
      const y1 = Math.round(Math.max(0, Math.min(maxScroll(), y)))
      if (ms <= 0 || Math.abs(y1 - y0) < 1) {
        window.scrollTo(0, y1)
        return res(window.scrollY)
      }
      const t0 = performance.now()
      const long = ms > 2500
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms)
        window.scrollTo(0, y0 + (y1 - y0) * ease(k, long))
        if (k < 1) requestAnimationFrame(step)
        else res(window.scrollY)
      }
      requestAnimationFrame(step)
    })
  }
  function visible(el) {
    if (!el || !el.isConnected) return false
    if (el.closest('[hidden]')) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false
    return true
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
  function lookup(t) {
    if (typeof t === 'string') return [...document.querySelectorAll(t)].find(visible) || null
    const want = norm(t.text)
    const cands = [...document.querySelectorAll(t.scope || 'body')]
      .flatMap((s) => [...s.querySelectorAll('a, button, summary, label, [role=tab], [role=button]')])
      .filter(visible)
    const texts = cands.map((c) => norm(c.innerText))
    for (const test of [(x) => x === want, (x) => x.startsWith(want), (x) => x.endsWith(want), (x) => x.includes(want)]) {
      const i = texts.findIndex(test)
      if (i >= 0) return cands[i]
    }
    return null
  }
  // Is something pinned to the viewport (the sticky header or step nav) covering the point? Hover cards do not count.
  function pinnedCover(hit) {
    for (let a = hit; a && a !== document.body; a = a.parentElement) {
      if (a.closest('.hc-card')) return false
      const p = getComputedStyle(a).position
      if (p === 'sticky' || p === 'fixed') return true
    }
    return false
  }
  function find(t) {
    const el = lookup(t)
    if (!el) return null
    document.querySelectorAll('[data-demo-target]').forEach((e) => e !== el && e.removeAttribute('data-demo-target'))
    el.setAttribute('data-demo-target', '')
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const inView = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
    const hit = inView ? document.elementFromPoint(x, y) : null
    const covered = !!hit && hit !== el && !el.contains(hit) && pinnedCover(hit)
    const label = (el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + ' ' + norm(el.innerText).slice(0, 60)).trim()
    return { x, y, w: r.width, h: r.height, top: r.top, pageTop: r.top + window.scrollY, inView, covered, vw: innerWidth, vh: innerHeight, label }
  }
  function ring(holdMs) {
    const el = document.querySelector('[data-demo-target]')
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 5
    const d = document.createElement('div')
    d.className = '__demo_ring'
    d.style.left = `${r.left + window.scrollX - pad}px`
    d.style.top = `${r.top + window.scrollY - pad}px`
    d.style.width = `${r.width + 2 * pad}px`
    d.style.height = `${r.height + 2 * pad}px`
    document.documentElement.appendChild(d)
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')))
    setTimeout(() => d.classList.remove('on'), holdMs)
    setTimeout(() => d.remove(), holdMs + 400)
  }
  function busy() {
    return [...document.querySelectorAll('.spinner, .loading, [aria-busy="true"]')].some(visible)
  }
  window.__demo = { mount, place, glide, nudge, scrollToY, find, ring, busy, maxScroll, pos: () => ({ ...st }) }
  if (!mount()) document.addEventListener('DOMContentLoaded', mount, { once: true })
}

// ------------------------------------------------------------------------------------------------ browser and pages

async function launch() {
  return puppeteer.launch({
    executablePath: opt.chrome,
    headless: !opt.headful,
    protocolTimeout: 600_000,
    defaultViewport: null,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      `--window-size=${VW},${VH}`,
    ],
  })
}

/** A page in a fresh browser context (its own storage: what a first-time viewer sees), with the overlay, light
 *  colour scheme, downloads into `downloadDir` and /api routed to `apiOrigin` (null keeps the app's own /api). */
async function newPage(browser, { apiOrigin, downloadDir }) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF })
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ])
  await page.evaluateOnNewDocument(demoInit, { theme: 'light', density: 'simple', ...START_CURSOR })
  const cdp = await page.createCDPSession()
  const base = new URL(opt.base)
  const issues = { api: [], console: [], pageerrors: [] }
  if (apiOrigin) {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] })
    cdp.on('Fetch.requestPaused', (e) => {
      const u = new URL(e.request.url)
      const to = u.origin === base.origin && u.pathname.startsWith('/api/') ? apiOrigin + u.pathname + u.search : undefined
      cdp.send('Fetch.continueRequest', to ? { requestId: e.requestId, url: to } : { requestId: e.requestId }).catch(() => {})
    })
  }
  await fsp.mkdir(downloadDir, { recursive: true })
  const bs = await browser.target().createCDPSession()
  await bs.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, browserContextId: ctx.id, eventsEnabled: true })
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) issues.api.push(`${r.status()} ${r.request().method()} ${r.url()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') issues.console.push(m.text())
  })
  page.on('pageerror', (e) => issues.pageerrors.push(String(e && e.message ? e.message : e)))
  return { ctx, page, cdp, issues }
}

async function waitOverlay(page) {
  await page.waitForFunction(() => window.__demo && window.__demo.mount(), { timeout: 15000, polling: 50 })
}

async function settleScroll(page, quietMs = 300, maxMs = 4000) {
  const t0 = Date.now()
  let last = await page.evaluate(() => window.scrollY)
  let since = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(60)
    const y = await page.evaluate(() => window.scrollY)
    if (y !== last) {
      last = y
      since = Date.now()
    } else if (Date.now() - since >= quietMs) return
  }
}

// ------------------------------------------------------------------------------------------------ capture

/** Page.startScreencast frames, placed on a video clock that stops while paused. Frames are written to disk as they
 *  arrive (no encoding during the take); encode() later resamples them to a constant frame rate. */
class Capture {
  constructor(cdp, dir) {
    this.cdp = cdp
    this.dir = dir
    this.frames = []
    this.writes = []
    this.seq = 0
    this.latest = null
    this.started = false
    this.paused = true
    this.pausedTotal = 0
    this.pauses = []
    this.lastV = 0
    this.onFrame = (e) => this.#frame(e)
  }
  async start() {
    await fsp.rm(this.dir, { recursive: true, force: true })
    await fsp.mkdir(this.dir, { recursive: true })
    this.cdp.on('Page.screencastFrame', this.onFrame)
    await this.#cast()
    if (!(await this.waitFrame(3000, 0))) throw new Error('no screencast frame within 3 s')
    this.t0 = nowS()
    this.started = true
    this.paused = false
    this.#push(this.latest, 0)
  }
  async #cast() {
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: opt.quality, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 })
  }
  #frame(e) {
    this.cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {})
    this.latest = Buffer.from(e.data, 'base64')
    this.seq++
    // The frame's swap time (seconds since the epoch) places it more precisely than its arrival; use arrival time if
    // the browser's clock does not agree with ours.
    const meta = e.metadata && e.metadata.timestamp
    if (this.useMeta === undefined && meta) this.useMeta = Math.abs(meta - nowS()) < 1.5
    if (!this.started || this.paused) return
    const ts = this.useMeta && meta ? meta : nowS()
    this.#push(this.latest, Math.max(this.lastV, ts - this.t0 - this.pausedTotal))
  }
  #push(buf, v) {
    const file = path.join(this.dir, `f${String(this.frames.length).padStart(6, '0')}.jpg`)
    this.frames.push({ file, v })
    this.writes.push(fsp.writeFile(file, buf))
    this.lastV = v
  }
  /** Seconds on the video clock. */
  v() {
    if (!this.started) return 0
    return this.paused ? this.pausedAtV : nowS() - this.t0 - this.pausedTotal
  }
  async waitFrame(ms, after = this.seq) {
    const t0 = Date.now()
    while (this.seq <= after) {
      if (Date.now() - t0 > ms) return false
      await sleep(10)
    }
    return true
  }
  pause(why) {
    if (!this.started || this.paused) return
    this.pausedAtV = this.v()
    this.paused = true
    this.pauseWall = nowS()
    this.pauses.push({ at: +this.pausedAtV.toFixed(3), why })
  }
  async resume(page) {
    if (!this.started || !this.paused) return
    // A fresh frame of the settled page; restart the screencast if a navigation stopped it.
    let seq = this.seq
    await page.evaluate(() => window.__demo && window.__demo.nudge()).catch(() => {})
    if (!(await this.waitFrame(700, seq))) {
      await this.cdp.send('Page.stopScreencast').catch(() => {})
      seq = this.seq
      await this.#cast()
      if (!(await this.waitFrame(2000, seq))) throw new Error('the screencast stopped sending frames')
    }
    const p = this.pauses[this.pauses.length - 1]
    p.off_camera_s = +(nowS() - this.pauseWall).toFixed(2)
    this.pausedTotal += nowS() - this.pauseWall
    this.paused = false
    this.#push(this.latest, this.pausedAtV)
  }
  async stop() {
    this.pause('end')
    this.cdp.off('Page.screencastFrame', this.onFrame)
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    await Promise.all(this.writes)
  }
}

/** Resample the frames to a constant frame rate and encode H.264 yuv420p. Frame k shows whatever was on screen at the
 *  middle of its interval. */
async function encode(frames, total, outFile) {
  const n = Math.round(total * opt.fps)
  const vf = [
    `scale=${OUT_W}:${OUT_H}:flags=lanczos:in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709`,
    ...(opt.fade ? ['fade=t=in:st=0:d=0.5', `fade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5`] : []),
    'format=yuv420p',
  ].join(',')
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(opt.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opt.crf), '-pix_fmt', 'yuv420p', '-r', String(opt.fps), '-g', String(opt.fps * 2),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-an', outFile,
  ]
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  let err = ''
  ff.stderr.on('data', (d) => (err += d))
  let p = 0
  let cur = -1
  let buf = null
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / opt.fps
    while (p + 1 < frames.length && frames[p + 1].v <= t) p++
    if (p !== cur) {
      buf = await fsp.readFile(frames[p].file)
      cur = p
    }
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain')
  }
  ff.stdin.end()
  const [code] = await once(ff, 'close')
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err}`)
  return n
}

// ------------------------------------------------------------------------------------------------ subtitles and chapters

function srtTime(s) {
  const ms = Math.round(s * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

/** Two balanced lines at most. */
function wrap(text) {
  if (text.length <= 46) return text
  const mid = text.length / 2
  let best = -1
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`
}

/** The narration as cues: sentences (a sentence ends where the next word starts with a capital, so "U.S. sites" stays
 *  whole), long ones split at the comma or colon nearest the middle, timed by length inside the scene. */
function writeSubtitles() {
  const cues = []
  for (const s of SCENES) {
    const parts = []
    for (let p of s.narration.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      p = p.trim()
      while (p.length > 96) {
        const mid = p.length / 2
        let best = -1
        for (const m of p.matchAll(/[,:;] /g)) if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index
        if (best < 24 || best > p.length - 24) {
          // No punctuation near the middle: break at the space nearest it.
          best = -1
          for (const m of p.matchAll(/ /g)) if (best < 0 || Math.abs(m.index - mid) < Math.abs(best - mid)) best = m.index
          parts.push(p.slice(0, best))
          p = p.slice(best + 1).trim()
          continue
        }
        parts.push(p.slice(0, best + 1))
        p = p.slice(best + 2).trim()
      }
      if (p) parts.push(p)
    }
    const a = s.start_s + 0.25
    const b = s.start_s + s.duration_s - 0.4
    const total = parts.reduce((x, p) => x + p.length, 0)
    let t = a
    for (const p of parts) {
      const d = ((b - a) * p.length) / total
      cues.push({ from: t, to: t + d - 0.05, text: wrap(p) })
      t += d
    }
  }
  fs.writeFileSync(FILES.srt, cues.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join('\n'))
  const chapters = SCENES.map((s) => `${mmss(s.start_s, false)} ${s.title || TITLES[s.id] || s.id}`)
  fs.writeFileSync(FILES.chapters, chapters.join('\n') + '\n')
  return cues.length
}

// ------------------------------------------------------------------------------------------------ the scene runner

/** Plays the scene list on one page. take=false is the rehearsal: same actions at full speed, no clock, no capture. */
class Runner {
  constructor(page, { take, capture, downloadDir, issues }) {
    this.page = page
    this.take = take
    this.cap = capture
    this.downloadDir = downloadDir
    this.issues = issues
    this.cursor = { ...START_CURSOR }
    this.log = []
    this.problems = []
  }
  v() {
    return this.take ? this.cap.v() : 0
  }
  async until(t) {
    if (!this.take) return
    for (;;) {
      const left = t - this.cap.v()
      if (left <= 0) return
      await sleep(Math.min(25, left * 1000))
    }
  }
  /** Off camera while `fn` runs (no-op in the rehearsal). */
  async offCamera(why, fn) {
    if (!this.take) return fn()
    this.cap.pause(why)
    try {
      return await fn()
    } finally {
      await this.cap.resume(this.page)
    }
  }

  async find(target, timeoutMs, where) {
    const t0 = Date.now()
    let paused = false
    for (;;) {
      const info = await this.page.evaluate((t) => window.__demo && window.__demo.find(t), target).catch(() => null)
      if (info) {
        if (paused) {
          await sleep(300)
          await this.cap.resume(this.page)
          this.problems.push(`${where}: waited ${((Date.now() - t0) / 1000).toFixed(1)} s off camera for ${describe(target)}`)
        }
        return info
      }
      // Not there yet: keep the wait off camera (unless a cut already paused the capture).
      if (this.take && !paused && !this.cap.paused && Date.now() - t0 > 250) {
        this.cap.pause(`waiting for ${describe(target)}`)
        paused = true
      }
      if (Date.now() - t0 > timeoutMs) {
        if (paused) await this.cap.resume(this.page)
        throw new Error(`${where}: target not found or not visible: ${describe(target)}`)
      }
      await sleep(50)
    }
  }

  /** After a click: if a spinner or busy region shows up, wait for it off camera. */
  async guardBusy(where) {
    if (!this.take) return
    const t0 = Date.now()
    while (Date.now() - t0 < 450) {
      if (await this.page.evaluate(() => window.__demo && window.__demo.busy()).catch(() => false)) {
        const w0 = Date.now()
        let done = true
        await this.offCamera('loading', async () => {
          done = await this.page
            .waitForFunction(() => !window.__demo.busy(), { timeout: 30000, polling: 50 })
            .then(() => true)
            .catch(() => false)
          await sleep(250)
        })
        const s = ((Date.now() - w0) / 1000).toFixed(1)
        this.problems.push(`${where}: a loading state showed; ${s} s kept off camera${done ? '' : ' (still loading after 30 s)'}`)
        return
      }
      await sleep(40)
    }
  }

  async parkMouse() {
    await this.page.mouse.move(MOUSE_PARK.x, MOUSE_PARK.y)
  }

  async scrollTo(y, ms) {
    await this.parkMouse()
    return this.page.evaluate((y, ms) => window.__demo.scrollToY(y, ms), y, this.take ? ms : 0)
  }

  /** Glide the visible cursor (compositor-driven CSS transition, smooth even while the app renders) and walk the real
   *  pointer along the same eased path, so hover states open and close as they would for a person. */
  async glide(x, y, ms) {
    const from = { ...this.cursor }
    this.cursor = { x, y }
    if (!this.take || ms < 40 || Math.hypot(x - from.x, y - from.y) < 3) {
      await this.page.evaluate((x, y) => window.__demo.place(x, y), x, y)
      await this.page.mouse.move(x, y)
      return
    }
    await this.page.evaluate((x, y, ms, ex, ey) => window.__demo.glide(x, y, ms, ex, ey), x, y, ms, EASE_X, EASE_Y)
    const t0 = performance.now()
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / ms)
      await this.page.mouse.move(from.x + (x - from.x) * easeX(k), from.y + (y - from.y) * easeY(k))
      if (k >= 1) break
      await sleep(28)
    }
  }

  /** Find the target; scroll it into view first when its centre is off screen or under the sticky header. */
  async reach(target, where) {
    let info = await this.find(target, this.take ? 15000 : 30000, where)
    if (!info.inView || info.covered) {
      const y = info.pageTop + info.h / 2 - info.vh / 2
      await this.scrollTo(y, 700)
      if (this.take) await sleep(60)
      info = await this.find(target, 5000, where)
      this.problems.push(`${where}: ${describe(target)} was off screen; scrolled it in first`)
    }
    return info
  }

  async point(a, where, click) {
    const info = await this.reach(a.target, where)
    const x = Math.round(info.x)
    const y = Math.round(info.y)
    await this.glide(x, y, Math.round((a.duration_s || 0.8) * 1000 * 0.85))
    if (click) {
      await this.page.mouse.down()
      await sleep(this.take ? 90 : 20)
      await this.page.mouse.up()
      await this.guardBusy(where)
    } else if (this.take && opt.ring && info.w * info.h < 0.25 * VW * VH && info.h < 0.5 * VH) {
      await this.page.evaluate((ms) => window.__demo.ring(ms), Math.max(900, Math.min(1800, (a.duration_s || 1) * 1000 + 700)))
    }
    return info
  }

  async cut(target, where, nextWait) {
    await this.offCamera('cut', async () => {
      let url
      if (target.startsWith('download:')) {
        const name = target.slice('download:'.length)
        url = pathToFileURL(await this.waitDownload(name, where)).href
      } else url = opt.base + target
      const cur = this.page.url()
      // Same document with another hash: load it fresh, as a cut would.
      if (cur.split('#')[0] === url.split('#')[0]) await this.page.goto('about:blank')
      await this.page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
      await this.page.evaluate(() => document.fonts && document.fonts.ready)
      await waitOverlay(this.page)
      await this.page.evaluate((c) => window.__demo.place(c.x, c.y), this.cursor)
      if (nextWait) await this.find(nextWait, 30000, where)
      await settleScroll(this.page)
      await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await sleep(this.take ? 350 : 50)
    })
  }

  async waitDownload(name, where) {
    const want = path.join(this.downloadDir, name)
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) {
      if (fs.existsSync(want)) {
        const s1 = fs.statSync(want).size
        await sleep(150)
        if (s1 > 0 && fs.statSync(want).size === s1) return want
      }
      await sleep(100)
    }
    // The scene names the file; take the newest export if the name differs (another site id, say).
    const prefix = name.split('_')[0]
    const alt = fs
      .readdirSync(this.downloadDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.html'))
      .map((f) => ({ f, t: fs.statSync(path.join(this.downloadDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]
    if (!alt) throw new Error(`${where}: download ${name} did not arrive in ${this.downloadDir}`)
    this.problems.push(`${where}: expected ${name}, opened ${alt.f}`)
    return path.join(this.downloadDir, alt.f)
  }

  async run() {
    for (const [si, s] of SCENES.entries()) {
      await this.until(s.start_s)
      const lateScene = this.v() - s.start_s
      say(`${this.take ? mmss(this.v()) : 'rehearsal'}  scene ${si + 1} ${s.id}${this.take && lateScene > 0.05 ? ` (late ${lateScene.toFixed(2)} s)` : ''}`)
      for (const [ai, a] of s.actions.entries()) {
        const where = `${s.id}#${ai + 1} ${a.type}`
        const at = s.start_s + a.at_s
        await this.until(at)
        const start = this.v()
        const preRoll = si === 0 && ai === 0 && a.type === 'goto'
        const next = s.actions[ai + 1]
        const nextWait = next && next.type === 'wait' && next.target && next.at_s === a.at_s ? next.target : null
        switch (a.type) {
          case 'goto':
            if (!preRoll) await this.cut(a.target, where, nextWait)
            break
          case 'wait':
            if (a.target) await this.find(a.target, this.take ? Math.max(15000, a.duration_s * 1000) : 30000, where)
            break
          case 'scroll_to': {
            let y
            if (typeof a.target === 'number') y = a.target
            else {
              const info = await this.find(a.target, 15000, where)
              y = info.pageTop - (a.offset_px ?? 96)
            }
            await this.scrollTo(y, (a.duration_s || 0) * 1000)
            break
          }
          case 'scroll_by': {
            const y0 = await this.page.evaluate(() => window.scrollY)
            await this.scrollTo(y0 + Number(a.target), (a.duration_s || 0) * 1000)
            break
          }
          case 'hover':
            await this.point(a, where, false)
            break
          case 'click':
            await this.point(a, where, true)
            break
          case 'type': {
            const focused = await this.page.evaluate(
              (t) => {
                const el = window.__demo.find(t) && document.querySelector('[data-demo-target]')
                return !!el && document.activeElement === el
              },
              a.target,
            )
            if (!focused) await this.point({ ...a, duration_s: 0.5 }, where, true)
            await this.page.keyboard.type(a.text, { delay: this.take ? ((a.duration_s || 1) * 1000) / a.text.length : 0 })
            break
          }
          default:
            throw new Error(`${where}: unknown action type ${a.type}`)
        }
        const end = this.v()
        this.log.push({
          scene: s.id,
          action: ai + 1,
          type: a.type,
          target: a.target === undefined ? null : describe(a.target),
          planned_s: +at.toFixed(2),
          started_s: +start.toFixed(2),
          late_s: +(start - at).toFixed(2),
          ended_s: +end.toFixed(2),
          overrun_s: +Math.max(0, end - (at + (a.duration_s || 0))).toFixed(2),
        })
        if (!this.take && a.type === 'goto' && !preRoll) await sleep(100)
      }
    }
    await this.until(TOTAL)
  }
}

// ------------------------------------------------------------------------------------------------ main

async function preRoll(page) {
  const first = SCENES[0].actions[0]
  const route = first && first.type === 'goto' ? first.target : '/#home'
  await page.goto(opt.base + route, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.evaluate(() => document.fonts && document.fonts.ready)
  await waitOverlay(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await settleScroll(page)
  await page.mouse.move(START_CURSOR.x, START_CURSOR.y)
  await page.evaluate((c) => window.__demo.place(c.x, c.y), START_CURSOR)
  await sleep(800)
}

async function main() {
  const t0 = Date.now()
  await fsp.mkdir(opt.out, { recursive: true })
  const cues = writeSubtitles()
  say(`Scenes: ${SCENES.length}, runtime ${mmss(TOTAL, false)} (${TOTAL} s). Subtitles: ${cues} cues -> ${FILES.srt}`)
  if (!(await httpOk(opt.base + '/', 5000))) throw new Error(`the frontend is not answering at ${opt.base}`)

  let api = null
  let liveRestore = []
  const cleanup = async () => {
    if (!api || api.child.exitCode !== null) return
    // On Windows the virtualenv's python.exe is a launcher with the real interpreter as its child: end the tree.
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(api.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else api.child.kill()
    await sleep(300)
  }
  process.on('SIGINT', async () => {
    await cleanup()
    process.exit(130)
  })
  const browser = await launch()
  const report = { started: new Date().toISOString(), options: { ...opt, viewport: `${VW}x${VH}`, deviceScaleFactor: DSF }, problems: [] }
  try {
    // 1. The API the browser talks to, and a clean trial list (the added trial must not be there yet).
    let apiOrigin = null
    let cacheDir
    if (opt.api === 'scratch') {
      api = await startScratchApi()
      apiOrigin = api.origin
      cacheDir = FILES.cache
      say(`Private API: ${api.origin} (registry cache ${cacheDir})`)
    } else {
      if (!(await httpOk(opt.base + '/api/terms-flow/trials', 10000))) throw new Error('the app API is not answering through the frontend')
      cacheDir = path.join(ROOT, 'data', 'work', 'registry_cache')
      liveRestore = ADDED.filter((n) => !fs.existsSync(protocolFile(cacheDir, n)))
      say(`Live API through ${opt.base}/api (registry cache ${cacheDir})`)
    }
    const clean = () => ADDED.forEach((n) => fs.rmSync(protocolFile(cacheDir, n), { force: true }))
    clean()

    // 2. Rehearsal: every scene once at full speed, off camera.
    say('Rehearsal (off camera): checking every target and warming every route ...')
    await fsp.rm(FILES.rehearsal, { recursive: true, force: true })
    const r0 = Date.now()
    {
      const { ctx, page, issues } = await newPage(browser, { apiOrigin, downloadDir: FILES.rehearsal })
      await preRoll(page)
      const runner = new Runner(page, { take: false, downloadDir: FILES.rehearsal, issues })
      await runner.run()
      report.rehearsal = { seconds: +((Date.now() - r0) / 1000).toFixed(1), issues, notes: runner.problems }
      await ctx.close()
    }
    clean()
    const listed = await fetch((apiOrigin || opt.base) + '/api/terms-flow/trials', { signal: AbortSignal.timeout(30000) })
      .then((r) => r.json())
      .then((ts) => ts.map((t) => t.nct_id))
      .catch(() => [])
    report.trials_before_take = listed
    say(`Rehearsal passed in ${report.rehearsal.seconds} s. Trials listed when the take starts: ${listed.join(', ')}`)
    const rehearsalErrors = [...report.rehearsal.issues.api, ...report.rehearsal.issues.pageerrors]
    if (rehearsalErrors.length) say(`Rehearsal errors:\n  ${rehearsalErrors.join('\n  ')}`)
    if (opt.rehearseOnly) return

    // 3. The take.
    await fsp.rm(FILES.downloads, { recursive: true, force: true })
    const { ctx, page, cdp, issues } = await newPage(browser, { apiOrigin, downloadDir: FILES.downloads })
    await preRoll(page)
    const cap = new Capture(cdp, FILES.capture)
    const runner = new Runner(page, { take: true, capture: cap, downloadDir: FILES.downloads, issues })
    say('Recording ...')
    await cap.start()
    await runner.run()
    const recorded = cap.v()
    await cap.stop()
    await ctx.close()
    say(`Captured ${cap.frames.length} frames over ${recorded.toFixed(2)} s of video (${cap.pauses.length - 1} off-camera pauses).`)

    // 4. Encode.
    say(`Encoding ${FILES.mp4} ...`)
    const n = await encode(cap.frames, TOTAL, FILES.mp4)
    if (!opt.keepFrames) await fsp.rm(FILES.capture, { recursive: true, force: true })
    const late = runner.log.filter((l) => l.late_s > 0.3)
    Object.assign(report, {
      video: FILES.mp4,
      seconds: TOTAL,
      frames_out: n,
      fps: opt.fps,
      resolution: `${OUT_W}x${OUT_H}`,
      captured_frames: cap.frames.length,
      unique_fps: +(cap.frames.length / TOTAL).toFixed(1),
      pauses: cap.pauses,
      take_issues: issues,
      late_actions: late,
      problems: runner.problems,
      actions: runner.log,
      subtitles: FILES.srt,
      chapters: FILES.chapters,
      wall_seconds: Math.round((Date.now() - t0) / 1000),
    })
    say(`Done: ${FILES.mp4} (${TOTAL} s, ${OUT_W}x${OUT_H}, ${opt.fps} fps, ${n} frames).`)
    if (late.length) say(`Late actions (> 0.3 s): ${late.map((l) => `${l.scene}#${l.action} +${l.late_s}s`).join(', ')}`)
    if (runner.problems.length) say(`Notes:\n  ${runner.problems.join('\n  ')}`)
    const errs = [...issues.api, ...issues.pageerrors]
    if (errs.length) say(`Errors during the take:\n  ${errs.join('\n  ')}`)
  } finally {
    report.finished = new Date().toISOString()
    fs.writeFileSync(FILES.log, JSON.stringify(report, null, 1))
    await browser.close().catch(() => {})
    if (opt.api === 'scratch') {
      ADDED.forEach((n) => fs.rmSync(protocolFile(FILES.cache, n), { force: true }))
    } else {
      // Leave the live cache as it was: a trial the take added is removed again.
      const cacheDir = path.join(ROOT, 'data', 'work', 'registry_cache')
      liveRestore.forEach((n) => fs.rmSync(protocolFile(cacheDir, n), { force: true }))
    }
    await cleanup()
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e)
  process.exit(1)
})
