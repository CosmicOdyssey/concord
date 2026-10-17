# Recruitment causality acceptance

## Finding

Saving sponsor money alone does not accelerate enrollment. Concord's matched synthetic comparisons correctly preserve timing when only administration changes or support has zero assumed effect. Faster outputs arise from extra assumed usable recruitment capacity or an explicitly entered rate multiplier. No causal effect on actual recruitment has been measured.

## Mechanisms actually implemented

| Mechanism | Implementation and limit |
|---|---|
| Administrative efficiency | Reduces central administration only when savings_realized=true; does not alter rates, target, hospital caps or clinical care |
| Additional sites | Adds static trial/site edges with fixed activation charges, delay, ongoing costs and assumed rates; proportional shared hospital capacity can bind |
| Better allocation | Searches additions/removals/swaps; may reallocate from baseline, subject to expected no-loser if enabled. Bounded heuristic can miss good networks |
| Patient assistance | Minimum support preserved; extra support defaults to zero rate effect. Any nonzero effect is a user assumption, not literature-calibrated |
| Recruitment operations | Fixed investment per trial with explicit hypothetical 15% default rate increase; cannot exceed shared hospital cap |
| No useful reinvestment | With no productive candidates/effect, savings remain unspent and modeled time unchanged |

New hospitals are not proven independent patient sources. Shared hospital capacity is modeled, but eligibility overlap, catchment overlap and recruitment competition from external trials are unknown. Portfolio Instance uses beta=0; there is no separately calibrated congestion-elasticity effect. Legacy research beta sensitivity is replay/unverified and cannot substitute for this missing population model.

## Matched comparisons actually reproduced

Seed 7, 128 independent mean-one lognormal edge shocks, spread 0.25, common draw bank for every strategy/candidate. Budget $3 million, 36 months, 40 simulated remaining participants in each Regeneron-context trial. Administrative realization explicitly switched on. All costs include held unknown-responsibility reserve; they are not all cash spending.

| Strategy | Expected final months | Expected USD + reserve | Conservative USD | Expected trial months (05800015 / 05785767) |
|---|---:|---:|---:|---|
| A Fixed baseline | 15.13 | 1,018,304.91 | 1,133,866.40 | 12.77 / 14.78 |
| B Financial efficiency | 15.13 | 943,304.91 | 1,058,866.40 | 12.77 / 14.78 |
| C More sites | 9.94 | 1,050,576.45 | 1,309,266.40 | 8.08 / 9.9 |
| D Participant support | 15.13 | 967,304.91 | 1,082,866.40 | 12.77 / 14.78 |
| E Better allocation | 9.94 | 1,125,576.45 | 1,384,266.40 | 8.08 / 9.9 |
| F Joint portfolio optimization | 9.53 | 1,097,829.59 | 1,359,266.40 | 7.85 / 9.5 |

A→B releases $75,000 without changing any duration. B→D spends $24,000 on extra support without assumed rate benefit and reports no gain. C adds sites and uses realized savings; its speed gain cannot be attributed to administration alone. E searches allocation without the savings assumption, producing the same timing as C here at $75,000 higher cost. E is not generally an equal-spend comparison: compare its explicit ledger to A. F combines savings, network changes and assumed operations effects. Its extra gain is conditional on that unvalidated rate effect. The baseline already has enough budget to afford C/E: this example does not prove that savings were necessary to unlock their capacity.

In an independent one-site case, administration falls by $25,000 but every strategy remains exactly 3.5 months. Increasing budget when no useful candidate exists cannot create an enrollment improvement. Increasing budget when productive affordable candidates become feasible does reduce modeled time. Activation delays can remove that gain; all incomplete draws remain infeasible.

## Uncertainty and trade-offs

The same seed regenerates identical scenario arrays. Rate-spread and activation-delay changes were tested; hospital-capacity constraints were checked against independent Fraction schedules. Distributions are assumptions, with independent edge shocks rather than correlated real-world site/trial uncertainty. Optimization and reporting share the draw bank, making comparisons in-sample sensitivity. P10–P90 bands and deadline draw fractions are not calibrated prediction intervals/probabilities. A no-loser setting compares each trial's mean capped time, not every participant, site, or individual draw. Disabling it permits losing trials; tests disclose individual outcomes instead of hiding them in an average.

The shared-capacity model captures operational competition only. No overlap coefficient can be meaningfully calibrated from this synthetic dataset. Congestion-coefficient sensitivity for historical predictions is blocked by missing historical inputs and unresolved leakage; no corrected coefficient or predictive result is invented.

## Historical claim correction

A start-before-cutoff training rule admits outcomes recorded after cutoff. A regression proves this with an explicitly synthetic 2017-start/2022-completion record at a 2018 evaluation date. Current site lists and histories also cannot establish historical availability. No corrected historical backtest has been run because dated snapshots are missing. Archived speedups and error ratios remain available as clearly UNVERIFIED research artifacts. The Findings API/frontend labels were corrected without overwriting historical files.

Do not claim that financial coordination, insurance coverage or these allocations accelerate actual trials. A defensible demonstration says: “Under these disclosed hypothetical rates, costs and capacity assumptions, the live model computes these paired financial and timing differences.” A real causal claim needs validated as-of prediction, operational implementation, measured recruitment, and a design addressing overlap, temporal confounding and changing trial eligibility.
