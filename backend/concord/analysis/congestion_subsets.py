"""F. Attenuation check: is the within-site congestion estimate biased toward zero by noise?

    python -m concord.analysis.congestion_subsets [--out data/robustness/congestion_subsets.json]

PRE-REGISTERED METHOD (written and committed before any subset number was computed)
==================================================================================

Question. The primary premise estimate (concord.analysis.congestion, within_overlap) is about -0.027,
95% CI about [-0.12, 0.07]; the service turns it into the default congestion elasticity
beta = max(0, -coef) = 0.026. Noise in the exposure (sites that run few lung trials, giant trials
whose per-site exposure is diluted, competitor pairs that barely share patients) would attenuate the
coefficient toward 0. Re-estimate on cleaner subsets and see whether the estimate moves.

Data. The private DB copy (CONCORD_DATA_DIR). Trials, rows, outcome, controls and exposures come
from concord.analysis.congestion.load() unchanged; this module imports load, _masks, _design,
_ols_cluster, _demean and _fmt and does not modify congestion.py or the DB meta.

Samples (restrict trial-site rows FIRST, then compute every estimator on the remaining rows exactly
as congestion.run() does for the measure "overlap"):
  full  all rows of load(). Must reproduce congestion.run(): coef and se of all nine estimators
        (pooled / site_fe / within x start / overlap / avg) are recomputed with this module's
        estimator code and asserted equal to congestion.run() on the same DB (abs diff < 1e-9).
  S1    rows at sites with site_model.n_hist >= 10 (site has >= 10 lung trials of any status;
        a site missing from site_model counts as n_hist = 0, i.e. dropped).
  S2    rows of trials with trials.n_sites <= 20 (registered site count, including anonymized
        sites, as stored in the trials table and used in congestion.py's outcome and weights).
  S3    all rows, but the overlap exposure is rebuilt from competitor pairs with eligibility overlap
        o_tQ >= 0.8 only: exposure = log(1 + sum_{Q rival, o_tQ >= 0.8} o_tQ), where
        o_tQ = |E_t & E_Q| / |E_t| on the same synthetic population as congestion._masks
        (n = 4000, seed 11), and rivals are defined exactly as in load() (other lung trials at the
        site with start_Q <= start_t < end_Q). Trials without a mask or with an empty mask get
        exposure 0, as in load(). Sanity check: with no threshold this rebuild must reproduce load()'s
        overlap column (abs diff < 1e-9).
  "Exactly as congestion.run()" means, per sample: outcome y_t = log(N_t / (tau_t * n_sites_t)) with
  n_sites_t from the trials table (not the number of rows left); pooled = trial-level OLS on the mean
  exposure over the trial's remaining rows + controls, SEs clustered by trial; site_fe = drop sites
  with < 2 remaining rows, rows weighted 1/n_sites_t, weighted site demeaning, CR1 SEs clustered by
  trial; within = on the site_fe rows, exposure minus the site's unweighted mean exposure, averaged
  over the trial's rows, trial-level OLS + controls. Controls: phase dummies, log n_sites, industry,
  start-year FE (congestion._design).

Reported per sample, for within_overlap (PRIMARY), site_fe_overlap and pooled_overlap:
  coef, 95% CI (coef +/- 1.96 se), p, number of trials (= clusters), number of trial-site rows
  (pooled: all remaining rows of the sample; site_fe and within: rows after the singleton-site drop),
  sites (site_fe), exposure mean / p90, and the implied beta = max(0, -coef) with CI
  [max(0, -hi), max(0, -lo)] (same mapping as service.congestion_beta). Also whether each CI
  excludes the model-implied -1 (master-doc beta = 1). For S3 also the share of rows with non-zero
  exposure (power diagnostic).

Decision rule (fixed now). Recommend changing the default beta ONLY if a subset's within_overlap
  (a) 95% CI excludes the full-sample within_overlap point estimate, AND
  (b) is well powered: >= 300 trials AND CI half-width <= 1.5 x the full-sample CI half-width.
  Otherwise recommend keeping the default (beta from the full-sample within_overlap).
  Three subsets are tested, so a Bonferroni-adjusted CI (coef +/- 2.394 se, alpha = 0.05/3) is
  reported beside each; a subset that meets the rule at 95% but whose Bonferroni CI still contains
  the full-sample estimate is flagged as weak evidence in the recommendation (the rule still decides).
  If more than one subset meets the rule: if all move in the same direction from the full-sample
  estimate, recommend the beta implied by the one with the smallest se; if they move in opposite
  directions, keep the default. The subsets overlap with the full sample, so (a) is a heuristic
  screen, not a formal test of a difference.
  The recommendation is advice only; this module never writes the DB meta or the default beta.

Interpretation (descriptive, not part of the rule): attenuation would show as subset estimates
more negative than the full sample. Estimates near 0 or positive in the cleaner subsets do not
support attenuation as the explanation for the small full-sample coefficient.
"""
