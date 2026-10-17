// Portfolio overlap for an extra indication (breast cancer): where one sponsor's trials recruiting at the registry
// snapshot share registered sites, and for how many months both have been recruiting. Site overlap only: no
// eligibility number exists for these trials (absent, never 0); every place one would be says SITE_ONLY_LABEL.
//
// Simple: the half grid (halfgrid.tsx) with one number per cell (shared registered sites) and no shade, dot or marks;
// the rest of each pair is in its hover/focus card and the pair panel below; tables and sources in "Details".
// Detailed: summary counts, the pair list, the shared-site table, every trial and the sources inline.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Caveat, Details, ErrorBox, HoverCard, InfoTip, Loading, PageHead, Qualifier, Segmented, Stat, Window } from '../components'
import { useDensity } from '../density'
import { ctgovUrl, int, num } from '../format'
import { CellFace, HalfGrid } from '../halfgrid'
import { mostlyAnonymized } from '../overlapApi'
import {
  overlapSitesApi,
  SITE_ONLY_LABEL,
  type IndicationInfo,
  type SitesAudit,
  type SitesPair,
  type SitesSite,
  type SitesSponsors,
  type SitesTrial,
} from '../overlapSitesApi'
import './overlap.css'
import './overlapSites.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ANON = 'sites anonymized on CT.gov'
const STORE_KEY = 'concord.overlap.sites.v1'
type Pair = [string, string]
type Mode = 'matrix' | 'list'

function shortDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : (iso ?? '—')
}

function phaseText(phases: string[]): string {
  const ps = phases.filter((p) => p !== 'NA')
  if (ps.length === 0) return 'Phase not given'
  return ps.map((p) => p.replace(/^EARLY_PHASE(\d)$/, 'Early phase $1').replace(/^PHASE(\d)$/, '$1')).join('/').replace(/^(\d)/, 'Phase $1')
}

const label = (t: SitesTrial) => t.acronym || t.nct_id
const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`
const known = (a?: SitesTrial, b?: SitesTrial) => !!a && !!b && a.n_sites_identified > 0 && b.n_sites_identified > 0

function loadStored(slug: string): { sponsor: string; region: string; mode: Mode } | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(`${STORE_KEY}.${slug}`) ?? 'null')
    return s && typeof s.sponsor === 'string' ? s : null
  } catch {
    return null
  }
}

function saveStored(slug: string, v: { sponsor: string; region: string; mode: Mode }) {
  try {
    sessionStorage.setItem(`${STORE_KEY}.${slug}`, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

function regionOptions(regions: string[]) {
  return [
    { value: '', label: 'All registered sites worldwide' },
    { value: 'US', label: 'All U.S. sites' },
    ...regions.filter((r) => r !== 'US').map((r) => ({ value: r, label: r.startsWith('US-') ? `U.S. ${r.slice(3)}` : r })),
  ]
}

/** The label that stands where an eligibility number would be: the number is absent, not 0. */
function NoEligibility({ compact }: { compact?: boolean }) {
  return (
    <span className="ovs-noelig">
      {compact ? '' : 'Eligibility overlap: '}
      <Qualifier tone="muted">{SITE_ONLY_LABEL}</Qualifier>
    </span>
  )
}

function SourceCard({ data }: { data: SitesAudit }) {
  return (
    <div className="ov-tip">
      <span className="hc-title">Source</span>
      <p className="small">
        {data.source.name}, fetched {shortDate(data.source.fetched_at)} ({int(data.source.trials)} trials): condition “{data.source.query['query.cond']}”,
        interventional, industry lead sponsor, a U.S. location, status Recruiting, Active not recruiting or Enrolling by invitation.
      </p>
      <p className="small">Sites are the locations each trial registers (withdrawn site rows left out). Registered sites, not confirmed enrolling.</p>
    </div>
  )
}

function PairRows({ p, A, B, detailed }: { p: SitesPair; A: SitesTrial; B: SitesTrial; detailed: boolean }) {
  const k = known(A, B)
  return (
    <dl className="ov-tip-rows">
      <div>
        <dt>Shared registered sites</dt>
        <dd>{k ? <span className="num">{int(p.shared_sites)}</span> : <span className="ov-tip-unk">can't be counted ({ANON})</span>}</dd>
      </div>
      <div>
        <dt>Months both recruiting (estimated)</dt>
        <dd className="num">{num(p.months_both_recruiting_estimated, 1)}</dd>
      </div>
      {detailed && (
        <div>
          <dt>Both recruiting</dt>
          <dd>
            {shortDate(p.both_recruiting_from)} to {shortDate(p.both_recruiting_to)} (snapshot)
          </dd>
        </div>
      )}
      {detailed && p.anonymized_same_city > 0 && (
        <div>
          <dt>Cities where both list an anonymized site (not counted)</dt>
          <dd className="num">{int(p.anonymized_same_city)}</dd>
        </div>
      )}
      <div>
        <dt>Eligible patients in both</dt>
        <dd>
          <NoEligibility compact />
        </dd>
      </div>
    </dl>
  )
}

function SiteTable({ ids, sites, worldwide }: { ids: string[]; sites: Record<string, SitesSite>; worldwide: boolean }) {
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact ov-sites-tbl">
        <thead>
          <tr>
            <th scope="col">Shared registered site</th>
            <th scope="col">Place</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const s = sites[id]
            if (!s) return null
            return (
              <tr key={id}>
                <td>{s.facility}</td>
                <td className="small muted">{[s.city, s.state, worldwide ? s.country : null].filter(Boolean).join(', ')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TrialTable({ trials }: { trials: SitesTrial[] }) {
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact ovs-trials-tbl">
        <thead>
          <tr>
            <th scope="col">Trial</th>
            <th scope="col">Phase</th>
            <th scope="col">Start</th>
            <th scope="col" className="num">
              Registered sites
            </th>
            <th scope="col" className="num">
              Anonymized
            </th>
          </tr>
        </thead>
        <tbody>
          {trials.map((t) => (
            <tr key={t.nct_id}>
              <td>
                <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
                  {label(t)}
                </a>
                {t.acronym && <span className="small muted"> {t.nct_id}</span>}
                <div className="small muted ovs-title">{t.title}</div>
              </td>
              <td>{phaseText(t.phases)}</td>
              <td className="ovs-nowrap">{shortDate(t.start_date)}</td>
              <td className="num">{int(t.n_sites)}</td>
              <td className="num">{int(t.n_sites_anonymized)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OverlapSitesView({
  indication,
  indicationField,
  regions,
}: {
  indication: IndicationInfo
  indicationField: ReactNode
  regions: string[]
}) {
  const { density } = useDensity()
  const detailed = density === 'detailed'
  const ids = useId()
  const slug = indication.slug
  const [init] = useState(() => loadStored(slug) ?? { sponsor: '', region: '', mode: 'matrix' as Mode })
  const [sponsor, setSponsor] = useState(init.sponsor)
  const [region, setRegion] = useState(init.region)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [sponsors, setSponsors] = useState<SitesSponsors | null>(null)
  // Errors and completion are stored with the request they belong to, so a new request clears them without a reset.
  const [sponsorErr, setSponsorErr] = useState<{ key: string; msg: string } | null>(null)
  const [data, setData] = useState<SitesAudit | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [auditErr, setAuditErr] = useState<{ key: string; msg: string } | null>(null)
  const [selected, setSelected] = useState<Pair | null>(null)
  const [reload, setReload] = useState(0)
  const sponsorKey = `${slug}|${region}`
  const auditKey = `${slug}|${sponsor}|${region}|${reload}`
  const loading = !!sponsor && done !== auditKey
  const error = auditErr?.key === auditKey ? auditErr.msg : null

  useEffect(() => saveStored(slug, { sponsor, region, mode }), [slug, sponsor, region, mode])

  useEffect(() => {
    const ctl = new AbortController()
    overlapSitesApi
      .sponsors(slug, region, ctl.signal)
      .then((s) => {
        if (ctl.signal.aborted) return
        setSponsors(s)
        setSponsor((cur) => (cur && s.sponsors.some((x) => x.sponsor === cur) ? cur : (s.sponsors.find((x) => !mostlyAnonymized(x)) ?? s.sponsors[0])?.sponsor ?? ''))
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSponsorErr({ key: `${slug}|${region}`, msg: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [slug, region])

  useEffect(() => {
    if (!sponsor) return
    const ctl = new AbortController()
    const key = `${slug}|${sponsor}|${region}|${reload}`
    overlapSitesApi
      .audit(slug, sponsor, region, ctl.signal)
      .then((d) => {
        if (ctl.signal.aborted) return
        setData(d)
        const top = [...d.pairs].sort((x, y) => y.shared_sites - x.shared_sites)[0]
        setSelected((cur) => (cur && d.trials.some((t) => t.nct_id === cur[0]) && d.trials.some((t) => t.nct_id === cur[1]) ? cur : top ? [top.p, top.q] : null))
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setAuditErr({ key, msg: e instanceof Error ? e.message : String(e) })
      })
      .finally(() => {
        if (!ctl.signal.aborted) setDone(key)
      })
    return () => ctl.abort()
  }, [slug, sponsor, region, reload])

  const trials = useMemo(() => data?.trials ?? [], [data])
  const tIdx = useMemo(() => new Map(trials.map((t) => [t.nct_id, t])), [trials])
  const pairOf = useMemo(() => {
    const m = new Map<string, SitesPair>()
    for (const p of data?.pairs ?? []) {
      m.set(`${p.p}|${p.q}`, p)
      m.set(`${p.q}|${p.p}`, p)
    }
    return m
  }, [data])
  const stats = useMemo(() => {
    if (!data) return null
    const countable = data.pairs.filter((p) => known(tIdx.get(p.p), tIdx.get(p.q)))
    const shared = new Set(countable.flatMap((p) => p.shared_site_ids))
    return {
      countable: countable.length,
      sharing: countable.filter((p) => p.shared_sites > 0).length,
      distinct: shared.size,
      top: [...countable].sort((x, y) => y.shared_sites - x.shared_sites)[0],
    }
  }, [data, tIdx])
  const worldwide = !data?.region
  const stale = loading && !!data
  const cur = selected ? pairOf.get(`${selected[0]}|${selected[1]}`) : undefined
  const A = selected ? tIdx.get(selected[0]) : undefined
  const B = selected ? tIdx.get(selected[1]) : undefined
  const snapshot = data?.snapshot_date ?? sponsors?.snapshot_date ?? indication.snapshot_date
  const sorted = useMemo(() => [...(data?.pairs ?? [])].sort((x, y) => y.shared_sites - x.shared_sites || y.months_both_recruiting_estimated - x.months_both_recruiting_estimated), [data])

  const statTiles = data && stats && (
    <div className="stats ov-stats">
      <Stat label="Trials recruiting (CT.gov status)" value={int(trials.length)} sub={`${indication.noun} trials of this lead sponsor listed as Recruiting or Enrolling by invitation at the ${shortDate(data.snapshot_date)} snapshot`} />
      <Stat
        label="Pairs sharing a site"
        value={
          <>
            {int(stats.sharing)} <span className="unit">of {int(stats.countable)} pairs</span>
          </>
        }
        sub={`share at least one identifiable registered site (${worldwide ? 'worldwide' : data.region_label})`}
      />
      <Stat label="Distinct shared sites" value={int(stats.distinct)} sub="identifiable sites registered on two or more of these trials" />
      <Stat label="Most shared sites" value={stats.top ? int(stats.top.shared_sites) : '—'} sub={stats.top ? `${stats.top.p} × ${stats.top.q}` : 'needs two trials'} />
    </div>
  )

  const pairList = data && (
    <div className="table-scroll">
      <table className="tbl tbl-compact ovs-pairs-tbl">
        <caption className="sr-only">Every pair, most shared sites first</caption>
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col" className="num">
              Shared sites
            </th>
            <th scope="col" className="num">
              Months both recruiting (est.)
            </th>
            <th scope="col">Eligibility overlap</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const a = tIdx.get(p.p)
            const b = tIdx.get(p.q)
            if (!a || !b) return null
            const sel = !!selected && ((selected[0] === p.p && selected[1] === p.q) || (selected[0] === p.q && selected[1] === p.p))
            return (
              <tr key={`${p.p}|${p.q}`} className={sel ? 'ovs-row-sel' : undefined}>
                <td>
                  <button type="button" className="ovs-linkbtn" aria-pressed={sel} onClick={() => setSelected([p.p, p.q])}>
                    {label(a)} × {label(b)}
                  </button>
                </td>
                <td className="num">{known(a, b) ? int(p.shared_sites) : '—'}</td>
                <td className="num">{num(p.months_both_recruiting_estimated, 1)}</td>
                <td className="small muted">absent</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="view ov ovs">
      <PageHead
        title="Portfolio overlap"
        lede={`Where one sponsor's ${indication.noun} trials recruiting at the registry snapshot share registered sites, and for how long both have been recruiting.`}
        meta={snapshot ? `Registry snapshot: ${shortDate(snapshot)}` : undefined}
      />

      <div className="ov-controls">
        <div className="ov-filters" role="group" aria-label="Overlap filters">
          {indicationField}
          <div className="field ov-f-sponsor">
            <label className="field-label" htmlFor={`${ids}-sponsor`}>
              Sponsor
            </label>
            <select id={`${ids}-sponsor`} value={sponsor} onChange={(e) => setSponsor(e.target.value)}>
              {!sponsor && <option value="">Loading sponsors…</option>}
              {(sponsors?.sponsors ?? []).map((s) => (
                <option key={s.sponsor} value={s.sponsor}>
                  {s.sponsor} ({s.trials}){mostlyAnonymized(s) ? ` · ${ANON}` : ''}
                </option>
              ))}
            </select>
            {detailed && sponsors && (
              <span className="ov-hint">
                {plural(sponsors.sponsors.length, 'sponsor')} with 2 or more {indication.noun} trials recruiting at the snapshot; trial counts in brackets
              </span>
            )}
          </div>
          <div className="field ov-f-date">
            <span className="field-label" id={`${ids}-date`}>
              As of
            </span>
            <span className="ovs-date" aria-labelledby={`${ids}-date`}>
              {shortDate(snapshot)}
              <InfoTip
                label="Why only the snapshot date"
                content={`This indication is a single registry download (${shortDate(snapshot)}) of trials open or active at that date. Trials that closed earlier were not fetched, so earlier dates are not shown.`}
              />
            </span>
          </div>
          <div className="field ov-f-region">
            <label className="field-label" htmlFor={`${ids}-region`}>
              Region
            </label>
            <select id={`${ids}-region`} value={region} onChange={(e) => setRegion(e.target.value)}>
              {regionOptions(regions).map((o) => (
                <option key={o.value || 'world'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="ovs-label" role="note">
          <Qualifier tone="caution">{SITE_ONLY_LABEL}</Qualifier>
        </p>
        {sponsorErr?.key === sponsorKey && <ErrorBox error={sponsorErr.msg} />}
      </div>

      {error && <ErrorBox error={error} onRetry={() => setReload((n) => n + 1)} />}
      {loading && !data && <Loading label="Loading registry data…" />}

      {data && stats && (
        <>
          <div className="ov-cluster">
            <div className="ov-summary">
              <p className="ov-sumline">
                <span className="num">{int(trials.length)}</span> {trials.length === 1 ? 'trial' : 'trials'} recruiting on {shortDate(data.as_of)} ·{' '}
                <span className="num">{int(data.pairs.length)}</span> {data.pairs.length === 1 ? 'pair' : 'pairs'}
                {stats.countable > 0 && (
                  <>
                    {' '}
                    · <span className="num">{int(stats.distinct)}</span> distinct shared sites
                  </>
                )}
                <InfoTip label="Source of these counts" content={<SourceCard data={data} />} />
              </p>
              <span className="ov-updating" role="status">
                {stale ? 'Updating…' : ''}
              </span>
              {trials.length >= 2 && !detailed && (
                <Segmented
                  label="Pair view"
                  className="ov-mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'matrix', label: 'Matrix' },
                    { value: 'list', label: 'Pair list' },
                  ]}
                />
              )}
            </div>
            {detailed && statTiles}
            {trials.length < 2 ? (
              <div className="empty">
                <p className="ov-empty-lead">This sponsor has fewer than 2 {indication.noun} trials recruiting at the snapshot{data.region ? ` with a registered site in ${data.region_label}` : ''}.</p>
              </div>
            ) : (
              <>
                {trials.every((t) => t.n_sites_identified === 0) && (
                  <p className="ov-anon">This sponsor lists its sites on ClinicalTrials.gov only as anonymized entries, so shared sites can't be counted (unknown, not zero).</p>
                )}
                <Window
                  label={mode === 'list' && !detailed ? 'Pair list' : 'Pair matrix'}
                  className={`ov-win${stale ? ' ov-stale' : ''}`}
                  title={data.sponsor}
                  meta={data.region_label}
                  aside="Shared registered sites per pair"
                  flush
                >
                  <div aria-busy={stale || undefined}>
                    {mode === 'list' && !detailed ? (
                      pairList
                    ) : (
                      <div className="ov-mscroll">
                        <HalfGrid
                          items={trials}
                          keyOf={(t) => t.nct_id}
                          className={`ov-hg ov-hg-s${trials.length - 1 <= 7 ? 1 : trials.length - 1 <= 11 ? 2 : trials.length - 1 <= 15 ? 3 : 4}`}
                          label={`Shared registered sites for each pair of ${trials.length} trials, each pair once; ${SITE_ONLY_LABEL}`}
                          rowHead={(t) => (
                            <span className="ovs-head">
                              <span className="hg-rowh-label">
                                <span className="ov-rl-text">{label(t)}</span>
                              </span>
                              <span className="hg-rowh-sub">{phaseText(t.phases)}</span>
                            </span>
                          )}
                          colHead={(t) => <span className="hg-vt">{label(t)}</span>}
                          cell={(r, c) => {
                            const p = pairOf.get(`${r.nct_id}|${c.nct_id}`)
                            if (!p) return null
                            const sel = !!selected && ((selected[0] === r.nct_id && selected[1] === c.nct_id) || (selected[0] === c.nct_id && selected[1] === r.nct_id))
                            const k = known(r, c)
                            return (
                              <div className={`ov-hg-c${sel ? ' ov-sel' : ''}`} onClick={() => setSelected([r.nct_id, c.nct_id])}>
                                <HoverCard
                                  className={`hg-cell ovs-cell${sel ? ' hg-on' : ''}`}
                                  label={`${label(r)} × ${label(c)}: ${k ? `${plural(p.shared_sites, 'shared registered site')}` : `shared sites can't be counted (${ANON})`}; ${num(p.months_both_recruiting_estimated, 1)} months both recruiting (estimated); ${SITE_ONLY_LABEL}${sel ? '; selected' : ''}`}
                                  content={
                                    <div className="ov-tip">
                                      <span className="hc-title">
                                        {label(r)} × {label(c)}
                                      </span>
                                      <span className="ov-tip-sub">
                                        {r.nct_id} · {plural(r.n_sites, 'site')} — {c.nct_id} · {plural(c.n_sites, 'site')}
                                      </span>
                                      <PairRows p={p} A={r} B={c} detailed={false} />
                                      <span className="small muted">Select for the shared site list. Source: ClinicalTrials.gov registered locations.</span>
                                    </div>
                                  }
                                >
                                  <CellFace n={k ? p.shared_sites : null} marks="" hi={false} />
                                </HoverCard>
                              </div>
                            )
                          }}
                        />
                      </div>
                    )}
                  </div>
                </Window>
                <p className="ov-caption">
                  Registered sites, not confirmed enrolling. No shade: {SITE_ONLY_LABEL}.{' '}
                  {mode === 'list' && !detailed ? 'Every pair, most shared sites first.' : 'Hover or focus a cell for details; select it for the shared site list below.'}
                </p>
                {detailed && <Window label="Pair list" title="Every pair" meta="most shared sites first" flush>{pairList}</Window>}
                {!detailed && <Details summary="Summary counts">{statTiles}</Details>}
              </>
            )}
          </div>

          {cur && A && B && (
            <Window label="Selected pair" className="ovs-pair" title={`${label(A)} × ${label(B)}`} meta={data.region_label}>
              <p className="small muted ovs-pair-sub">
                <a href={ctgovUrl(A.nct_id)} target="_blank" rel="noreferrer">
                  {A.nct_id}
                </a>{' '}
                · {phaseText(A.phases)} · {plural(A.n_sites, 'site')} —{' '}
                <a href={ctgovUrl(B.nct_id)} target="_blank" rel="noreferrer">
                  {B.nct_id}
                </a>{' '}
                · {phaseText(B.phases)} · {plural(B.n_sites, 'site')}
              </p>
              <PairRows p={cur} A={A} B={B} detailed={detailed} />
              {cur.shared_sites > 0 &&
                (detailed ? (
                  <SiteTable ids={cur.shared_site_ids} sites={data.sites} worldwide={worldwide} />
                ) : (
                  <Details summary={`The ${plural(cur.shared_sites, 'shared site')}`}>
                    <SiteTable ids={cur.shared_site_ids} sites={data.sites} worldwide={worldwide} />
                  </Details>
                ))}
            </Window>
          )}

          {trials.length > 0 && (
            <Window label="Trials" className="ov-trials" title={`Trials recruiting on ${shortDate(data.as_of)}`} meta="CT.gov status">
              {detailed ? <TrialTable trials={trials} /> : <Details summary={`All ${plural(trials.length, 'trial')}`}>{<TrialTable trials={trials} />}</Details>}
            </Window>
          )}

          {(() => {
            const defs = (
              <div className="ovs-defs">
                <p className="small">
                  Source: {data.source.name}, fetched {data.source.fetched_at} ({int(data.source.trials)} trials). Query: <code>{Object.entries(data.source.query).map(([k, v]) => `${k}=${v}`).join(' & ')}</code>.
                </p>
                <dl className="ovs-dl">
                  {Object.entries(data.definitions).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k.replace(/_/g, ' ')}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Caveat>Descriptive only: counts of registered sites and dates from the registry. Nothing here predicts enrollment.</Caveat>
              </div>
            )
            return detailed ? (
              <Window label="Definitions and sources" title="Definitions and sources">
                {defs}
              </Window>
            ) : (
              <Details summary="Definitions and sources" className="ov-defs-disclosure">
                {defs}
              </Details>
            )
          })()}
        </>
      )}
    </div>
  )
}
