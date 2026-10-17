// Cut tall full-page screenshots into readable chunks.
// Usage: node crop.js <chunkHeight> <png> [<png> ...]
const L = require('./lib')
const fs = require('fs')
const path = require('path')

const CH = Number(process.argv[2] || 1800)
const files = process.argv.slice(3)

;(async () => {
  const browser = await L.launch()
  for (const src of files) {
    const buf = fs.readFileSync(src)
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    const page = await browser.newPage()
    await page.setViewport({ width: w, height: Math.min(h, 16000) })
    await page.setContent(`<html><body style="margin:0"><img id="i" src="data:image/png;base64,${buf.toString('base64')}"></body></html>`)
    await page.waitForSelector('#i')
    const dir = path.join(path.dirname(src), 'crops')
    fs.mkdirSync(dir, { recursive: true })
    const base = path.basename(src, '.png')
    let n = 0
    for (let y = 0, i = 0; y < h; y += CH, i++) {
      const p = path.join(dir, `${base}_${String(i).padStart(2, '0')}.png`)
      await page.screenshot({ path: p, clip: { x: 0, y, width: w, height: Math.min(CH, h - y) }, captureBeyondViewport: true })
      n++
    }
    console.log(base, n, 'chunks')
    await page.close()
  }
  await browser.close()
})()
