import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DEFAULT_PARAMS, isDefaultSolve, type TermSheet } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, Loading, NeedsClear, RunLine, Stat } from '../components'
import { ctgovUrl, num, siteName, trialName, usd } from '../format'

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; data: T }

const CAP_LABEL: Record<string, string> = {
  central_imaging_upload: 'Central imaging upload',
  central_lab_shipping: 'Central lab shipping',
  ct: 'CT',
  ecg: 'ECG',
  infusion: 'Infusion chairs',
  ip_pharmacy: 'Investigational pharmacy',
  mri: 'MRI',
  pk_processing: 'PK sample processing',
  tissue_handling: 'Tissue handling',
}

function unitLabel(u: string): string {
  return u.replace(/_/g, ' ')
}

export default function TermsView({ clear }: { clear: ClearState }) {
  const r = clear.result
  const solved = clear.solvedParams
  const [siteId, setSiteId] = useState<string>('')
  const [nctId, setNctId] = useState<string>('')
  const [sheet, setSheet] = useState<Async<TermSheet>>({ status: 'idle' })
  const [tick, setTick] = useState(0)
  const cache = useRef(new Map<string, TermSheet>())

  const { siteOptions, trialsBySite } = useMemo(() => {
    const bySite = new Map<string, string[]>()
    for (const [s, t] of r?.assignments.coord ?? []) {
      const list = bySite.get(s) ?? []
      list.push(t)
      bySite.set(s, list)
    }
    const siteIdx = new Map(r?.sites.map((s) => [s.site_id, s]) ?? [])
    const opts = [...bySite.keys()]
      .map((id) => siteIdx.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => b.load_coord - a.load_coord || a.facility.localeCompare(b.facility))
    return { siteOptions: opts, trialsBySite: bySite }
  }, [r])
  const trialIdx = useMemo(() => new Map(r?.trials.map((t) => [t.nct_id, t]) ?? []), [r])

  // Default to the busiest coordinated site and its first trial; reset when the run changes.
  useEffect(() => {
    if (siteOptions.length === 0) return
    if (!siteId || !trialsBySite.has(siteId)) {
      const s = siteOptions[0].site_id
      setSiteId(s)
      setNctId(trialsBySite.get(s)?.[0] ?? '')
    } else if (!trialsBySite.get(siteId)?.includes(nctId)) {
      setNctId(trialsBySite.get(siteId)?.[0] ?? '')
    }
  }, [siteOptions, trialsBySite, siteId, nctId])

  const region = solved?.region ?? ''
  useEffect(() => {
    if (!siteId || !nctId || !region) return
    const key = `${region}|${siteId}|${nctId}`
    const hit = cache.current.get(key)
    if (hit) {
      setSheet({ status: 'ok', data: hit })
      return
    }
    const ctl = new AbortController()
    setSheet({ status: 'loading' })
    api
      .termsheet(siteId, nctId, region, ctl.signal)
      .then((d) => {
        cache.current.set(key, d)
        setSheet({ status: 'ok', data: d })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSheet({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [siteId, nctId, region, tick])

  if (!r || !solved) {
    if (clear.loading) return <Loading label={`Clearing ${clear.pendingParams?.region ?? ''}…`} />
    return (
      <>
        {clear.error && <ErrorBox error={clear.error} onRetry={() => clear.run(DEFAULT_PARAMS)} />}
        <NeedsClear onRun={() => clear.run(DEFAULT_PARAMS)} busy={clear.loading} />
      </>
    )
  }

  const trial = trialIdx.get(nctId)
  const ts = sheet.status === 'ok' ? sheet.data : null
  const b = ts?.budget

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1>Pre-cleared terms</h1>
          <p className="lede tagline">This is what replaces the negotiation.</p>
          <p className="lede">
            Every coordinated match comes with its terms already attached: a capability check, a coverage analysis
            (routine care vs research), a budget from a public rate card, and a standard agreement.
          </p>
        </div>
        <RunLine params={solved} stale={clear.loading} />
      </div>

      <div className="card controls">
        <div className="controls-row">
          <label className="field field-wide">
            <span className="field-label">Coordinated site ({siteOptions.length} used)</span>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {siteOptions.map((s) => (
                <option key={s.site_id} value={s.site_id}>
                  {siteName(s)} · {s.load_coord} trial{s.load_coord === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-wide">
            <span className="field-label">Trial matched to it</span>
            <select value={nctId} onChange={(e) => setNctId(e.target.value)}>
              {(trialsBySite.get(siteId) ?? []).map((id) => {
                const t = trialIdx.get(id)
                return (
                  <option key={id} value={id}>
                    {t ? trialName(t) : id}
                    {t?.sponsor ? ` · ${t.sponsor}` : ''}
                  </option>
                )
              })}
            </select>
          </label>
        </div>
        {!isDefaultSolve(solved) && (
          <p className="note small">
            The term-sheet endpoint takes only the region, so expected patients come from the default-assumption clearing
            of {solved.region}. If this match is not in that allocation, the backend substitutes a placeholder of 10
            patients.
          </p>
        )}
      </div>

      {sheet.status === 'loading' && <Loading label="Building term sheet…" />}
      {sheet.status === 'error' && <ErrorBox error={sheet.error} onRetry={() => setTick((x) => x + 1)} />}

      {ts && b && (
        <>
          <div className="card">
            <div className="kv-grid">
              <div>
                <div className="field-label">Site</div>
                <div className="strong">{ts.site.facility}</div>
                <div className="muted small">
                  {[ts.site.city, ts.site.state, ts.site.zip].filter(Boolean).join(', ')}
                  {ts.site.is_amc ? ' · academic center' : ''}
                </div>
              </div>
              <div>
                <div className="field-label">Trial (sets expected patients)</div>
                {trial ? (
                  <a href={ctgovUrl(trial.nct_id)} target="_blank" rel="noreferrer" className="strong">
                    {trialName(trial)}
                  </a>
                ) : (
                  <span>{nctId}</span>
                )}
                <div className="muted small">{trial?.sponsor ?? ''}</div>
              </div>
              <div>
                <div className="field-label">Protocol (schedule of assessments)</div>
                <div className="strong">{ts.protocol.title}</div>
                <div className="muted small">
                  Demo protocol <code>{ts.protocol.id}</code>, not the selected trial’s own protocol.
                </div>
              </div>
            </div>
          </div>

          <div className="stats stats-3">
            <Stat label="Expected patients at this site" value={num(ts.expected_patients)} sub="From the trial’s cleared allocation (model estimate)" />
            <Stat label="Per-patient budget" value={usd(b.per_patient_total)} sub="Sponsor-paid procedures + per-patient items" />
            <Stat emphasis label="Expected site total" value={usd(ts.expected_site_total)} sub="Per-site fixed items + per-patient × expected patients" />
          </div>

          <div className="card">
            <div className="section-head">
              <h2>Capability check</h2>
              {ts.capability_ok ? <Badge tone="ok">all requirements met</Badge> : <Badge tone="bad">requirements missing</Badge>}
            </div>
            <ul className="caps">
              {ts.capability_check.map((c) => (
                <li key={c.capability} className={c.met ? 'cap-ok' : 'cap-no'}>
                  <span className="cap-mark" aria-label={c.met ? 'met' : 'not met'}>
                    {c.met ? '✓' : '✗'}
                  </span>
                  {CAP_LABEL[c.capability] ?? c.capability}
                </li>
              ))}
            </ul>
            <p className="muted small">
              Source: <Badge tone="neutral">inferred</Badge> {ts.capabilities_source}. Not verified with the site.
            </p>
          </div>

          <div className="card">
            <h2>Coverage analysis</h2>
            <p className="muted small">
              Routine items are billed to Medicare or the patient’s insurer as standard of care; research items are paid by
              the sponsor.
            </p>
            <div className="table-scroll">
              <table className="tbl tbl-coverage">
                <thead>
                  <tr>
                    <th>Visit</th>
                    <th>Procedure</th>
                    <th>Code</th>
                    <th>Coverage</th>
                    <th>Payer</th>
                    <th>Rationale</th>
                    <th className="num">Medicare amount (national)</th>
                  </tr>
                </thead>
                <tbody>
                  {ts.coverage_grid.map((row) => (
                    <tr key={row.node}>
                      <td className="nowrap">{row.visit}</td>
                      <td>{row.procedure}</td>
                      <td>
                        <code>{row.code}</code>
                      </td>
                      <td>
                        <span className={`pill pill-${row.coverage}`}>{row.coverage}</span>
                      </td>
                      <td className="nowrap">{row.payer}</td>
                      <td className="muted small rationale">{row.rationale}</td>
                      <td className="num nowrap">
                        {usd(row.medicare_amount)}
                        {!row.verified && (
                          <span className="unverified" title="Approximate national amount; not verified against the CMS fee schedule">
                            unverified placeholder
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Budget</h2>
            <div className="kv-row small">
              <span>
                Locality factor <strong className="tnum">×{num(b.locality_factor, 2)}</strong>
              </span>
              <span className="muted">{b.locality_source}</span>
            </div>
            <div className="kv-row small">
              <span className="muted">Schedule: {b.schedule_source}</span>
              {b.multiplier !== 1 && <span>Multiplier ×{num(b.multiplier, 2)}</span>}
            </div>

            <h3>Sponsor-paid procedures (per patient)</h3>
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Procedure</th>
                    <th>Code</th>
                    <th className="num">Amount</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {b.procedure_lines.map((l) => (
                    <tr key={l.node}>
                      <td>{l.procedure}</td>
                      <td>
                        <code>{l.code}</code>
                      </td>
                      <td className="num nowrap">
                        {usd(l.amount)}
                        {!l.verified && <span className="unverified">unverified placeholder</span>}
                      </td>
                      <td className="muted small">{l.source}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Procedures total</th>
                    <td className="num strong">{usd(b.procedures_total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {b.unpriced_codes.length > 0 && (
              <p className="note small">
                Unpriced codes (no rate found, not counted as $0): {b.unpriced_codes.join(', ')}
              </p>
            )}

            <div className="two-col">
              <div>
                <h3>Per-patient items</h3>
                <table className="tbl tbl-compact">
                  <tbody>
                    {b.per_patient_items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.label} <span className="muted small">({unitLabel(i.unit)})</span>
                        </td>
                        <td className="num">{usd(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Per-patient total (incl. procedures)</th>
                      <td className="num strong">{usd(b.per_patient_total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div>
                <h3>Per-site items</h3>
                <table className="tbl tbl-compact">
                  <tbody>
                    {b.per_site_items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.label} <span className="muted small">({unitLabel(i.unit)})</span>
                          {i.unit !== 'per_site' && (
                            <div className="muted small">Not in the totals: depends on screen-failure counts.</div>
                          )}
                        </td>
                        <td className="num">{usd(i.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Per-site fixed total</th>
                      <td className="num strong">
                        {usd(b.per_site_items.filter((i) => i.unit === 'per_site').reduce((a, i) => a + i.amount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Agreement</h2>
            <ol className="clauses">
              {ts.agreement.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          </div>

          <Caveat>
            <strong>Disclaimer:</strong> {ts.disclaimer}
          </Caveat>
        </>
      )}
    </section>
  )
}
