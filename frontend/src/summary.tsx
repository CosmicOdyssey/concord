// Result blocks shared by the Research tab's clearing views (Clear it, Portfolio clearing, Robustness). Used only by
// those views.
import type { ReactNode } from 'react'
import type { Assumptions, BetaInfo, CalibrationCheck, ClearResult, Comparison, ComparisonKey } from './api'
import { Badge, Gloss, Qualifier, Section, Stat } from './components'
import { int, isNum, num, pct, times } from './format'
import { InSampleMark, RatioLanes } from './views/researchParts'

/** Material threshold (months) for "faster/slower": the API reports it per comparison block (1.0). */
const MATERIAL_MONTHS = 1

export function materialMonths(c?: Comparison | null): number {
  return isNum(c?.material_threshold_months) ? c.material_threshold_months : MATERIAL_MONTHS
}

/** "≥ 1 mo" / "≥ 1 month": the label that goes with a material share. */
export function atLeast(months: number, long = false): string {
  const n = Number.isInteger(months) ? String(months) : num(months, 1)
  return long ? `≥ ${n} month${months === 1 ? '' : 's'}` : `≥ ${n} mo`
}

/** Main number = share that moved by at least the material threshold ("—" when the field is
 *  missing, never 0); the any-change share, which counts near-ties, is small secondary text. */
export function ShareCell({ material, any }: { material: number | null | undefined; any: number | null | undefined }) {
  return (
    <>
      {pct(material)}
      <div className="muted small nowrap">{pct(any)} any change</div>
    </>
  )
}

/** Background trials materially slower under the joint optimum with losers allowed. The API sends
 *  only the any-change count, so this is counted from the per-trial times in the same response
 *  (no times = no sites = slower). */
export function backgroundSlowerMaterial(r: ClearResult): number {
  const thr = materialMonths(r.summary.coord_free_vs_actual)
  return r.trials.filter(
    (t) => !t.movable && isNum(t.T_actual) && (!isNum(t.T_coord_free) || t.T_coord_free >= t.T_actual + thr - 1e-9),
  ).length
}

export const COMPARISONS: { key: ComparisonKey; label: string; detail: string; headline?: boolean }[] = [
  {
    key: 'coord_vs_actual',
    label: 'Capped at registered times (vs registered; in-sample)',
    detail:
      'Joint optimum constrained so no trial is slower than registered under the same rates used to choose it. Out of sample the cap does not hold.',
  },
  {
    key: 'indep_vs_actual',
    label: 'Site selection alone (best response vs registered)',
    detail: 'Each trial picks its own best sites, ignoring the others. A single sponsor can already buy this.',
  },
  {
    key: 'coordination_no_loser_vs_indep',
    label: 'Pure coordination, no losers (vs best response)',
    detail: 'What joint allocation adds on top of every trial’s best response, with no trial slower than that.',
  },
  {
    key: 'coord_free_vs_actual',
    label: 'Joint optimum, losers allowed (vs registered)',
    detail: 'No participation constraint; see the share slower.',
  },
  {
    key: 'coord_free_vs_indep',
    label: 'Joint optimum, losers allowed (vs best response)',
    detail: 'No participation constraint; see the share slower.',
  },
]

export function betaInfo(a: Assumptions): BetaInfo | null {
  if (typeof a.beta === 'number') return { beta: a.beta, source: 'scenario value' }
  return a.beta ?? null
}

/** The default β is the full-sample within-site estimate; it is the one that carries a CI. A user
 *  setting ("user setting") and the not-estimated fallback have none. */
export function isFullSampleBeta(b: BetaInfo | null): b is BetaInfo & { ci95: [number, number] } {
  return !!b && Array.isArray(b.ci95) && isNum(b.ci95[0]) && isNum(b.ci95[1])
}

function worst(c: Comparison): string {
  if (!isNum(c.worst_slowdown_months) || c.worst_slowdown_months <= 1e-6) return 'none slower'
  return `${num(c.worst_slowdown_months)} mo`
}

/** Model median time for this instance's Phase III trials over the completed-trial median enrollment window (the
 *  calibration check), or null when either is missing. */
function calibrationRatio(c: CalibrationCheck): number | null {
  return isNum(c.model_median_T_actual_phase3) && isNum(c.real_completed_phase3_median_enrollment_window)
    ? c.model_median_T_actual_phase3 / c.real_completed_phase3_median_enrollment_window
    : null
}

const NOT_LIKE_FOR_LIKE =
  'Not like for like: a snapshot of recruiting trials over-represents slow ones (length-biased sampling) and their site lists are still growing.'

/** The four headline numbers of the capped allocation (Detailed, or inside the Simple disclosure). */
export function HeadlineStats({ r }: { r: ClearResult }) {
  const h = r.summary.coord_vs_actual
  return (
    <div className="stats rs-stats">
      <Stat label="Enrollment-time ratio (in-sample)" value={times(h.ratio)} sub={<>Total trial-months, registered ÷ coordinated</>} />
      <Stat label="Median per-trial ratio (in-sample)" value={times(h.median_speedup)} sub="T registered ÷ T coordinated" />
      <Stat
        label={`Trials faster by ${atLeast(materialMonths(h), true)} (in-sample)`}
        value={pct(h.share_faster_material)}
        sub={
          <>
            {pct(h.share_faster)} any change · slower by {atLeast(materialMonths(h))}: {pct(h.share_slower_material)} (
            {pct(h.share_slower)} any change; {worst(h)}) in-sample only, by construction
          </>
        }
      />
      <Stat
        label="Trial-months (in-sample)"
        value={
          <>
            {int(h.dividend_trial_months)} <span className="unit">trial-months</span>
          </>
        }
        sub={
          <>
            median T {num(h.median_T_base)} → {num(h.median_T_new)} months
          </>
        }
      />
    </div>
  )
}

/** The in-sample result of a clear (Clear it and Portfolio clearing), as a Calm section: the claim, one plain
 *  sentence, the qualifiers that change what the numbers mean (always visible), and a compact chart of the three
 *  comparisons that matter, drawn with equal weight: the capped allocation, site selection alone, and what
 *  coordination adds on top of it. `qualifiers` adds lines (the portfolio's background trials); `details` is the
 *  secondary content (inline in Detailed, a closed disclosure in Simple). */
export function InSampleResult({ r, qualifiers, details }: { r: ClearResult; qualifiers?: ReactNode; details?: ReactNode }) {
  const s = r.summary
  const h = s.coord_vs_actual
  const sel = s.indep_vs_actual
  const pure = s.coordination_no_loser_vs_indep
  const calib = calibrationRatio(s.calibration_check)
  const fromSelection = isNum(pure?.ratio) && pure.ratio < 1.05
  return (
    <Section
      id="rs-result"
      title="In-sample model result (not a claim)"
      lede={
        <>
          {r.params.sponsor
            ? `Reassigning ${r.params.sponsor}’s trials jointly among its own registered sites, capped so no trial is slower than registered,`
            : 'Choosing every trial’s sites jointly, capped so no trial is slower than registered,'}{' '}
          gives an in-sample ratio of{' '}
          <span className="num rs-fig">{times(h.ratio)}</span> against the registered sites.
          {pure && (
            <>
              {' '}
              On top of each trial’s own best response, coordination adds <span className="num rs-fig">{times(pure.ratio)}</span>
              {fromSelection
                ? ': the in-sample gain comes from choosing faster sites, which a single sponsor could do alone, not from coordinating trials.'
                : '.'}
            </>
          )}
        </>
      }
      qualifiers={
        <>
          <p className="rs-qual-line">
            <InSampleMark /> · <Gloss term="scored-by-model">scored by our enrollment model</Gloss>.{' '}
            <strong>Does not hold out of sample:</strong> see the held-out test on <a href="#findings/allocation">Findings</a>.
          </p>
          <p className="rs-qual-line rs-qual-muted">
            {int(h.trials)} trials compared · {int(s.background_trials)} held fixed as background (not in these numbers)
          </p>
          {calib !== null && calib > 1.25 && (
            <p className="rs-qual-line">
              <Qualifier info={NOT_LIKE_FOR_LIKE}>Calibration check:</Qualifier> model times for this instance’s Phase III trials are{' '}
              <span className="num">{num(calib, 1)}×</span> the median enrollment window of completed trials.
            </p>
          )}
          {qualifiers}
        </>
      }
      info={
        <>
          <span className="hc-title">Does not hold out of sample</span>
          These numbers are in-sample: the allocation is chosen and scored with the same site rates. They do not hold out of
          sample; the held-out test (choosing with older trials, scoring with newer ones) is reported on Findings. They are
          shown for transparency, not as a claim.
        </>
      }
      figure={
        <RatioLanes
          label="In-sample ratios of total trial-months, three comparisons"
          lanes={[
            { label: 'Capped at registered times', sub: 'vs registered sites', value: h.ratio, note: 'in-sample' },
            { label: 'Site selection alone', sub: 'best response vs registered', value: sel?.ratio ?? null, note: 'in-sample' },
            { label: 'Pure coordination, no losers', sub: 'vs each trial’s best response', value: pure?.ratio ?? null, note: 'in-sample' },
          ]}
        />
      }
      caption={
        <>
          Ratio = total trial-months, baseline ÷ alternative, scored by our enrollment model with the same site rates used to
          choose the sites (in-sample). 1.00× = no gain.
        </>
      }
      details={details}
      detailsLabel="Details: headline numbers and comparisons"
    />
  )
}

export function DecompositionTable({ r, compact }: { r: ClearResult; compact?: boolean }) {
  const s = r.summary
  const thr = atLeast(materialMonths(s.coord_vs_actual))
  return (
    <div className="table-scroll">
      <table className={`tbl${compact ? ' tbl-compact' : ''}`}>
        <thead>
          <tr>
            <th>Comparison</th>
            <th className="num">Ratio</th>
            <th className="num" title="Median over trials of T baseline ÷ T alternative">
              Median per-trial ratio
            </th>
            <th className="num" title={`Share of trials faster by ${thr}; below it, the share faster by any amount (near-ties included)`}>
              Faster {thr}
            </th>
            <th className="num" title={`Share of trials slower by ${thr}; below it, the share slower by any amount (near-ties included)`}>
              Slower {thr}
            </th>
            <th className="num">Worst slowdown</th>
            <th className="num">Trial-months</th>
            <th className="num">Median T (mo)</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISONS.map(({ key, label, detail, headline }) => {
            const c = s[key]
            if (!c) return null
            return (
              <tr key={key} className={headline ? 'row-on' : ''}>
                <td>
                  <div className="strong">{label}</div>
                  {!compact && <div className="muted small">{detail}</div>}
                </td>
                <td className="num strong">{times(c.ratio)}</td>
                <td className="num">{times(c.median_speedup)}</td>
                <td className="num">
                  <ShareCell material={c.share_faster_material} any={c.share_faster} />
                </td>
                <td className={`num${((isNum(c.share_slower_material) ? c.share_slower_material : c.share_slower) ?? 0) > 0 ? ' neg' : ''}`}>
                  <ShareCell material={c.share_slower_material} any={c.share_slower} />
                </td>
                <td className="num nowrap">{worst(c)}</td>
                <td className="num">{int(c.dividend_trial_months)}</td>
                <td className="num nowrap">
                  {num(c.median_T_base)} → {num(c.median_T_new)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function AssumptionsUsed({ a }: { a: Assumptions }) {
  const b = betaInfo(a)
  return (
    <div className="raw-grid small">
      <div>
        <span className="muted">Congestion elasticity β</span>
        <div className="tnum">
          {b ? num(b.beta, 3) : '—'}
          {isFullSampleBeta(b) && (
            <>
              {' '}
              (95% CI {num(b.ci95[0], 3)} to {num(b.ci95[1], 3)})
            </>
          )}
        </div>
        {isFullSampleBeta(b) && <div className="strong">default β = full-sample estimate</div>}
        {b && <div className="muted">{b.source}</div>}
      </div>
      <div>
        <span className="muted">Site rates</span>
        <div>
          low-history rule <strong>{a.low_history}</strong>
          {/* low_history_n is the threshold (LOW_HISTORY_N), not a count of sites. */}
          {isNum(a.low_history_n) && <> (low history = fewer than {int(a.low_history_n)} past lung trials)</>}
          {isNum(a.level_factor) && <> · level factor ×{num(a.level_factor, 3)}</>}
          {isNum(a.rate_cap_q) && <> · capped at q{num(a.rate_cap_q * 100, 0)}</>}
        </div>
      </div>
      <div>
        <span className="muted">Site universe</span>
        <div>
          <strong>{a.universe}</strong>
          {isNum(a.candidate_sites) && <> · {int(a.candidate_sites)} candidate sites</>}
        </div>
        <div className="muted">
          {a.universe === 'registered'
            ? 'Only sites some trial in the instance actually registered.'
            : 'Any regional site with industry lung-trial history (includes idle sites).'}
        </div>
      </div>
      <div>
        <span className="muted">Other</span>
        <div>
          activation lag {num(a.activation_lag_months, 0)} mo
          {isNum(a.plausible_T_cap_months) && <> · trials over {int(a.plausible_T_cap_months)} mo held as background</>}
        </div>
      </div>
    </div>
  )
}

export function CalibrationLine({ c }: { c: CalibrationCheck }) {
  const same = c.same_trials_model_vs_realized
  const ratio = calibrationRatio(c)
  return (
    <div className="small">
      <div>
        Model median time for this instance’s Phase III trials at their registered sites:{' '}
        <strong className="tnum">{num(c.model_median_T_actual_phase3)} mo</strong> ({int(c.phase3_trials_in_instance)} trials).
        Completed industry Phase III lung trials: median enrollment window{' '}
        <strong className="tnum">{num(c.real_completed_phase3_median_enrollment_window)} mo</strong> (start to primary completion{' '}
        {num(c.real_completed_phase3_median_start_to_primary_completion)} mo × an assumed enrollment fraction; n ={' '}
        {int(c.real_n)}).
        {ratio !== null && ratio > 1.25 && (
          <>
            {' '}
            <Badge tone="warn">{num(ratio, 1)}× longer than completed trials</Badge>
          </>
        )}
      </div>
      <div className="muted">{NOT_LIKE_FOR_LIKE} The same-trial check below is the calibration test.</div>
      <div className="muted">
        Same trials, model vs realized:{' '}
        {same.n >= 5 && isNum(same.median_model) ? (
          <>
            median {num(same.median_model)} vs {num(same.median_realized)} mo (n = {int(same.n)})
          </>
        ) : (
          <>not available (n = {int(same.n)}; needs a past as-of date with finished trials)</>
        )}
      </div>
    </div>
  )
}
