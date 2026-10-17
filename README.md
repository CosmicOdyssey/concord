# Concord

Tools for NSCLC trial portfolios on public ClinicalTrials.gov data. HackHarvard 2026, Regeneron track.

Concord started as a clearing mechanism that would allocate sites across concurrent trials at once.
Testing that idea on 7,221 NSCLC trials (see **Results**) showed that coordination gains largely
disappear out of sample and that competing trials barely slow each other within a site. So the product
now does things that need no forecasting:

- **Portfolio overlap audit** (`#overlap`): where a sponsor's own concurrently recruiting trials share
  registered sites and eligible patients, with the criteria that distinguish each pair. Counts and overlaps
  only.
- **Protocol to terms** (`#terms-flow`): a protocol's schedule of assessments becomes a coverage grid
  (routine care vs research-only, rule shown, reviewer override), a per-patient budget priced from the
  real CMS 2026 physician fee schedule with Medicare locality, a proposed standard non-procedure schedule,
  and a term sheet with provenance on every line. Decision support, not a fair-market-value legal opinion.
- **Site scores** (`#site-scores`): each U.S. site's historical lung-trial enrollment score, with every step
  that forms it (prior, the site's own trials, posterior, low-history cap), a 10th-90th range that counts how
  much a site's rate varies from trial to trial, and the observed-outcome check
  that says raw differences are overstated about 3x on the log scale. Historical evidence, not a forecast;
  the default order is history depth, not score.
- **Findings** (`#findings`): the research results that motivate both. The earlier clearing views live
  under **Research**, labelled as in-sample model outputs.

The home page (no hash, or `#home`) describes the two tools with live fragments of each (the Merck overlap
matrix, a two-site price comparison) and the research results; `#home/overlap`, `#home/terms` and
`#home/tested` open a section, and "See demo" opens Findings. The app header has a Simple | Detailed switch
(Simple for a first visit; the choice is remembered) and a Light / Dark / System theme switch. The look is the
"Calm" design system: tokens in `frontend/src/index.css`, shared building blocks in `frontend/src/components.tsx`.

Rule for the whole app: no view shows a predicted speedup, time-to-fill or enrollment rate as a product
claim. Site scores show past per-site rates as evidence, next to their validation, never as a forecast.

## Layout

```
backend/concord/
  ingest/ctgov.py         ClinicalTrials.gov API v2 crawler (stdlib only, resumable, ~45 req/min)
  ingest/normalize.py     raw pages -> SQLite (trials, sites, trial_sites); site dedupe; anonymized-site flag
  compiler/               eligibility text -> predicates; hand-encoded overrides; synthetic NSCLC population;
                          schedule-of-assessments DAG
  model/recruitment.py    Poisson-gamma site rates, low-history cap, backtest
  model/build.py          builds trial_model / site_model / meta tables
  analysis/congestion.py  does competition at a site slow enrollment? (regressions with site fixed effects)
  analysis/robustness.py  headline under each congestion elasticity x site-rate rule
  allocator/core.py       congestion model, best-response baseline, greedy + local search + exchanges + ILS,
                          no-loser caps, fixed background trials
  ratecard/cms.py         loads the real CMS physician fee schedule (RVU + GPCI) and, if supplied, CLFS
  ratecard/medicare.py    rate card, coverage grid, standard schedule, term sheet
  service.py              instance builder (region, date, sponsor); the four allocations; price tags
  site_scores.py          site score breakdown (replicates the rate fit to keep per-trial allocations), calibration
  api/main.py             FastAPI
frontend/                 Vite + React + TS
scripts/pipeline.sh       crawl -> normalize -> build -> congestion test -> CMS rates -> robustness grids
```

## Run it

```bash
# backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # macOS/Linux: .venv/bin/pip
../scripts/pipeline.sh                             # ~10 min: crawl, fit, tests of the premise, grids
.venv/Scripts/python -m pytest
.venv/Scripts/python -m uvicorn concord.api.main:app --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev          # http://localhost:5173, proxies /api -> :8000
```

## API

| Endpoint | What |
|---|---|
| `GET /api/findings` | findings page content (`data/findings/findings.json`, built by `python -m concord.findings`) |
| `GET /api/findings/self-overlap` | same-sponsor overlap statistic (`data/findings/self_overlap.json`) |
| `GET /api/overlap/sponsors?as_of&region` | sponsors with >= 2 lung trials recruiting on a date |
| `GET /api/overlap?sponsor&as_of&region` | a sponsor's concurrent trials, pairwise shared sites, eligibility overlap, criteria diff |
| `GET /api/terms-flow/trials` | demo protocols (illustrative, authored from public trial information) |
| `GET /api/terms-flow/{nct}/protocol, /sites, /budget, /compare, /termsheet.md, /termsheet.html` | schedule of assessments, coverage, site budget, two-site comparison, term sheet export |
| `GET /api/site-scores?region&state&q&min_trials&sort&limit&offset` | U.S. identifiable sites with at least one fitted trial; default sort fitted trials (desc) |
| `GET /api/site-scores/summary` | method, prior, history-depth buckets, histogram, validation and calibration blocks |
| `GET /api/site-scores/{site_id}` | one site's full breakdown: prior, data, posterior, cap, calibrated value, contributing trials |
| `GET /api/status` | crawl state, counts, model prior, backtest, congestion test |
| `POST /api/clear` `{region, as_of, sponsor, beta, low_history, universe, ...}` | registered vs best-response vs coordinated allocations (free and no-loser) |
| `GET /api/robustness?<scenario>` | headline under each congestion elasticity x site-rate rule (precomputed) |
| `GET /api/congestion-test` | regression results for the premise |
| `GET /api/sponsors?region&as_of` | sponsors with several concurrent trials (portfolio mode) |
| `GET /api/trials/{nct}/price-tags` | months of enrollment each eligibility criterion costs |
| `GET /api/slot-values` | where one more trial slot is worth the most |
| `GET /api/protocol/demo` | demo schedule-of-assessments DAG |
| `GET /api/termsheet?site_id&nct_id` | capability check, coverage grid, budget, ACTA-style terms |
| `POST /api/compile/eligibility` `{text}` | criteria text -> predicates with provenance |

Interactive docs at `http://localhost:8000/docs`.

## Results (17 Oct 2026, after trying to break them)

> **Status, 17 Oct.** Sections 3-4 report the final rerun of the pre-registered holdout (task A's script,
> unchanged). These are research results, not product claims: the app shows no predicted speedups.

### 1. Does congestion slow enrollment? Not measurably within a site, and far less than the model assumed.

`analysis/congestion.py`: 3,442 completed lung trials, 68k trial-site rows. Outcome: log per-site-month
enrollment rate. Exposure: competitors recruiting at the same site when the trial started (fixed in
advance; counting over the whole window would mechanically penalize slow trials), weighted by
eligibility overlap. Controls: phase, site count, sponsor type, start year. Standard errors are two-way
clustered by trial and site (pre-registered); the earlier trial-only clustering is shown beside them.
Run on the current database (hand-encoded eligibility for the 151 demo and Regeneron trials included).

| coef on log(1 + sum of overlaps) | 95% CI, two-way | p | 95% CI, trial only | p |
|---|---|---|---|---|
| model assumption (master doc eq. 2): -1 | | | | |
| **within site, full sample (primary; the default beta): -0.093** | **[-0.297, +0.111]** | **0.37** | [-0.213, +0.028] | 0.13 |
| pooled across sites (confounded with site type): -0.107 | [-0.216, +0.002] | 0.055 | [-0.158, -0.056] | <0.001 |

Subset estimates, within site. They are reported separately and are never the default. Bonferroni
adjustment is over the 4 subsets (z = 2.50):

| subset (not the default) | coef | 95% CI, two-way | p | Bonferroni CI | trial only: CI (p) |
|---|---|---|---|---|---|
| S1p: sites with >= 10 lung trials started before the focal trial | -0.055 | [-0.339, +0.229] | 0.71 | [-0.417, +0.308] | [-0.179, +0.069] (0.39) |
| S1: sites with >= 10 lung trials over all time (counts later trials; not predetermined) | -0.135 | [-0.323, +0.053] | 0.16 | [-0.374, +0.104] | [-0.245, -0.025] (0.02) |
| S2: trials with <= 20 sites | -0.045 | [-0.186, +0.096] | 0.53 | [-0.225, +0.135] | [-0.177, +0.087] (0.50) |
| S3: competitor pairs with overlap >= 0.8 | -0.083 | [-0.285, +0.119] | 0.42 | [-0.340, +0.174] | [-0.180, +0.014] (0.09) |

Beta under each eligibility-parser version (full-sample within site, no hand-encoded overrides; beta = -coef):

| parser | coef | 95% CI | p | trials with no eligible patient |
|---|---|---|---|---|
| v0 `b8c576f`: "Key Exclusion Criteria" read as inclusion | -0.136 | [-0.339, +0.067] | 0.19 | 3 |
| v1 `c0050f4`: headers fixed, but contradictory criteria | -0.027 | [-0.121, +0.067] (trial only*) | 0.57 | 646 |
| v2 `4a87d33`: current | -0.088 | [-0.291, +0.116] | 0.40 | 3 |

\* For v1 the two-way variance of this coefficient is negative before clipping, so it can't be
estimated; the trial-clustered CI is shown instead.

- **What it says.** Within the same site, at the resolution of public registry data, the full-sample
  estimate is a small slowdown (about 6% per doubling of overlapping load) and is not significant under any
  clustering. Every interval rejects the master doc's -1. Unweighted competitor counts are null within site.
- **"Mainly at experienced sites" is withdrawn.** It rested on S1, whose ">= 10 lung trials" count included
  trials that started later. Counting only trials started before each trial (S1p): -0.055, p 0.71. No subset
  meets the pre-registered rule (a well-powered subset whose CI excludes the full-sample estimate).
- **Across sites, busier sites have slower trials** (-0.107), confounded with site type; with two-way SEs
  the CI includes 0 (p 0.055).
- **Default beta = 0.093** (95% CI 0 to 0.297, floored at 0 as the app uses it): the full-sample estimate.
- **Parser dependence.** Across parser versions the estimate runs from -0.027 to -0.136. None is significant
  with two-way SEs; with trial-only SEs only v0 was (p 0.03).
- **Post hoc, not pre-registered.** The pre-registered two-way variance clips negative eigenvalues of the
  whole coefficient covariance (18 of 41 for the primary), so its SE depends partly on how controls are coded
  (0.104 as coded, 0.105-0.115 under equivalent codings). The coefficient's own two-way variance before
  clipping does not: primary SE 0.087, CI [-0.262, +0.077], p 0.29. On that measure the pooled association
  ([-0.209, -0.005], p 0.040) and S1 with the lifetime count ([-0.265, -0.005], p 0.041) look stronger; neither
  is predetermined or causal, and neither survives Bonferroni. Details: `data/robustness/congestion_v2.json`,
  `congestion_v2_se_diagnostics.json`.
- **Corrections, in order.** v0 read "Key Exclusion Criteria" as inclusion (-0.136). After that fix the
  estimate was -0.027 (v1), but 646 trials had contradictory compiled criteria (no eligible patients, zero
  exposure), pulling it toward zero; task F's audit found this. With the parser fixed (v2) and the 151
  hand-encoded trials, the same regressions give the tables above.

### 2. Site-rate model and backtest

Fit before 2018, predict the enrollment duration of 1,094 later trials (390 industry Phase II/III):

| industry Phase II/III, held out | median abs log error | median signed bias |
|---|---|---|
| **model** (posterior mean; sites with < 3 lung trials capped at the prior's 25th percentile) | **0.67** | -0.09 |
| raw posterior mean (unknown sites at the prior mean) | 1.09 | -0.92 |
| naive median rate x site count | 1.03 | -0.76 |

The raw model's large optimism came from sites it barely knew. So the cap is backed by the backtest,
not just a conservative choice. Calibration slope of actual on predicted rate: 0.95 (SE 0.07). On past
dates, the model's times for the same trials are within 15-40% of what they actually took (June 2019:
31 vs 37 months).

**Observed-outcome check of the site scores** (`analysis/selection_validation.py`, 17 Oct). Completed trials
started 2018 or later: each trial's registered site list is scored with rates fit only on pre-2018 trials,
and the actual log per-site enrollment rate is regressed on that score with phase, log site count and
start-year controls:

| completed trials started 2018+ | slope | 95% CI | p | n |
|---|---|---|---|---|
| all lung trials | 0.16 | [0.07, 0.24] | 0.0003 | 1,094 |
| industry Phase II/III | 0.33 | [0.16, 0.50] | 0.0001 | 390 |

- **The scores carry real signal.** Registered site lists that pre-2018 data scored higher did enroll
  faster per site.
- **Predicted differences between site lists are about 3-6x larger than observed.** The slope is far below
  1.
- **Why the backtest slope above is 0.95.** It compares raw predicted and actual rates across trials, and
  much of that variation is explained by phase, site count and start year. Net of those, the site scores
  add less, which is what selection depends on.

### 3. Clearing, US-Northeast: final rerun of the holdout

Task A's pre-registered script (`analysis/selection_holdout.py`), run unchanged on the current database:
beta 0.0925, hand-encoded eligibility (basket and multi-cohort trials held out), deterministic solver
(500k evaluations). 46 movable trials. Allocations are chosen with site rates fit on one half of history
and scored with rates fit on the other half (alternating and time splits; geometric mean of both
directions). Ratio = total trial-months, baseline / alternative, under our enrollment model. "Slower" = share
of trials slower than the baseline. Output: `data/robustness/holdout.json`; earlier run on the pre-E database:
`holdout_preE.json`.

| comparison | in-sample, all history | alternating: in-sample | alternating: held-out | time: in-sample | time: held-out |
|---|---|---|---|---|---|
| Site selection alone: best response vs registered | 1.76x (20% slower) | 1.59x (18% slower) | 1.73x (14% slower) | 1.72x (16% slower) | 1.70x (13% slower) |
| Coordination: joint optimum vs best response | 1.42x (39% slower) | 1.44x (41% slower) | 1.05x (47% slower) | 1.37x (38% slower) | 1.05x (51% slower) |
| Coordination capped at registered times, vs registered | 1.60x (0% slower) | 1.57x (0% slower) | 1.37x (24% slower) | 1.67x (0% slower) | 1.23x (31% slower) |
| Coordination capped at best-response times, vs best response | 1.00x (0% slower) | 1.00x (0% slower) | 1.00x (2% slower) | 1.01x (0% slower) | 0.99x (16% slower) |

**Re-scored with calibrated site rates (post hoc, not pre-registered; `analysis/selection_calibrated.py`,
17 Oct).** The observed-outcome check in section 2 says the scores overstate differences between site
lists. So the same saved allocations, not re-solved, are re-scored with every site's log rate shrunk
toward the U.S. mean by b, the observed-outcome slope. b = 1 reproduces the table above exactly (largest
difference 4e-16). Output: `data/findings/selection_calibrated.json`.

| US-Northeast | in-sample, all history | alternating: held-out | time: held-out |
|---|---|---|---|
| Site selection alone, b = 1 (uncalibrated, as above) | 1.76x | 1.73x | 1.70x |
| Site selection alone, b = 0.33 (industry Phase II/III slope) | 1.22x | 1.18x | 1.17x |
| Site selection alone, b = 0.16 (all-trials slope) | 1.09x | 1.07x | 1.06x |
| Coordination, b = 0.33 | 1.12x | 1.03x | 1.03x |
| Coordination, b = 0.16 | 1.06x | 1.03x | 1.02x |

- **Calibrated, site selection alone is worth about 1.2x held-out, not 1.7x.** That uses the industry Phase
  II/III slope, whose 95% CI (0.16 to 0.50) spans roughly 1.06x to 1.3x.
- **Caveat.** b was estimated on trial-level scores (the mean score of a registered list). Applying it to
  each site's rate assumes the overstatement is the same at site level.

### 4. Portfolio clearing: Regeneron, as of 1 Sept 2024

Same script and settings, 5 movable trials (Regeneron's), everyone else held fixed.

| comparison | in-sample, all history | alternating: in-sample | alternating: held-out | time: in-sample | time: held-out |
|---|---|---|---|---|---|
| Site selection alone: best response vs registered | 2.04x (0% slower) | 1.90x (0% slower) | 1.69x (0% slower) | 1.90x (0% slower) | 1.42x (10% slower) |
| Coordination: joint optimum vs best response | 1.01x (40% slower) | 1.00x (20% slower) | 0.99x (30% slower) | 1.00x (30% slower) | 1.03x (50% slower) |
| Coordination capped at registered times, vs registered | 1.27x (0% slower) | 1.23x (0% slower) | 1.20x (20% slower) | 1.22x (0% slower) | 1.12x (30% slower) |
| Coordination capped at best-response times, vs best response | 1.00x (0% slower) | 1.00x (0% slower) | 0.99x (40% slower) | 1.00x (0% slower) | 0.99x (40% slower) |

Calibrated re-score (post hoc, as in section 3): site selection alone is 1.32x in-sample, 1.20x and 1.12x
held-out at b = 0.33, and 1.15x, 1.08x and 1.05x at b = 0.16.

Observed fact, no model needed: Regeneron's two fianlimab Phase 2/3 trials (NCT05785767, NCT05800015) shared
16 registered U.S. sites. Under hand-encoded eligibility on the synthetic population, every patient eligible
for the first was eligible for the second (overlap 1.0).

### 5. Term sheets

- **Physician codes use real CMS rates.** They are priced from the CMS 2026 RVU file (RVU26D, October
  release, conversion factor $33.4009), with GPCI locality adjustment matched by city name.
- **Lab codes use the real CMS 2026 lab fee schedule** (CLFS, Q4 2026 release, national limitation
  amounts; not geographically adjusted). CMS serves that file behind an AMA CPT license click-through, so a
  person downloads it: https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files/26clabq4
  (file `clfs_cy2026_q4v1.zip`), saves it under `data/raw/cms/`, and loads it with
  `python -m concord.ratecard.cms --rvu ../data/raw/cms/rvu26d/rvu26d.zip --clfs ../data/raw/cms/clfs26q4/clfs_cy2026_q4v1.zip`
  (from `backend/`; or `CLFS_ZIP=... scripts/pipeline.sh`). Only numbers are copied into
  `data/ratecard.json`, never AMA descriptors. Without the file, lab lines fall back to labelled placeholders.

## Assumptions to defend (all in code, all adjustable via the API)

- Enrollment window = 65% of start to primary completion (`recruitment.ENROLL_FRACTION`).
- Congestion elasticity beta from the within-site regression (default), with its CI; `beta` overrides.
- Site rates:
  - posterior mean, with low-history sites capped (section 2)
  - winsorized at the 95th percentile of experienced sites
  - scaled by the backtest bias
  - busy sites de-congested so the registered allocation reproduces history; idle sites get no boost.
- No activation lag on top: backtest rates already include ramp-up. So ratios don't depend on the
  absolute level.
- Capacity k_s = peak concurrent industry Phase II/III lung trials the site has run.
- The best-response baseline claims sites first-come by start date and respects capacity.
- Eligibility enters only relative to the instance median. Synthetic population prevalences are in
  `compiler/population.py`.

## Known issues

- **Eligibility parsing.** Rule-based for history trials. The 146 US-Northeast demo trials and Regeneron's
  5 are hand-encoded (`compiler/overrides_demo.json`, `compiler/overrides.py`). 34 demo trials need a
  biomarker the synthetic population cannot represent (e.g. KRAS G12D, RET, MTAP loss); those requirements
  are listed per trial, not modeled.
- **Price tags and slot values are local.** They are warm-start re-solves, compared against the same
  procedure on the unchanged market.
- **Today's snapshot runs long.** It over-represents slow trials (length-biased sampling), so its
  absolute times are high (median 41 months). Past-date snapshots are the calibration check.
- **Academic-center flag.** Widened to NCI-designated and university centers (404 more U.S. sites,
  including Dartmouth-Hitchcock). It also matches satellites carrying a center's name, as before.

## Next

- [ ] Load CLFS (needs a person to accept the AMA license); county-level Medicare locality match
- [ ] LLM-assisted eligibility parser with a review screen; hand-encode every trial shown in the demo
- [ ] Site-level enrollment data (the flywheel) is what would make the site-rate model trustworthy
- [ ] Side-payment / priority-credit mechanism, since coordination gains need transfers to be no-loser

## Checks in progress (17 Oct)

Pre-registered checks running in parallel worktrees, each committing its method before its results,
with adversarial audits. Numbers below are provisional until the final rerun (last row).

| task | status | result so far |
|---|---|---|
| A. optimizer's curse holdout (choose with half the history, score with the other) | merged; final rerun done | sections 3-4 |
| B. where the joint optimum comes from (capacity settings, beta = 0) | merged; one audit gap left (time split not run by B) | see below |
| C. transfer surplus of the joint optimum | not merged (decision 17 Oct) | moot given the time-split result |
| D. browser QA | merged | 2,576 of 2,580 on-screen numbers match the API; the other 4 were backend inconsistencies, now fixed. 7 label and layout defects fixed. No phone-width breakage. Report: `docs/qa/2026-10-17-browser-qa.md` |
| E. hand-encoded eligibility, design labels, academic flag | merged | 146 demo trials: 63 single population, 62 basket, 21 multi-cohort. Basket and multi-cohort trials are held out of headline numbers: US-Northeast keeps 47 movable trials (was 103) |
| F. attenuation check of beta | merged | see section 1 |
| Congestion re-estimate: predetermined "experienced site", two-way clustered SEs, beta by parser version | merged; audited | see section 1 |
| UI: ">= 1 month" threshold for share faster; beta labels | merged | |
| Deterministic solver | done: 500k-evaluation default, chosen by objective convergence; repeat runs identical | `data/robustness/solver_budget_calibration.json` |
| Database rebuilt with E's encodings and academic flags | done | congestion regression rerun on it (section 1) |
| Final rerun of sections 3-4: task A's script unchanged, current beta, deterministic solver, both splits | done | sections 3-4 |

### B. Where the joint optimum's gain comes from (provisional)

US-Northeast, old beta 0.026, B's own fixed-effort solver, before E's design exclusions. Held-out =
geometric mean of both directions. The time-split column comes from B's auditor running B's code.

| | in-sample | held-out, alternating split | held-out, time split |
|---|---|---|---|
| joint optimum vs best response | 1.57x (42% slower) | 1.38x (44% slower) | **0.98x** |
| same, unlimited capacity | 1.02x | 0.96x | 0.77x |
| same, beta = 0 | 1.56x | 1.42x | |
| no-loser vs registered | 1.27x | 1.13x (22% of trials slower) | 1.03x |

- **Capacity, not congestion.** The joint optimum's gain is about allocating scarce slots at sites
  with long track records. It disappears with unlimited capacity and barely moves at beta = 0.
- **Fragile.** About 240 extra slots at 59 high-capacity sites cut the held-out gain from 1.38x to 1.05x.
- **It doesn't hold over time.** Choosing with older trials and scoring with newer ones gives 0.98x.
- **"No loser" doesn't hold out of sample.** Scored with held-out rates, 22% of trials end up slower
  than with their registered sites.
- **More search helps in-sample only.** More solver effort raised the in-sample headline but lowered the
  held-out one: the optimizer's curse acting through search.

### C. Transfer surplus

Transfer surplus not evaluated out of sample; moot given the time-split result.

Two findings from D that the final numbers must handle:

- **Solver budget.** The solver stopped at a 6 s limit, so the in-sample headline depended on CPU load:
  1.32x live vs 1.28x in the grid for US-Northeast. Fixed: the solver now runs to a fixed evaluation budget.
- **Near-ties.** "Share faster" counted near-ties. The API now also reports a material threshold
  (>= 1 month): "91% faster" is 62% at >= 1 month.

## Financial Coordination: sponsor-budget worksheet

The additive **Financial Coordination** tab provides a live, explicitly synthetic sponsor-budget worksheet linked to existing illustrative public-trial protocols: a coverage worksheet, five sponsor-budget scenarios at a fixed participant target over a budgeted contract period (listed, not ranked), a three-party transfer/resource ledger, cost-input sensitivity and HTML/JSON evidence exports, without a registry database. It outputs no time, speed or enrollment estimate, and in the worksheet payer assumptions do not change the sponsor commitment (only a line's coverage status does): insurer and Medicare amounts are benchmarks for fair-value reasoning and site negotiation, not a lever that lowers sponsor cost or speeds a trial (decision 24). No insurer partnership, coverage approval, observed savings or clinical benefit is claimed. See [what it computes, what it does not, and verification](docs/financial/README.md).

# Portfolio Command

Budget-constrained multi-trial planning with shared site capacity, financial
coordination, paired sensitivity and immutable evidence exports is available at
`#portfolio-command`. The demo computes live on explicitly synthetic operational
inputs; ClinicalTrials.gov supplies registry context only. See
[reproduction and assumptions](docs/portfolio/README.md) and
[verification evidence](docs/portfolio/VERIFICATION.md).

