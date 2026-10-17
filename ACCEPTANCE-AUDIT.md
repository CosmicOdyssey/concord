# Concord independent acceptance audit

Audit date: 2026-10-17. Campaign: CONCORD-INDEPENDENT-ACCEPTANCE.

## Decision

**Do not merge original PR #2 as-is.** A reproduced P0 timing defect and essential P1 cache/evidence defects require the isolated remediation commits below. The remediated checkout supports a local, explicitly synthetic operational demonstration with real registry context. Full end-to-end acceptance remains LIMITED because browser downloads were blocked by organization policy. Historical predictive performance is UNVERIFIED, and the optimizer is a bounded heuristic with a demonstrated 200% optimality gap on one constructed case. No real clinical acceleration or realized economic saving is established.

No merge, push, deployment, premium provider call, or new agent invocation was performed during this audit. Original PR states were preserved. This audit is independent reference testing by Codex, not a second-provider or independent-human certification.

## Exact repository state

| Item | Verified state |
|---|---|
| PR #1 | MERGED to main; head 89e75752db40f482856c66b019df543e6802bdcc |
| PR #1 merge | f51b13fa7c84dbd9f06b331b906500c28403e40b |
| PR #2 | OPEN, draft, main base; head 59f0c33d52d7928fd136b3c58c4db87b87c0836c |
| Ancestry | PR #1 head → its merge → PR #2 head; PR #2 already includes Financial Coordination |
| Audit branch | codex/concord-independent-acceptance; based on exact PR #2 head |
| Audited runtime code after remediation | 555f3f86efaa338de1eff45570af3f4d0a1c38d9 |
| CI | No .github workflow; GitHub statusCheckRollup empty. Remote CI is NOT_CONFIGURED, not passed |

Original source hashes and GitHub state are preserved in docs/acceptance/original-state.json. PR #2's original checkout remained clean at its original SHA. Applying the PR #2 descendant to main retains PR #1 rather than requiring a second conflicting merge. No original allocator source was changed.

## Verified defects and bounded remediation

| Severity | Trigger / original behavior | Remediation and regression |
|---|---|---|
| P0 | Omit horizon from API request; 7 participants at rate 2 completes in 3.5 months but reports 3 due to integer NumPy storage | 2e89334a4008e9d3706278c8215a631e9ee771d9: dtype=float; direct ASGI and independent Fraction regressions |
| P1 | Research robustness GET with changed capacity or activation delay returns incompatible stored output with HTTP 200 | 63ffadfca23b24e0c649ec2e9fe64d0023e64313: compare complete saved parameters, reject mismatch with 409, label compatible artifact replay |
| P1 | Leaky historical allocation speedups promoted in visible headline | Same commit: UNVERIFIED/provisional, archived table labels; underlying research files preserved |
| P1 | Load saved Portfolio Command evidence but banner still says LIVE COMPUTATION | Same commit: saved replay badge, delivery response header, snapshot HTML labeling |
| P1 | Browser found archived 1.9x prediction-error table still marked Final | 555f3f86efaa338de1eff45570af3f4d0a1c38d9: implication section UNVERIFIED/provisional with regression |

Each defect was reproduced before correction. See original-*.log and remediation-*.log. The last commit also includes financial stress regressions developed during the audit. Changes add no product feature and do not change the search architecture or invent a historical correction.

## Integration matrix

| Component | Actual integration / acceptance limit |
|---|---|
| Existing allocator | Original allocator Instance supplies feasibility, slots, weights and remaining-target contract; legacy solvers unchanged |
| Financial Coordination | Its original single-trial planner, coverage worksheet and economics are retained and browser-checked |
| Portfolio manager | New PR #2 endpoints under /api/portfolio-command, six strategies, static selected trial/site networks |
| Shared site capacity | Event simulator proportionally shares each hospital cap between active unfinished trials and releases it at completion |
| Coverage | Reuses Financial Coordination; fixed across portfolio strategies, never optimized to shift billing |
| Recruitment | Portfolio uses synthetic fluid rates and lognormal shocks, not fitted historical rates; legacy history remains leaky |
| Persistence | Immutable content-digested results, atomic publish, tamper/identifier validation; saved retrieval is replay |
| Reports | JSON equality and embedded HTML evidence verified against actual API and browser values; browser download delivery blocked |
| Navigation | Findings, Financial Coordination, Portfolio Command and Research navigated in actual Chrome |
| API compatibility | Existing endpoints retained; incompatible robustness artifact requests intentionally change from misleading 200 to explicit 409 |

## Mathematical problem actually implemented

For selected edges x and draw d, raw rate is r_e × z_ed × (1 + selected support effect + selected operations effect). At hospital s the rate is scaled by min(1, C_s / sum_active raw rates). Activation, trial completion and horizon are events. Remaining enrollment is continuous fluid mass; it is not observed people or a patient-level simulation.

Decision variables: a static subset of trial/site edges; joint search also compares portfolio-wide operations/support flags. More-sites strategy only adds edges to the baseline. General reallocation may remove baseline edges. Baseline activation costs are sunk; monthly and variable costs remain payable. Existing allocations are preserved only in add-only strategies, not universally.

Objectives in backend/concord/portfolio.py:run are empirical means over the SAME common draw bank:

- weighted_makespan: mean_d max_i(priority_i × T_id).
- sum_duration: mean_d sum_i(priority_i × T_id).
- min_cost_deadline: expected sponsor costs including contingency, subject to each trial's expected completion meeting its deadline.

The unweighted final completion mean_d max_i T_id is displayed separately. It is not interchangeable with max_i mean_d T_id. Deadlines and no-loser restrictions constrain expected trial durations, not every draw. All assumed draws must complete before the horizon for a recommendation. Other constraints: usable assumed inputs, static hospital slots, shared monthly caps, conservative sponsor commitment ≤ fixed budget, per-trial modeled hospital-contribution floor. Unknown/infeasible edges are rejected. Horizon-censored networks are infeasible, not claimed completed.

Search is deterministic beam width 3, depth 3, at most 96 visited networks per search. There is no global optimum certificate. The independent oracle in backend/tests/acceptance_reference.py uses scalar Fraction arithmetic, exhaustive subsets, and independent costs/constraints. It does not call production simulation/pricing/search; coverage totals are held fixed inputs, with separate accounting tests. Exact enumeration is limited to the small deterministic cases, not a proof for stochastic or arbitrary large portfolios.

Across 18 small cases, 15 matched exact feasible optima within output rounding and three correctly had no feasible recommendation after the timing fix; the nineteenth exposes a limitation. Four trials each need 12 participants. Three hospitals each offer rate 1 per trial, no binding cap, 4 slots. Baseline assigns each trial to A. B/C are affordable. Search reports 12 months; all 12 edges finish in 4 months at expected $298,239.84 / conservative $344,319.84. Gap = 8 months, 200% above optimum. A four-trial improvement plateau exceeds the search depth. Preserve the visible heuristic caveat; do not call its recommendation globally optimal.

35 additional seeded randomized schedules matched independent timing and edge enrollment to 1e-7. Feasible cases respected modeled budgets/caps/targets. Case details and both original/corrected outputs: docs/acceptance/numerical-original.json and numerical-corrected.json.

## Historical validity and original claims

load_history(before=...) filters trial start, not the availability date of final enrollment/completion outcomes. A synthetic negative control starting in 2017 and completing in 2022 enters training with a 2018 cutoff. selection_validation similarly uses start-year splits. Current/full-history site lists, completion windows and concurrency are not reconstructed from dated snapshots. Trial overlap is not evidence that all features/outcomes were known as-of the evaluation date.

| Archived claim | Corrected acceptance status |
|---|---|
| Northeast coordination 1.42x in-sample / about 1.05x held-out | Replayed original numbers; UNVERIFIED predictive performance |
| Regeneron time-held-out coordination 1.03x (0.97x / 1.09x), about 50% losing trials | UNVERIFIED; aggregate does not establish every trial benefits |
| Site prediction typical miss 1.9x vs naive 2.8x | UNVERIFIED; unavailable as-of training evidence |
| Synthetic demo 15.13 → 9.53 months | Reproduced assumed model computation, not historical correction or observed acceleration |

No valid corrected historical result is available. Rebuilding from today's registry would not recover what was known historically. Dated snapshots and outcome-availability rules are required before rerunning/claiming an as-of backtest. Observational congestion artifacts are not independently reproduced here and do not establish a causal effect. Portfolio competition has shared capacity, but no eligibility-overlap population or external-trial congestion model (Instance beta=0); those mechanisms cannot be claimed validated.

## Verification and release limits

Fresh original baseline: 412 passed / 43 skipped. Final backend: **443 passed / 43 skipped**, one Starlette httpx deprecation warning. Frontend: 4 financial + 6 portfolio contract tests passed; tsc -b and Vite production build passed. Lint exits 0 with 17 pre-existing warnings. Fleet exact-commit checks are recorded separately under ignored .fleet/state; only their actual current-SHA result is authoritative.

All skips and reasons are preserved in docs/acceptance/final-backend.log. Missing data/concord.db and data/ratecard.json prevent historical model, terms and site-score data-dependent validation. They block historical/live-registry claims; they do not prevent the checked-in synthetic portfolio computation. Research visibly returns 503 with the missing database command. No synthetic database was silently substituted.

Security: npm audit reports zero vulnerabilities; pip-audit reports no known vulnerabilities for the pinned requirements/transitives; bounded tracked-file credential-pattern scan finds no matches. These are advisory/limited scans, not penetration certification. Existing API has wildcard CORS and no multiuser authentication; bind local-only. No production or confidential-data release is accepted. Saved IDs are constrained, report text escaped, source endpoint restricted to cited checkout files; existing tests exercise integrity/error paths.

Full browser acceptance is **LIMITED**: computations, edits, navigation, accounting, labels, invalid inputs, missing data and saved restore were exercised. Both export links returned HTTP 200 in the server log, but Chrome showed “Blocked by your organization” and no new audit download was found. Direct HTTP content comparisons passed and are explicitly not substituted for browser delivery. Obtain policy-approved browser downloads and compare the actual downloaded files before removing this blocker.

The uploaded mission ends at “### 4. DEMO-E”; DEMO-EVIDENCE.md is the explicitly disclosed inferred fourth filename. Supporting financial and causal detail is in the two companion reports.

## Independent exact case results

| Synthetic case | Baseline final mo | Allocation final mo | Allocation feasible | Exact objective | Heuristic objective gap |
|---|---:|---:|---|---:|---:|
| one_trial_two_sites | 3.5 | 1.83 | True | 1.8333 | -0.0033 |
| fractional_default_horizon | 3.5 | 3.5 | True | 3.5 | 0.0 |
| two_trials_one_shared_hospital | 3.0 | 3.0 | True | 3.0 | 0.0 |
| independent_hospitals | 5.0 | 5.0 | True | 5.0 | 0.0 |
| staggered_activation | 10.0 | 6.0 | True | 6.0 | 0.0 |
| fast_site_unaffordable | 3.5 | 3.5 | True | 3.5 | 0.0 |
| cheap_but_too_slow | 14.0 | 14.0 | False | none | n/a |
| unknown_capacity | 3.5 | 3.5 | True | 3.5 | 0.0 |
| no_feasible_sites | 3.5 | 3.5 | False | none | n/a |
| budget_below_minimum | 3.5 | 3.5 | False | none | n/a |
| late_expensive_activation | 3.5 | 3.5 | True | 3.5 | 0.0 |
| different_variable_cost | 3.5 | 1.83 | True | 1.8333 | -0.0033 |
| budget_increase_no_candidates | 3.5 | 3.5 | True | 3.5 | 0.0 |
| one_dominant_trial | 10.0 | 10.0 | True | 10.0 | 0.0 |
| priority_weighted_max | 6.67 | 4.9 | True | 11.2 | 0.0 |
| priority_weighted_sum | 6.67 | 4.9 | True | 16.1 | 0.0 |
| losers_disclosed | 6.67 | 4.97 | True | 13.0909 | -0.0009 |
| same_no_loser_enabled | 6.67 | 4.97 | True | 13.0909 | -0.0009 |
| bounded_search_plateau | 12.0 | 12.0 | True | 4.0 | 8.0 |

## Required stress-case coverage

| Mission case | Evidence / outcome |
|---|---|
| 1 Budget increase, no candidates | budget_increase_no_candidates; no acceleration |
| 2 Budget increase, productive candidate | test_budget_and_sensitivity_counterfactuals; lower feasible time |
| 3 Below minimum budget | budget_below_minimum; no feasible recommendation |
| 4 Shared constrained hospital | two_trials_one_shared_hospital; exact event/reference agreement |
| 5 Dominant trial budget | one_dominant_trial; per-trial costs/outcomes in raw JSON |
| 6 Late expensive site | late_expensive_activation; delay and budget included |
| 7 Unknown hospital | unknown_capacity plus actual browser UNKNOWN edit; never treated verified |
| 8 No feasible sites | no_feasible_sites; explicitly infeasible |
| 9 Higher insurer expense, no sponsor saving | financial-stress.json payer-share counterfactual |
| 10 Admin savings, no gain | savings_without_useful_reinvestment; $25k reduction, 3.5mo unchanged |
| 11 Sponsor lower, hospital resources higher | financial-stress.json explicit counterfactual |
| 12 Sponsor lower, patient higher | responsibility shift: $2,110 shifted, zero resource change |
| 13 Priorities | priority_weighted_max versus other cases; explicit objective |
| 14 Objectives | weighted max, weighted sum and min-cost deadline cases |
| 15 Repeated identical | deterministic scenario equality test and real API repeat |
| 16 Modified cached inputs | robustness regression returns 409; browser stale marker and new result after edit |

Per-trial gains/losses and ledgers are retained in the raw case records. This finite test suite does not prove arbitrary-input global optimality or feasibility beyond the declared model.
