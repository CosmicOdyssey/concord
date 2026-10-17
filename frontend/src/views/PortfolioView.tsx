import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { api, REGENERON_PRESET, type Scenario, type SponsorCount } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Gloss, Loading, Qualifier, RunLine, Section } from '../components'
import { useDensity } from '../density'
import { ALLOC_HINT, ALLOC_LABEL, ctgovUrl, int, num, phaseLabel, signedMonths, siteName, trialName } from '../format'
import { atLeast, backgroundSlowerMaterial, DecompositionTable, HeadlineStats, InSampleResult, materialMonths } from '../summary'
import { EligBadge, saved } from './ClearView'
import { InSampleLine, InSampleMark, RsHead } from './researchParts'

interface Props {
  clear: ClearState
  regions: string[]
  form: Scenario
  setForm: Dispatch<SetStateAction<Scenario>>
  onOpenTrial: (nct: string) => void
}

export default function PortfolioView({ clear, regions, form, setForm, onOpenTrial }: Props) {
  const [sponsors, setSponsors] = useState<SponsorCount[] | null>(null)
  const [sponsorErr, setSponsorErr] = useState<string | null>(null)
  const simple = useDensity().density === 'simple'
  const r = clear.result
  const isPortfolio = !!r?.params.sponsor

  useEffect(() => {
    const ctl = new AbortController()
    setSponsorErr(null)
    api
      .sponsors(form.region, form.as_of, ctl.signal)
      .then(setSponsors)
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSponsorErr(e instanceof Error ? e.message : String(e))
      })
    return () => ctl.abort()
  }, [form.region, form.as_of])

  const own = useMemo(() => (r && isPortfolio ? r.trials.filter((t) => t.movable) : []), [r, isPortfolio])
  const ownFlagged = useMemo(
    () =>
      r && isPortfolio
        ? r.trials.filter((t) => t.flagged && (t.sponsor ?? '').toLowerCase().includes((r.params.sponsor ?? '').toLowerCase()))
        : [],
    [r, isPortfolio],
  )

  // Registered sites shared by two or more of the sponsor's movable trials.
  const shared = useMemo(() => {
    if (!r || own.length === 0) return []
    const ownIds = new Set(own.map((t) => t.nct_id))
    const bySite = new Map<string, string[]>()
    for (const [s, t] of r.assignments.actual) {
      if (!ownIds.has(t)) continue
      const l = bySite.get(s) ?? []
      l.push(t)
      bySite.set(s, l)
    }
    const siteIdx = new Map(r.sites.map((s) => [s.site_id, s]))
    const trialIdx = new Map(r.trials.map((t) => [t.nct_id, t]))
    return [...bySite.entries()]
      .filter(([, l]) => l.length >= 2)
      .map(([sid, l]) => ({ site: siteIdx.get(sid), trials: l.map((id) => trialIdx.get(id)) }))
      .filter((x) => x.site)
      .sort((a, b) => b.trials.length - a.trials.length || (a.site?.facility ?? '').localeCompare(b.site?.facility ?? ''))
  }, [r, own])

  const sponsorInList = sponsors?.some((s) => s.sponsor === form.sponsor)

  return (
    <section className="view rs-view">
      <RsHead
        title="Portfolio mode"
        lede="Clear one sponsor’s concurrent trials across its own registered sites, with every other trial held fixed as background. This is the version a single sponsor can act on today."
      >
        <InSampleLine />
      </RsHead>

      <div className="card controls rs-controls">
        <div className="controls-row">
          <label className="field">
            <span className="field-label">Region</span>
            <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
              {regions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">As of</span>
            <input type="date" value={form.as_of ?? ''} onChange={(e) => setForm({ ...form, as_of: e.target.value || null })} />
          </label>
          <label className="field field-wide">
            <span className="field-label">Sponsor</span>
            <select value={form.sponsor ?? ''} onChange={(e) => setForm({ ...form, sponsor: e.target.value || null })}>
              <option value="">Select a sponsor…</option>
              {form.sponsor && !sponsorInList && <option value={form.sponsor}>{form.sponsor} (name match)</option>}
              {(sponsors ?? []).map((s) => (
                <option key={s.sponsor} value={s.sponsor}>
                  {s.sponsor} · {s.trials} trials
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="controls-row">
          <button className="btn btn-primary" disabled={!form.sponsor || clear.loading} onClick={() => clear.run(form)}>
            {clear.loading ? 'Clearing…' : 'Clear this portfolio'}
          </button>
          <button
            className="btn"
            disabled={clear.loading}
            onClick={() => {
              setForm(REGENERON_PRESET)
              clear.run(REGENERON_PRESET)
            }}
          >
            Preset: Regeneron, Sept 2024
          </button>
          <span className="muted small">US-wide clears take about 25 s.</span>
        </div>
        {sponsorErr && <ErrorBox error={sponsorErr} />}
        <p className="muted small">
          Sponsors with two or more concurrent industry Phase II/III lung trials {form.as_of ? `on ${form.as_of}` : 'recruiting today'}.
          Counts come from /api/sponsors and are for trials with sites in {form.region}. The sponsor name is matched as a case-insensitive
          substring, so “Regeneron” matches “Regeneron Pharmaceuticals”.
        </p>
      </div>

      {clear.loading && <Loading label={`Clearing ${clear.pendingParams?.region} · ${clear.pendingParams?.sponsor ?? 'all sponsors'}…`} />}
      {clear.error && !clear.loading && <ErrorBox error={clear.error} onRetry={() => clear.run(form)} />}

      {r && !isPortfolio && !clear.loading && (
        <div className="empty">
          <p>The current result clears the whole market. Pick a sponsor and clear its portfolio, or use the preset.</p>
        </div>
      )}

      {r && isPortfolio && (
        <>
          <RunLine params={r.params} stale={clear.loading} />
          {own.length === 0 ? (
            <div className="empty">
              <p>
                No movable trials matched “{r.params.sponsor}” in {r.params.region}
                {r.params.as_of ? ` on ${r.params.as_of}` : ''}.
                {ownFlagged.length > 0 && <> {ownFlagged.length} matched but are held out as background (implausible model time).</>}
              </p>
            </div>
          ) : (
            <>
              <InSampleResult
                r={r}
                qualifiers={
                  <p className="rs-qual-line">
                    <Qualifier>Other sponsors’ trials:</Qualifier> {int(r.summary.background_trials)} other trials are held fixed at their
                    registered sites. Under the joint optimum with losers allowed, <strong>{int(backgroundSlowerMaterial(r))}</strong> of them
                    would enroll more slowly by {atLeast(materialMonths(r.summary.coord_free_vs_actual), true)} (
                    {int(r.summary.background_worse_under_coord_free)} by any amount) because this portfolio moves onto their sites. The
                    capped allocation holds every trial, background included, at its registered time under the same rates (in-sample
                    only).
                  </p>
                }
                details={
                  <>
                    <HeadlineStats r={r} />
                    {simple && (
                      <>
                        <h3>Decomposition</h3>
                        <DecompositionTable r={r} compact />
                      </>
                    )}
                  </>
                }
              />
              {!simple && (
                <Section title="Decomposition" lede="The same five comparisons as Clear it, over this sponsor’s trials only. All in-sample.">
                  <DecompositionTable r={r} compact />
                </Section>
              )}

              <Section
                title={`${r.params.sponsor}’s trials (${own.length}${ownFlagged.length > 0 ? ` + ${ownFlagged.length} held out` : ''})`}
                lede="Model-estimated months to fill each trial’s regional target under each allocation. Click a row for that trial’s criterion price tags."
                qualifiers={
                  <p className="rs-qual-line">
                    <InSampleMark /> · <Gloss term="scored-by-model">scored by our enrollment model</Gloss>, not observed enrollment.
                  </p>
                }
                details={
                  <>
                    <div className="table-scroll">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Trial</th>
                            <th className="num">Regional target</th>
                            <th className="num">Sites</th>
                            <th className="num" title={ALLOC_HINT.actual}>
                              {ALLOC_LABEL.actual}
                            </th>
                            <th className="num" title={ALLOC_HINT.indep}>
                              {ALLOC_LABEL.indep}
                            </th>
                            <th className="num" title={ALLOC_HINT.coord}>
                              {ALLOC_LABEL.coord}
                            </th>
                            <th className="num" title={ALLOC_HINT.coord_free}>
                              {ALLOC_LABEL.coord_free}
                            </th>
                            <th className="num" title="Registered minus coordinated (no losers): model estimate, in-sample">
                              Difference (mo)
                            </th>
                            <th className="num" title="Realized enrollment window, only for trials finished by a past as-of date">
                              Realized
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {own.map((t) => (
                            <tr
                              key={t.nct_id}
                              className="clickable"
                              tabIndex={0}
                              onClick={() => onOpenTrial(t.nct_id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') onOpenTrial(t.nct_id)
                              }}
                            >
                              <td className="trial-cell">
                                <div className="trial-id">
                                  <a href={ctgovUrl(t.nct_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                    {trialName(t)}
                                  </a>
                                </div>
                                <div className="muted small trunc" title={t.title}>
                                  {phaseLabel(t.phases)} · {t.title}
                                </div>
                                <EligBadge source={t.eligibility_source} />
                              </td>
                              <td className="num">{num(t.target_region)}</td>
                              <td className="num nowrap">
                                {int(t.sites_actual)} → {int(t.sites_coord)}
                              </td>
                              <td className="num">{num(t.T_actual)}</td>
                              <td className="num">{num(t.T_indep)}</td>
                              <td className="num">{num(t.T_coord)}</td>
                              <td className="num">{num(t.T_coord_free)}</td>
                              <td className="num pos">{signedMonths(saved(t))}</td>
                              <td className="num">{num(t.realized_window_months)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted small">
                      Months (model estimates, in-sample). Sites = registered → coordinated (no losers). Difference = Registered − Coordinated
                      (no losers). Realized shows “—” when the trial had not finished enrolling.
                    </p>
                  </>
                }
                detailsLabel={`Show the trials table (${own.length})`}
              />

              <Section
                title="Shared registered sites"
                lede={
                  shared.length === 0 ? (
                    'None: no site is registered by more than one of these trials.'
                  ) : (
                    <>
                      {int(shared.length)} <Gloss term="registered-site">registered sites</Gloss> are listed by two or more of these trials.
                    </>
                  )
                }
                details={
                  shared.length > 0 ? (
                    <div className="table-scroll">
                      <table className="tbl tbl-compact">
                        <thead>
                          <tr>
                            <th>Site</th>
                            <th className="num">Trials</th>
                            <th>Which</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shared.map(({ site, trials }) => (
                            <tr key={site!.site_id}>
                              <td>
                                {siteName(site!)} {site!.is_amc && <Badge tone="neutral">AMC</Badge>}
                              </td>
                              <td className="num">{trials.length}</td>
                              <td className="small">{trials.map((t) => (t ? trialName(t) : '?')).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : undefined
                }
                detailsLabel={`Show the ${int(shared.length)} shared sites`}
              />
              <Caveat>
                Portfolio clearing only reassigns this sponsor’s trials among its own registered sites; other sponsors’ trials stay
                where they registered. Times are model estimates for the regional slice of each trial.
              </Caveat>
            </>
          )}
        </>
      )}
    </section>
  )
}
