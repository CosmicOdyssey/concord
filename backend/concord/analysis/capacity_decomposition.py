"""Task B: where the joint optimum's gain over best response comes from (capacity or congestion).

    python -m concord.analysis.capacity_decomposition --out ../data/robustness/capacity.json

Question. In US-Northeast at the estimated congestion elasticity, the joint optimum (coord_free)
beats every trial's best response (indep) by 1.57x on summed enrollment months, while ~42% of
trials end up slower. Site capacity k_s is each site's historical peak concurrency. Is the gain
from allocating scarce slots at proven sites (capacity), or from congestion between trials?

PRE-REGISTERED METHOD (written and committed before any result of this task was computed)

Scenarios
  primary    US-Northeast, service.Params() defaults (estimated beta, low_history="model",
             universe="registered", time_limit=6.0, ...).
  secondary  Params(region="US", sponsor="Regeneron", as_of="2024-09-01") (portfolio mode: only
             Regeneron trials move, other sponsors' trials are fixed background). Run if time allows.

Settings (all other params at the scenario defaults; all at the estimated beta unless stated)
  peak            default k_s = historical peak concurrency
  unlimited       capacity_unlimited=True (capacity never binds)
  peak+1          capacity_add=1
  1.5x peak       capacity_scale=1.5
  beta=0 at peak  beta=0.0 (no congestion at all; calibration then also has no de-congestion)

Per setting, in-sample (rates fit on full history, as in production):
  run = service.solve(params, cache=False); blocks = service.comparisons(run["T"], movable).
  Reported blocks: coord_free_vs_indep (PRIMARY), coord_free_vs_actual, coord_vs_actual,
  indep_vs_actual, coordination_no_loser_vs_indep; stats ratio, median_speedup, share_slower
  (plus the rest of each compare() block in the JSON).

Per setting, held-out (same machinery as the pitch-blocking holdout task A, defined here so this
task is independent of it):
  split = recruitment.split_alternating(con)   (fixed definition; not changed here)
  rates_h = recruitment.fit_rate_table(con, keep=lambda t: split.get(t) == h) for h in A, B
  for (choose, score) in (A, B), (B, A):
      b_choose = service.build(params, rates=rates_choose)
      run      = service.solve(params, b_choose, cache=False)
      b_score  = service.build(params, rates=rates_score, movable=b_choose.inst.movable)
      T_held   = service.rescore(b_score, run["x"])
      half in-sample = comparisons(run["T"], mv); held-out = comparisons(T_held, mv)
  Aggregation over the two directions: geometric mean of ratio and of median_speedup; arithmetic
  mean of share_slower and share_faster (shares can be 0, so no geometric mean for them).
  Reported side by side: full-history in-sample | half-history in-sample (geo mean) | held-out
  (geo mean). The apples-to-apples optimizer's-curse shrinkage is half in-sample -> held-out.

Decomposition (pre-registered formulas; r = coord_free_vs_indep ratio of the setting named)
  capacity share of the joint-optimum gain = 1 - log(r_unlimited) / log(r_peak)
      PRIMARY on full-history in-sample ratios; also computed on half in-sample and held-out ratios.
      If r_peak <= 1 it is reported as n/a.
  congestion share (secondary) = 1 - log(r_beta0) / log(r_peak), same conventions. The two shares
      come from different counterfactuals and need not add to 1.
  dependence on k_s = historical peak: log(r_setting) / log(r_peak) for peak, peak+1, 1.5x peak,
      unlimited, i.e. the share of the peak gain left as capacity is relaxed; reported for the
      joint optimum vs best response and also for the headline coord_vs_actual and for
      indep_vs_actual (how the pitch numbers move with the capacity assumption).
  Reading rule (fixed now): if capacity share >= 0.8, the gain is called capacity-driven
  ("allocating scarce slots at proven sites"); if <= 0.2, not capacity-driven; otherwise mixed.

Diagnostics (reported, never substituted for the numbers above)
  - unfilled trials: movable trials with T >= core.NO_SITES_T under each allocation; if any
    exist under indep or coord_free, also the coord_free_vs_indep ratio over trials filled under both.
  - dividend concentration: share of the coord_free_vs_indep dividend (sum T_indep - sum T_free over
    movable trials) contributed by the 10% of movable trials with the largest individual gain.
  - capacity binding: sites at capacity (load >= k_s) under indep and coord_free; share of movable
    trials' site slots placed at proven sites (n_hist >= 5 lung trials, the build's "experienced"
    rule) under actual, indep and coord_free.
  - solver: stats per solve (hit_time_limit etc.); and one solver-noise check, the peak setting
    in-sample re-solved with time_limit=12, reported only as a measure of solver noise.

No parameter is tuned; every number that comes out is reported, including ones that weaken the pitch.
"""

from __future__ import annotations
