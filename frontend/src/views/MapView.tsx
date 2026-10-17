import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { AllocKey, ClearResult, Site } from '../api'
import type { ClearState } from '../App'
import { Badge, Details, ErrorBox, Loading, NeedsClear, RunLine } from '../components'
import { useDensity } from '../density'
import { useTabActive } from '../tabActive'
import { ALLOC_HINT, ALLOC_LABEL, int, isNum, loadOf, pct } from '../format'
import { DEFAULT_SCENARIO } from '../api'
import { useTheme } from '../theme'
import { InSampleLine, RsHead } from './researchParts'

const ALLOCS: AllocKey[] = ['actual', 'indep', 'coord', 'coord_free']

function load(s: Site, a: AllocKey): number {
  return loadOf(s, a)
}

function radius(n: number): number {
  return n === 0 ? 2.5 : 3.5 + 2.2 * Math.sqrt(n)
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap()
  // The Research tab stays mounted behind other tabs (display: none): the map measures 0 x 0 there. When the tab is
  // shown again, re-read the size, and fit a result that arrived while it was hidden.
  const active = useTabActive()
  const fitted = useRef<LatLngBoundsExpression | null>(null)
  useEffect(() => {
    if (!active) return
    map.invalidateSize()
    if (bounds && fitted.current !== bounds) {
      fitted.current = bounds
      map.fitBounds(bounds, { padding: [24, 24] })
    }
    // bounds is memoized per clear result, so toggling the allocation does not refit.
  }, [bounds, map, active])
  return null
}

interface AllocStats {
  used: number
  slots: number
  amcShare: number | null
  top10Share: number | null
  maxLoad: number
}

function allocStats(r: ClearResult, a: AllocKey): AllocStats {
  const loads = r.sites.map((s) => ({ s, n: load(s, a) }))
  const slots = loads.reduce((acc, x) => acc + x.n, 0)
  const amc = loads.reduce((acc, x) => acc + (x.s.is_amc ? x.n : 0), 0)
  const top10 = [...loads]
    .sort((x, y) => y.n - x.n)
    .slice(0, 10)
    .reduce((acc, x) => acc + x.n, 0)
  const used = r.counts[`sites_used_${a}`] ?? loads.filter((x) => x.n > 0).length
  return {
    used,
    slots,
    amcShare: slots > 0 ? amc / slots : null,
    top10Share: slots > 0 ? top10 / slots : null,
    maxLoad: Math.max(0, ...loads.map((x) => x.n)),
  }
}

interface Palette {
  amc: string
  other: string
  idle: string
  stroke: string
}

// Fallbacks equal to the Calm tokens, used until the computed values are read.
const LIGHT: Palette = { amc: '#b07020', other: '#1c6684', idle: '#738390', stroke: '#ffffff' }
const DARK: Palette = { amc: '#bc8a45', other: '#6bc0dd', idle: '#687884', stroke: '#131c21' }

const TOKENS = ['--series-2', '--accent', '--ctl', '--surface'] as const

// The theme lives in <html data-theme>; ThemeProvider sets it in a layout effect, after this view has rendered, so the
// tokens are read when the attribute changes rather than during the render that follows a theme switch.
function subscribeTheme(onChange: () => void) {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}
function readTokens(): string {
  const cs = getComputedStyle(document.documentElement)
  return TOKENS.map((t) => cs.getPropertyValue(t).trim()).join('|')
}

/** The markers' colours, read from the theme tokens (Leaflet draws on a canvas, so it needs literal colours):
 *  academic centers in the second data series, other sites in the accent, idle sites in the control grey. */
function useMarkerPalette(): Palette {
  const { theme } = useTheme()
  const snap = useSyncExternalStore(subscribeTheme, readTokens)
  return useMemo(() => {
    const fb = theme === 'dark' ? DARK : LIGHT
    const [amc, other, idle, stroke] = snap.split('|')
    return { amc: amc || fb.amc, other: other || fb.other, idle: idle || fb.idle, stroke: stroke || fb.stroke }
  }, [snap, theme])
}

export default function MapView({ clear }: { clear: ClearState }) {
  const [alloc, setAlloc] = useState<AllocKey>('actual')
  const simple = useDensity().density === 'simple'
  const palette = useMarkerPalette()
  const r = clear.result

  const mapped = useMemo(() => (r ? r.sites.filter((s) => s.lat !== null && s.lon !== null) : []), [r])
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (mapped.length === 0) return null
    const used = mapped.filter((s) => ALLOCS.some((a) => load(s, a) > 0))
    const pts = used.length > 0 ? used : mapped
    const lats = pts.map((s) => s.lat as number)
    const lons = pts.map((s) => s.lon as number)
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ]
  }, [mapped])

  const ordered = useMemo(() => [...mapped].sort((a, b) => load(a, alloc) - load(b, alloc)), [mapped, alloc])
  const stats = useMemo(() => (r ? ALLOCS.map((a) => [a, allocStats(r, a)] as const) : []), [r])
  const top = useMemo(
    () =>
      r
        ? [...r.sites]
            .filter((s) => load(s, alloc) > 0)
            .sort((a, b) => load(b, alloc) - load(a, alloc) || b.k - a.k)
            .slice(0, 10)
        : [],
    [r, alloc],
  )

  if (!r) {
    if (clear.loading) return <Loading label={`Clearing ${clear.pendingParams?.region ?? ''}…`} hint="The US-wide region can take up to a minute." />
    return (
      <>
        {clear.error && <ErrorBox error={clear.error} onRetry={() => clear.run(DEFAULT_SCENARIO)} />}
        <NeedsClear onRun={() => clear.run(DEFAULT_SCENARIO)} busy={clear.loading} />
      </>
    )
  }

  const unmapped = r.sites.length - mapped.length
  const st = Object.fromEntries(stats)
  const concentration =
    st.actual && st.indep && st.coord_free && st.coord
      ? `The 10 busiest sites hold ${pct(st.actual.top10Share)} of trial–site slots as registered, ${pct(
          st.indep.top10Share,
        )} under each trial’s best response, ${pct(st.coord_free.top10Share)} under the joint optimum and ${pct(
          st.coord.top10Share,
        )} under the allocation capped at registered times.`
      : null
  const piles = r.params.beta === null && (st.coord_free?.top10Share ?? 0) > (st.actual?.top10Share ?? 0)
  const pilesText =
    'With the congestion elasticity estimated from data (near zero), piling onto the strongest sites costs little, so the optimizers concentrate demand rather than spread it.'
  const maxTop = Math.max(0.0001, ...stats.map(([, s]) => s.top10Share ?? 0))

  const table = (
    <div className="table-scroll">
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th />
            <th className="num">Sites used</th>
            <th className="num">Top-10 share</th>
            <th className="num">At AMCs</th>
            <th className="num">Max</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(([a, s]) => (
            <tr key={a} className={a === alloc ? 'row-on' : ''}>
              <th scope="row">{ALLOC_LABEL[a]}</th>
              <td className="num">{int(s.used)}</td>
              <td className="num">{pct(s.top10Share)}</td>
              <td className="num">{pct(s.amcShare)}</td>
              <td className="num">{int(s.maxLoad)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const counts = (
    <p className="muted small">
      {int(r.counts.sites)} sites in the region instance
      {isNum(r.summary.assumptions.candidate_sites) && <> ({int(r.summary.assumptions.candidate_sites)} open to reassignment)</>},{' '}
      {int(r.counts.trials)} trials. Shares are of trial–site slots, computed here from the returned assignments.
    </p>
  )
  const busiest = (
    <>
      <h2>Busiest sites · {ALLOC_LABEL[alloc]}</h2>
      <ol className="toplist">
        {top.map((s) => (
          <li key={s.site_id}>
            <div className="toplist-name">
              <span title={s.facility}>{s.facility}</span>
              {s.is_amc && <Badge tone="neutral">AMC</Badge>}
            </div>
            <div className="toplist-meta small muted">{[s.city, s.state].filter(Boolean).join(', ') || '—'}</div>
            <div className="toplist-bar" aria-hidden="true">
              <span style={{ width: `${(100 * load(s, alloc)) / Math.max(1, top[0] ? load(top[0], alloc) : 1)}%` }} />
            </div>
            <div className="toplist-n tnum">
              {load(s, alloc)}
              <span className="muted small"> / cap {s.k}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Capacity (cap): the site’s historical peak of concurrent trials (never below its current CT.gov load), times the capacity
        assumption. “Registered” is the site list each trial registered on ClinicalTrials.gov; anonymized sites appear only there and
        cannot be reassigned.
      </p>
    </>
  )

  return (
    <section className="view rs-view">
      <RsHead
        title="Where enrollment demand piles up"
        lede="Each circle is a trial site in the region; size is the number of concurrent trials assigned to it. Toggle the allocation to see where each one puts the demand."
      >
        <InSampleLine>Allocations other than Registered are chosen by our model.</InSampleLine>
        {!simple && concentration && (
          <p className="lede small">
            {concentration}
            {piles && ` ${pilesText}`}
          </p>
        )}
        <RunLine params={r.params} stale={clear.loading} />
      </RsHead>

      <div className="map-layout">
        <div className="map-wrap card">
          <div className="seg" role="radiogroup" aria-label="Allocation shown">
            {ALLOCS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={alloc === a}
                title={ALLOC_HINT[a]}
                className={`seg-btn${alloc === a ? ' seg-on' : ''}`}
                onClick={() => setAlloc(a)}
              >
                {ALLOC_LABEL[a]}
              </button>
            ))}
          </div>
          <MapContainer className="map" center={[41.5, -74]} zoom={6} scrollWheelZoom={false} preferCanvas>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds bounds={bounds} />
            {ordered.map((s) => {
              const n = load(s, alloc)
              const color = n === 0 ? palette.idle : s.is_amc ? palette.amc : palette.other
              return (
                <CircleMarker
                  key={s.site_id}
                  center={[s.lat as number, s.lon as number]}
                  radius={radius(n)}
                  pathOptions={{
                    color: n === 0 ? color : palette.stroke,
                    weight: n === 0 ? 0 : 1,
                    fillColor: color,
                    fillOpacity: n === 0 ? 0.45 : 0.8,
                  }}
                >
                  <Tooltip>
                    <div className="tip">
                      <strong>{s.facility}</strong>
                      <div>{[s.city, s.state].filter(Boolean).join(', ')}</div>
                      <div>
                        {s.is_amc ? 'Academic center' : 'Other site'} · capacity {s.k} concurrent
                      </div>
                      <div className="tnum">
                        trials: registered {s.load_actual} · best resp. {s.load_indep} · coord. {s.load_coord} · joint {s.load_coord_free}
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              )
            })}
          </MapContainer>
          <div className="legend small">
            <span>
              <i className="sw" style={{ background: palette.amc }} /> Academic center
            </span>
            <span>
              <i className="sw" style={{ background: palette.other }} /> Other site
            </span>
            <span>
              <i className="sw sw-small" style={{ background: palette.idle }} /> Idle (0 trials)
            </span>
            <span className="muted">Circle area ∝ trials assigned</span>
          </div>
          {unmapped > 0 && <p className="muted small pad-x">{int(unmapped)} sites without coordinates are not drawn.</p>}
        </div>

        <aside className="side card" aria-label="Concentration by allocation">
          <h2>Concentration by allocation</h2>
          {simple ? (
            <>
              <p className="rs-side-lede">
                Share of trial–site slots at the 10 busiest sites, by allocation.
                {piles && ` ${pilesText}`}
              </p>
              <ul className="rs-bars">
                {stats.map(([a, s]) => (
                  <li key={a} className={a === alloc ? 'rs-bars-on' : ''}>
                    <span className="rs-bars-label">{ALLOC_LABEL[a]}</span>
                    <span className="rs-bars-val">{pct(s.top10Share)}</span>
                    <span className="rs-bars-bar" aria-hidden="true">
                      <span style={{ width: `${(100 * (s.top10Share ?? 0)) / maxTop}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="rs-qual-line rs-qual-muted">Every allocation except Registered is our model’s in-sample choice.</p>
              <Details summary="Details: sites used, AMC share and the busiest sites" className="section-disclosure">
                {table}
                {counts}
                {concentration && <p className="muted small">{concentration}</p>}
                {busiest}
              </Details>
            </>
          ) : (
            <>
              {table}
              {counts}
              {busiest}
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
