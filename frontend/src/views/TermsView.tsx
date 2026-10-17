import { useEffect, useMemo, useRef, useState } from 'react'
import { api, DEFAULT_SCENARIO, scenarioKey, type TermSheet } from '../api'
import type { ClearState } from '../App'
import { Badge, Caveat, ErrorBox, KeyFigure, Loading, NeedsClear, Qualifier, RunLine, Section, Stat } from '../components'
import { useDensity } from '../density'
import { ctgovUrl, isNum, num, siteName, trialName, usd } from '../format'
import { InSampleLine, RsHead } from './researchParts'

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

function SourceMark({ verified, schedule }: { verified: boolean; schedule?: string }) {
  if (verified) return <span className="srcmark srcmark-ok">CMS 2026 {schedule ?? ''}</span>
  return (
    <span className="srcmark srcmark-warn" title="Approximate national amount; the CMS lab fee schedule (CLFS) file is not loaded">
      placeholder
    </span>
  )
}

function unitLabel(u: string): string {
  return u.replace(/_/g, ' ')
}

export default function TermsView({ clear }: { clear: ClearState }) {
  const r = clear.result
  const solved = clear.solvedParams
  const simple = useDensity().density === 'simple'
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

  const skey = solved ? scenarioKey(solved) : ''
  useEffect(() => {
    if (!siteId || !nctId || !solved) return
    const key = `${skey}|${siteId}|${nctId}`
    const hit = cache.current.get(key)
    if (hit) {
      setSheet({ status: 'ok', data: hit })
      return
    }
    const ctl = new AbortController()
    setSheet({ status: 'loading' })
    api
      .termsheet(siteId, nctId, solved, ctl.signal)
      .then((d) => {
        cache.current.set(key, d)
        setSheet({ status: 'ok', data: d })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setSheet({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
    // solved is captured via skey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, nctId, skey, tick])

  if (!r || !solved) {
    if (clear.loading) return <Loading label={`Clearing ${clear.pendingParams?.region ?? ''}…`} />
    return (
      <>
        {clear.error && <ErrorBox error={clear.error} onRetry={() => clear.run(DEFAULT_SCENARIO)} />}
        <NeedsClear onRun={() => clear.run(DEFAULT_SCENARIO)} busy={clear.loading} />
      </>
    )
  }

  const trial = trialIdx.get(nctId)
  const ts = sheet.status === 'ok' ? sheet.data : null
  const b = ts?.budget
  const placeholderExpected = !!ts?.expected_source?.startsWith('placeholder')
  const nPlaceholder = ts ? ts.coverage_grid.filter((row) => !row.verified).length : 0

  const facts = ts && (
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
  )

  const capsLine = ts && (
    <>
      {ts.capability_ok ? 'All requirements met' : 'Requirements missing'} ({ts.capabilities_source}; not verified with the site)
    </>
  )
  const caps = ts && (
    <>
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
    </>
  )

  const coverage = ts && (
    <>
      <p className="muted small">
        Routine items are billed to Medicare or the patient’s insurer as standard of care; research items are paid by the sponsor.
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
              <th>Schedule</th>
              <th className="num">Medicare amount</th>
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
                <td className="nowrap">
                  <code>{row.schedule ?? '—'}</code>
                </td>
                <td className="num nowrap" title={row.source}>
                  {usd(row.medicare_amount)}
                  <SourceMark verified={row.verified} schedule={row.schedule} />
                  {row.locality && <span className="muted small block">{row.locality}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )

  const budget = ts && b && (
    <>
      <div className="kv-row small">
        <span>
          Medicare locality <strong>{b.locality ?? 'national (no locality match)'}</strong>
        </span>
        {isNum(b.conversion_factor) && (
          <span>
            PFS conversion factor <strong className="tnum">${num(b.conversion_factor, 4)}</strong>
          </span>
        )}
        <span className="muted">{b.locality_source}</span>
      </div>
      <div className="kv-row small">
        <span className="muted">Non-procedure items: {b.schedule_source}</span>
        {b.multiplier !== 1 && <span>Multiplier ×{num(b.multiplier, 2)}</span>}
      </div>

      <h3>Sponsor-paid procedures (per patient)</h3>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Procedure</th>
              <th>Code</th>
              <th>Schedule</th>
              <th className="num">National</th>
              <th className="num">Local (billed)</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {b.procedure_lines.map((l, i) => (
              <tr key={`${l.node}-${i}`}>
                <td>{l.procedure}</td>
                <td>
                  <code>{l.code}</code>
                </td>
                <td>
                  <code>{l.schedule ?? '—'}</code>
                </td>
                <td className="num nowrap">{usd(l.national)}</td>
                <td className="num nowrap">
                  {usd(l.amount)}
                  <SourceMark verified={l.verified} schedule={l.schedule} />
                </td>
                <td className="muted small">{l.source}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>Procedures total</th>
              <td className="num strong">{usd(b.procedures_total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {b.unpriced_codes.length > 0 && <p className="note small">Unpriced codes (no rate found, not counted as $0): {b.unpriced_codes.join(', ')}</p>}

      <div className="two-col">
        <div>
          <h3>Per-patient items</h3>
          <div className="table-scroll">
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
        </div>
        <div>
          <h3>Per-site items</h3>
          <div className="table-scroll">
            <table className="tbl tbl-compact">
              <tbody>
                {b.per_site_items.map((i) => (
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
                  <th>Per-site fixed total</th>
                  <td className="num strong">{usd(b.per_site_items.filter((i) => i.unit === 'per_site').reduce((a, i) => a + i.amount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </>
  )

  const asIncurred =
    b && b.as_incurred_items && b.as_incurred_items.length > 0 ? (
      <>
        <p className="muted small">Not included in the per-patient or site totals above.</p>
        <div className="table-scroll">
          <table className="tbl tbl-compact">
            <tbody>
              {b.as_incurred_items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.label} <span className="muted small">({unitLabel(i.unit)})</span>
                  </td>
                  <td className="num">{usd(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ) : null

  const agreement = ts && (
    <ol className="clauses">
      {ts.agreement.map((a, i) => (
        <li key={i}>{a}</li>
      ))}
    </ol>
  )

  const expectedQual = placeholderExpected ? (
    <Qualifier>{ts?.expected_source}</Qualifier>
  ) : (
    <Qualifier tone="muted">model estimate</Qualifier>
  )

  return (
    <section className="view rs-view">
      <RsHead
        title="Pre-cleared terms"
        lede="An earlier version of Protocol to terms, kept for reference. Each coordinated match from the clear comes with a capability check, a coverage analysis (routine care vs research), a budget from a public rate card, and a standard agreement."
      >
        <InSampleLine>The matches come from the in-sample clear. Prices are decision support, not a fair-market-value legal opinion.</InSampleLine>
        <RunLine params={solved} stale={clear.loading} />
      </RsHead>

      <div className="card controls rs-controls">
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
      </div>

      {sheet.status === 'loading' && <Loading label="Building term sheet…" />}
      {sheet.status === 'error' && <ErrorBox error={sheet.error} onRetry={() => setTick((x) => x + 1)} />}

      {ts && b && (
        <>
          {simple ? (
            <Section
              id="rs-sheet"
              title="Term sheet for this match"
              lede={
                <>
                  {trial ? trialName(trial) : nctId} at {ts.site.facility}. The schedule of assessments is a demo protocol, not the selected
                  trial’s own protocol.
                </>
              }
              qualifiers={
                <>
                  <p className="rs-qual-line">
                    <Qualifier tone="muted">Expected patients:</Qualifier> {placeholderExpected ? ts.expected_source : `${ts.expected_source ?? 'unknown'} (model estimate, in-sample)`}.
                  </p>
                  <p className="rs-qual-line">
                    <Qualifier tone="muted">Prices:</Qualifier> CMS 2026 fee schedules where marked
                    {nPlaceholder > 0 && (
                      <>
                        ; <Qualifier>{nPlaceholder} placeholder amounts</Qualifier> where the lab fee schedule is not loaded
                      </>
                    )}
                    .
                  </p>
                  <p className="rs-qual-line">
                    <Qualifier tone="muted">Capability check:</Qualifier> {capsLine}.
                  </p>
                </>
              }
              figure={
                <div className="rs-figs">
                  <KeyFigure value={num(ts.expected_patients)} label="Expected patients at this site" qualifier={expectedQual} />
                  <KeyFigure value={usd(b.per_patient_total)} label="Per-patient budget" sub="Sponsor-paid procedures + per-patient items" />
                  <KeyFigure
                    value={usd(ts.expected_site_total)}
                    label="Expected site total"
                    sub="Per-site fixed items + per-patient × expected patients"
                  />
                </div>
              }
              details={
                <>
                  {facts}
                  <h3>Capability check</h3>
                  {caps}
                  <h3>Coverage analysis</h3>
                  {coverage}
                  <h3>Budget</h3>
                  {budget}
                  {asIncurred && (
                    <>
                      <h3>Billed as incurred</h3>
                      {asIncurred}
                    </>
                  )}
                  <h3>Agreement</h3>
                  {agreement}
                </>
              }
              detailsLabel="Details: coverage grid, budget lines and agreement"
            />
          ) : (
            <>
              <div className="card">{facts}</div>
              <div className="stats stats-3">
                <Stat
                  label="Expected patients at this site"
                  value={num(ts.expected_patients)}
                  sub={
                    placeholderExpected ? <Badge tone="warn">{ts.expected_source}</Badge> : <>Source: {ts.expected_source ?? 'unknown'} (model estimate)</>
                  }
                />
                <Stat label="Per-patient budget" value={usd(b.per_patient_total)} sub="Sponsor-paid procedures + per-patient items" />
                <Stat emphasis label="Expected site total" value={usd(ts.expected_site_total)} sub="Per-site fixed items + per-patient × expected patients" />
              </div>
              <Section title="Capability check" lede={capsLine}>
                {caps}
              </Section>
              <Section title="Coverage analysis">{coverage}</Section>
              <Section title="Budget">{budget}</Section>
              {asIncurred && <Section title="Billed as incurred">{asIncurred}</Section>}
              <Section title="Agreement">{agreement}</Section>
            </>
          )}
          <Caveat>
            <strong>Disclaimer:</strong> {ts.disclaimer}
          </Caveat>
        </>
      )}
    </section>
  )
}
