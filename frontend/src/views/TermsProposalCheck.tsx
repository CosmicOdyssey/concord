// Site proposal check (a step of Protocol to terms): paste or upload a site's proposed prices (CSV: item or code,
// amount per occurrence), match each row to the protocol's budget lines at the selected site, and flag it.
// Coded procedure and lab lines: Medicare at the site's locality x a band the user sets (an assumption, default
// 100% to 150%) -> above / below / in range, with the CMS source. Non-procedure lines: "needs itemized
// justification", with Concord's proposed standard amount as a reference (not market data). Then a printable
// counter-proposal. Simple: the key numbers, one sentence and the flagged lines with sources in hover cards;
// Detailed: every line with its source inline. No forecasting: Medicare amounts are benchmarks for fair-value
// reasoning in negotiation, never a saving or a speed-up.
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Badge, ErrorBox, HoverCard, InfoTip, KeyFigure, Loading, Qualifier } from '../components'
import { useDensity } from '../density'
import { usd } from '../format'
import { DISCLAIMER, formulaText, localityTitle, type Locality, type PriceParams } from '../termsFlowApi'
import { BAND_DEFAULT, REF_LABEL, proposalApi, type Flag, type ProposalResult, type ProposalRow, type ProposalSample } from '../termsProposalApi'
import './termsProposal.css'

const FLAG_ORDER: Flag[] = ['above', 'below', 'justify', 'unmatched', 'in_range']
const FLAG_TEXT: Record<Flag, string> = {
  above: 'above range',
  below: 'below range',
  in_range: 'in range',
  justify: 'needs itemized justification',
  unmatched: 'not in this protocol’s schedule',
}
const FLAG_TONE: Record<Flag, 'bad' | 'info' | 'ok' | 'warn' | 'neutral'> = {
  above: 'bad',
  below: 'info',
  in_range: 'ok',
  justify: 'warn',
  unmatched: 'neutral',
}
const MAX_CHARS = 200_000

type Settled = { key: string; data: ProposalResult } | { key: string; error: string }

function storeKey(nct: string) {
  return `tf:proposal:${nct}`
}

function readText(nct: string): string {
  try {
    return window.localStorage.getItem(storeKey(nct)) ?? ''
  } catch {
    return ''
  }
}

function writeText(nct: string, text: string) {
  try {
    if (text) window.localStorage.setItem(storeKey(nct), text)
    else window.localStorage.removeItem(storeKey(nct))
  } catch {
    /* storage unavailable: per-viewer convenience only */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

function locText(l: Locality | null): string {
  return l ? `${localityTitle(l.name)} (${l.state} locality ${l.code})` : 'national amounts (no locality)'
}

function askText(r: ProposalRow): string {
  return r.reference_rate ? `${+(r.ask * 100).toFixed(1)}%` : usd(r.ask)
}

function refText(r: ProposalRow): string {
  if (r.reference === null) return '—'
  return r.reference_rate ? `${Math.round(r.reference * 100)}%` : usd(r.reference)
}

function FlagBadge({ flag }: { flag: Flag }) {
  return <Badge tone={FLAG_TONE[flag]}>{FLAG_TEXT[flag]}</Badge>
}

export default function TermsProposalCheck({ nct, siteId, params }: { nct: string; siteId: string; params: PriceParams }) {
  const { density } = useDensity()
  const detailed = density === 'detailed'
  const ids = { csv: useId(), lo: useId(), hi: useId(), file: useId() }
  const [text, setText] = useState(() => readText(nct))
  const [lo, setLo] = useState<number>(BAND_DEFAULT.low)
  const [hi, setHi] = useState<number>(BAND_DEFAULT.high)
  const [sample, setSample] = useState<ProposalSample | null | undefined>(undefined)
  const [res, setRes] = useState<Settled | null>(null)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => writeText(nct, text), [nct, text])

  useEffect(() => {
    const ctl = new AbortController()
    proposalApi.sample(nct, ctl.signal).then(
      (s) => {
        if (!ctl.signal.aborted) setSample(s)
      },
      () => {
        if (!ctl.signal.aborted) setSample(null)
      },
    )
    return () => ctl.abort()
  }, [nct])

  const bandOk = Number.isFinite(lo) && Number.isFinite(hi) && lo >= 10 && hi <= 500 && lo <= hi
  const query = useMemo(
    () => ({ siteId, csv: text, bandLow: lo / 100, bandHigh: hi / 100, params }),
    [siteId, text, lo, hi, params],
  )
  const dq = useDebounced(query, 350)
  const dkey = JSON.stringify(dq)
  const ready = !!dq.siteId && dq.csv.trim().length > 0 && bandOk
  useEffect(() => {
    if (!ready) return
    const ctl = new AbortController()
    proposalApi.check(nct, dq, ctl.signal).then(
      (data) => {
        if (!ctl.signal.aborted) setRes({ key: dkey, data })
      },
      (e: unknown) => {
        if (!ctl.signal.aborted) setRes({ key: dkey, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => ctl.abort()
  }, [nct, dq, dkey, ready])

  const data = res && 'data' in res && text.trim() ? res.data : null
  const current = !!res && res.key === JSON.stringify(query)
  const error = res && 'error' in res && current ? res.error : null
  const stale = !!data && !current
  const isSample = !!sample && text === sample.csv

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_CHARS * 2) {
      setFileNote(`${f.name} is too large (over ${MAX_CHARS.toLocaleString('en-US')} characters).`)
      return
    }
    try {
      const t = await f.text()
      if (t.length > MAX_CHARS) {
        setFileNote(`${f.name} is too large (over ${MAX_CHARS.toLocaleString('en-US')} characters).`)
        return
      }
      setText(t)
      setFileNote(`Loaded ${f.name}.`)
    } catch {
      setFileNote(`Could not read ${f.name}.`)
    }
  }

  const download = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const html = await proposalApi.counterHtml(nct, query, density)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `counter-proposal_${nct}_${siteId}${isSample ? '_SYNTHETIC' : ''}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="tp">
      <div className="tp-grid">
        <div className="tp-input">
          <div className="field">
            <label className="field-label" htmlFor={ids.csv}>
              Site’s proposal (CSV: item or code, amount per occurrence)
            </label>
            <textarea
              id={ids.csv}
              className="tp-csv"
              rows={detailed ? 10 : 6}
              spellCheck={false}
              value={text}
              placeholder={'item_or_code,amount\n71260,$275.00\nCoordinator time and data entry,$350'}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              aria-describedby={`${ids.csv}-hint`}
            />
            <p id={`${ids.csv}-hint`} className="tp-hint">
              One row per item: a CPT/HCPCS or lab code or the item’s name, then the site’s price for one occurrence. A header row, $ and commas are fine.
            </p>
          </div>
          <div className="tp-actions">
            <input id={ids.file} ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} tabIndex={-1} />
            <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}>
              Upload CSV…
            </button>
            {sample && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setText(sample.csv)
                  setFileNote(null)
                }}
              >
                Load synthetic sample
              </button>
            )}
            {text && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setText('')
                  setFileNote(null)
                  setRes(null)
                }}
              >
                Clear
              </button>
            )}
            {isSample && (
              <Badge tone="warn" title={sample?.label}>
                SYNTHETIC sample
              </Badge>
            )}
          </div>
          {fileNote && (
            <p className="tp-hint" role="status">
              {fileNote}
            </p>
          )}
          <fieldset className="tp-band">
            <legend className="field-label">
              Justified range for coded lines{' '}
              <Qualifier info={<BandInfo />}>assumption</Qualifier>
            </legend>
            <span className="tp-band-row">
              <span className="tf-num-input">
                <input
                  id={ids.lo}
                  type="number"
                  inputMode="decimal"
                  min={10}
                  max={500}
                  step={5}
                  value={Number.isFinite(lo) ? lo : ''}
                  onChange={(e) => setLo(e.target.value === '' ? NaN : Number(e.target.value))}
                  aria-label="Band low, percent of Medicare"
                />
                <span aria-hidden="true">%</span>
              </span>
              <span>to</span>
              <span className="tf-num-input">
                <input
                  id={ids.hi}
                  type="number"
                  inputMode="decimal"
                  min={10}
                  max={500}
                  step={5}
                  value={Number.isFinite(hi) ? hi : ''}
                  onChange={(e) => setHi(e.target.value === '' ? NaN : Number(e.target.value))}
                  aria-label="Band high, percent of Medicare"
                />
                <span aria-hidden="true">%</span>
              </span>
              <span className="muted">of Medicare at the site’s locality</span>
              {(lo !== BAND_DEFAULT.low || hi !== BAND_DEFAULT.high) && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setLo(BAND_DEFAULT.low)
                    setHi(BAND_DEFAULT.high)
                  }}
                >
                  Reset to {BAND_DEFAULT.low}%–{BAND_DEFAULT.high}%
                </button>
              )}
            </span>
            {!bandOk && (
              <p className="tp-hint tp-bad" role="alert">
                Use a band from 10% to 500%, with the low end at or below the high end.
              </p>
            )}
          </fieldset>
        </div>

        <div className={`tp-result${stale ? ' tf-stale' : ''}`} aria-live="polite">
          {!text.trim() && (
            <p className="tp-empty">
              Paste a site’s price list or upload a CSV{sample ? ', or load the synthetic sample' : ''}. Each line is matched to this protocol at the selected site and
              checked against the CMS 2026 fee schedules.
            </p>
          )}
          {text.trim() && !data && !error && <Loading label="Checking the proposal…" />}
          {error && <ErrorBox error={error} />}
          {data && <Summary r={data} isSample={isSample} />}
        </div>
      </div>

      {data && (
        <>
          {detailed ? <AllLines r={data} /> : <FlaggedLines r={data} />}
          {data.errors.length > 0 && <Unreadable r={data} />}
          <div className="tp-export">
            <button type="button" className="btn btn-primary" onClick={download} disabled={exporting || stale}>
              {exporting ? 'Preparing…' : 'Download counter-proposal (HTML)'}
            </button>
            <p className="tp-hint">
              {detailed ? 'Every line of the proposal' : 'The summary and the flagged lines (switch to Detailed for every line)'}, each with its source, the band
              assumption, the site and locality. Open the file in a browser and print to PDF.
            </p>
            {exportError && <ErrorBox error={exportError} />}
          </div>
          {detailed && <SourcesList r={data} />}
        </>
      )}
    </div>
  )
}

function BandInfo() {
  return (
    <>
      <span className="hc-title">The band is an assumption</span>
      The justified range for a coded procedure or lab line is the Medicare amount at the site’s locality times this band (default {BAND_DEFAULT.low}% to{' '}
      {BAND_DEFAULT.high}%). Concord does not know what sites are paid in the market; the band is a negotiating assumption you set, not market data.
    </>
  )
}

function Summary({ r, isSample }: { r: ProposalResult; isSample: boolean }) {
  const c = r.summary.counts
  const cd = r.summary.coded
  const band = `${Math.round(r.band.low * 100)}%–${Math.round(r.band.high * 100)}%`
  const parts = FLAG_ORDER.filter((f) => c[f] > 0).map((f) => `${c[f]} ${FLAG_TEXT[f]}`)
  return (
    <div className="tp-summary">
      <p className="tp-site small">
        <span className="muted">Site</span> <span className="strong">{r.site.label}</span> · {locText(r.locality)}
      </p>
      {isSample && (
        <p className="tp-synth" role="note">
          <strong>Synthetic sample.</strong> Invented prices to demonstrate the check, not a real site’s proposal and not market data.
        </p>
      )}
      <ul className="tp-tally" aria-label="Lines by flag">
        {FLAG_ORDER.map((f) => (
          <li key={f} className={c[f] ? undefined : 'tp-zero'}>
            <span className="num tp-tally-n">{c[f]}</span> <FlagBadge flag={f} />
          </li>
        ))}
      </ul>
      {cd.n > 0 && (
        <KeyFigure
          value={usd(cd.total_ask)}
          label={`Site’s ask for the ${cd.n} coded line${cd.n === 1 ? '' : 's'} (one occurrence each)`}
          qualifier={
            <Qualifier
              tone="muted"
              info={
                <>
                  <span className="hc-title">Justified range</span>
                  Sum over the coded lines of the Medicare amount at {locText(r.locality)} × {band} (band: assumption). PFS lines from{' '}
                  {r.pfs_source ?? 'the CMS PFS file'}; lab lines from {r.clfs_source ?? 'the CMS CLFS file'} (national).
                </>
              }
            >
              justified {usd(cd.range_low)}–{usd(cd.range_high)}
            </Qualifier>
          }
          sub={
            cd.above_by > 0 || cd.below_by > 0
              ? `${cd.above_by > 0 ? `${usd(cd.above_by)} above the range tops` : ''}${cd.above_by > 0 && cd.below_by > 0 ? ' · ' : ''}${cd.below_by > 0 ? `${usd(cd.below_by)} below the range bottoms` : ''}`
              : 'every coded line within its range'
          }
        />
      )}
      <p className="tp-sentence">
        Of {r.summary.n_rows} line{r.summary.n_rows === 1 ? '' : 's'}: {parts.join(', ')}.
        {c.justify > 0 && <> Non-procedure lines are compared with Concord’s {REF_LABEL}, never priced from Medicare.</>}
      </p>
      <p className="tp-quals">
        <Qualifier tone="muted">Band {band} of Medicare: assumption</Qualifier> <Qualifier>{DISCLAIMER}</Qualifier>
      </p>
    </div>
  )
}

/** Hover-card content: everything behind one line's flag. */
function RowSource({ row, r }: { row: ProposalRow; r: ProposalResult }) {
  const band = `${Math.round(r.band.low * 100)}% to ${Math.round(r.band.high * 100)}%`
  return (
    <dl className="tf-line-dl tp-dl">
      <Field k="Site item">{row.item}</Field>
      <Field k="Matched">{row.match ? `${row.code ? `${row.code} · ` : ''}${row.matched_label ?? ''} (by ${row.method})` : 'Not in this protocol’s schedule'}</Field>
      {row.medicare !== null && (
        <>
          <Field k="Medicare">
            <span className="num">{usd(row.medicare)}</span> at {row.source?.schedule === 'CLFS' ? 'the national lab rate' : locText(r.locality)}
          </Field>
          <Field k="Range">
            <span className="num">
              {usd(row.range_low)}–{usd(row.range_high)}
            </span>{' '}
            (× {band}, assumption)
          </Field>
        </>
      )}
      {row.reference !== null && (
        <Field k="Reference">
          <span className="num">{refText(row)}</span> {row.reference_unit}, {REF_LABEL}
          {row.reference_edited ? ' (edited in step 3)' : ''}
        </Field>
      )}
      {row.source && (
        <Field k="Source">
          {row.source.schedule === 'PFS' || row.source.schedule === 'CLFS' ? (
            <>
              CMS {row.source.schedule} {row.source.year ?? ''}, {row.source.file ?? 'file'}, {row.source.locality}, code {row.source.code}
            </>
          ) : (
            row.source.text
          )}
        </Field>
      )}
      {row.source?.formula && (
        <Field k="Formula">
          <span className="num tf-formula-text">{formulaText(row.source.formula)}</span>
        </Field>
      )}
      {row.coverage && (
        <Field k="Coverage">
          Sponsor-paid at {row.coverage.sponsor_visits} scheduled visit{row.coverage.sponsor_visits === 1 ? '' : 's'}, billed to insurance at {row.coverage.insurance_visits}
        </Field>
      )}
      {row.notes.length > 0 && <Field k="Note">{row.notes.join('; ')}</Field>}
    </dl>
  )
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RangeCell({ row }: { row: ProposalRow }) {
  if (row.range_low !== null)
    return (
      <span className="num">
        {usd(row.range_low)}–{usd(row.range_high)}
      </span>
    )
  if (row.reference !== null)
    return (
      <span>
        <span className="num">{refText(row)}</span> <span className="tp-ref">{REF_LABEL}</span>
      </span>
    )
  return <span className="muted">—</span>
}

function FlaggedLines({ r }: { r: ProposalResult }) {
  const rows = r.rows.filter((x) => x.flag !== 'in_range').sort((a, b) => FLAG_ORDER.indexOf(a.flag) - FLAG_ORDER.indexOf(b.flag) || b.outside_by - a.outside_by)
  const nIn = r.summary.counts.in_range
  return (
    <div className="tp-lines">
      <h3 className="tp-h">
        Flagged lines <span className="muted tnum">({rows.length})</span>
      </h3>
      {rows.length === 0 ? (
        <p className="small">Every line is within its justified range.</p>
      ) : (
        <div className="table-scroll">
          <table className="tbl tbl-compact tp-table">
            <thead>
              <tr>
                <th scope="col">Site item</th>
                <th scope="col" className="num">
                  Ask
                </th>
                <th scope="col">Range or reference</th>
                <th scope="col">Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row}>
                  <th scope="row">
                    <HoverCard content={<RowSource row={row} r={r} />}>{row.item}</HoverCard>
                  </th>
                  <td className="num">{askText(row)}</td>
                  <td>
                    <RangeCell row={row} />
                  </td>
                  <td>
                    <FlagBadge flag={row.flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tp-hint">
        {nIn > 0 && `${nIn} line${nIn === 1 ? '' : 's'} within range not listed. `}Hover or focus an item for its source; Detailed lists every line with its source.
      </p>
    </div>
  )
}

function AllLines({ r }: { r: ProposalResult }) {
  return (
    <div className="tp-lines">
      <h3 className="tp-h">
        Every line <span className="muted tnum">({r.rows.length})</span>
      </h3>
      <div className="table-scroll">
        <table className="tbl tbl-compact tp-table tp-table-full">
          <thead>
            <tr>
              <th scope="col" className="num">
                Row
              </th>
              <th scope="col">Site item</th>
              <th scope="col">Matched to</th>
              <th scope="col" className="num">
                Ask
              </th>
              <th scope="col" className="num">
                Medicare
              </th>
              <th scope="col">Range or reference</th>
              <th scope="col">Flag</th>
              <th scope="col">Source and notes</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.row}>
                <td className="num muted">{row.row}</td>
                <th scope="row">{row.item}</th>
                <td>
                  {row.match ? (
                    <>
                      {row.code && <code className="tf-code">{row.code}</code>} {row.matched_label}
                      <span className="tp-how"> by {row.method}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">{askText(row)}</td>
                <td className="num">{row.medicare === null ? '—' : usd(row.medicare)}</td>
                <td>
                  <RangeCell row={row} />
                </td>
                <td>
                  <FlagBadge flag={row.flag} />
                </td>
                <td className="tf-prov tp-src">
                  {row.source ? row.source.text : 'No source: not in this protocol’s schedule'}
                  {row.notes.length > 0 && <span className="tp-note"> Note: {row.notes.join('; ')}.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Unreadable({ r }: { r: ProposalResult }) {
  return (
    <div className="tp-lines">
      <h3 className="tp-h">
        Rows that could not be read <span className="muted tnum">({r.errors.length})</span>
      </h3>
      <ul className="tp-errors small">
        {r.errors.map((e) => (
          <li key={`${e.row}-${e.text}`}>
            Row {e.row}: <code className="tf-code">{e.text}</code> {e.error}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourcesList({ r }: { r: ProposalResult }) {
  return (
    <div className="tp-lines">
      <h3 className="tp-h">Sources and assumptions</h3>
      <ul className="tf-sheet-list small">
        <li>Physician fee schedule: {r.pfs_source ?? 'not loaded'}; conversion factor {r.conversion_factor ?? '—'}</li>
        <li>Clinical lab fee schedule: {r.clfs_source ?? 'not loaded'} (national, not geographically adjusted)</li>
        <li>Medicare locality: {r.locality ? `${locText(r.locality)}; ${r.locality.method}` : 'none resolved: national amounts'}</li>
        <li>
          {r.band.text} <InfoTip label="About the band" content={<BandInfo />} />
        </li>
        <li>
          Non-procedure reference: {r.standard_source}. Labelled “{REF_LABEL}”.
        </li>
        <li>Medicare amounts are benchmarks that inform fair-value reasoning in sponsor-site negotiation, not the sponsor’s price and not market data.</li>
        <li>{DISCLAIMER}</li>
      </ul>
    </div>
  )
}
