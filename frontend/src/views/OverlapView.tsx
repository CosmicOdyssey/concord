// Portfolio overlap audit: where one sponsor's own concurrent NSCLC trials recruit at the same sites for
// overlapping patients. Descriptive only (counts, dates, eligibility shares); no forecasts anywhere.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Criterion } from '../api'
import { Badge, Caveat, ErrorBox, Loading, Stat } from '../components'
import { ctgovUrl, int, num, pct, phaseLabel } from '../format'
import {
  FIANLIMAB_PAIR,
  overlapApi,
  REGENERON_OVERLAP_PRESET,
  type OverlapAudit,
  type OverlapPair,
  type OverlapQuery,
  type OverlapSite,
  type OverlapSponsors,
  type OverlapTrial,
} from '../overlapApi'
import './overlap.css'

const DEEP_LINK = /^#overlap\/regeneron/i
const UB = '†'
const UB_TEXT = "upper bound: a required biomarker or cohort restriction the synthetic population can't represent"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const BINS: [number, string][] = [
  [0, '0'],
  [1, '1–4'],
  [5, '5–9'],
  [10, '10–24'],
  [25, '25+'],
]
const DESIGN_LABEL: Record<string, string> = {
  single_population: 'single population',
  basket: 'basket',
  multi_cohort: 'multi-cohort',
}

type Pair = [string, string]

/** A pair seen from trial a (row) toward trial b (column). */
interface Oriented {
  a: string
  b: string
  pair: OverlapPair
  /** Share of a's eligible patients also eligible for b. */
  o_ab: number
  o_ba: number
  onlyA: string[]
  onlyB: string[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function bin(n: number): number {
  let b = 0
  BINS.forEach(([lo], i) => {
    if (n >= lo) b = i
  })
  return b
}

function sitesLabel(n: number): string {
  return `${int(n)} site${n === 1 ? '' : 's'}`
}

function stripHand(s: string): string {
  return s.replace(/^\[hand-encoded\]\s*/, '')
}

function regionOptions(regions: string[]): { value: string; label: string }[] {
  const sub = regions.filter((r) => r !== 'US')
  return [
    { value: 'US', label: 'All U.S. sites' },
    ...sub.map((r) => ({ value: r, label: `${r} (U.S.)` })),
    { value: '', label: 'All sites worldwide (CT.gov)' },
  ]
}

function setHash(h: string) {
  try {
    window.history.replaceState(null, '', h)
  } catch {
    /* ignore */
  }
}

export default function OverlapView({ regions }: { regions?: string[] }) {
  const deepLinked = DEEP_LINK.test(window.location.hash)
  const [form, setForm] = useState<OverlapQuery>(() =>
    deepLinked ? REGENERON_OVERLAP_PRESET : { sponsor: '', as_of: today(), region: 'US' },
  )
  const [wantPair, setWantPair] = useState<Pair | null>(() => (deepLinked ? FIANLIMAB_PAIR : null))
  const [sponsors, setSponsors] = useState<OverlapSponsors | null>(null)
  const [sponsorErr, setSponsorErr] = useState<string | null>(null)
  const [data, setData] = useState<OverlapAudit | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Pair | null>(null)
  const [mode, setMode] = useState<'matrix' | 'list'>('matrix')
  const [openTrial, setOpenTrial] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const validDate = DATE_RE.test(form.as_of)

  // Sponsor list for the date and region.
  useEffect(() => {
    if (!validDate) return
    const ctl = new AbortController()
    setSponsorErr(null)
    overlapApi
      .sponsors(form.as_of, form.region, ctl.signal)
      .then((s) => {
        setSponsors(s)
        setForm((f) => (f.sponsor || s.sponsors.length === 0 ? f : { ...f, sponsor: s.sponsors[0].sponsor }))
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSponsorErr(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [form.as_of, form.region, validDate])

  // The audit itself.
  useEffect(() => {
    if (!form.sponsor || !validDate) return
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    overlapApi
      .audit(form, ctl.signal)
      .then((d) => {
        setData(d)
        const ids = new Set(d.trials.map((t) => t.nct_id))
        const has = (p: Pair | null) => !!p && ids.has(p[0]) && ids.has(p[1])
        setSelected((cur) => {
          if (wantPair && has(wantPair)) return wantPair
          if (has(cur)) return cur
          return defaultPair(d)
        })
        setWantPair(null)
        setOpenTrial((cur) => (cur && ids.has(cur) ? cur : null))
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false)
      })
    return () => ctl.abort()
    // wantPair is read once per load on purpose (the preset's pair selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.sponsor, form.as_of, form.region, validDate, reload])

  const update = (patch: Partial<OverlapQuery>) => {
    setForm((f) => ({ ...f, ...patch }))
    setHash('#overlap')
  }

  const loadPreset = () => {
    const P = REGENERON_OVERLAP_PRESET
    const same = form.sponsor === P.sponsor && form.as_of === P.as_of && form.region === P.region
    setHash('#overlap/regeneron')
    if (same && data) {
      setSelected(FIANLIMAB_PAIR)
      return
    }
    setWantPair(FIANLIMAB_PAIR)
    setForm(P)
  }

  const trials = useMemo(() => data?.trials ?? [], [data])
  const tIdx = useMemo(() => new Map(trials.map((t) => [t.nct_id, t])), [trials])
  const pairIdx = useMemo(() => new Map((data?.pairs ?? []).map((p) => [`${p.p}|${p.q}`, p])), [data])
  const orient = (a: string, b: string): Oriented | null => {
    const p = pairIdx.get(`${a}|${b}`)
    if (p) return { a, b, pair: p, o_ab: p.o_pq, o_ba: p.o_qp, onlyA: p.criteria_diff.only_p, onlyB: p.criteria_diff.only_q }
    const r = pairIdx.get(`${b}|${a}`)
    if (r) return { a, b, pair: r, o_ab: r.o_qp, o_ba: r.o_pq, onlyA: r.criteria_diff.only_q, onlyB: r.criteria_diff.only_p }
    return null
  }
  const current = selected ? orient(selected[0], selected[1]) : null

  const sponsorOptions = useMemo(() => {
    const list = sponsors?.sponsors ?? []
    const known = list.some((s) => s.sponsor === form.sponsor)
    return { list, extra: form.sponsor && !known ? form.sponsor : null }
  }, [sponsors, form.sponsor])

  const stats = useMemo(() => {
    if (!data) return null
    const pairs = data.pairs
    const sharing = pairs.filter((p) => p.shared_sites > 0).length
    const top = [...pairs].sort((x, y) => y.shared_sites - x.shared_sites)[0]
    const nested = pairs.filter((p) => p.overlap_informative && p.shared_sites >= 10 && Math.max(p.o_pq, p.o_qp) >= 0.8)
    return { sharing, top, nested: nested.length, nestedUb: nested.filter((p) => p.upper_bound).length }
  }, [data])

  const stale = loading && !!data
  const worldwide = !data?.region

  return (
    <div className="view">
      <div className="view-head">
        <h1>Portfolio overlap audit</h1>
        <p className="lede">
          Where one sponsor's own concurrent NSCLC trials recruit at the same sites for overlapping patients. Everything here
          is descriptive: registered sites from ClinicalTrials.gov, estimated enrollment windows, and eligibility overlap on
          a synthetic population. No enrollment forecasts.
        </p>
      </div>

      <section className="card controls ov-controls" aria-label="Audit inputs">
        <div className="controls-row">
          <label className="field field-wide">
            <span className="field-label">
              Sponsor{sponsors ? ` · ${sponsors.sponsors.length} with ≥ 2 lung trials recruiting on the date` : ''}
            </span>
            <select value={form.sponsor} onChange={(e) => update({ sponsor: e.target.value })}>
              {!form.sponsor && <option value="">Loading sponsors…</option>}
              {sponsorOptions.extra && <option value={sponsorOptions.extra}>{sponsorOptions.extra} (fewer than 2 on this date)</option>}
              {sponsorOptions.list.map((s) => (
                <option key={s.sponsor} value={s.sponsor}>
                  {s.sponsor} ({s.trials})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">As of</span>
            <input type="date" value={form.as_of} onChange={(e) => update({ as_of: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Sites</span>
            <select value={form.region} onChange={(e) => update({ region: e.target.value })}>
              {regionOptions(regions ?? ['US-Northeast', 'US-Midwest', 'US-South', 'US-West', 'US']).map((o) => (
                <option key={o.value || 'world'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn ov-preset" onClick={loadPreset}>
            Regeneron, 1 Sept 2024
          </button>
        </div>
        {!validDate && <p className="small neg">Enter a full date (YYYY-MM-DD).</p>}
        {sponsorErr && <ErrorBox error={sponsorErr} />}
      </section>

      {error && <ErrorBox error={error} onRetry={() => setReload((n) => n + 1)} />}
      {loading && !data && <Loading label="Reading registered sites and eligibility…" />}

      {data && stats && (
        <>
          <div className="ov-runline small">
            <span>
              <strong>{data.sponsor}</strong>
            </span>
            <span>
              as of <strong>{data.as_of}</strong>
            </span>
            <span>{data.region_label}</span>
            <span className="muted">
              synthetic population n = {int(data.population.n)} · eligibility{' '}
              {int(trials.filter((t) => t.eligibility_source === 'hand-encoded').length)} hand-encoded,{' '}
              {int(trials.filter((t) => t.eligibility_source !== 'hand-encoded').length)} rule-based parse
            </span>
            {stale && <Badge tone="info">updating…</Badge>}
          </div>
          {data.n_sites > 0 && data.n_sites_anonymized / data.n_sites >= 0.2 && (
            <Caveat>
              {int(data.n_sites_anonymized)} of {int(data.n_sites)} registered sites of these trials are anonymized on
              ClinicalTrials.gov (“Research Site”). They are collapsed to one entry per city and cannot be matched across
              trials, so shared-site and other-sponsor counts here undercount for this sponsor. Same-city anonymized entries are
              listed in the pair detail, not counted.
            </Caveat>
          )}
          {data.excluded_open_ended.length > 0 && (
            <Caveat>
              Left out: {data.excluded_open_ended.join(', ')} started by this date but register no completion date at all, so no
              enrollment window can be estimated.
            </Caveat>
          )}

          <div className="stats">
            <Stat
              label="Trials recruiting on the date"
              value={int(trials.length)}
              sub="lung trials of this lead sponsor inside their estimated enrollment windows"
            />
            <Stat
              label="Pairs sharing a site"
              value={
                <>
                  {int(stats.sharing)} <span className="unit">of {int(data.pairs.length)} pairs</span>
                </>
              }
              sub={`share at least one identifiable registered site (${worldwide ? 'worldwide' : data.region_label})`}
            />
            <Stat
              label="Most shared sites"
              value={stats.top ? int(stats.top.shared_sites) : '—'}
              sub={
                !stats.top ? 'needs two trials' : stats.top.shared_sites > 0 ? `${stats.top.p} × ${stats.top.q}` : 'no pair shares an identifiable site'
              }
            />
            <Stat
              label="Nested pairs"
              value={int(stats.nested)}
              sub={`≥ 10 shared sites and ≥ 80% eligibility overlap in one direction${stats.nestedUb ? ` (${stats.nestedUb} upper bound ${UB})` : ''}`}
            />
          </div>

          {trials.length === 0 ? (
            <div className="empty">
              No lung trials of {data.sponsor} are inside their estimated enrollment window on {data.as_of}
              {data.region ? ` with a registered site in ${data.region_label}` : ''}.
            </div>
          ) : (
            <section className="card" aria-label="Pair matrix">
              <div className="section-head">
                <div>
                  <h2>{mode === 'matrix' ? 'Pair matrix' : 'Pair list'}</h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    {mode === 'matrix' ? (
                      <>
                        Each cell: shared registered sites · % of the <strong>row</strong> trial's eligible patients who also
                        qualify for the <strong>column</strong> trial / the reverse. Diagonal: the trial's registered sites. Click
                        a cell for the detail.
                      </>
                    ) : (
                      <>Every pair, most shared sites first. Click a row for the detail.</>
                    )}
                  </p>
                </div>
                <div className="seg" role="group" aria-label="Pair view">
                  <button className={`seg-btn${mode === 'matrix' ? ' seg-on' : ''}`} aria-pressed={mode === 'matrix'} onClick={() => setMode('matrix')}>
                    Matrix
                  </button>
                  <button className={`seg-btn${mode === 'list' ? ' seg-on' : ''}`} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                    Pair list
                  </button>
                </div>
              </div>
              {mode === 'matrix' ? (
                <Matrix trials={trials} orient={orient} selected={selected} onSelect={setSelected} />
              ) : (
                <PairList data={data} orient={orient} selected={selected} onSelect={setSelected} />
              )}
              <div className="ov-legend small">
                <span className="ov-legend-bins">
                  Shared sites:
                  {BINS.map(([, label], i) => (
                    <span key={label} className={`ov-swatch ov-b${i}`}>
                      {label}
                    </span>
                  ))}
                </span>
                <span>
                  <span className="ov-ub">{UB}</span> {UB_TEXT}
                </span>
                {data.pairs.some((p) => !p.overlap_informative) && <span>— no criteria encoded for a trial: overlap not informative</span>}
              </div>
            </section>
          )}

          {current && (
            <PairDetail o={current} tIdx={tIdx} sites={data.sites} asOf={data.as_of} regionLabel={data.region_label} worldwide={worldwide} />
          )}

          {trials.length > 0 && (
            <section className="card" aria-label="Trials">
              <h2>Trials recruiting on {data.as_of}</h2>
              <p className="small muted" style={{ marginTop: 0 }}>
                Other sponsors' trials: distinct lung trials of other lead sponsors (any sponsor class, any phase) inside their
                estimated enrollment windows on this date at the trial's identifiable registered sites. A count, not an effect.
              </p>
              <ul className="ov-tlist">
                {trials.map((t) => (
                  <TrialRow
                    key={t.nct_id}
                    t={t}
                    sites={data.sites}
                    worldwide={worldwide}
                    open={openTrial === t.nct_id}
                    onToggle={() => setOpenTrial((c) => (c === t.nct_id ? null : t.nct_id))}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-label="Provenance">
            <h2>Where these numbers come from</h2>
            <ul className="ov-prov">
              <li>
                <strong>Recruiting on a date</strong> means inside the trial's estimated enrollment window: from its registered start
                to start + 65% of the time to its registered primary completion (the 65% is an assumption). The window end is
                labelled “estimated” wherever it appears. Withdrawn trials are excluded.
              </li>
              <li>
                <strong>Sites</strong> are the lists registered on ClinicalTrials.gov today (site activation dates are not public).
                Sites withdrawn from a trial are dropped. Sites registered anonymously (“Research Site”) are collapsed to one
                pseudo-site per city and are never counted as shared.
              </li>
              <li>
                <strong>Eligibility overlap</strong> is computed on a synthetic population of {int(data.population.n)} advanced-NSCLC
                patients whose prevalences are rounded modeling assumptions, not patient data. Criteria are hand-encoded from each
                trial's CT.gov text where available (reviewed), otherwise taken from a rule-based parse (unreviewed).
              </li>
              <li>
                <span className="ov-ub">{UB}</span> <strong>Upper bound</strong>: a required biomarker or cohort restriction the
                synthetic population can't represent (or another restriction it does not model), so the overlap shown is a ceiling
                on the modeled populations, not a measurement.
              </li>
              <li>No speedup, time-to-fill or enrollment rate is shown or implied: this view counts and compares.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function defaultPair(d: OverlapAudit): Pair | null {
  if (d.pairs.length === 0) return null
  const best = [...d.pairs].sort(
    (x, y) =>
      Number(y.overlap_informative) - Number(x.overlap_informative) ||
      y.shared_sites - x.shared_sites ||
      Math.max(y.o_pq, y.o_qp) - Math.max(x.o_pq, x.o_qp),
  )[0]
  return [best.p, best.q]
}

function trialShort(t: OverlapTrial): string {
  return t.acronym ? `${t.acronym}` : t.nct_id
}

function pctPair(o: Oriented): string {
  return o.pair.overlap_informative ? `${pct(o.o_ab)} / ${pct(o.o_ba)}` : '—'
}

function cellText(o: Oriented): string {
  const s = `${o.a} × ${o.b}: ${sitesLabel(o.pair.shared_sites)} shared. `
  const ov = o.pair.overlap_informative
    ? `${pct(o.o_ab)} of ${o.a}'s eligible patients also qualify for ${o.b}; ${pct(o.o_ba)} of ${o.b}'s also qualify for ${o.a}. `
    : 'Overlap not informative (no criteria encoded for one trial). '
  const m = `Both recruiting about ${num(o.pair.months_both_recruiting_estimated, 1)} months (estimated).`
  return s + ov + m + (o.pair.upper_bound ? ` ${UB} ${UB_TEXT}.` : '')
}

function Matrix({
  trials,
  orient,
  selected,
  onSelect,
}: {
  trials: OverlapTrial[]
  orient: (a: string, b: string) => Oriented | null
  selected: Pair | null
  onSelect: (p: Pair) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // Keep the selected cell in view horizontally (narrow screens), without scrolling the page.
  useEffect(() => {
    const box = scroller.current
    if (!box || !selected) return
    const cell = box.querySelector<HTMLElement>(`[data-cell="${selected[0]}|${selected[1]}"]`)
    if (!cell) return
    const b = box.getBoundingClientRect()
    const c = cell.getBoundingClientRect()
    const sticky = box.querySelector('.ov-rowh')?.getBoundingClientRect().width ?? 0
    if (c.left < b.left + sticky || c.right > b.right) box.scrollLeft += c.left - (b.left + sticky) - 8
  }, [selected, trials])
  return (
    <div className="ov-matrix-scroll" ref={scroller}>
      <table className="ov-matrix">
        <thead>
          <tr>
            <th className="ov-corner" scope="col">
              row → column
            </th>
            {trials.map((t) => (
              <th key={t.nct_id} scope="col" className="ov-colh">
                <span className="ov-id">{trialShort(t)}</span>
                <span className="ov-sub">{phaseLabel(t.phases)}</span>
                <span className="ov-sub">{t.eligibility_source}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trials.map((r) => (
            <tr key={r.nct_id}>
              <th scope="row" className="ov-rowh" title={r.title}>
                <span className="ov-id">
                  {trialShort(r)}
                  {r.upper_bound && <span className="ov-ub" title={UB_TEXT}>{UB}</span>}
                </span>
                <span className="ov-title">{r.title}</span>
              </th>
              {trials.map((c) => {
                if (c.nct_id === r.nct_id)
                  return (
                    <td key={c.nct_id} className="ov-diag" title={`${r.nct_id}: ${sitesLabel(r.n_sites)} registered`}>
                      {sitesLabel(r.n_sites)}
                    </td>
                  )
                const o = orient(r.nct_id, c.nct_id)
                if (!o) return <td key={c.nct_id} />
                const sel =
                  !!selected &&
                  ((selected[0] === r.nct_id && selected[1] === c.nct_id) || (selected[0] === c.nct_id && selected[1] === r.nct_id))
                const label = cellText(o)
                return (
                  <td
                    key={c.nct_id}
                    data-cell={`${r.nct_id}|${c.nct_id}`}
                    className={`ov-cell ov-b${bin(o.pair.shared_sites)}${sel ? ' ov-sel' : ''}`}
                  >
                    <button className="ov-cellbtn" onClick={() => onSelect([r.nct_id, c.nct_id])} title={label} aria-label={label} aria-pressed={sel}>
                      <span className="ov-cell-sites">
                        {sitesLabel(o.pair.shared_sites)}
                        <span className="ov-sep"> ·</span>
                      </span>
                      <span className="ov-cell-pcts">
                        {pctPair(o)}
                        {o.pair.upper_bound && <span className="ov-ub">{UB}</span>}
                      </span>
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PairList({
  data,
  orient,
  selected,
  onSelect,
}: {
  data: OverlapAudit
  orient: (a: string, b: string) => Oriented | null
  selected: Pair | null
  onSelect: (p: Pair) => void
}) {
  const rows = [...data.pairs].sort(
    (x, y) => y.shared_sites - x.shared_sites || Math.max(y.o_pq, y.o_qp) - Math.max(x.o_pq, x.o_qp),
  )
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact ov-pairs">
        <thead>
          <tr>
            <th>Trial P</th>
            <th>Trial Q</th>
            <th className="num">Shared sites</th>
            <th className="num">P → Q</th>
            <th className="num">Q → P</th>
            <th className="num">Both recruiting (est.)</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const o = orient(p.p, p.q)!
            const sel = !!selected && new Set(selected).has(p.p) && new Set(selected).has(p.q)
            return (
              <tr
                key={`${p.p}|${p.q}`}
                className={`clickable${sel ? ' row-on' : ''}`}
                tabIndex={0}
                onClick={() => onSelect([p.p, p.q])}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect([p.p, p.q])
                  }
                }}
              >
                <td className="nowrap">{p.p}</td>
                <td className="nowrap">{p.q}</td>
                <td className="num">{int(p.shared_sites)}</td>
                <td className="num">{p.overlap_informative ? pct(o.o_ab) : '—'}</td>
                <td className="num">{p.overlap_informative ? pct(o.o_ba) : '—'}</td>
                <td className="num nowrap">{num(p.months_both_recruiting_estimated, 1)} mo</td>
                <td>
                  {p.upper_bound && <Badge tone="warn" title={UB_TEXT}>{UB} upper bound</Badge>}{' '}
                  {p.open_ended && <Badge tone="neutral">open-ended window</Badge>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="small muted">P → Q: share of P's eligible synthetic patients who also qualify for Q.</p>
    </div>
  )
}

function SourceBadge({ t }: { t: OverlapTrial }) {
  return t.eligibility_source === 'hand-encoded' ? (
    <Badge tone="ok" title="Encoded by hand from the CT.gov eligibility text and reviewed">
      hand-encoded
    </Badge>
  ) : (
    <Badge tone="neutral" title="Rule-based parse of the CT.gov eligibility text; not reviewed">
      rule-based parse
    </Badge>
  )
}

function TrialCard({ t, worldwide }: { t: OverlapTrial; worldwide: boolean }) {
  return (
    <div className="ov-tcard">
      <div className="ov-tcard-head">
        <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
          {t.nct_id}
        </a>
        {t.acronym && <span>{t.acronym}</span>}
        <SourceBadge t={t} />
        {t.upper_bound && (
          <Badge tone="warn" title={t.upper_bound_reasons.join('; ')}>
            {UB} upper bound
          </Badge>
        )}
      </div>
      <p className="ov-tcard-title">{t.title}</p>
      <dl className="ov-dl">
        <dt>Phase</dt>
        <dd>{phaseLabel(t.phases)}</dd>
        <dt>Start</dt>
        <dd>{t.start_date}</dd>
        <dt>Estimated window end</dt>
        <dd>
          {t.estimated_window_end}
          {t.open_ended && <span className="muted"> (no completion date registered: open-ended)</span>}
        </dd>
        <dt>Registered sites</dt>
        <dd>
          {int(t.n_sites)} {worldwide ? 'worldwide' : 'in region'}
          {t.n_sites_anonymized > 0 && <span className="muted"> ({int(t.n_sites_anonymized)} anonymized)</span>}
        </dd>
        <dt>Design</dt>
        <dd>{t.design ? DESIGN_LABEL[t.design] ?? t.design : <span className="muted">not hand-reviewed</span>}</dd>
        <dt>Eligible share</dt>
        <dd>{pct(t.eligible_share, 1)} of the synthetic population</dd>
      </dl>
      {t.upper_bound && <p className="small muted" style={{ marginBottom: 0 }}>Upper bound because: {t.upper_bound_reasons.join('; ')}.</p>}
    </div>
  )
}

function CritItem({ c, other, otherId, differs }: { c: Criterion; other?: Criterion; otherId?: string; differs?: boolean }) {
  const src = stripHand(c.source)
  const otherSrc = other ? stripHand(other.source) : null
  return (
    <li className="ov-crit">
      <div className="ov-crit-head">
        <span>{c.label}</span>
        <Badge tone={c.kind === 'inclusion' ? 'info' : 'neutral'}>{c.kind}</Badge>
        {differs && <Badge tone="warn">differs in value</Badge>}
      </div>
      <p className="source">{src}</p>
      {other && otherSrc && otherSrc !== src && (
        <p className="source">
          <b>{otherId}:</b> {other.label !== c.label ? `${other.label} · ` : ''}
          {otherSrc}
        </p>
      )}
    </li>
  )
}

function PairDetail({
  o,
  tIdx,
  sites,
  asOf,
  regionLabel,
  worldwide,
}: {
  o: Oriented
  tIdx: Map<string, OverlapTrial>
  sites: Record<string, OverlapSite>
  asOf: string
  regionLabel: string
  worldwide: boolean
}) {
  const A = tIdx.get(o.a)
  const B = tIdx.get(o.b)
  if (!A || !B) return null
  const ca = new Map(A.criteria.map((c) => [c.id, c]))
  const cb = new Map(B.criteria.map((c) => [c.id, c]))
  const differs = new Set(o.pair.criteria_diff.shared_differs)
  const p = o.pair
  return (
    <section className="card ov-detail" aria-label="Pair detail">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 style={{ margin: 0 }}>
          Pair detail: {o.a} × {o.b}
        </h2>
        <div>
          {p.upper_bound && (
            <Badge tone="warn" title={UB_TEXT}>
              {UB} upper bound
            </Badge>
          )}
        </div>
      </div>

      <div className="ov-two">
        <TrialCard t={A} worldwide={worldwide} />
        <TrialCard t={B} worldwide={worldwide} />
      </div>

      <div className="ov-facts">
        <div className="ov-fact">
          <div className="ov-fact-n">{p.overlap_informative ? pct(o.o_ab) : '—'}{p.upper_bound && <span className="ov-ub">{UB}</span>}</div>
          <p>
            {p.overlap_informative
              ? `${pct(o.o_ab)} of ${o.a}'s eligible patients also qualify for ${o.b}`
              : 'Not informative: no criteria encoded for one of the trials'}
          </p>
        </div>
        <div className="ov-fact">
          <div className="ov-fact-n">{p.overlap_informative ? pct(o.o_ba) : '—'}{p.upper_bound && <span className="ov-ub">{UB}</span>}</div>
          <p>
            {p.overlap_informative
              ? `${pct(o.o_ba)} of ${o.b}'s eligible patients also qualify for ${o.a}`
              : 'Not informative: no criteria encoded for one of the trials'}
          </p>
        </div>
        <div className="ov-fact">
          <div className="ov-fact-n">{int(p.shared_sites)}</div>
          <p>
            shared registered sites ({worldwide ? 'worldwide' : regionLabel})
            {p.anonymized_same_city > 0 &&
              ` · plus ${int(p.anonymized_same_city)} ${p.anonymized_same_city === 1 ? 'city' : 'cities'} where both list an anonymized site (facility unknown, not counted)`}
          </p>
        </div>
        <div className="ov-fact">
          <div className="ov-fact-n">
            {num(p.months_both_recruiting_estimated, 1)} <span className="unit">months</span>
          </div>
          <p>
            both recruiting (estimated windows)
            {p.both_recruiting_from && p.both_recruiting_to ? `: ${p.both_recruiting_from} to ${p.both_recruiting_to}` : ''}
            {p.open_ended ? ' · one window is open-ended' : ''}
          </p>
        </div>
      </div>
      {p.upper_bound && (
        <Caveat>
          {UB} {UB_TEXT.charAt(0).toUpperCase() + UB_TEXT.slice(1)}.{' '}
          {[A, B]
            .filter((t) => t.upper_bound)
            .map((t) => `${t.nct_id}: ${t.upper_bound_reasons.join('; ')}`)
            .join(' · ')}
        </Caveat>
      )}

      <div>
        <h3>Criteria diff</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          Matched on criterion id. Source sentences from each trial's CT.gov eligibility text ({A.eligibility_source} for {o.a},{' '}
          {B.eligibility_source} for {o.b}).
        </p>
        <div className="ov-diff">
          <div className="ov-diff-col">
            <h4>Only {o.a} ({o.onlyA.length})</h4>
            {o.onlyA.length ? (
              <ul className="ov-crits">
                {o.onlyA.map((id) => ca.get(id) && <CritItem key={id} c={ca.get(id)!} />)}
              </ul>
            ) : (
              <p className="ov-empty">None: every criterion of {o.a} is also in {o.b}.</p>
            )}
          </div>
          <div className="ov-diff-col">
            <h4>Both ({p.criteria_diff.shared.length})</h4>
            {p.criteria_diff.shared.length ? (
              <ul className="ov-crits">
                {p.criteria_diff.shared.map(
                  (id) => ca.get(id) && <CritItem key={id} c={ca.get(id)!} other={cb.get(id)} otherId={o.b} differs={differs.has(id)} />,
                )}
              </ul>
            ) : (
              <p className="ov-empty">No criteria in common.</p>
            )}
          </div>
          <div className="ov-diff-col">
            <h4>Only {o.b} ({o.onlyB.length})</h4>
            {o.onlyB.length ? (
              <ul className="ov-crits">
                {o.onlyB.map((id) => cb.get(id) && <CritItem key={id} c={cb.get(id)!} />)}
              </ul>
            ) : (
              <p className="ov-empty">None: every criterion of {o.b} is also in {o.a}.</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3>Shared sites ({int(p.shared_sites)})</h3>
        {p.shared_site_ids.length ? (
          <SiteTable ids={p.shared_site_ids} sites={sites} asOf={asOf} worldwide={worldwide} />
        ) : (
          <p className="ov-empty">No identifiable registered site in common{worldwide ? '' : ` in ${regionLabel}`}.</p>
        )}
      </div>
    </section>
  )
}

function SiteTable({ ids, sites, asOf, worldwide }: { ids: string[]; sites: Record<string, OverlapSite>; asOf: string; worldwide: boolean }) {
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact ov-sites-tbl">
        <thead>
          <tr>
            <th>Site</th>
            <th className="num ov-count-col">Other sponsors' lung trials recruiting here on {asOf}</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const s = sites[id]
            if (!s) return null
            const place = [s.city, s.state, worldwide ? s.country : null].filter(Boolean).join(', ')
            return (
              <tr key={id}>
                <td>
                  <div>{s.anonymized ? <span className="muted">Anonymized site (not matchable across trials)</span> : s.facility}</div>
                  {place && <div className="small muted">{place}</div>}
                </td>
                <td className="num">{s.other_sponsor_trials === null ? '—' : int(s.other_sponsor_trials)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TrialRow({
  t,
  sites,
  worldwide,
  open,
  onToggle,
}: {
  t: OverlapTrial
  sites: Record<string, OverlapSite>
  worldwide: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <li className="ov-trow">
      <div>
        <div className="ov-trow-id">
          <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
            {t.nct_id}
          </a>
          {t.acronym && <span>{t.acronym}</span>}
          <SourceBadge t={t} />
          {t.design && <Badge tone="neutral">{DESIGN_LABEL[t.design] ?? t.design}</Badge>}
          {t.upper_bound && (
            <Badge tone="warn" title={t.upper_bound_reasons.join('; ')}>
              {UB} upper bound
            </Badge>
          )}
          {t.no_criteria && <Badge tone="bad">no criteria parsed</Badge>}
        </div>
        <p className="ov-trow-title">{t.title}</p>
      </div>
      <div className="ov-trow-facts">
        <div>
          {phaseLabel(t.phases)} · started {t.start_date}
        </div>
        <div>
          Estimated window end {t.estimated_window_end}
          {t.open_ended && <span className="muted"> (open-ended)</span>}
        </div>
        <div>
          {sitesLabel(t.n_sites)} registered {worldwide ? 'worldwide' : 'in region'}
          {t.n_sites_anonymized > 0 && <span className="muted"> ({int(t.n_sites_anonymized)} anonymized)</span>}
        </div>
      </div>
      <div>
        <div className="ov-count">
          <strong>{int(t.other_sponsor_trials_at_sites)}</strong> other sponsors' trials recruiting at its sites on this date
        </div>
        <div className="small muted">{int(t.other_sponsor_trials_at_sites_industry)} of them industry-sponsored</div>
        {t.n_sites > 0 && (
          <button className="btn btn-small" style={{ marginTop: '0.35rem' }} onClick={onToggle} aria-expanded={open}>
            {open ? 'Hide sites' : `Per-site counts (${int(t.n_sites)})`}
          </button>
        )}
      </div>
      {open && (
        <div className="ov-trow-sites">
          <SiteTable ids={t.site_ids} sites={sites} asOf="this date" worldwide={worldwide} />
        </div>
      )}
    </li>
  )
}
