// Compare the API responses the page received with independent fetches of the same requests.
const fs = require('fs')
const W = 'C:/Users/micha/Projects/concord/data/work/D'
const logs = ['desktop', 'desktop_fixed'].map((n) => JSON.parse(fs.readFileSync(`${W}/${n}_log.json`, 'utf8')))
const ind = (f) => JSON.parse(fs.readFileSync(`${W}/api/${f}`, 'utf8'))
const pairs = [
  ['POST /api/clear US-Northeast', (a) => a.url.endsWith('/api/clear') && JSON.parse(a.post).region === 'US-Northeast', 'clear_ne.json'],
  ['POST /api/clear US Regeneron 2024-09-01', (a) => a.url.endsWith('/api/clear') && JSON.parse(a.post).sponsor === 'Regeneron', 'clear_regn.json'],
  ['GET /api/robustness US-Northeast', (a) => a.url.includes('/api/robustness') && a.url.includes('region=US-Northeast'), 'robust_ne.json'],
  ['GET /api/robustness Regeneron', (a) => a.url.includes('/api/robustness') && a.url.includes('sponsor=Regeneron'), 'robust_regn.json'],
  ['GET /api/congestion-test', (a) => a.url.endsWith('/api/congestion-test'), 'congestion.json'],
  ['GET /api/status', (a) => a.url.endsWith('/api/status'), 'status.json'],
  ['GET /api/trials/NCT06452277/price-tags', (a) => a.url.includes('/price-tags'), 'pricetags_soho02.json'],
  ['GET /api/slot-values', (a) => a.url.includes('/slot-values'), 'slotvalues_ne.json'],
  ['GET /api/termsheet', (a) => a.url.includes('/api/termsheet'), 'termsheet.json'],
  ['POST /api/compile/eligibility', (a) => a.url.endsWith('/api/compile/eligibility'), 'compile.json'],
  ['GET /api/sponsors US 2024-09-01', (a) => a.url.includes('/api/sponsors') && a.url.includes('as_of=2024-09-01'), 'sponsors_us_20240901.json'],
  ['GET /api/sponsors US-Northeast', (a) => a.url.includes('/api/sponsors') && a.url.includes('region=US-Northeast'), 'sponsors_ne.json'],
]
const strip = (o) => {
  // the crawl "updated" timestamp and counts can move while the crawler runs; compare the rest
  if (o && o.crawls) return { ...o, crawls: Object.fromEntries(Object.entries(o.crawls).map(([k, v]) => [k, { ...v, updated: '' }])) }
  return o
}
for (const [label, pred, file] of pairs) {
  const other = ind(file)
  const res = logs.map((l) => {
    const a = l.api.filter((x) => pred(x) && x.status === 200)
    if (!a.length) return 'not requested'
    return a.every((x) => JSON.stringify(strip(x.body)) === JSON.stringify(strip(other))) ? 'identical' : 'DIFFERENT'
  })
  console.log(`${label}: original run ${res[0]}; fixed-frontend run ${res[1]}`)
}
