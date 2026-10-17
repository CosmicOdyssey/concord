"""Task C: transfer surplus of the joint optimum.

    python -m concord.analysis.transfer_surplus --out ../data/robustness/transfers.json

Question. The joint optimum (coord_free) has fewer total enrollment months than registered sites
and than every trial's best response, but some trials are slower under it. If winners gain more
than losers lose, priority credits paid by winners to losers (in proportion to months lost) could
leave every trial no worse off. How big is the net surplus, in-sample and held-out? No auction is
implemented; this only totals gains and losses and checks a simple compensation rule.

PRE-REGISTERED METHOD (written and committed before any result of this task was computed)

Scenarios (estimated beta, all other params at service.Params defaults)
  primary    US-Northeast, service.Params().
  secondary  Params(region="US", sponsor="Regeneron", as_of="2024-09-01") (portfolio mode: only
             Regeneron trials move; other sponsors' trials are fixed background).
Capacity
  peak       default k_s = historical peak concurrency (PRIMARY).
  unlimited  capacity_unlimited=True (contrast: task B found the joint optimum's gain over best
             response is almost all capacity, so the surplus should mostly vanish here).

Solver. Deterministic, exactly as task B's Fix 1: the allocations of service.solve, with
  core.coordinate(patience=0, max_passes=2, time_limit=900) (service.RESOLVE: greedy + 2 local-search
  passes, no exchanges, no kicks); the 900 s limit is a safety bound that must not bind (every solve
  records hit_time_limit). Reason: task B showed that service.solve's 6 s wall-clock budget gives
  different allocations under different CPU load, so its numbers are not reproducible. This is a
  departure from the brief's "run = service.solve(params, b_choose, cache=False)"; the allocation
  definitions, starts and caps are unchanged. Context only (never in place of the numbers above):
  one run of the unchanged service.solve (6 s) for US-Northeast at peak (full history and both
  directions), with --wallclock-context.

Allocations (service.solve definitions)
  actual         registered CT.gov site lists           (baseline 1)
  indep          each trial's best response            (baseline 2)
  coord_free     joint optimum, losers allowed          (the NEW allocation; PRIMARY)
  coord          no-loser vs registered                 (secondary: best found WITHOUT transfers, vs actual)
  coord_nl_indep no-loser vs best response              (secondary: best found WITHOUT transfers, vs indep)
Comparisons: coord_free vs actual, coord_free vs indep (PRIMARY pair); coord vs actual and
  coord_nl_indep vs indep (the no-transfer alternatives, scored the same way).

Quantities for one comparison (base, new) on one vector of T (months), weights w_i = 1
  M  = movable trials of the build that CHOSE the allocations (inst.movable); Bg = the other trials
       (background: held at registered sites; affected only through congestion).
  delta_i = T_base_i - T_new_i (positive = gain), EPS = 1e-6 months.
  winners = #{i in M: delta_i > EPS}; losers = #{i in M: delta_i < -EPS}; also counted at a
       material threshold of 1 month.
  G    = sum_{i in M} max(delta_i, 0)            gains of winning trials (trial-months)
  L    = sum_{i in M} max(-delta_i, 0)           losses of losing movable trials
  L_bg = sum_{i in Bg} max(-delta_i, 0)          losses of background trials whose T rises
         (split into flagged-implausible background, T_registered > 120 months under the same rates,
         and the rest, which in portfolio mode are other sponsors' trials); G_bg (background gains)
         is reported as context and NOT credited to S.
  S    = G - L - L_bg                            NET SURPLUS (PRIMARY), and S/G.
  Check: G - L must equal service.compare(T_base, T_new, M)["dividend_trial_months"] (asserted).
  Scale: S / sum_{i in M} T_base_i (surplus as a share of baseline trial-months).
  Unfilled trials (T >= core.NO_SITES_T under base or new) are counted; if any, S is also reported
  without them (the pre-registered S keeps them).

Compensation (ex ante; computed only if S > 0)
  credit_i  = max(-delta_i, 0) for every losing trial, movable or background (months lost);
  payment_i = max(delta_i, 0) * (L + L_bg) / G for every winning movable trial.
  Sum of credits = sum of payments = L + L_bg (budget balanced), and net_i = delta_i + credit_i -
  payment_i >= 0 for every trial by construction. Reported: share of gains winners keep
  1 - (L + L_bg)/G (= S/G), total credits, largest single credit and payment. If S <= 0 no scheme is
  reported ("no surplus") and the shortfall -S is.

In-sample: rates fit on full history (the DB), allocations chosen and scored with them.

Held-out: alternating split, recruitment.split_alternating (fixed definition). For (choose, score)
  in (A, B), (B, A):
    rates_h = recruitment.fit_rate_table(con, keep=lambda t: split.get(t) == h)
    b_c = service.build(params, rates=rates_choose); run = deterministic solve on b_c
    b_s = service.build(params, rates=rates_score, movable=b_c.inst.movable)
    T_held = service.rescore(b_s, run["x"])
  (a) half in-sample: the quantities above on run["T"] (choose rates): context for shrinkage.
  (b) held-out: the quantities above on T_held, with M = b_c.inst.movable.
  (c) EX POST test of the ex-ante scheme: credits and payments from the half in-sample deltas
      (a), realized deltas from T_held. Realized net_i = delta_held_i + credit_i - payment_i for
      every trial (background trials never pay; they hold a credit only if they lost in (a)).
      Reported: trials with realized net < -EPS (PRIMARY ex post count; movable and background
      separately), trials with realized net < -1 month, total shortfall (sum of negative realized
      nets), largest shortfall, and realized total surplus = sum over all trials of realized net
      (= sum of delta_held over all trials, since transfers balance). If S <= 0 in (a), there is no
      scheme and (c) is n/a.
  Aggregation over the two directions: arithmetic mean of G, L, L_bg, S and of counts; the mean
  S/G is mean S / mean G.
  Sensitivity (task B's Fix 2, reported beside, never in place): screened set M_s = M minus trials
  with T_registered > 120 months under the score half's rates. Held-out quantities and ex post
  counts restricted to M_s (background unchanged); ex-ante transfers unchanged.

Reading rules (fixed now)
  - PRIMARY number: US-Northeast at peak, coord_free vs indep, held-out mean S (trial-months) and S/G;
    coord_free vs actual reported beside it with equal prominence.
  - "Positive surplus" (the condition task G uses) means held-out S > 0 in BOTH directions for
    US-Northeast at peak vs best response. If in-sample S > 0 but this fails, it is reported as
    "positive in-sample only".
  - Value of transfers: S(coord_free vs base) - S(no-loser allocation vs the same base), i.e. coord
    vs actual and coord_nl_indep vs indep, in-sample and held-out. Positive means the joint optimum
    plus transfers beats the best allocation found without transfers. Reported as is.
  - The ex-ante scheme "holds out of sample" only if no movable trial has realized net < -1 month in
    either direction; otherwise the count, shortfall and largest shortfall are the result.
No parameter is tuned; every number is reported, including ones that weaken the pitch.
"""
