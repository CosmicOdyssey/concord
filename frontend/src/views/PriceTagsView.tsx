import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DEFAULT_SCENARIO, scenarioKey, type PriceTags, type SlotValue } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Gloss, InfoTip, Loading, NeedsClear, Qualifier, RunLine, Section } from '../components'
import { useDensity } from '../density'
import { EligBadge } from './ClearView'
import { ctgovUrl, int, num, phaseLabel, siteName, times, trialName } from '../format'
import { InSampleLine, InSampleMark, RsHead } from './researchParts'

interface Props {
  clear: ClearState
  selected: string | null
  setSelected: (nct: string | null) => void
}

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

/** "−3.2 mo" when dropping the criterion shortens the modeled time, "+0.4 mo" when it lengthens it. */
function signed(m: number): string {
  return `${m > 0 ? '−' : m < 0 ? '+' : ''}${num(Math.abs(m))}`
}

export default function PriceTagsView({ clear, selected, setSelected }: Props) {
  const r = clear.result
  const solved = clear.solvedParams
  const simple = useDensity().density === 'simple'
  const tagsCache = useRef(new Map<string, PriceTags>())
  const slotsCache = useRef(new Map<string, SlotValue[]>())
  const [tags, setTags] = useState<Async<PriceTags>>({ status: 'idle' })
  const [slots, setSlots] = useState<Async<SlotValue[]>>({ status: 'idle' })
  const [reloadTick, setReloadTick] = useState(0)
  const slotAbort = useRef<AbortController | null>(null)

  const trials = useMemo(
    () => (r ? [...r.trials].sort((a, b) => (a.acronym ?? a.nct_id).localeCompare(b.acronym ?? b.nct_id)) : []),
    [r],
  )
  const trial = r?.trials.find((t) => t.nct_id === selected) ?? null
  const pkey = solved ? scenarioKey(solved) : ''

  useEffect(() => {
    if (!solved || !trial) {
      setTags({ status: 'idle' })
      return
    }
    const key = `${pkey}|${trial.nct_id}`
    const hit = tagsCache.current.get(key)
    if (hit) {
      setTags({ status: 'ok', data: hit })
      return
    }
    const ctl = new AbortController()
    setTags({ status: 'loading' })
    api
      .priceTags(trial.nct_id, solved, ctl.signal)
      .then((d) => {
        tagsCache.current.set(key, d)
        setTags({ status: 'ok', data: d })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setTags({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [pkey, solved, trial, reloadTick])

  useEffect(() => {
    const hit = slotsCache.current.get(pkey)
    setSlots(hit ? { status: 'ok', data: hit } : { status: 'idle' })
    return () => slotAbort.current?.abort()
  }, [pkey])

  const loadSlots = () => {
    if (!solved) return
    slotAbort.current?.abort()
    const ctl = new AbortController()
    slotAbort.current = ctl
    const key = pkey
    setSlots({ status: 'loading' })
    api
      .slotValues(solved, ctl.signal)
      .then((d) => {
        slotsCache.current.set(key, d)
        setSlots({ status: 'ok', data: d })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSlots({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
  }

  if (!r || !solved) {
    if (clear.loading) return <Loading label={`Clearing ${clear.pendingParams?.region ?? ''}…`} />
    return (
      <>
        {clear.error && <ErrorBox error={clear.error} onRetry={() => clear.run(DEFAULT_SCENARIO)} />}
        <NeedsClear onRun={() => clear.run(DEFAULT_SCENARIO)} busy={clear.loading} />
      </>
    )
  }

  const tagData = tags.status === 'ok' ? tags.data : null
  const maxTrialSaved = tagData ? Math.max(0.01, ...tagData.criteria.map((c) => Math.abs(c.months_saved_trial))) : 1
  const eligSource = tagData?.eligibility_source ?? trial?.eligibility_source ?? 'unknown'

  return (
    <section className="view rs-view">
      <RsHead
        title="What each eligibility criterion costs"
        lede="For one trial, drop each parsed criterion in turn, recompute the eligible pool and overlaps, and re-clear. The result is a price tag in months of enrollment."
      >
        <InSampleLine>Price tags are modeled months, not observed enrollment.</InSampleLine>
        <RunLine params={solved} stale={clear.loading} />
      </RsHead>

      <div className="card controls rs-controls">
        <label className="field field-wide">
          <span className="field-label">
            Trial ({trials.length} in {solved.region})
          </span>
          <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
            <option value="">Select a trial…</option>
            {trials.map((t) => (
              <option key={t.nct_id} value={t.nct_id}>
                {trialName(t)}
                {t.sponsor ? ` · ${t.sponsor}` : ''}
                {t.flagged ? ' · background (excluded)' : !t.movable ? ' · background' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected && !trial && (
        <div className="empty">
          <p>
            {selected} is not in the {solved.region} instance. Pick a trial from this region.
          </p>
        </div>
      )}

      {trial && (
        <div className="card trial-head">
          <div className="trial-head-top">
            <a href={ctgovUrl(trial.nct_id)} target="_blank" rel="noreferrer" className="strong">
              {trialName(trial)}
            </a>
            {trial.flagged && <Badge tone="warn">background (excluded)</Badge>}
            {!trial.flagged && !trial.movable && <Badge tone="neutral">background</Badge>}
            <EligBadge source={trial.eligibility_source} />
            <span className="muted small">
              {phaseLabel(trial.phases)} · {trial.sponsor ?? 'sponsor unknown'}
            </span>
          </div>
          <p className="small">{trial.title}</p>
          <div className="kv-row small tnum">
            <span>
              T registered <strong>{num(trial.T_actual)}</strong> mo
            </span>
            <span>
              T best response <strong>{num(trial.T_indep)}</strong> mo
            </span>
            <span>
              T coordinated <strong>{num(trial.T_coord)}</strong> mo
            </span>
            <span>
              T joint optimum <strong>{num(trial.T_coord_free)}</strong> mo
            </span>
            <span>
              regional target <strong>{num(trial.target_region)}</strong> pts
            </span>
            <span>
              eligible fraction (synthetic) <strong>{num(trial.f !== null ? trial.f * 100 : null, 1)}%</strong>
            </span>
          </div>
          <p className="rs-qual-line rs-qual-muted">
            <InSampleMark />: T = months to fill the regional target, <Gloss term="scored-by-model">scored by our enrollment model</Gloss>.
            The eligible fraction is computed on the <Gloss term="synthetic-population">synthetic population</Gloss>.
          </p>
        </div>
      )}

      {trial && tags.status === 'loading' && (
        <Loading label="Re-clearing once per criterion…" hint="Often 20 s or more: the backend re-solves the market once per relaxation." />
      )}
      {trial && tags.status === 'error' && <ErrorBox error={tags.error} onRetry={() => setReloadTick((x) => x + 1)} />}

      {tagData && (
        <Section
          id="rs-tags"
          title={`Price tags · ${tagData.criteria.length} parsed criteria`}
          lede={
            <>
              How this trial’s modeled time to fill changes if each criterion is dropped, against a reference re-solve of the joint optimum
              (T = <span className="num rs-fig">{num(tagData.T_coord)}</span> months). − means a shorter modeled time.
            </>
          }
          qualifiers={
            <p className="rs-qual-line">
              <InSampleMark /> · <Gloss term="scored-by-model">scored by our enrollment model</Gloss> ·{' '}
              <Qualifier tone="muted">Eligibility: {eligSource}</Qualifier>; review parsed criteria against the source text.
            </p>
          }
          details={
            <>
              {tagData.alternatives_not_priced && tagData.alternatives_not_priced.length > 0 && (
                <p className="muted small">
                  Not priced (one of several OR’ed alternatives; dropping it narrows the pool rather than relaxing it):{' '}
                  {tagData.alternatives_not_priced.join(', ')}.
                </p>
              )}
              <Caveat>
                {tagData.note} The months are relative to this trial’s time in a reference re-solve of the joint optimum (T ={' '}
                {num(tagData.T_coord)} months), and the relaxed market is re-solved with the same deterministic procedure, so solver
                progress is not credited to the criterion. “Pool” is the eligible-population multiplier from dropping the criterion.
                Eligibility: {eligSource}; review parsed criteria against the source text.
              </Caveat>
            </>
          }
          detailsLabel="Details: method and unpriced criteria"
        >
          {tagData.criteria.length === 0 && <p className="muted">No criteria were parsed from this trial’s CT.gov text.</p>}
          {simple ? (
            <ul className="tags">
              {tagData.criteria.map((c) => {
                const w = (100 * Math.abs(c.months_saved_trial)) / maxTrialSaved
                return (
                  <li key={c.id} className="rs-tag-simple">
                    <div className="tag-title">
                      <span className="strong">{c.label}</span>
                      <Qualifier tone="muted">{c.kind}</Qualifier>
                      {c.pool_multiplier === 1 && <Qualifier tone="muted">· pool unchanged</Qualifier>}
                      <InfoTip
                        label={`Details: ${c.label}`}
                        content={
                          <>
                            <span className="hc-title">{c.label}</span>“{c.source}”
                            <span className="hc-src">
                              Portfolio {num(c.months_saved_portfolio)} trial-mo · pool {times(c.pool_multiplier)} · source sentence from
                              ClinicalTrials.gov
                            </span>
                          </>
                        }
                      />
                    </div>
                    <div className="rs-tag-num">
                      <span className={c.months_saved_trial > 0 ? 'pos' : c.months_saved_trial < 0 ? 'neg' : ''}>
                        {signed(c.months_saved_trial)} mo
                      </span>{' '}
                      <span className="muted small">this trial, modeled</span>
                      <div className="minibar" aria-hidden="true">
                        <span style={{ width: `${w}%` }} className={c.months_saved_trial < 0 ? 'minibar-neg' : ''} />
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul className="tags">
              {tagData.criteria.map((c) => {
                const w = (100 * Math.abs(c.months_saved_trial)) / maxTrialSaved
                return (
                  <li key={c.id} className="tag">
                    <div className="tag-main">
                      <div className="tag-title">
                        <span className="strong">{c.label}</span>
                        <Badge tone={c.kind === 'exclusion' ? 'bad' : 'ok'}>{c.kind}</Badge>
                        {c.pool_multiplier === 1 && (
                          <Badge tone="neutral" title="Dropping this criterion does not change the synthetic eligible pool">
                            pool unchanged
                          </Badge>
                        )}
                      </div>
                      <blockquote className="source" title="Source sentence from ClinicalTrials.gov eligibility text">
                        “{c.source}”
                      </blockquote>
                    </div>
                    <div className="tag-nums tnum">
                      <div>
                        <span className="muted small">this trial, if relaxed</span>
                        <div className={c.months_saved_trial > 0 ? 'pos strong' : c.months_saved_trial < 0 ? 'neg strong' : 'strong'}>
                          {signed(c.months_saved_trial)} mo
                        </div>
                        <div className="minibar" aria-hidden="true">
                          <span style={{ width: `${w}%` }} className={c.months_saved_trial < 0 ? 'minibar-neg' : ''} />
                        </div>
                      </div>
                      <div>
                        <span className="muted small">portfolio</span>
                        <div>{num(c.months_saved_portfolio)} trial-mo</div>
                      </div>
                      <div>
                        <span className="muted small">pool</span>
                        <div>{times(c.pool_multiplier)}</div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}

      {!trial && !selected && (
        <div className="empty">
          <p>Select a trial above, or click a row in the “Clear it” table.</p>
        </div>
      )}

      <Section
        id="rs-slots"
        title="Slot values"
        lede="Portfolio trial-months by one more concurrent-trial slot at sites already at capacity in the cleared joint optimum (up to 12, highest enrollment rate first)."
        qualifiers={
          <p className="rs-qual-line">
            <InSampleMark /> · <Gloss term="scored-by-model">scored by our enrollment model</Gloss>. Each is compared with the same
            deterministic re-solve of the unchanged market.
          </p>
        }
      >
        <div className="rs-slot-action">
          <button className="btn" onClick={loadSlots} disabled={slots.status === 'loading'}>
            {slots.status === 'ok' ? 'Recompute' : 'Compute slot values'}
          </button>
        </div>
        {slots.status === 'loading' && <Loading label="Re-clearing once per candidate site…" hint="Often 20 s or more." />}
        {slots.status === 'error' && <ErrorBox error={slots.error} onRetry={loadSlots} />}
        {slots.status === 'ok' && slots.data.length === 0 && <p className="muted">No site is at capacity in this allocation.</p>}
        {slots.status === 'ok' && slots.data.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="num">Capacity</th>
                    <th className="num">Hist. rate (pts/mo)</th>
                    <th className="num">n hist</th>
                    <th className="num" title="Portfolio trial-months, model estimate, in-sample">
                      Trial-months (model)
                    </th>
                    <th className="bar-col" />
                  </tr>
                </thead>
                <tbody>
                  {slots.data.map((s) => {
                    const max = Math.max(0.01, ...slots.data.map((x) => x.months_saved))
                    return (
                      <tr key={s.site_id}>
                        <td>
                          <span>{siteName(s)}</span> {s.is_amc && <Badge tone="neutral">AMC</Badge>}
                        </td>
                        <td className="num">{int(s.k)}</td>
                        <td className="num" title={s.lam_ci ? `80% interval ${num(s.lam_ci[0], 2)}–${num(s.lam_ci[1], 2)}` : ''}>
                          {num(s.lam_hist, 2)}
                          {s.lam_ci && (
                            <span className="muted small">
                              {' '}
                              [{num(s.lam_ci[0], 2)}–{num(s.lam_ci[1], 2)}]
                            </span>
                          )}
                        </td>
                        <td className="num">{int(s.n_hist)}</td>
                        <td className="num strong">{num(s.months_saved)}</td>
                        <td className="bar-col">
                          <div className="minibar">
                            <span style={{ width: `${(100 * Math.max(0, s.months_saved)) / max}%` }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Hist. rate = fitted patients per month per trial at the site (posterior mean; bracket = 10th–90th percentile), from n hist
              past trials at the site.
            </p>
          </>
        )}
      </Section>
    </section>
  )
}
