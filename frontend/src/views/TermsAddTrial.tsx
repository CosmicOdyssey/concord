// Any trial in Protocol to terms: "Add any trial by NCT ID" in the trial picker (AddTrialForm), and, for an added
// trial, where its schedule of assessments comes from (AddedTrialSchedule): a cited draft from the registry, or the
// protocol's schedule uploaded as CSV. Simple: the key numbers and one sentence, sources in hover cards; Detailed:
// every drafted visit and item with its registry quote and code mapping. No forecasting.
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Badge, Details, KeyFigure } from '../components'
import { useDensity } from '../density'
import { InfoTip } from '../hovercard'
import type { Protocol } from '../termsFlowApi'
import { importApi, NCT_PATTERN, type ImportInfo } from '../termsImportApi'
import './termsAddTrial.css'

const MAX_CHARS = 200_000

export function AddTrialForm({ known, onAdded }: { known: string[]; onAdded: (nct: string) => void }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nct = value.trim().toUpperCase()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!NCT_PATTERN.test(nct)) {
      setError('Enter an NCT ID: NCT followed by 8 digits, e.g. NCT07564414.')
      return
    }
    if (known.includes(nct)) {
      onAdded(nct)
      setValue('')
      return
    }
    setBusy(true)
    try {
      const r = await importApi.add(nct)
      setValue('')
      onAdded(r.nct_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ta-add" onSubmit={submit} noValidate>
      <label className="field-label" htmlFor={`${id}-nct`}>
        Add any trial by NCT ID
      </label>
      <div className="ta-add-row">
        <input
          id={`${id}-nct`}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="NCT07564414"
          maxLength={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
          aria-invalid={!!error}
        />
        <button type="submit" className="btn btn-small" disabled={busy || !value.trim()}>
          {busy ? 'Fetching…' : 'Add trial'}
        </button>
      </div>
      <p id={`${id}-hint`} className="ta-hint">
        Fetched once from the public ClinicalTrials.gov record. Concord drafts a schedule from the registry, every item cited, which you can replace
        with the protocol’s schedule of assessments as CSV.
      </p>
      {error && (
        <p id={`${id}-err`} className="ta-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

/** Where an added trial's schedule comes from, with the CSV route. */
export function AddedTrialSchedule({ proto, onChanged }: { proto: Protocol; onChanged: () => void }) {
  const detailed = useDensity().density === 'detailed'
  const imp = proto.import as ImportInfo
  const ids = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const draft = imp.source === 'registry_draft'

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const t = await f.text()
      if (t.length > MAX_CHARS) {
        setNote(`${f.name} is too large (over ${MAX_CHARS.toLocaleString('en-US')} characters).`)
        return
      }
      setText(t)
      setNote(`Loaded ${f.name}. Check it, then use it.`)
    } catch {
      setNote(`Could not read ${f.name}.`)
    }
  }

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setNote(done)
      setText('')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const sourceInfo = (
    <>
      <span className="hc-title">{imp.label}</span>
      {draft ? (
        <>
          Visits come from the time frames of the registry’s outcome measures; items from the assessments those measures, the interventions and the
          eligibility criteria name. Codes come only from Concord’s explicit procedure-to-code table and only when the loaded CMS rate card has them.
          Every visit and item quotes its registry field: confirm it against the protocol.
        </>
      ) : (
        <>Visits, procedures and codes as uploaded. Items without a code are mapped from their names only through Concord’s table, and say so.</>
      )}{' '}
      Record: <a href={imp.source_url}>{imp.source_url}</a>
      {imp.fetched ? `, fetched ${imp.fetched}` : ''}.
    </>
  )

  return (
    <section className="ta-panel" aria-labelledby={`${ids}-h`}>
      <div className="ta-head">
        <h3 id={`${ids}-h`} className="ta-title">
          Schedule source
        </h3>
        <Badge tone={draft ? 'warn' : 'info'} title={imp.label}>
          {draft ? 'Draft from the public record' : 'Uploaded schedule (CSV)'}
        </Badge>
        <InfoTip label="Where this schedule comes from" content={sourceInfo} />
      </div>
      <div className="ta-kfs">
        <KeyFigure value={imp.n_visits} label={draft ? 'visits inferred' : 'visits'} />
        <KeyFigure value={imp.n_items} label={draft ? 'items inferred' : 'scheduled items'} />
        <KeyFigure value={imp.n_unpriced_procedures} label="items unpriced" sub="listed, never counted as zero" />
      </div>
      <p className="ta-lede">
        {draft ? (
          <>
            <strong>{imp.label}.</strong> Every item is research (assumed until reviewed): mark routine care in step 2. Upload the protocol’s schedule
            of assessments for a real budget.
          </>
        ) : (
          <>
            <strong>Your uploaded schedule</strong>, not checked against the sponsor’s protocol. Every item is research (assumed until reviewed): mark
            routine care in step 2.
          </>
        )}
      </p>

      {detailed && <DraftTables proto={proto} imp={imp} />}
      {!detailed && (
        <Details summary={`Every ${draft ? 'inferred' : 'uploaded'} visit and item, with its source (${imp.unmapped.length} unmapped)`}>
          <DraftTables proto={proto} imp={imp} />
        </Details>
      )}

      <div className="ta-csv">
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-csv`}>
            Schedule of assessments (CSV: visit, day or week, procedure, code, repeats)
          </label>
          <textarea
            id={`${ids}-csv`}
            className="ta-csv-text"
            rows={detailed ? 8 : 4}
            spellCheck={false}
            value={text}
            placeholder={'visit,day,procedure,code,repeats\nScreening,-28,ECG,93000,\nDosing visit,W4,Study drug injection,96372,12'}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            aria-describedby={`${ids}-csvhint`}
          />
          <p id={`${ids}-csvhint`} className="ta-hint">
            One row per procedure at a visit. A header row, blank visit cells (carried down), $ signs and weeks (W4, Week 4) are fine. code is optional:
            a CPT/HCPCS code, <code>standard:&lt;item&gt;</code> for a proposed standard fee, or blank. repeats: how many times the visit happens.
          </p>
        </div>
        <div className="ta-actions">
          <input id={`${ids}-file`} ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} tabIndex={-1} />
          <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload CSV…
          </button>
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={busy || !text.trim()}
            onClick={() => run(() => importApi.upload(proto.nct_id, text), 'Schedule replaced with your CSV.')}
          >
            {busy ? 'Working…' : 'Use this schedule'}
          </button>
          <a className="btn btn-small" href={importApi.templateUrl} download>
            CSV template
          </a>
          <a className="btn btn-small" href={importApi.exportUrl(proto.nct_id)} download>
            Export current schedule
          </a>
          {!draft && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => run(() => importApi.reset(proto.nct_id), 'Back to the registry draft.')}>
              Back to the registry draft
            </button>
          )}
        </div>
        {note && (
          <p className="ta-hint" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="ta-error" role="alert">
            {error}
          </p>
        )}
        {imp.warnings.length > 0 && (
          <ul className="ta-warn small">
            {imp.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function DraftTables({ proto, imp }: { proto: Protocol; imp: ImportInfo }) {
  const draft = imp.source === 'registry_draft'
  return (
    <div className="ta-tables">
      <h4>Visits</h4>
      <div className="ta-tw">
        <table className="ta-table">
          <thead>
            <tr>
              <th scope="col">Visit</th>
              <th scope="col">When</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {proto.visits.map((v) => (
              <tr key={v.id}>
                <td>{v.label}</td>
                <td className="ta-nowrap">{v.window}</td>
                <td className="ta-src">{v.inferred ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Items</h4>
      <div className="ta-tw">
        <table className="ta-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Code</th>
              <th scope="col">Code mapping</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {proto.procedures.map((p) => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td className="num ta-nowrap">{p.code ?? (p.pricing.startsWith('standard:') ? 'standard' : p.pricing === 'unpriced' ? 'unpriced' : '—')}</td>
                <td className="ta-src">{p.mapping ?? '—'}</td>
                <td className="ta-src">{p.inferred ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {imp.unmapped.length > 0 && (
        <>
          <h4>{draft ? 'Named in the registry but not mapped (listed, unpriced)' : 'Unpriced items'}</h4>
          <ul className="ta-unmapped small">
            {imp.unmapped.map((u, i) => (
              <li key={i}>
                <span className="ta-field">{u.field}</span> “{u.quote}” <span className="muted">→ {u.why}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">{imp.coverage_note}</p>
    </div>
  )
}
