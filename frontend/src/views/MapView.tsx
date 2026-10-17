import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { AllocKey, ClearResult, Site } from '../api'
import type { ClearState } from '../App'
import { Badge, ErrorBox, Loading, NeedsClear, RunLine, useDarkMode } from '../components'
import { ALLOC_HINT, ALLOC_LABEL, int, isNum, loadOf, pct } from '../format'
import { DEFAULT_SCENARIO } from '../api'

const ALLOCS: AllocKey[] = ['actual', 'indep', 'coord', 'coord_free']

function load(s: Site, a: AllocKey): number {
  return loadOf(s, a)
}

function radius(n: number): number {
  return n === 0 ? 2.5 : 3.5 + 2.2 * Math.sqrt(n)
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] })
    // bounds is memoized per clear result, so toggling the allocation does not refit.
  }, [bounds, map])
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

export default function MapView({ clear }: { clear: ClearState }) {
  const [alloc, setAlloc] = useState<AllocKey>('actual')
  const dark = useDarkMode()
  const r = clear.result

  const palette = dark
    ? { amc: '#f59e0b', other: '#60a5fa', idle: '#6b7280', stroke: '#0b0f14' }
    : { amc: '#c2410c', other: '#1d4ed8', idle: '#9ca3af', stroke: '#ffffff' }

  const mapped = useMemo(
    () => (r ? r.sites.filter((s) => s.lat !== null && s.lon !== null) : []),
    [r],
  )
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
        )} under the allocation capped at registered times.${
          r.params.beta === null && (st.coord_free.top10Share ?? 0) > (st.actual.top10Share ?? 0)
            ? ' With the congestion elasticity estimated from data (near zero), piling onto the strongest sites costs little, so the optimizers concentrate demand rather than spread it.'
            : ''
        }`
      : null

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Where enrollment demand piles up</h1>
          <p className="lede">
            Each circle is a trial site in the region; size is the number of concurrent trials assigned to it. Toggle the
            allocation to see where each one puts the demand.
          </p>
          {concentration && <p className="lede small">{concentration}</p>}
        </div>
        <RunLine params={r.params} stale={clear.loading} />
      </div>

      <div className="map-layout">
        <div className="map-wrap card">
          <div className="seg" role="radiogroup" aria-label="Allocation shown">
            {ALLOCS.map((a) => (
              <button key={a} role="radio" aria-checked={alloc === a} title={ALLOC_HINT[a]} className={`seg-btn${alloc === a ? ' seg-on' : ''}`} onClick={() => setAlloc(a)}>
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
                    fillOpacity: n === 0 ? 0.45 : 0.78,
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

        <aside className="side card">
          <h2>Concentration by allocation</h2>
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
                {stats.map(([a, st]) => (
                  <tr key={a} className={a === alloc ? 'row-on' : ''}>
                    <th scope="row">{ALLOC_LABEL[a]}</th>
                    <td className="num">{int(st.used)}</td>
                    <td className="num">{pct(st.top10Share)}</td>
                    <td className="num">{pct(st.amcShare)}</td>
                    <td className="num">{int(st.maxLoad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            {int(r.counts.sites)} sites in the region instance
            {isNum(r.summary.assumptions.candidate_sites) && <> ({int(r.summary.assumptions.candidate_sites)} open to reassignment)</>},{' '}
            {int(r.counts.trials)} trials. Shares are of trial–site slots, computed here from the returned assignments.
          </p>

          <h2>Busiest sites · {ALLOC_LABEL[alloc]}</h2>
          <ol className="toplist">
            {top.map((s) => (
              <li key={s.site_id}>
                <div className="toplist-name">
                  <span title={s.facility}>{s.facility}</span>
                  {s.is_amc && <Badge tone="neutral">AMC</Badge>}
                </div>
                <div className="toplist-meta small muted">
                  {[s.city, s.state].filter(Boolean).join(', ') || '—'}
                </div>
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
            Capacity (cap): the site’s historical peak of concurrent trials (never below its current CT.gov load),
            times the capacity assumption. “Registered” is the site list each trial registered on ClinicalTrials.gov;
            anonymized sites appear only there and cannot be reassigned.
          </p>
        </aside>
      </div>
    </section>
  )
}
