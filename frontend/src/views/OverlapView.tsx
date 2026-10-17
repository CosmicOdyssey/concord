// Portfolio overlap (Calm, design direction C): where one sponsor's own concurrent NSCLC trials share registered sites
// and eligible patients, and the criteria that separate each pair. Descriptive only (counts, dates, eligibility shares
// on a synthetic population); no forecasts anywhere, and no date after the registry snapshot.
//
// Simple: the matrix is the landing hero's half grid (halfgrid.tsx): each pair once, above the diagonal, one number per
// cell (shared registered sites) on a quiet shade of the larger eligible-patient share, with the 80% dot and the
// upper-bound / unreviewed marks; the rest of each pair is in its hover/focus/tap card, and secondary tables sit in
// "Details" disclosures. Detailed: the full directional matrix, every cell with its full text, and every table, note
// and definition inline. Both densities keep every control and deep link.
//
// Deep links: #overlap/regeneron (the Regeneron Sept 2024 preset, fianlimab pair selected) and
// #overlap/<sponsor>[/<region>][/<YYYY-MM-DD>], e.g. #overlap/merck (Merck at the snapshot, all registered sites
// worldwide), #overlap/merck/us, #overlap/bristol/us-northeast/2025-06-01. <sponsor> is the start of the sponsor's name
// (case and punctuation ignored); <region> is world, us or a U.S. region key.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Criterion } from '../api'
import { Caveat, Details, ErrorBox, Gloss, HoverCard, InfoTip, Loading, PageHead, Qualifier, Segmented, Stat, Window } from '../components'
import { useDensity } from '../density'
import { ctgovUrl, int, num, pct } from '../format'
import { CellFace, HalfGrid } from '../halfgrid'
import {
  FIANLIMAB_PAIR,
  mostlyAnonymized,
  overlapApi,
  REGENERON_OVERLAP_PRESET,
  type OverlapAudit,
  type OverlapPair,
  type OverlapQuery,
  type OverlapSite,
  type OverlapSponsor,
  type OverlapSponsors,
  type OverlapTrial,
} from '../overlapApi'
import { highShare, shadeStep } from '../shade'
import { useTheme } from '../theme'
import { IndicationSwitch } from './OverlapIndication'
import './overlap.css'

const UB = '†'
const UNREVIEWED = '‡'
const ANON = 'sites anonymized on CT.gov'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const STORE_KEY = 'concord.overlap.v2'
/** Copy deck B6: the region picker's default option is every registered site worldwide. */
const DEFAULT_REGION = ''
const FALLBACK_REGIONS = ['US-Northeast', 'US-Midwest', 'US-South', 'US-West', 'US']

// Mark meanings, copy deck B6 ("Marks" and "Legend"), verbatim.
const MARK_UB = "A ceiling, not a measurement. A trial has a restriction the synthetic population can't represent."
const MARK_UNREV =
  'Criteria for at least one trial come from the rule-based parse, not yet reviewed by a person. The parse never sets the Upper bound mark, so a missing mark here does not mean the share is exact.'
const MARK_UNREV_CRIT = "This trial's criteria come from the rule-based parse, not yet reviewed by a person."
const MARK_SPARSE = 'A trial in this pair has 2 or fewer encoded criteria, so most patients pass it and containment in it says little.'
const MARK_NONUM = "Shared sites can't be counted: a trial lists only anonymized sites. Not zero."
const ANON_SPONSOR_NOTE =
  'This sponsor lists its sites on ClinicalTrials.gov only as anonymized "Research Site" entries, so shared sites can\'t be counted; those cells show eligibility overlap only.'
const FOOT = 'Synthetic population. Registered sites, not confirmed enrolling.'
/** The landing hero card's upper-bound line (Simple pair cards). */
const UB_NOTE = "Upper bound: a trial has restrictions the synthetic population can't represent, so these shares are ceilings."

const DESIGN_LABEL: Record<string, string> = {
  single_population: 'Single population',
  basket: 'Basket',
  multi_cohort: 'Multi-cohort',
}
const STATUS_LABEL: Record<string, string> = {
  RECRUITING: 'Recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling by invitation',
  ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  NOT_YET_RECRUITING: 'Not yet recruiting',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
  SUSPENDED: 'Suspended',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Unknown status',
}
const CONCEPT_LABEL: Record<string, string> = {
  'driver requirement': 'Required driver mutation (any of)',
  ecog: 'Performance status (ECOG)',
  stage: 'Stage',
  histology: 'Histology',
  prior_lines: 'Prior treatment',
  prior_io: 'Prior immunotherapy',
  pdl1: 'PD-L1 expression',
  egfr: 'EGFR',
  alk: 'ALK',
  ros1: 'ROS1',
  kras_g12c: 'KRAS G12C',
  met: 'MET',
  her2: 'HER2',
  brain_mets_active: 'Brain metastases',
  ild_history: 'ILD / pneumonitis history',
  autoimmune: 'Autoimmune disease',
  never_smoker: 'Smoking history',
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Pair = [string, string]
type Mode = 'matrix' | 'list'

interface SharedOriented {
  concept: string
  a: string[]
  b: string[]
  same: boolean
}

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
  shared: SharedOriented[]
}

interface Stored {
  form: OverlapQuery
  selected: Pair | null
  mode: Mode
}

/** #overlap/regeneron is the preset; #overlap/<sponsor>[/<region>][/<date>] opens a sponsor. */
type Link = { kind: 'preset' } | { kind: 'sponsor'; slug: string; region: string | null; asOf: string | null }

function loadStored(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Stored>
    if (!s.form || typeof s.form.sponsor !== 'string' || typeof s.form.as_of !== 'string' || typeof s.form.region !== 'string')
      return null
    return { form: s.form, selected: Array.isArray(s.selected) && s.selected.length === 2 ? s.selected : null, mode: s.mode === 'list' ? 'list' : 'matrix' }
  } catch {
    return null
  }
}

function saveStored(s: Stored) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: the view still works, it just forgets on remount */
  }
}

function setHash(h: string) {
  try {
    window.history.replaceState(null, '', h)
  } catch {
    /* ignore */
  }
}

/** Lower-case words joined by '-', punctuation dropped: "Merck Sharp & Dohme LLC" -> "merck-sharp-dohme-llc". */
function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseLink(hash: string, regions: string[]): Link | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0]?.toLowerCase() !== 'overlap' || !parts[1]) return null
  let raw = parts[1]
  try {
    raw = decodeURIComponent(raw)
  } catch {
    /* keep the raw segment */
  }
  const slug = slugify(raw)
  if (!slug) return null
  const rest = parts.slice(2).map((s) => s.toLowerCase())
  if (slug === 'regeneron' && rest.length === 0) return { kind: 'preset' }
  let region: string | null = null
  let asOf: string | null = null
  for (const s of rest) {
    if (DATE_RE.test(s)) asOf = s
    else if (s === 'world' || s === 'worldwide' || s === 'all') region = ''
    else {
      const r = regions.find((x) => x.toLowerCase() === s)
      if (r) region = r
    }
  }
  return { kind: 'sponsor', slug, region, asOf }
}

/** The sponsor a slug names: an exact match, else the first (most trials) whose name starts with it. */
function matchSponsor(list: OverlapSponsor[], slug: string): OverlapSponsor | null {
  const named = list.map((s) => ({ s, k: slugify(s.sponsor) }))
  return (
    named.find((x) => x.k === slug)?.s ??
    named.find((x) => x.k.startsWith(`${slug}-`))?.s ??
    named.find((x) => x.k.startsWith(slug))?.s ??
    null
  )
}

/** The first sponsor whose sites are identifiable: for an all-anonymized sponsor (e.g. AstraZeneca) no shared site can
 *  be counted, so the matrix would show eligibility overlap only. */
function defaultSponsor(s: OverlapSponsors): string {
  return (s.sponsors.find((x) => !mostlyAnonymized(x)) ?? s.sponsors[0])?.sponsor ?? ''
}

/** Shared sites are countable only if both trials list an identifiable site: anonymized ones never match, so unknown, not 0. */
function sitesKnown(a: OverlapTrial | undefined, b: OverlapTrial | undefined): boolean {
  return !!a && !!b && a.n_sites_identified > 0 && b.n_sites_identified > 0
}

function stripHand(s: string): string {
  return s.replace(/^\[hand-encoded\]\s*/, '')
}

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase()
}

function conceptLabel(c: string): string {
  return CONCEPT_LABEL[c] ?? c.replace(/_/g, ' ')
}

function isoParts(iso: string): [number, number, number] | null {
  if (!DATE_RE.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  return m >= 1 && m <= 12 ? [y, m, d] : null
}

/** Prose date (copy deck): "October 16, 2026". */
function longDate(iso: string | null | undefined): string {
  const p = iso ? isoParts(iso) : null
  return p ? `${MONTHS[p[1] - 1]} ${p[2]}, ${p[0]}` : (iso ?? '—')
}

/** Tight UI date (copy deck): "Oct 16, 2026". */
function shortDate(iso: string | null | undefined): string {
  const p = iso ? isoParts(iso) : null
  return p ? `${MONTHS[p[1] - 1].slice(0, 3)} ${p[2]}, ${p[0]}` : (iso ?? '—')
}

/** "Phase 2/3", "Phase 1", "Early phase 1". */
function phaseText(phases: string[] | null | undefined): string {
  const ps = (phases ?? []).filter((p) => p !== 'NA')
  if (ps.length === 0) return 'Phase not given'
  if (ps.every((p) => /^PHASE\d$/.test(p))) return `Phase ${ps.map((p) => p.slice(5)).join('/')}`
  return ps.map((p) => p.replace(/^EARLY_PHASE(\d)$/, 'Early phase $1').replace(/^PHASE(\d)$/, 'Phase $1')).join('/')
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${int(n)} ${n === 1 ? one : many}`
}

function sitesLabel(n: number): string {
  return plural(n, 'site')
}

/** The label a trial goes by in the matrix: its acronym, else its NCT id. */
function trialLabel(t: OverlapTrial): string {
  return t.acronym || t.nct_id
}

function regionOptions(regions: string[]): { value: string; label: string }[] {
  const sub = regions.filter((r) => r !== 'US')
  return [
    { value: '', label: 'All registered sites worldwide' },
    { value: 'US', label: 'All U.S. sites' },
    ...sub.map((r) => ({ value: r, label: r.startsWith('US-') ? `U.S. ${r.slice(3)}` : r })),
  ]
}

/** Shade step of the larger eligible-patient share as shown (shade.ts, the landing hero's steps). null: no criteria
 *  encoded for one trial, so the overlap is not informative (hatched). */
function heatOf(o: Oriented): number | null {
  return o.pair.overlap_informative ? shadeStep(Math.max(o.o_ab, o.o_ba)) : null
}

function hiOf(o: Oriented): boolean {
  return o.pair.overlap_informative && highShare(Math.max(o.o_ab, o.o_ba))
}

function markGlyphs(p: OverlapPair): string {
  return (p.upper_bound ? UB : '') + (p.unreviewed_criteria ? UNREVIEWED : '')
}

function summarizeStatuses(ts: OverlapTrial[]): string {
  const n = new Map<string, number>()
  ts.forEach((t) => n.set(t.status_now, (n.get(t.status_now) ?? 0) + 1))
  return [...n.entries()].map(([s, k]) => `${statusLabel(s)}: ${int(k)}`).join(', ')
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

function cellLabel(o: Oriented, A: OverlapTrial, B: OverlapTrial, known: boolean, selected: boolean): string {
  const a = trialLabel(A)
  const b = trialLabel(B)
  const p = o.pair
  return (
    `${a} × ${b}: ` +
    (known ? `${sitesLabel(p.shared_sites)} shared (registered)` : `shared sites can't be counted (${ANON})`) +
    '; ' +
    (p.overlap_informative
      ? `${pct(o.o_ab)} of ${a}'s eligible patients also eligible for ${b}, ${pct(o.o_ba)} the reverse`
      : 'eligibility overlap not informative (no criteria encoded for one trial)') +
    `; ${num(p.months_both_recruiting_estimated, 1)} months both recruiting (estimated)` +
    (p.upper_bound ? '; upper bound' : '') +
    (p.unreviewed_criteria ? '; unreviewed criteria' : '') +
    (selected ? '; selected' : '')
  )
}

/** Indication selector (OverlapIndication.tsx): lung cancer by default, rendered by LungOverlapView unchanged. */
export default function OverlapView({ regions }: { regions?: string[] }) {
  return <IndicationSwitch regions={regions ?? FALLBACK_REGIONS} renderLung={(field) => <LungOverlapView regions={regions} indicationField={field} />} />
}

function LungOverlapView({ regions, indicationField }: { regions?: string[]; indicationField?: ReactNode }) {
  const regionList = regions ?? FALLBACK_REGIONS
  const regionsRef = useRef(regionList)
  regionsRef.current = regionList
  const { density } = useDensity()
  const detailed = density === 'detailed'
  const { theme } = useTheme()
  const ids = useId()

  // Initial state: a deep link wins, else what this tab showed before (sessionStorage), else the snapshot.
  const [init] = useState(() => {
    const link = parseLink(window.location.hash, regionList)
    if (link?.kind === 'preset') return { form: REGENERON_OVERLAP_PRESET, selected: FIANLIMAB_PAIR as Pair, mode: 'matrix' as Mode, slug: null }
    if (link?.kind === 'sponsor')
      return {
        form: { sponsor: '', as_of: link.asOf ?? '', region: link.region ?? DEFAULT_REGION },
        selected: null,
        mode: (loadStored()?.mode ?? 'matrix') as Mode,
        slug: link.slug,
      }
    const s = loadStored()
    return s ? { ...s, slug: null } : { form: { sponsor: '', as_of: '', region: DEFAULT_REGION }, selected: null, mode: 'matrix' as Mode, slug: null }
  })
  const [form, setForm] = useState<OverlapQuery>(init.form)
  const [wantPair, setWantPair] = useState<Pair | null>(init.selected)
  const [sponsors, setSponsors] = useState<OverlapSponsors | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [sponsorErr, setSponsorErr] = useState<string | null>(null)
  const [data, setData] = useState<OverlapAudit | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Pair | null>(null)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [openTrial, setOpenTrial] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  // A sponsor deep link waiting for the sponsor list of its date and region, and the slug it could not match.
  const slugRef = useRef<string | null>(init.slug)
  const [linkTick, setLinkTick] = useState(0)
  const [linkMiss, setLinkMiss] = useState<string | null>(null)

  const afterSnapshot = !!snapshot && DATE_RE.test(form.as_of) && form.as_of > snapshot
  const validDate = form.as_of === '' || (DATE_RE.test(form.as_of) && !afterSnapshot)

  // Remember the form across tab switches (App unmounts inactive tabs).
  useEffect(() => {
    saveStored({ form, selected: selected ?? wantPair, mode })
  }, [form, selected, wantPair, mode])

  // Sponsor list for the date and region ('' date = the registry snapshot, returned as as_of).
  useEffect(() => {
    if (!validDate) return
    const ctl = new AbortController()
    setSponsorErr(null)
    overlapApi
      .sponsors(form.as_of, form.region, ctl.signal)
      .then((s) => {
        if (ctl.signal.aborted) return
        setSponsors(s)
        setSnapshot(s.snapshot_date)
        const slug = slugRef.current
        if (slug !== null) {
          slugRef.current = null
          const hit = matchSponsor(s.sponsors, slug)
          setLinkMiss(hit ? null : slug)
          setForm((f) => ({ ...f, sponsor: hit?.sponsor ?? defaultSponsor(s) }))
          return
        }
        setForm((f) => (f.sponsor || s.sponsors.length === 0 ? f : { ...f, sponsor: defaultSponsor(s) }))
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSponsorErr(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [form.as_of, form.region, validDate, linkTick])

  // The audit itself.
  useEffect(() => {
    if (!form.sponsor || !validDate) return
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    overlapApi
      .audit(form, ctl.signal)
      .then((d) => {
        if (ctl.signal.aborted) return
        setData(d)
        setSnapshot(d.snapshot_date)
        const known = new Set(d.trials.map((t) => t.nct_id))
        const has = (p: Pair | null) => !!p && known.has(p[0]) && known.has(p[1])
        setSelected((cur) => {
          if (wantPair && has(wantPair)) return wantPair
          if (has(cur)) return cur
          return defaultPair(d)
        })
        setWantPair(null)
        setOpenTrial((cur) => (cur && known.has(cur) ? cur : null))
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
    slugRef.current = null
    setLinkMiss(null)
    setForm((f) => ({ ...f, ...patch }))
    setHash('#overlap')
  }

  const loadPreset = () => {
    const P = REGENERON_OVERLAP_PRESET
    const same = form.sponsor === P.sponsor && form.as_of === P.as_of && form.region === P.region
    slugRef.current = null
    setLinkMiss(null)
    setHash('#overlap/regeneron')
    if (same && data) {
      setSelected(FIANLIMAB_PAIR)
      return
    }
    setWantPair(FIANLIMAB_PAIR)
    setForm(P)
  }

  const applyLink = (l: Link) => {
    if (l.kind === 'preset') {
      loadPreset()
      return
    }
    slugRef.current = l.slug
    setLinkMiss(null)
    setWantPair(null)
    setForm({ sponsor: '', as_of: l.asOf ?? '', region: l.region ?? DEFAULT_REGION })
    setLinkTick((n) => n + 1)
  }

  // A deep link typed or followed while this tab is already open (App only switches tabs on hashchange).
  const linkRef = useRef(applyLink)
  linkRef.current = applyLink
  useEffect(() => {
    const onHash = () => {
      const l = parseLink(window.location.hash, regionsRef.current)
      if (l) linkRef.current(l)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const trials = useMemo(() => data?.trials ?? [], [data])
  const tIdx = useMemo(() => new Map(trials.map((t) => [t.nct_id, t])), [trials])
  const pairIdx = useMemo(() => new Map((data?.pairs ?? []).map((p) => [`${p.p}|${p.q}`, p])), [data])
  const orient = (a: string, b: string): Oriented | null => {
    const p = pairIdx.get(`${a}|${b}`)
    if (p)
      return {
        a,
        b,
        pair: p,
        o_ab: p.o_pq,
        o_ba: p.o_qp,
        onlyA: p.criteria_diff.only_p,
        onlyB: p.criteria_diff.only_q,
        shared: p.criteria_diff.shared.map((s) => ({ concept: s.concept, a: s.p, b: s.q, same: s.same })),
      }
    const r = pairIdx.get(`${b}|${a}`)
    if (r)
      return {
        a,
        b,
        pair: r,
        o_ab: r.o_qp,
        o_ba: r.o_pq,
        onlyA: r.criteria_diff.only_q,
        onlyB: r.criteria_diff.only_p,
        shared: r.criteria_diff.shared.map((s) => ({ concept: s.concept, a: s.q, b: s.p, same: s.same })),
      }
    return null
  }
  const current = selected ? orient(selected[0], selected[1]) : null

  // The sponsor list matches the inputs (not a previous date's list still on screen).
  const sponsorsFresh =
    !!sponsors && sponsors.as_of === (form.as_of || sponsors.snapshot_date) && (sponsors.region ?? '') === form.region
  const sponsorOptions = useMemo(() => {
    const list = sponsors?.sponsors ?? []
    const known = list.some((s) => s.sponsor === form.sponsor)
    return { list, extra: form.sponsor && !known ? form.sponsor : null }
  }, [sponsors, form.sponsor])

  const stats = useMemo(() => {
    if (!data) return null
    // Site stats cover only pairs whose shared sites can be counted.
    const pairs = data.pairs.filter((p) => sitesKnown(tIdx.get(p.p), tIdx.get(p.q)))
    const sharing = pairs.filter((p) => p.shared_sites > 0).length
    const top = [...pairs].sort((x, y) => y.shared_sites - x.shared_sites)[0]
    const nested = pairs.filter((p) => p.overlap_informative && p.shared_sites >= 10 && Math.max(p.o_pq, p.o_qp) >= 0.8)
    const closedNow = data.trials.filter((t) => !t.recruiting_at_snapshot)
    return {
      known: pairs.length,
      noneKnown: data.pairs.length > 0 && pairs.length === 0,
      someUnknown: pairs.length > 0 && pairs.length < data.pairs.length,
      sharing,
      top,
      nested: nested.length,
      nestedUb: nested.filter((p) => p.upper_bound).length,
      closedNow,
      uninformative: data.pairs.some((p) => !p.overlap_informative),
    }
  }, [data, tIdx])
  const allAnon = trials.length > 0 && trials.every((t) => t.n_sites_identified === 0)

  const stale = loading && !!data
  const worldwide = !data?.region
  const registry = data?.basis === 'registry'
  const pickedA = current ? tIdx.get(current.a) : undefined
  const pickedB = current ? tIdx.get(current.b) : undefined
  const pickedStatus = pickedA && pickedB ? `Selected ${trialLabel(pickedA)} × ${trialLabel(pickedB)}. Criteria compared below.` : ''

  const statTiles = data && stats && (
    <div className="stats ov-stats">
      <Stat
        label={registry ? 'Trials recruiting (CT.gov status)' : 'Trials recruiting on the date (estimated)'}
        value={int(trials.length)}
        sub={
          registry
            ? `lung trials of this lead sponsor listed as Recruiting or Enrolling by invitation at the ${shortDate(data.snapshot_date)} snapshot`
            : 'lung trials of this lead sponsor inside their estimated enrollment windows, bounded by the CT.gov status at the snapshot'
        }
      />
      <Stat
        label="Pairs sharing a site"
        value={
          stats.noneKnown ? (
            '—'
          ) : (
            <>
              {int(stats.sharing)} <span className="unit">of {int(stats.known)} pairs</span>
            </>
          )
        }
        sub={
          stats.noneKnown
            ? ANON
            : `share at least one identifiable registered site (${worldwide ? 'worldwide' : data.region_label})` +
              (stats.someUnknown ? `; only the ${int(stats.known)} pairs whose sites can be counted` : '')
        }
      />
      <Stat
        label="Most shared sites"
        value={stats.top ? int(stats.top.shared_sites) : '—'}
        sub={
          stats.noneKnown
            ? ANON
            : !stats.top
              ? 'needs two trials'
              : stats.top.shared_sites > 0
                ? `${stats.top.p} × ${stats.top.q}`
                : 'no pair shares an identifiable site'
        }
      />
      <Stat
        label="Nested pairs"
        value={stats.noneKnown ? '—' : int(stats.nested)}
        sub={
          stats.noneKnown
            ? ANON
            : `≥ 10 shared sites and ≥ 80% eligibility overlap in one direction${stats.nestedUb ? ` (${stats.nestedUb} upper bound ${UB})` : ''}`
        }
      />
    </div>
  )

  const trialList = data && (
    <ul className="ov-tlist">
      {trials.map((t) => (
        <TrialRow
          key={t.nct_id}
          t={t}
          sites={data.sites}
          snapshot={data.snapshot_date}
          worldwide={worldwide}
          detailed={detailed}
          open={openTrial === t.nct_id}
          onToggle={() => setOpenTrial((c) => (c === t.nct_id ? null : t.nct_id))}
        />
      ))}
    </ul>
  )

  return (
    <div className="view ov">
      <PageHead
        title="Portfolio overlap"
        lede="Where one sponsor's lung cancer trials recruiting on the same date share registered sites and eligible patients, and the criteria that separate each pair."
        meta={snapshot ? `Registry snapshot: ${shortDate(snapshot)}` : undefined}
      />

      <div className="ov-controls">
        <div className="ov-filters" role="group" aria-label="Overlap filters">
          {indicationField}
          <div className="field ov-f-sponsor">
            <label className="field-label" htmlFor={`${ids}-sponsor`}>
              Sponsor
            </label>
            <select
              id={`${ids}-sponsor`}
              value={form.sponsor}
              onChange={(e) => update({ sponsor: e.target.value })}
              aria-describedby={detailed && sponsorsFresh ? `${ids}-sponsor-hint` : undefined}
            >
              {!form.sponsor && <option value="">Loading sponsors…</option>}
              {sponsorOptions.extra && (
                <option value={sponsorOptions.extra}>
                  {sponsorOptions.extra}
                  {sponsorsFresh ? ' (fewer than 2 on this date)' : ''}
                </option>
              )}
              {sponsorOptions.list.map((s) => (
                <option key={s.sponsor} value={s.sponsor}>
                  {s.sponsor}
                  {sponsorsFresh ? ` (${s.trials})` : ''}
                  {mostlyAnonymized(s) ? ` · ${ANON}` : ''}
                </option>
              ))}
            </select>
            {detailed && sponsorsFresh && sponsors && (
              <span className="ov-hint" id={`${ids}-sponsor-hint`}>
                {plural(sponsors.sponsors.length, 'sponsor')} with 2 or more lung trials recruiting on this date; trial counts in brackets
              </span>
            )}
          </div>
          <div className="field ov-f-date">
            <label className="field-label" htmlFor={`${ids}-date`}>
              As of
            </label>
            <input
              id={`${ids}-date`}
              type="date"
              value={form.as_of || snapshot || ''}
              max={snapshot ?? undefined}
              onChange={(e) => update({ as_of: e.target.value === snapshot ? '' : e.target.value })}
              aria-describedby={detailed && snapshot ? `${ids}-date-hint` : undefined}
            />
            {detailed && snapshot && (
              <span className="ov-hint" id={`${ids}-date-hint`}>
                Snapshot {shortDate(snapshot)}; earlier dates are estimated
              </span>
            )}
          </div>
          <div className="field ov-f-region">
            <label className="field-label" htmlFor={`${ids}-region`}>
              Region
            </label>
            <select id={`${ids}-region`} value={form.region} onChange={(e) => update({ region: e.target.value })}>
              {regionOptions(regionList).map((o) => (
                <option key={o.value || 'world'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn ov-preset"
            onClick={loadPreset}
            title="The Regeneron example: its lung trials on Sep 1, 2024 at U.S. sites, with the two fianlimab trials selected"
          >
            Regeneron, Sep 1, 2024
          </button>
        </div>
        {afterSnapshot ? (
          <p className="ov-invalid">
            The registry snapshot is {longDate(snapshot)}. Later dates would be projections, so this audit does not show them.{' '}
            <button type="button" className="btn btn-small" onClick={() => update({ as_of: '' })}>
              Use {shortDate(snapshot)}
            </button>
          </p>
        ) : (
          !validDate && <p className="ov-invalid">Enter a full date (YYYY-MM-DD).</p>
        )}
        {sponsorErr && <ErrorBox error={sponsorErr} />}
      </div>

      {error && <ErrorBox error={error} onRetry={() => setReload((n) => n + 1)} />}
      {loading && !data && <Loading label="Loading registry data…" />}
      <p className="sr-only" aria-live="polite">
        {pickedStatus}
      </p>

      {data && stats && (
        <>
          <div className="ov-cluster">
          <div className="ov-summary">
            <p className="ov-sumline">
              <span className="num">{int(trials.length)}</span> {trials.length === 1 ? 'trial' : 'trials'} {registry ? '' : 'estimated '}recruiting on{' '}
              {longDate(data.as_of)} · <span className="num">{int(data.pairs.length)}</span> {data.pairs.length === 1 ? 'pair' : 'pairs'}
            </p>
            <span className="ov-updating" role="status">
              {stale ? 'Updating…' : ''}
            </span>
            {trials.length >= 2 && (
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

          {detailed && (
            <p className="ov-runline">
              <span>
                <span className="strong">{data.sponsor}</span> · {data.region_label}
              </span>
              <span>
                {registry ? (
                  <Qualifier tone="muted">CT.gov status at the snapshot</Qualifier>
                ) : (
                  <Qualifier info={`Earlier than the ${shortDate(data.snapshot_date)} snapshot: recruiting is estimated from enrollment windows.`}>
                    Estimated windows
                  </Qualifier>
                )}
              </span>
              <span>
                <Gloss term="synthetic-population">Synthetic population</Gloss> n = <span className="num">{int(data.population.n)}</span>
              </span>
              <span>
                Eligibility: <span className="num">{int(trials.filter((t) => t.eligibility_source === 'hand-encoded').length)}</span> hand-encoded,{' '}
                <span className="num">{int(trials.filter((t) => t.eligibility_source !== 'hand-encoded').length)}</span> rule-based parse
              </span>
            </p>
          )}

          {linkMiss && (
            <Caveat>
              No sponsor named “{linkMiss.replace(/-/g, ' ')}” has 2 or more lung trials recruiting on {longDate(data.as_of)} in this region, so this shows{' '}
              {data.sponsor}.
            </Caveat>
          )}
          <AuditNotes data={data} trials={trials} closedNow={stats.closedNow} registry={registry} detailed={detailed} />

          {detailed && statTiles}

          {trials.length < 2 ? (
            <div className="empty">
              <p className="ov-empty-lead">This sponsor had fewer than 2 lung cancer trials recruiting on this date. Try another date or sponsor.</p>
              <p className="small">
                {trials.length === 0 ? 'No' : 'One'} lung trial of {data.sponsor}{' '}
                {trials.length === 1 ? 'is' : 'are'} {registry ? 'listed as recruiting at the snapshot' : `inside an estimated enrollment window on ${longDate(data.as_of)}`}
                {data.region ? ` with a registered site in ${data.region_label}` : ''}.
              </p>
            </div>
          ) : (
            <>
              {mode === 'matrix' && (
                <LegendRow
                  theme={theme}
                  uncountable={stats.noneKnown || stats.someUnknown}
                  uninformative={stats.uninformative}
                  simple={
                    detailed
                      ? null
                      : {
                          numbers: !stats.noneKnown,
                          unrevPairs: data.pairs.some((p) => p.unreviewed_criteria),
                          unrevTrials: trials.some((t) => t.eligibility_source !== 'hand-encoded'),
                        }
                  }
                />
              )}
              {stats.noneKnown ? (
                <p className="ov-anon">
                  {allAnon
                    ? ANON_SPONSOR_NOTE
                    : "Every pair includes a trial that lists only anonymized sites on ClinicalTrials.gov, so shared sites can't be counted; those cells show eligibility overlap only."}
                </p>
              ) : (
                stats.someUnknown && (
                  <p className="ov-anon">
                    Cells with no number involve a trial that lists only anonymized sites on ClinicalTrials.gov: shared sites can't be counted. Unknown,
                    not zero.
                  </p>
                )
              )}
              <Window
                label={mode === 'matrix' ? 'Pair matrix' : 'Pair list'}
                className={`ov-win${stale ? ' ov-stale' : ''}`}
                title={data.sponsor}
                meta={data.region_label}
                aside={
                  mode === 'list'
                    ? "P → Q: share of P's eligible patients who also qualify for Q"
                    : detailed
                      ? "Row trial vs column trial · diagonal: the trial's registered sites"
                      : 'Each pair once: row trial × column trial'
                }
                flush
              >
                <div aria-busy={stale || undefined}>
                  {mode === 'matrix' ? (
                    detailed ? (
                      <Matrix trials={trials} orient={orient} selected={selected} onSelect={setSelected} worldwide={worldwide} />
                    ) : (
                      <HalfMatrix trials={trials} orient={orient} selected={selected} onSelect={setSelected} worldwide={worldwide} />
                    )
                  ) : (
                    <PairList data={data} tIdx={tIdx} hideSites={stats.noneKnown} orient={orient} selected={selected} onSelect={setSelected} />
                  )}
                </div>
              </Window>
              <p className="ov-caption">
                <Gloss term="synthetic-population">Synthetic population</Gloss>. <Gloss term="registered-site">Registered sites</Gloss>, not
                confirmed enrolling.{' '}
                {mode === 'matrix'
                  ? "Hover or focus a cell for details; select it to compare the two trials' criteria below."
                  : (stats.noneKnown
                      ? 'Every pair, largest eligibility overlap first.'
                      : stats.someUnknown
                        ? "Every pair, most shared sites first, then pairs whose shared sites can't be counted, by eligibility overlap."
                        : 'Every pair, most shared sites first.') + " Select a row to compare the two trials' criteria below."}
              </p>
              {!detailed && <Details summary="Summary counts">{statTiles}</Details>}
            </>
          )}
          </div>

          {current && pickedA && pickedB && (
            <PairDetail
              o={current}
              A={pickedA}
              B={pickedB}
              sites={data.sites}
              data={data}
              worldwide={worldwide}
              detailed={detailed}
              onClear={() => {
                setSelected(null)
                setWantPair(null)
              }}
            />
          )}

          {trials.length > 0 && (
            <Window label="Trials" className="ov-trials">
              <div className="ov-trials-head">
                <h2>Trials recruiting on {longDate(data.as_of)}</h2>
                {registry ? <Qualifier tone="muted">CT.gov status</Qualifier> : <Qualifier>Estimated</Qualifier>}
                {!detailed && (
                  <InfoTip
                    label="Details: other sponsors' trials"
                    content={`Other sponsors' trials: distinct lung trials of other lead sponsors (any sponsor class, any phase) ${registry ? 'listed as recruiting at the snapshot' : 'recruiting on this date by the same rule'} at the trial's identifiable registered sites. A count, not an effect.`}
                  />
                )}
              </div>
              {detailed && (
                <p className="ov-trials-note">
                  Other sponsors' trials: distinct lung trials of other lead sponsors (any sponsor class, any phase){' '}
                  {registry ? 'listed as recruiting at the snapshot' : 'recruiting on this date by the same rule'} at the trial's identifiable registered
                  sites. A count, not an effect.
                </p>
              )}
              {detailed ? (
                trialList
              ) : (
                <>
                  <p className="ov-trials-lede">
                    Each trial's registered sites, where its criteria come from, and how many other sponsors' lung trials recruit at those sites.
                  </p>
                  <Details summary={`All ${plural(trials.length, 'trial')}, with per-site counts`}>{trialList}</Details>
                </>
              )}
            </Window>
          )}

          {detailed ? (
            <LegendDefs data={data} theme={theme} detailed />
          ) : (
            <Details summary="Legend, definitions and sources" className="ov-defs-disclosure">
              <LegendDefs data={data} theme={theme} detailed={false} />
            </Details>
          )}
        </>
      )}
    </div>
  )
}

/** The audit's caveats. Each changes what the numbers mean, so a short form stays visible in Simple (the full text in
 *  its info card); Detailed shows the full text. */
function AuditNotes({
  data,
  trials,
  closedNow,
  registry,
  detailed,
}: {
  data: OverlapAudit
  trials: OverlapTrial[]
  closedNow: OverlapTrial[]
  registry: boolean
  detailed: boolean
}) {
  const notes: { key: string; short: ReactNode; full: string }[] = []
  if (!registry && closedNow.length > 0) {
    const share = closedNow.length === trials.length ? `All ${int(trials.length)}` : `${int(closedNow.length)} of ${int(trials.length)}`
    notes.push({
      key: 'closed',
      short: (
        <>
          {share} of these trials are no longer recruiting at the {shortDate(data.snapshot_date)} snapshot, so whether each was recruiting on{' '}
          {longDate(data.as_of)} is estimated.
        </>
      ),
      full:
        `${share} of these trials are no longer recruiting on ClinicalTrials.gov at the ${longDate(data.snapshot_date)} snapshot (` +
        `${summarizeStatuses(closedNow)}). The registry does not publish when enrollment closed, so whether each was recruiting on ` +
        `${longDate(data.as_of)} is estimated from its enrollment window; a window that would run past the snapshot is cut there.`,
    })
  }
  if (data.n_sites > 0 && data.n_sites_anonymized / data.n_sites >= 0.2) {
    notes.push({
      key: 'anon',
      short: (
        <>
          {int(data.n_sites_anonymized)} of {int(data.n_sites)} registered sites are anonymized on ClinicalTrials.gov, so shared-site counts here
          undercount for this sponsor.
        </>
      ),
      full:
        `${int(data.n_sites_anonymized)} of ${int(data.n_sites)} registered sites of these trials are anonymized on ClinicalTrials.gov ` +
        '(“Research Site”). They are collapsed to one entry per city and cannot be matched across trials, so shared-site and ' +
        'other-sponsor counts here undercount for this sponsor. Same-city anonymized entries are listed in the pair detail, not counted.',
    })
  }
  if (data.excluded_open_ended.length > 0) {
    const full = `Left out: ${data.excluded_open_ended.join(', ')} started by this date and are no longer recruiting, but register no completion date at all, so no enrollment window can be estimated.`
    notes.push({ key: 'open', short: full, full })
  }
  if (data.not_yet_recruiting.length > 0) {
    const full =
      `Not counted: ${data.not_yet_recruiting.map((t) => t.nct_id).join(', ')} ${data.not_yet_recruiting.length === 1 ? 'is' : 'are'} listed as ` +
      `Not yet recruiting on ClinicalTrials.gov at the ${longDate(data.snapshot_date)} snapshot` +
      `${registry ? '' : ', although the registered (anticipated) start is on or before this date'}.`
    notes.push({ key: 'nyr', short: full, full })
  }
  if (notes.length === 0) return null
  return (
    <div className="ov-notes">
      {notes.map((n) =>
        detailed || n.short === n.full ? (
          <Caveat key={n.key}>{n.full}</Caveat>
        ) : (
          <Caveat key={n.key}>
            {n.short} <InfoTip label="More about this note" content={n.full} />
          </Caveat>
        ),
      )}
    </div>
  )
}

/** The compact legend above the matrix (both densities), as in the C mockup. `simple` (Simple): what the half matrix
 *  shows (any site count, unreviewed pair marks, unreviewed trial marks), so the legend keeps only those keys; null
 *  (Detailed) keeps every key. */
function LegendRow({
  theme,
  uncountable,
  uninformative,
  simple,
}: {
  theme: 'light' | 'dark'
  uncountable: boolean
  uninformative: boolean
  simple: { numbers: boolean; unrevPairs: boolean; unrevTrials: boolean } | null
}) {
  return (
    <div className={`ov-legend${simple ? ' ov-legend-simple' : ''}`} role="group" aria-label="Matrix legend">
      {(simple?.numbers ?? true) && (
        <span className="ov-lg">
          <span className="strong">Number:</span>
          <HoverCard content="Registered sites both trials list on ClinicalTrials.gov.">shared registered sites</HoverCard>
        </span>
      )}
      <span className="ov-lg">
        <HoverCard
          content={`The larger share of one trial's eligible patients who also qualify for the other, on a synthetic population. ${theme === 'dark' ? 'Brighter' : 'Darker'} means more.`}
        >
          Shade
        </HoverCard>
        <span className="ov-sws" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`ov-sw ov-h${i}`} />
          ))}
        </span>
        <span className="num">0% → 100%</span>
      </span>
      <span className="ov-lg">
        <span className="ov-lg-dot" aria-hidden="true" />
        80% or more, one way
      </span>
      <span className="ov-lg">
        <span className="ov-lg-mk" aria-hidden="true">
          {UB}
        </span>
        <HoverCard content={MARK_UB}>Upper bound</HoverCard>
      </span>
      {(simple?.unrevPairs ?? true) && (
        <span className="ov-lg">
          <span className="ov-lg-mk" aria-hidden="true">
            {UNREVIEWED}
          </span>
          <HoverCard content={MARK_UNREV}>Unreviewed</HoverCard>
        </span>
      )}
      {(simple?.unrevTrials ?? true) && (
        <span className="ov-lg">
          <span className="ov-lg-mk" aria-hidden="true">
            {UNREVIEWED}
          </span>
          <span>on a trial name:</span>
          <HoverCard content={MARK_UNREV_CRIT}>Unreviewed criteria</HoverCard>
        </span>
      )}
      {uncountable && (
        <span className="ov-lg">
          <span className="strong">No number:</span>
          <HoverCard content={MARK_NONUM}>can't be counted</HoverCard>
        </span>
      )}
      {uninformative && (
        <span className="ov-lg">
          <span className="ov-sw ov-hx" aria-hidden="true" />
          <span className="strong">Hatched:</span>
          <HoverCard content="No criteria are encoded for one of the trials, so the eligibility overlap is not informative.">overlap not informative</HoverCard>
        </span>
      )}
    </div>
  )
}

/** Hover/focus/tap card for a pair (copy deck B6 "Pair hover card template": Simple shows the bulleted lines, Detailed
 *  all of them). */
function PairTip({
  o,
  A,
  B,
  known,
  detailed,
  selected,
}: {
  o: Oriented
  A: OverlapTrial
  B: OverlapTrial
  known: boolean
  detailed: boolean
  selected: boolean
}) {
  const p = o.pair
  const a = trialLabel(A)
  const b = trialLabel(B)
  const ca = new Map(A.criteria.map((c) => [c.id, c.label]))
  const cb = new Map(B.criteria.map((c) => [c.id, c.label]))
  const both = o.shared.filter((g) => g.same).flatMap((g) => g.a.map((id) => ca.get(id) ?? id))
  const onlyA = o.onlyA.map((id) => ca.get(id) ?? id)
  const onlyB = o.onlyB.map((id) => cb.get(id) ?? id)
  const marks = (
    <>
      {p.upper_bound && <span className="ov-mtext">{UB} Upper bound</span>}
      {p.unreviewed_criteria && <span className="ov-mtext">{UNREVIEWED} Unreviewed</span>}
    </>
  )
  // Detailed: numbers on the left, the criteria lists on the right, so the card stays short enough to sit beside
  // its cell rather than over it.
  return (
    <div className={detailed ? 'ov-tip ov-tip-wide' : 'ov-tip'}>
      <span className="hc-title">
        {a} × {b}
      </span>
      <span className="ov-tip-sub">
        {A.nct_id} · {phaseText(A.phases)} · {sitesLabel(A.n_sites)} — {B.nct_id} · {phaseText(B.phases)} · {sitesLabel(B.n_sites)}
      </span>
      <div className={detailed ? 'ov-tip-cols' : undefined}>
      <dl className="ov-tip-rows">
        <div>
          <dt>Shared registered sites</dt>
          <dd>{known ? <span className="num">{int(p.shared_sites)}</span> : <span className="ov-tip-unk">can't be counted ({ANON})</span>}</dd>
        </div>
        {p.overlap_informative ? (
          <>
            <div>
              <dt>
                {a}'s eligible patients also eligible for {b}
              </dt>
              <dd>
                <span className="num">{pct(o.o_ab)}</span>
                {marks}
              </dd>
            </div>
            <div>
              <dt>
                {b}'s eligible patients also eligible for {a}
              </dt>
              <dd>
                <span className="num">{pct(o.o_ba)}</span>
                {marks}
              </dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Eligible patients in both</dt>
            <dd>
              <span className="ov-tip-unk">Not informative: no criteria encoded for one of the trials</span>
              {marks}
            </dd>
          </div>
        )}
        <div>
          <dt>Months both recruiting (estimated)</dt>
          <dd className="num">{num(p.months_both_recruiting_estimated, 1)}</dd>
        </div>
        {detailed && (
          <>
            <div>
              <dt>Both recruiting</dt>
              <dd className="ov-tip-plain">
                {p.both_recruiting_from
                  ? `${shortDate(p.both_recruiting_from)} to ${p.both_recruiting_at_snapshot || !p.both_recruiting_to ? 'the snapshot' : shortDate(p.both_recruiting_to)}`
                  : 'not at the same time'}
              </dd>
            </div>
            {p.anonymized_same_city > 0 && (
              <div>
                <dt>Same city, sites anonymized</dt>
                <dd className="num">{int(p.anonymized_same_city)}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {detailed && (
        <div className="ov-tip-crit">
          <span className="ov-tip-block">
            <span className="ov-tip-l">Criteria in both</span>
            {both.length ? both.join(' · ') : 'None'}
          </span>
          <span className="ov-tip-block">
            <span className="ov-tip-l">Only in {a}</span>
            {onlyA.length ? onlyA.join(' · ') : 'None'}
          </span>
          <span className="ov-tip-block">
            <span className="ov-tip-l">Only in {b}</span>
            {onlyB.length ? onlyB.join(' · ') : 'None'}
          </span>
        </div>
      )}
      </div>
      {p.sparse_criteria.length > 0 && (
        <span className="ov-tip-block ov-tip-caution">
          <span className="ov-tip-l">Sparse criteria ({p.sparse_criteria.join(', ')})</span>
          {MARK_SPARSE}
        </span>
      )}
      {/* Simple, as on the landing hero's card: what the upper-bound mark means, in the card itself. */}
      <span className="hc-src">{!detailed && p.upper_bound ? `${UB_NOTE} ${FOOT}` : FOOT}</span>
      <span className="ov-tip-cta">{selected ? 'Criteria compared below the matrix ↓' : 'Compare criteria ↓'}</span>
    </div>
  )
}

/** Hover/focus/tap card for a trial (row and column headers, diagonal). Copy deck B6 "Trial row-header hover card". */
function TrialTip({ t, detailed, worldwide, diag }: { t: OverlapTrial; detailed: boolean; worldwide: boolean; diag?: boolean }) {
  const hand = t.eligibility_source === 'hand-encoded'
  return (
    <div className="ov-tip">
      <span className="hc-title">{trialLabel(t)}</span>
      <span className="ov-tip-sub">
        {t.nct_id} · {phaseText(t.phases)} · {int(t.n_sites)} registered sites{worldwide ? '' : ' in region'}
        {t.n_sites_anonymized > 0 ? ` (${int(t.n_sites_anonymized)} anonymized)` : ''}
      </span>
      <span className="ov-tip-text">{t.title}</span>
      <span className="ov-tip-block">
        <span className="ov-tip-l">Criteria</span>
        {hand ? 'Hand-encoded and reviewed' : `Rule-based parse, unreviewed (${UNREVIEWED})`}
        {t.no_criteria ? '; none parsed, so overlap with this trial is not informative' : ''}
      </span>
      {t.upper_bound && (
        <span className="ov-tip-block ov-tip-caution">
          <span className="ov-tip-l">{UB} Upper bound</span>
          {t.upper_bound_reasons.join('; ')}
        </span>
      )}
      {t.sparse_criteria && (
        <span className="ov-tip-block ov-tip-caution">
          <span className="ov-tip-l">Sparse criteria</span>
          {plural(t.criteria.length, 'encoded criterion', 'encoded criteria')}: most synthetic patients pass them.
        </span>
      )}
      {detailed && t.criteria.length > 0 && (
        <span className="ov-tip-block">
          <span className="ov-tip-l">Encoded criteria</span>
          {t.criteria.map((c) => c.label).join(' · ')}
        </span>
      )}
      {diag && <span className="hc-src">Diagonal: the trial's registered sites. Registered, not confirmed enrolling.</span>}
    </div>
  )
}

/** Accessible name of a trial's row or column header. */
function headLabel(t: OverlapTrial): string {
  return `${trialLabel(t)}, ${phaseText(t.phases)}, ${int(t.n_sites)} registered sites${t.eligibility_source !== 'hand-encoded' ? ', unreviewed criteria' : ''}`
}

function isSelected(selected: Pair | null, a: string, b: string): boolean {
  return !!selected && ((selected[0] === a && selected[1] === b) || (selected[0] === b && selected[1] === a))
}

/** Keep the selected cell in view horizontally (narrow screens), without scrolling the page. `sticky` is the row
 *  header that scrolled cells pass under. */
function useSelectedInView(selected: Pair | null, trials: OverlapTrial[], sticky: string) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    if (!box || !selected) return
    const cell =
      box.querySelector<HTMLElement>(`[data-cell="${selected[0]}|${selected[1]}"]`) ?? box.querySelector<HTMLElement>(`[data-cell="${selected[1]}|${selected[0]}"]`)
    if (!cell) return
    const b = box.getBoundingClientRect()
    const c = cell.getBoundingClientRect()
    const w = box.querySelector(sticky)?.getBoundingClientRect().width ?? 0
    if (c.left < b.left + w || c.right > b.right) box.scrollLeft += c.left - (b.left + w) - 8
  }, [selected, trials, sticky])
  return scroller
}

/** Detailed: the full directional matrix. Each pair twice (row trial toward column trial), the diagonal the trial's own
 *  registered sites, every cell with its site count and both eligibility shares. */
function Matrix({
  trials,
  orient,
  selected,
  onSelect,
  worldwide,
}: {
  trials: OverlapTrial[]
  orient: (a: string, b: string) => Oriented | null
  selected: Pair | null
  onSelect: (p: Pair) => void
  worldwide: boolean
}) {
  const scroller = useSelectedInView(selected, trials, '.ov-rowh')
  return (
    <div className="ov-mscroll" ref={scroller}>
      <table className="ov-matrix ov-matrix-detailed">
        <caption className="sr-only">
          Shared registered sites and eligible-patient overlap for {trials.length} trials: rows against columns. Shade is the larger eligible-patient share.
        </caption>
        <thead>
          <tr>
            <th className="ov-corner" scope="col">
              Row × column
            </th>
            {trials.map((t) => (
              <th key={t.nct_id} scope="col" className="ov-colh">
                <HoverCard className="ov-hbtn ov-hbtn-col" label={headLabel(t)} content={<TrialTip t={t} detailed worldwide={worldwide} />}>
                  <span className="ov-vt">
                    <span className="ov-vt-label">
                      {trialLabel(t)}
                      {t.eligibility_source !== 'hand-encoded' && <span className="ov-hmk">{UNREVIEWED}</span>}
                    </span>
                    <span className="ov-vt-sub">{phaseText(t.phases)}</span>
                  </span>
                </HoverCard>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trials.map((r) => (
            <tr key={r.nct_id}>
              <th scope="row" className="ov-rowh">
                <HoverCard className="ov-hbtn ov-hbtn-row" label={headLabel(r)} content={<TrialTip t={r} detailed worldwide={worldwide} />}>
                  {/* A long label truncates; the unreviewed mark beside it never does. */}
                  <span className="ov-rh-label">
                    <span className="ov-rl-text">{trialLabel(r)}</span>
                    {r.eligibility_source !== 'hand-encoded' && <span className="ov-hmk">{UNREVIEWED}</span>}
                  </span>
                  <span className="ov-rh-sub">
                    {phaseText(r.phases)}
                    {` · ${sitesLabel(r.n_sites)}`}
                  </span>
                </HoverCard>
              </th>
              {trials.map((c) => {
                if (c.nct_id === r.nct_id)
                  return (
                    <td key={c.nct_id} className="ov-diag">
                      <HoverCard
                        className="ov-cell ov-cell-diag"
                        label={`${trialLabel(r)}: ${int(r.n_sites)} registered sites`}
                        content={<TrialTip t={r} detailed worldwide={worldwide} diag />}
                      >
                        <span className="ov-cn">
                          <span className="num">{int(r.n_sites)}</span>
                          <span className="ov-unit"> {r.n_sites === 1 ? 'site' : 'sites'}</span>
                        </span>
                      </HoverCard>
                    </td>
                  )
                const o = orient(r.nct_id, c.nct_id)
                if (!o) return <td key={c.nct_id} />
                const sel = isSelected(selected, r.nct_id, c.nct_id)
                // Pairs whose shared sites can't be counted show no number (unknown, not 0), only the eligibility shares.
                const known = sitesKnown(r, c)
                const heat = heatOf(o)
                const mk = markGlyphs(o.pair)
                return (
                  <td
                    key={c.nct_id}
                    data-cell={`${r.nct_id}|${c.nct_id}`}
                    className={`ov-c${sel ? ' ov-sel' : ''}${known ? '' : ' ov-nosites'}`}
                    onClick={() => onSelect([r.nct_id, c.nct_id])}
                  >
                    <HoverCard
                      className={`ov-cell ov-h${heat === null ? 'x' : heat}`}
                      label={cellLabel(o, r, c, known, sel)}
                      content={<PairTip o={o} A={r} B={c} known={known} detailed selected={sel} />}
                    >
                      {known && (
                        <span className="ov-cn">
                          <span className="num">{int(o.pair.shared_sites)}</span>
                          <span className="ov-unit"> {o.pair.shared_sites === 1 ? 'site' : 'sites'}</span>
                          {mk && <span className="ov-mk">{mk}</span>}
                        </span>
                      )}
                      <span className="ov-cp">
                        {/* The slash stays with the first share (a no-break space), so a narrow cell breaks only after it. */}
                        <span className="num">{o.pair.overlap_informative ? `${pct(o.o_ab)} / ${pct(o.o_ba)}` : '—'}</span>
                        {!known && mk && <span className="ov-mk">{mk}</span>}
                      </span>
                      {hiOf(o) && <span className="ov-hi" />}
                    </HoverCard>
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

/** Simple: the landing hero's half matrix (halfgrid.tsx) for every trial of the sponsor. A pair matrix is symmetric, so
 *  each pair appears once, above the diagonal: rows are trials 1..n-1, columns trials 2..n, no diagonal. One number per
 *  cell (shared registered sites; none when they can't be counted), the shade of the larger eligible-patient share, the
 *  80% dot and the upper-bound / unreviewed marks. Hover, focus or tap opens the pair's card (a bottom sheet on phones);
 *  a click or Enter selects the pair for the detail below. Cells narrow as the trial count grows, and the box scrolls
 *  sideways (never the page) under sticky row headers. */
function HalfMatrix({
  trials,
  orient,
  selected,
  onSelect,
  worldwide,
}: {
  trials: OverlapTrial[]
  orient: (a: string, b: string) => Oriented | null
  selected: Pair | null
  onSelect: (p: Pair) => void
  worldwide: boolean
}) {
  const scroller = useSelectedInView(selected, trials, '.hg-rowh')
  const cols = trials.length - 1
  const size = cols <= 7 ? 1 : cols <= 11 ? 2 : cols <= 15 ? 3 : 4
  const unrev = (t: OverlapTrial) => t.eligibility_source !== 'hand-encoded' && <span className="ov-hmk">{UNREVIEWED}</span>
  return (
    // data-scrolled: the sticky headers cover the gaps beside them only while cells can be underneath (overlap.css).
    <div className="ov-mscroll" ref={scroller} onScroll={(e) => e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollLeft > 0)}>
      <HalfGrid
        items={trials}
        keyOf={(t) => t.nct_id}
        className={`ov-hg ov-hg-s${size}`}
        label={`Shared registered sites for each pair of ${trials.length} trials, each pair once; shade is the larger eligible-patient share`}
        rowHead={(t) => (
          <HoverCard className="ov-hbtn ov-hbtn-row" label={headLabel(t)} content={<TrialTip t={t} detailed={false} worldwide={worldwide} />}>
            {/* A long label truncates; the unreviewed mark beside it never does. */}
            <span className="hg-rowh-label">
              <span className="ov-rl-text">{trialLabel(t)}</span>
              {unrev(t)}
            </span>
            <span className="hg-rowh-sub">{phaseText(t.phases)}</span>
          </HoverCard>
        )}
        colHead={(t) => (
          <HoverCard className="ov-hbtn ov-hbtn-col" label={headLabel(t)} content={<TrialTip t={t} detailed={false} worldwide={worldwide} />}>
            <span className="hg-vt">
              {trialLabel(t)}
              {unrev(t)}
            </span>
          </HoverCard>
        )}
        cell={(r, c) => {
          const o = orient(r.nct_id, c.nct_id)
          if (!o) return null
          const sel = isSelected(selected, r.nct_id, c.nct_id)
          // Pairs whose shared sites can't be counted show no number (unknown, not 0); the shade, dot and marks stay.
          const known = sitesKnown(r, c)
          const heat = heatOf(o)
          return (
            <div
              className={`ov-hg-c${sel ? ' ov-sel' : ''}${known ? '' : ' ov-nosites'}`}
              data-cell={`${r.nct_id}|${c.nct_id}`}
              onClick={() => onSelect([r.nct_id, c.nct_id])}
            >
              <HoverCard
                className={`hg-cell ${heat === null ? 'ov-hx' : `hg-h${heat}`}${sel ? ' hg-on' : ''}`}
                label={cellLabel(o, r, c, known, sel)}
                content={<PairTip o={o} A={r} B={c} known={known} detailed={false} selected={sel} />}
              >
                <CellFace n={known ? o.pair.shared_sites : null} marks={markGlyphs(o.pair)} hi={hiOf(o)} />
              </HoverCard>
            </div>
          )
        }}
      />
    </div>
  )
}

function FlagMarks({ p }: { p: OverlapPair }) {
  return (
    <span className="ov-flags">
      {p.upper_bound && (
        <Qualifier mark={UB} info={MARK_UB}>
          Upper bound
        </Qualifier>
      )}
      {p.unreviewed_criteria && (
        <Qualifier mark={UNREVIEWED} info={MARK_UNREV}>
          Unreviewed
        </Qualifier>
      )}
      {p.sparse_criteria.length > 0 && (
        <Qualifier tone="muted" info={MARK_SPARSE}>
          Sparse criteria
        </Qualifier>
      )}
    </span>
  )
}

function PairList({
  data,
  tIdx,
  hideSites,
  orient,
  selected,
  onSelect,
}: {
  data: OverlapAudit
  tIdx: Map<string, OverlapTrial>
  /** No pair's shared sites can be counted: drop the column rather than fill it with dashes. */
  hideSites: boolean
  orient: (a: string, b: string) => Oriented | null
  selected: Pair | null
  onSelect: (p: Pair) => void
}) {
  // Countable pairs first by shared sites, then the rest by eligibility overlap alone. Uninformative overlap
  // (no criteria encoded: 1.0 from the backend, shown as '—') sorts last among the uncountable pairs.
  const overlap = (p: OverlapPair, known: boolean) => (known || p.overlap_informative ? Math.max(p.o_pq, p.o_qp) : -1)
  const rows = data.pairs
    .map((p) => ({ p, known: sitesKnown(tIdx.get(p.p), tIdx.get(p.q)) }))
    .sort(
      (x, y) =>
        Number(y.known) - Number(x.known) ||
        (x.known ? y.p.shared_sites - x.p.shared_sites : 0) ||
        overlap(y.p, y.known) - overlap(x.p, x.known),
    )
  return (
    <div className="table-scroll ov-pairs-scroll">
      <table className="tbl tbl-compact ov-pairs">
        <thead>
          <tr>
            <th scope="col">Trial P</th>
            <th scope="col">Trial Q</th>
            {!hideSites && (
              <th scope="col" className="num">
                Shared sites
              </th>
            )}
            <th scope="col" className="num">
              P → Q
            </th>
            <th scope="col" className="num">
              Q → P
            </th>
            <th scope="col" className="num">
              Both recruiting (est.)
            </th>
            <th scope="col">Marks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, known }) => {
            const o = orient(p.p, p.q)!
            const sel = !!selected && new Set(selected).has(p.p) && new Set(selected).has(p.q)
            const P = tIdx.get(p.p)
            const Q = tIdx.get(p.q)
            return (
              <tr
                key={`${p.p}|${p.q}`}
                className={`clickable${sel ? ' row-on' : ''}`}
                tabIndex={0}
                aria-current={sel || undefined}
                onClick={() => onSelect([p.p, p.q])}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect([p.p, p.q])
                  }
                }}
              >
                <td className="nowrap" title={P?.acronym ?? undefined}>
                  {p.p}
                </td>
                <td className="nowrap" title={Q?.acronym ?? undefined}>
                  {p.q}
                </td>
                {hideSites ? null : known ? (
                  <td className="num">{int(p.shared_sites)}</td>
                ) : (
                  <td className="num muted" title={`Shared sites can't be counted (${ANON})`}>
                    –
                  </td>
                )}
                <td className="num">{p.overlap_informative ? pct(o.o_ab) : '—'}</td>
                <td className="num">{p.overlap_informative ? pct(o.o_ba) : '—'}</td>
                <td className="num nowrap">{num(p.months_both_recruiting_estimated, 1)} mo</td>
                <td>
                  <FlagMarks p={p} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Estimated window ends later than the registry snapshot would be projections, so they are not shown as dates. */
function WindowEnd({ t, snapshot }: { t: OverlapTrial; snapshot: string }) {
  if (!t.estimated_window_end) return <span className="muted">none (no completion date registered)</span>
  if (t.estimated_window_end > snapshot)
    return (
      <span className="muted" title="Start + 65% of the time to the registered primary completion falls after the snapshot; not shown as a date">
        after the snapshot
      </span>
    )
  return <>{shortDate(t.estimated_window_end)}</>
}

function StatusNote({ t, snapshot }: { t: OverlapTrial; snapshot: string }) {
  return (
    <>
      <span className={t.recruiting_at_snapshot ? '' : 'ov-closed'}>{statusLabel(t.status_now)}</span>
      {t.status_overrides_estimate && (
        <span className="muted">
          {t.recruiting_at_snapshot
            ? ' · still recruiting after the estimated window end'
            : ` · enrollment closed by ${shortDate(snapshot)}, before the estimated window end`}
        </span>
      )}
    </>
  )
}

function TrialCard({ t, worldwide, snapshot }: { t: OverlapTrial; worldwide: boolean; snapshot: string }) {
  return (
    <div className="ov-tcard">
      <div className="ov-tcard-head">
        <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
          {t.nct_id}
        </a>
        {t.acronym && <span>{t.acronym}</span>}
        <SourceMark t={t} />
        {t.upper_bound && (
          <Qualifier mark={UB} info={t.upper_bound_reasons.join('; ')}>
            Upper bound
          </Qualifier>
        )}
      </div>
      <p className="ov-tcard-title">{t.title}</p>
      <dl className="ov-dl">
        <dt>Phase</dt>
        <dd>{phaseText(t.phases)}</dd>
        <dt>Start</dt>
        <dd>{shortDate(t.start_date)}</dd>
        <dt>Estimated window end</dt>
        <dd>
          <WindowEnd t={t} snapshot={snapshot} />
        </dd>
        <dt>CT.gov status at {shortDate(snapshot)}</dt>
        <dd>
          <StatusNote t={t} snapshot={snapshot} />
        </dd>
        <dt>Registered sites</dt>
        <dd>
          {int(t.n_sites)} {worldwide ? 'worldwide' : 'in region'}
          {t.n_sites_anonymized > 0 && <span className="muted"> ({int(t.n_sites_anonymized)} anonymized)</span>}
        </dd>
        <dt>Design</dt>
        <dd>{t.design ? (DESIGN_LABEL[t.design] ?? t.design) : <span className="muted">not hand-reviewed</span>}</dd>
        <dt>Encoded criteria</dt>
        <dd>
          {int(t.criteria.length)}
          {t.sparse_criteria && <span className="muted"> (few: most synthetic patients pass them)</span>}
        </dd>
        <dt>Eligible share</dt>
        <dd>{pct(t.eligible_share, 1)} of the synthetic population</dd>
      </dl>
      {t.upper_bound && <p className="ov-tcard-note">Upper bound because: {t.upper_bound_reasons.join('; ')}.</p>}
    </div>
  )
}

/** Where a trial's criteria come from: hand-encoded (reviewed) or the rule-based parse (unreviewed, ‡). */
function SourceMark({ t }: { t: OverlapTrial }) {
  return t.eligibility_source === 'hand-encoded' ? (
    <Qualifier tone="muted" info="Eligibility criteria entered and reviewed by a person.">
      Hand-encoded
    </Qualifier>
  ) : (
    <Qualifier mark={UNREVIEWED} info={MARK_UNREV_CRIT}>
      Unreviewed criteria
    </Qualifier>
  )
}

/** One criterion: its label; the CT.gov source sentence inline in Detailed, in a hover card in Simple. */
function CritLine({ label, source, kind, detailed }: { label: string; source: ReactNode; kind?: string; detailed: boolean }) {
  if (detailed)
    return (
      <>
        <span className="ov-crit-label">
          {label}
          {kind && <span className="ov-crit-kind"> · {kind}</span>}
        </span>
        <span className="ov-crit-src">{source}</span>
      </>
    )
  return (
    <HoverCard content={<div className="ov-tip ov-tip-src">{source}</div>} className="ov-crit-gloss">
      {label}
    </HoverCard>
  )
}

function PairDetail({
  o,
  A,
  B,
  sites,
  data,
  worldwide,
  detailed,
  onClear,
}: {
  o: Oriented
  A: OverlapTrial
  B: OverlapTrial
  sites: Record<string, OverlapSite>
  data: OverlapAudit
  worldwide: boolean
  detailed: boolean
  onClear: () => void
}) {
  const hid = useId()
  const ca = new Map(A.criteria.map((c) => [c.id, c]))
  const cb = new Map(B.criteria.map((c) => [c.id, c]))
  const p = o.pair
  const a = trialLabel(A)
  const b = trialLabel(B)
  const snap = data.snapshot_date
  const unrev = [A, B].filter((t) => t.eligibility_source !== 'hand-encoded')
  const sparse = [A, B].filter((t) => t.sparse_criteria)
  const known = sitesKnown(A, B)
  const anonOnly = [A, B].filter((t) => t.n_sites_identified === 0).map((t) => t.nct_id)
  const crit = (m: Map<string, Criterion>, ids: string[]) => ids.map((id) => m.get(id)).filter((c): c is Criterion => !!c)
  const text = (cs: Criterion[]) => cs.map((c) => stripHand(c.source)).join(' ')
  const labels = (cs: Criterion[]) => cs.map((c) => c.label).join('; ')
  const same = o.shared.filter((g) => g.same)
  const diff = o.shared.filter((g) => !g.same)
  const onlyA = crit(ca, o.onlyA)
  const onlyB = crit(cb, o.onlyB)
  const ubReasons = [A, B]
    .filter((t) => t.upper_bound)
    .map((t) => `${t.nct_id}: ${t.upper_bound_reasons.join('; ')}`)
    .join(' · ')
  const ubInfo = (
    <>
      <span className="hc-title">Upper bound</span>
      {MARK_UB}
      {ubReasons && <span className="hc-src">{ubReasons}</span>}
    </>
  )
  const qualifiers = (
    <span className="ov-pfig-q">
      {p.upper_bound && (
        <Qualifier mark={UB} info={ubInfo}>
          Upper bound
        </Qualifier>
      )}
      {p.unreviewed_criteria && (
        <Qualifier mark={UNREVIEWED} info={MARK_UNREV}>
          Unreviewed
        </Qualifier>
      )}
      {p.sparse_criteria.length > 0 && (
        <Qualifier tone="muted" info={MARK_SPARSE}>
          Sparse criteria
        </Qualifier>
      )}
    </span>
  )
  const trialLine = (t: OverlapTrial) =>
    `${t.acronym ? `${t.acronym}: ` : ''}${t.nct_id} · ${phaseText(t.phases)} · ${int(t.n_sites)} registered sites${worldwide ? '' : ' in region'} · criteria ${
      t.eligibility_source === 'hand-encoded' ? 'hand-encoded and reviewed' : `from the rule-based parse, unreviewed (${UNREVIEWED})`
    }`

  const sharedSites = known ? (
    p.shared_site_ids.length ? (
      <SiteTable ids={p.shared_site_ids} sites={sites} dateLabel={shortDate(data.as_of)} worldwide={worldwide} />
    ) : (
      <p className="ov-empty">No identifiable registered site in common{worldwide ? '' : ` in ${data.region_label}`}.</p>
    )
  ) : (
    <p className="ov-empty">
      Shared sites can't be counted because {anonOnly.join(' and ')} {anonOnly.length === 1 ? 'lists' : 'list'} only anonymized sites on
      ClinicalTrials.gov.
    </p>
  )

  return (
    <section className="win ov-detail" aria-labelledby={hid}>
      <div className="win-body">
        <div className="ov-pd-head">
          <div className="ov-pd-title">
            <p className="ov-pd-kicker">Selected pair</p>
            <h2 id={hid}>
              {a} × {b}
            </h2>
            <p className="ov-pd-sub">
              {trialLine(A)}
              <br />
              {trialLine(B)}
            </p>
          </div>
          <button type="button" className="btn btn-small ov-clear" onClick={onClear}>
            Clear selection
          </button>
        </div>

        <dl className="ov-pfig">
          <div className="ov-fact">
            <dt>Shared registered sites ({worldwide ? 'worldwide' : data.region_label})</dt>
            <dd>
              {known ? <span className="num ov-fig">{int(p.shared_sites)}</span> : <span className="ov-fig-unk">Can't be counted ({ANON})</span>}
              {p.anonymized_same_city > 0 && (
                <span className="ov-fact-sub">
                  {known ? 'Plus ' : ''}
                  {plural(p.anonymized_same_city, 'city', 'cities')} where both list an anonymized site (facility unknown, not counted)
                </span>
              )}
            </dd>
          </div>
          <div className="ov-fact">
            <dt>
              {a}'s eligible patients also eligible for {b}
            </dt>
            <dd>
              {p.overlap_informative ? <span className="num ov-fig">{pct(o.o_ab)}</span> : <span className="ov-fig-unk">Not informative</span>}
              {qualifiers}
            </dd>
          </div>
          <div className="ov-fact">
            <dt>
              {b}'s eligible patients also eligible for {a}
            </dt>
            <dd>
              {p.overlap_informative ? <span className="num ov-fig">{pct(o.o_ba)}</span> : <span className="ov-fig-unk">Not informative</span>}
              {qualifiers}
            </dd>
          </div>
          <div className="ov-fact">
            <dt>Both recruiting (estimated)</dt>
            <dd>
              <span className="num ov-fig">{num(p.months_both_recruiting_estimated, 1)}</span> <span className="ov-fig-unit">months</span>
              <span className="ov-fact-sub">
                {!p.both_recruiting_from
                  ? `Not recruiting at the same time by the ${shortDate(snap)} snapshot`
                  : p.both_recruiting_at_snapshot || !p.both_recruiting_to
                    ? `Since ${shortDate(p.both_recruiting_from)}; both still recruiting at the ${shortDate(snap)} snapshot`
                    : `${shortDate(p.both_recruiting_from)} to ${shortDate(p.both_recruiting_to)}; windows cut at the ${shortDate(snap)} snapshot`}
              </span>
            </dd>
          </div>
        </dl>
        {!p.overlap_informative && <p className="ov-empty">Not informative: no criteria encoded for one of the trials.</p>}

        {detailed && p.upper_bound && (
          <Caveat>
            {UB} Upper bound: a required biomarker or cohort restriction the synthetic population can't represent, so the overlap shown is a ceiling, not a
            measurement. {ubReasons}
          </Caveat>
        )}
        {detailed && (unrev.length > 0 || sparse.length > 0) && (
          <Caveat>
            {unrev.length > 0 && (
              <>
                {UNREVIEWED} {unrev.map((t) => t.nct_id).join(' and ')} {unrev.length === 1 ? 'uses' : 'use'} the rule-based parse of the CT.gov text, which
                is not reviewed and can miss restrictions (that inflates overlap; the parse never sets the upper-bound flag).{' '}
              </>
            )}
            {sparse.map((t) => (
              <span key={t.nct_id}>
                {t.nct_id} has only {plural(t.criteria.length, 'encoded criterion', 'encoded criteria')} ({pct(t.eligible_share)} of the synthetic
                population pass), so a high share of the other trial's patients “also qualifying” for it says little.{' '}
              </span>
            ))}
          </Caveat>
        )}

        {detailed ? (
          <div className="ov-two">
            <TrialCard t={A} worldwide={worldwide} snapshot={snap} />
            <TrialCard t={B} worldwide={worldwide} snapshot={snap} />
          </div>
        ) : (
          <Details summary="Both trials: dates, status, sites and criteria counts">
            <div className="ov-two">
              <TrialCard t={A} worldwide={worldwide} snapshot={snap} />
              <TrialCard t={B} worldwide={worldwide} snapshot={snap} />
            </div>
          </Details>
        )}

        <div className="ov-cmp" role="group" aria-label="Criteria compared">
          <div className="ov-pblock ov-pblock-both">
            <h3>Criteria in both ({same.length})</h3>
            {same.length ? (
              <ul className="ov-clist">
                {same.map((g) => {
                  const as = crit(ca, g.a)
                  const bs = crit(cb, g.b)
                  const oneLine = text(as) === text(bs) && labels(as) === labels(bs)
                  return (
                    <li key={g.concept}>
                      <CritLine
                        label={labels(as) || conceptLabel(g.concept)}
                        detailed={detailed}
                        source={
                          oneLine ? (
                            text(as)
                          ) : (
                            <>
                              <span className="ov-src-line">
                                <b>{a}:</b> {labels(as)} · {text(as)}
                              </span>
                              <span className="ov-src-line">
                                <b>{b}:</b> {labels(bs)} · {text(bs)}
                              </span>
                            </>
                          )
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="ov-empty">No restriction selects the same patients in both.</p>
            )}
          </div>
          <div className="ov-pblock">
            <h3>Restricted differently ({diff.length})</h3>
            {diff.length ? (
              <ul className="ov-clist">
                {diff.map((g) => {
                  const as = crit(ca, g.a)
                  const bs = crit(cb, g.b)
                  return (
                    <li key={g.concept}>
                      {detailed && <span className="ov-crit-concept">{conceptLabel(g.concept)}</span>}
                      <span className="ov-vsline">
                        <CritLine label={labels(as)} detailed={detailed} source={text(as)} />
                        <span className="ov-vs"> vs </span>
                        <CritLine label={labels(bs)} detailed={detailed} source={text(bs)} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="ov-empty">None</p>
            )}
          </div>
          <div className="ov-pblock">
            <h3>
              Only in {a} ({onlyA.length})
            </h3>
            {onlyA.length ? (
              <ul className="ov-clist">
                {onlyA.map((c) => (
                  <li key={c.id}>
                    <CritLine label={c.label} kind={c.kind} detailed={detailed} source={stripHand(c.source)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ov-empty">
                None: {b} restricts everything {a} does.
              </p>
            )}
          </div>
          <div className="ov-pblock">
            <h3>
              Only in {b} ({onlyB.length})
            </h3>
            {onlyB.length ? (
              <ul className="ov-clist">
                {onlyB.map((c) => (
                  <li key={c.id}>
                    <CritLine label={c.label} kind={c.kind} detailed={detailed} source={stripHand(c.source)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ov-empty">
                None: {a} restricts everything {b} does.
              </p>
            )}
          </div>
        </div>
        <p className="ov-pd-foot">
          Criteria are matched by concept, the patient attribute each one restricts, not by name. "Restricted differently" means both trials restrict that
          attribute, in different ways ({a}'s version first).{' '}
          {unrev.length
            ? `${UNREVIEWED} ${unrev.map((t) => `${trialLabel(t)}'s`).join(' and ')} criteria come from the rule-based parse, not yet reviewed by a person.`
            : "Both trials' criteria were hand-encoded and reviewed."}{' '}
          {detailed
            ? `Source sentences from each trial's CT.gov eligibility text (${A.eligibility_source} for ${a}, ${B.eligibility_source} for ${b}). `
            : 'Hover or focus a criterion for its source sentence. '}
          {FOOT}
        </p>

        {detailed ? (
          <div className="ov-shared">
            <h3>{known ? `Shared sites (${int(p.shared_sites)})` : 'Shared sites'}</h3>
            {sharedSites}
          </div>
        ) : (
          <Details summary={known ? `Shared sites (${int(p.shared_sites)})` : 'Shared sites'}>{sharedSites}</Details>
        )}
      </div>
    </section>
  )
}

function SiteTable({ ids, sites, dateLabel, worldwide }: { ids: string[]; sites: Record<string, OverlapSite>; dateLabel: string; worldwide: boolean }) {
  return (
    <div className="table-scroll">
      <table className="tbl tbl-compact ov-sites-tbl">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col" className="num ov-count-col">
              Other sponsors' lung trials recruiting here on {dateLabel}
            </th>
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
  snapshot,
  worldwide,
  detailed,
  open,
  onToggle,
}: {
  t: OverlapTrial
  sites: Record<string, OverlapSite>
  snapshot: string
  worldwide: boolean
  detailed: boolean
  open: boolean
  onToggle: () => void
}) {
  const sitesId = useId()
  return (
    <li className="ov-trow">
      <div className="ov-trow-main">
        <div className="ov-trow-id">
          <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer">
            {t.nct_id}
          </a>
          {t.acronym && <span className="ov-trow-acr">{t.acronym}</span>}
          {(detailed || t.eligibility_source !== 'hand-encoded') && <SourceMark t={t} />}
          {t.upper_bound && (
            <Qualifier mark={UB} info={t.upper_bound_reasons.join('; ')}>
              Upper bound
            </Qualifier>
          )}
          {t.sparse_criteria && (
            <Qualifier tone="muted" info={`${plural(t.criteria.length, 'encoded criterion', 'encoded criteria')}: most synthetic patients pass them.`}>
              Sparse criteria
            </Qualifier>
          )}
          {t.no_criteria && <Qualifier info="The rule-based parse found no criteria, so overlap with this trial is not informative.">No criteria parsed</Qualifier>}
          {detailed && t.design && <span className="ov-trow-design">{DESIGN_LABEL[t.design] ?? t.design}</span>}
        </div>
        <p className="ov-trow-title">{t.title}</p>
      </div>
      <div className="ov-trow-facts">
        {detailed ? (
          <>
            <div>
              {phaseText(t.phases)} · started {shortDate(t.start_date)}
            </div>
            <div>
              Estimated window end <WindowEnd t={t} snapshot={snapshot} />
            </div>
            <div>
              CT.gov status at {shortDate(snapshot)}: <StatusNote t={t} snapshot={snapshot} />
            </div>
            <div>
              {sitesLabel(t.n_sites)} registered {worldwide ? 'worldwide' : 'in region'}
              {t.n_sites_anonymized > 0 && <span className="muted"> ({int(t.n_sites_anonymized)} anonymized)</span>}
            </div>
          </>
        ) : (
          <div>
            {phaseText(t.phases)} · {sitesLabel(t.n_sites)} registered {worldwide ? 'worldwide' : 'in region'}
            {t.n_sites_anonymized > 0 && <span className="muted"> ({int(t.n_sites_anonymized)} anonymized)</span>}
          </div>
        )}
      </div>
      <div className="ov-trow-count">
        {t.n_sites_identified === 0 ? (
          <div className="ov-count muted">Other sponsors' trials at its sites can't be counted: its sites are anonymized on CT.gov</div>
        ) : (
          <>
            <div className="ov-count">
              <strong className="num">{int(t.other_sponsor_trials_at_sites)}</strong> other sponsors' trials recruiting at its sites on this date
            </div>
            {detailed && <div className="ov-count-sub">{int(t.other_sponsor_trials_at_sites_industry)} of them industry-sponsored</div>}
          </>
        )}
        {t.n_sites > 0 && (
          <button type="button" className="btn btn-small ov-sites-btn" onClick={onToggle} aria-expanded={open} aria-controls={open ? sitesId : undefined}>
            {open ? 'Hide sites' : `Per-site counts (${int(t.n_sites)})`}
          </button>
        )}
      </div>
      {open && (
        <div className="ov-trow-sites" id={sitesId}>
          <SiteTable ids={t.site_ids} sites={sites} dateLabel="this date" worldwide={worldwide} />
        </div>
      )}
    </li>
  )
}

/** The full legend and the definitions (C mockup, Detailed), with the method notes that used to be the provenance list.
 *  Inline in Detailed; in a "Details" disclosure in Simple. */
function LegendDefs({ data, theme, detailed }: { data: OverlapAudit; theme: 'light' | 'dark'; detailed: boolean }) {
  const lid = useId()
  const did = useId()
  return (
    <div className="ov-defs">
      <section aria-labelledby={lid} className="ov-defs-col">
        <h2 id={lid}>Legend</h2>
        <dl className="ov-dlrows">
          {!detailed && (
            <div>
              <dt>Each pair once</dt>
              <dd>
                The matrix is symmetric, so this view shows each pair once, above the diagonal. Detailed shows both directions in every cell, and each
                trial's registered sites on the diagonal.
              </dd>
            </div>
          )}
          <div>
            <dt>Number</dt>
            <dd>Registered sites both trials list on ClinicalTrials.gov.</dd>
          </div>
          {detailed ? (
            <div>
              <dt>
                <span className="num">a% / b%</span>
              </dt>
              <dd>Share of the row trial's eligible patients who also qualify for the column trial, then the reverse, on a synthetic population.</dd>
            </div>
          ) : (
            <div>
              <dt>Both ways</dt>
              <dd>In a pair's card: the share of each trial's eligible patients who also qualify for the other, on a synthetic population.</dd>
            </div>
          )}
          <div>
            <dt>No number</dt>
            <dd>A trial lists only anonymized sites on ClinicalTrials.gov, so shared sites can't be counted. Unknown, not zero.</dd>
          </div>
          <div>
            <dt>Shade</dt>
            <dd>
              The larger share of one trial's eligible patients who also qualify for the other, on a synthetic population.{' '}
              {theme === 'dark' ? 'Brighter' : 'Darker'} means more.
            </dd>
          </div>
          <div>
            <dt>Dot</dt>
            <dd>80% or more, one way: the larger of the two shares is at least 80% as shown.</dd>
          </div>
          <div>
            <dt>Hatched, or —</dt>
            <dd>No criteria are encoded for one of the trials, so the eligibility overlap is not informative.</dd>
          </div>
          <div>
            <dt>
              <span aria-hidden="true">{UB} </span>Upper bound
            </dt>
            <dd>A ceiling, because a trial has a restriction the synthetic population can't represent.</dd>
          </div>
          <div>
            <dt>
              <span aria-hidden="true">{UNREVIEWED} </span>Unreviewed
            </dt>
            <dd>
              At least one trial's criteria come from our rule-based parse and have not been reviewed. The parse never sets the Upper bound mark, so a missing
              mark here does not mean the share is exact.
            </dd>
          </div>
          <div>
            <dt>Unreviewed criteria</dt>
            <dd>On a row or column header: this trial's criteria come from the rule-based parse.</dd>
          </div>
          <div>
            <dt>Sparse criteria</dt>
            <dd>A trial with 2 or fewer encoded criteria admits most patients, so overlap with it says little.</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby={did} className="ov-defs-col">
        <h2 id={did}>Definitions and sources</h2>
        <dl className="ov-dlrows">
          <div>
            <dt>Registered site</dt>
            <dd>
              A site listed for the trial on ClinicalTrials.gov. Being listed does not mean the site is enrolling. Site lists are as registered at the snapshot
              (site activation dates are not public); sites withdrawn from a trial are dropped.
            </dd>
          </div>
          <div>
            <dt>Shared sites</dt>
            <dd>
              Identifiable registered sites on both trials. Sites registered anonymously (“Research Site”) are collapsed to one pseudo-site per city and are
              never counted as shared.
            </dd>
          </div>
          <div>
            <dt>Synthetic population</dt>
            <dd>
              {int(data.population.n)} simulated advanced-NSCLC patients. Prevalences are rounded modeling assumptions, not patient data.
            </dd>
          </div>
          <div>
            <dt>Eligibility criteria</dt>
            <dd>
              Hand-encoded from each trial's CT.gov text where available (reviewed), otherwise taken from a rule-based parse (unreviewed, {UNREVIEWED}).
            </dd>
          </div>
          <div>
            <dt>Recruiting on the date</dt>
            <dd>
              On the snapshot ({longDate(data.snapshot_date)}, the ClinicalTrials.gov download): status Recruiting or Enrolling by invitation. An earlier date
              is estimated: from the registered start to start + 65% of the time to the registered primary completion (the 65% is an assumption), bounded by
              the status at the snapshot. A trial still recruiting then counts from its start; any other status means enrollment closed by the snapshot;
              withdrawn and not-yet-recruiting trials never count. Later dates are refused: nothing is projected.
            </dd>
          </div>
          <div>
            <dt>Months both recruiting</dt>
            <dd>Overlap of the two bounded windows, never past the snapshot. Estimated.</dd>
          </div>
          <div>
            <dt>Criteria compared</dt>
            <dd>Matched by concept (the patient attribute restricted; driver-mutation requirements are one concept), not by name.</dd>
          </div>
          <div>
            <dt>
              <span aria-hidden="true">{UB} </span>Upper bound
            </dt>
            <dd>
              A required biomarker or cohort restriction the synthetic population can't represent (or another restriction it does not model), so the overlap
              shown is a ceiling on the modeled populations, not a measurement. The rule-based parse never sets this flag, so an unflagged {UNREVIEWED} pair
              is unreviewed, not verified.
            </dd>
          </div>
          <div>
            <dt>Other sponsors' trials</dt>
            <dd>
              Distinct lung trials of other lead sponsors (any sponsor class, any phase) recruiting on the date at a trial's identifiable registered sites. A
              count, not an effect.
            </dd>
          </div>
          <div>
            <dt>Not shown</dt>
            <dd>No speedup, time-to-fill or enrollment rate is shown or implied, and no date after the registry snapshot: this view counts and compares.</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
