import type { Assumptions, BetaInfo, CalibrationCheck, ClearResult, Comparison, ComparisonKey } from './api'
import { Badge, Caveat, Stat } from './components'
import { int, isNum, money, num, pct, times } from './format'

export const COMPARISONS: { key: ComparisonKey; label: string; detail: string; headline?: boolean }[] = [
  {
    key: 'coord_vs_actual',
    label: 'Headline: coordinated, no trial worse off (vs registered)',
    detail: 'Joint optimum, constrained so no trial is slower than at the sites its sponsor registered.',
    headline: true,
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
  if (typeof a.beta === 'number') return { beta: a.beta, ci95: [NaN, NaN], source: 'scenario value' }
  return a.beta ?? null
}

function worst(c: Comparison): string {
  if (!isNum(c.worst_slowdown_months) || c.worst_slowdown_months <= 1e-6) return 'none slower'
  return `${num(c.worst_slowdown_months)} mo`
}

export function HeadlineBlock({ r }: { r: ClearResult }) {
  const s = r.summary
  const h = s.coord_vs_actual
  return (
    <div className="headline card">
      <div className="headline-title">
        <h2>No trial worse off vs what sponsors registered</h2>
        <span className="muted small">
          {int(h.trials)} trials compared · {int(s.background_trials)} held fixed as background (not in these numbers)
        </span>
      </div>
      <div className="stats">
        <Stat
          emphasis
          label="Enrollment-time ratio"
          value={times(h.ratio)}
          sub={<>Total trial-months, registered ÷ coordinated</>}
        />
        <Stat label="Median per-trial speedup" value={times(h.median_speedup)} sub="T registered ÷ T coordinated" />
        <Stat
          label="Trials faster"
          value={pct(h.share_faster)}
          sub={
            <>
              {pct(h.share_slower)} slower ({worst(h)}) by construction
            </>
          }
        />
        <Stat
          label="Coordination dividend"
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
        <Stat
          label="Dollar conversion"
          value={money(s.dollars_direct)}
          sub={
            <>
              direct cost · {money(s.dollars_lost_sales)} lost-sales equivalent · {int(s.dividend_days)} trial-days
            </>
          }
        />
      </div>
      <Caveat>
        <strong>Dollar caveat:</strong> {s.dollars_note}
      </Caveat>
    </div>
  )
}

export function DecompositionTable({ r, compact }: { r: ClearResult; compact?: boolean }) {
  const s = r.summary
  return (
    <div className="table-scroll">
      <table className={`tbl${compact ? ' tbl-compact' : ''}`}>
        <thead>
          <tr>
            <th>Comparison</th>
            <th className="num">Ratio</th>
            <th className="num">Median speedup</th>
            <th className="num">Faster</th>
            <th className="num">Slower</th>
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
                <td className="num">{pct(c.share_faster)}</td>
                <td className={`num${(c.share_slower ?? 0) > 0 ? ' neg' : ''}`}>{pct(c.share_slower)}</td>
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
          {b && isNum(b.ci95[0]) && (
            <>
              {' '}
              (95% CI {num(b.ci95[0], 3)} to {num(b.ci95[1], 3)})
            </>
          )}
        </div>
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
  const ratio =
    isNum(c.model_median_T_actual_phase3) && isNum(c.real_completed_phase3_median_enrollment_window)
      ? c.model_median_T_actual_phase3 / c.real_completed_phase3_median_enrollment_window
      : null
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
      <div className="muted">
        Not like for like: a snapshot of recruiting trials over-represents slow ones (length-biased sampling)
        and their site lists are still growing. The same-trial check below is the calibration test.
      </div>
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
