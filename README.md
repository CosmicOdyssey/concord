# Concord

A clearing mechanism for clinical-trial enrollment capacity. HackHarvard 2026, Regeneron track.

Today each sponsor picks sites on its own from the same shortlist, so trials pile onto the same
academic centers. Concord allocates sites **across concurrent trials at once** and attaches pre-cleared
terms (Medicare-indexed rate card, standard non-procedure schedule, coverage analysis) to each match.
This README reports what the data supports after we tried to break the result; see **Results**.

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

> **Status, 17 Oct (checks in progress).** The numbers in sections 3-4 are in-sample: allocations are
> chosen and scored with the same site rates. Treat them as upper bounds until the pre-registered holdout
> (task A) is merged. Sections 3-4 also predate the beta correction in section 1 (they used 0.026).
> See "Checks in progress" at the end.

### 1. Does congestion slow enrollment? Not measurably within a site, and far less than the model assumed.

`analysis/congestion.py`: 3,442 completed lung trials, 68k trial-site rows. Outcome: log per-site-month
enrollment rate. Exposure: competitors recruiting at the same site when the trial started (fixed in
advance; counting over the whole window would mechanically penalize slow trials), weighted by
eligibility overlap. Controls: phase, site count, sponsor type, start year. Standard errors are two-way
clustered by trial and site (pre-registered); the earlier trial-only clustering is shown beside them.

| coef on log(1 + sum of overlaps) | 95% CI, two-way | p | 95% CI, trial only | p |
|---|---|---|---|---|
| model assumption (master doc eq. 2): -1 | | | | |
| **within site, full sample (primary; the default beta): -0.087** | **[-0.291, +0.117]** | **0.40** | [-0.208, +0.034] | 0.16 |
| pooled across sites (confounded with site type): -0.106 | [-0.216, +0.003] | 0.058 | [-0.158, -0.055] | <0.001 |

Subset estimates, within site. They are reported separately and are never the default. Bonferroni
adjustment is over the 4 subsets (z = 2.50):

| subset (not the default) | coef | 95% CI, two-way | p | Bonferroni CI | trial only: CI (p) |
|---|---|---|---|---|---|
| S1p: sites with >= 10 lung trials started before the focal trial | -0.050 | [-0.335, +0.235] | 0.73 | [-0.413, +0.313] | [-0.174, +0.074] (0.43) |
| S1: sites with >= 10 lung trials over all time (counts later trials; not predetermined) | -0.129 | [-0.317, +0.059] | 0.18 | [-0.368, +0.110] | [-0.239, -0.019] (0.02) |
| S2: trials with <= 20 sites | -0.039 | [-0.180, +0.101] | 0.58 | [-0.219, +0.140] | [-0.172, +0.093] (0.56) |
| S3: competitor pairs with overlap >= 0.8 | -0.077 | [-0.281, +0.127] | 0.46 | [-0.337, +0.183] | [-0.175, +0.021] (0.12) |

Beta under each eligibility-parser version (full-sample within site, no hand-encoded overrides; beta = -coef):

| parser | coef | 95% CI | p | trials with no eligible patient |
|---|---|---|---|---|
| v0 `b8c576f`: "Key Exclusion Criteria" read as inclusion | -0.136 | [-0.339, +0.067] | 0.19 | 3 |
| v1 `c0050f4`: headers fixed, but contradictory criteria | -0.027 | [-0.121, +0.067] (trial only*) | 0.57 | 646 |
| v2 `4a87d33`: current | -0.088 | [-0.291, +0.116] | 0.40 | 3 |

\* For v1, the two-way variance of this coefficient is negative before clipping, so it can't be
estimated. The trial-clustered CI is shown instead. The clipped two-way CI, [-0.089, +0.034], was
narrower than the trial-only one and is not a valid estimate.

- **What it says.** Within the same site, at the resolution of public registry data, the full-sample
  estimate is a small slowdown: about 6% per doubling of overlapping load. It is not significant under any
  clustering. Every interval rejects the master doc's -1, so congestion is at most a fraction of what the
  model assumed. Unweighted competitor counts are null within site.
- **"Mainly at experienced sites" is withdrawn.** That claim rested on S1, whose ">= 10 lung trials" count
  included trials that started later. When only trials started before each trial are counted (S1p), the
  estimate shrinks to -0.050 (p 0.73). S1 itself is not significant with two-way SEs (p 0.18) or after
  Bonferroni. No subset meets the pre-registered rule: a well-powered subset whose CI excludes the
  full-sample estimate.
- **Across sites, busier sites have slower trials** (-0.106). The comparison is confounded with site type,
  and with two-way SEs its CI includes 0 (p 0.058).
- **Default beta = 0.087** (95% CI 0 to 0.291, floored at 0 as the app uses it). This is the full-sample
  estimate. Subset estimates are labelled as subsets wherever they appear and are never used as the default.
- **Parser dependence.** Across the three parser versions the estimate runs from -0.027 to -0.136, a 5x
  spread. None is significant with two-way SEs. With trial-only SEs, only v0 was (p 0.03). The hand-encoded
  overrides move v2 by 0.0006.
- **Post hoc, not pre-registered: CI width depends partly on a technical choice.** The pre-registered
  two-way variance clips the negative eigenvalues of the whole coefficient covariance matrix (18 of 41 for
  the primary). That makes the reported SE depend on how the controls are coded: 0.104 as coded, and
  0.105-0.115 under equivalent codings. The coefficient's own two-way variance before clipping does not
  depend on coding: SE 0.086, CI [-0.257, +0.082], p 0.31. On that measure two results look stronger than
  in the tables:
  - the cross-site pooled association: [-0.208, -0.004], p 0.042;
  - S1 with the lifetime count: [-0.258, +0.000], p 0.050. It is still not predetermined and not
    significant after Bonferroni.

  The primary and S1p stay far from significant (p 0.31 and 0.54). Details:
  `data/robustness/congestion_v2.json` (`se_note`, `*_twoway_unclipped`) and
  `congestion_v2_se_diagnostics.json`.
- **Corrections, in order.** An early run showed -0.136 because "Key Exclusion Criteria" headers weren't
  recognized (v0). After that fix the estimate was -0.027 (v1). Task F's audit then found that 646 of
  7,206 trials had contradictory compiled criteria (EGFR required and EGFR excluded; resectable and stage
  III-IV). That left them with no eligible patients and zero exposure, which pulled the estimate toward
  zero. With the parser fixed (v2; 3 such trials remain), the same pre-registered regressions give the
  tables above. Before-fix outputs: `data/robustness/congestion_subsets.json`. After: `..._maskfix.json`.
- **Inputs.** These numbers come from the database before task E's hand-encoded eligibility for the 146
  demo trials entered `trial_model`. Rerunning `analysis/congestion.py` on the rebuilt database (139 masks
  differ) gives a primary of about -0.092 (two-way p 0.37; default beta about 0.092). No conclusion above
  changes.

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

### 3. Clearing, US-Northeast (recruiting industry Phase II/III, 103 trials after flagging)

Four allocations, all evaluated under the same model. **Headline: no trial worse off than its registered
CT.gov site list.** Trials are reassigned only among sites that some trial in the market registered, and
no trial gets more sites than it registered.

| comparison | ratio | median speedup | faster / slower |
|---|---|---|---|
| **no-loser coordination vs registered** (headline) | **1.28x** | 1.10x | 91% / 0% |
| site selection alone (best response vs registered) | 1.23x | | |
| pure coordination, no losers (vs best response) | 1.002x | | |
| joint optimum, losers allowed (vs best response) | 1.57x | | 42% slower |

Robustness grid (`data/robustness/US-Northeast.json`, also in the app):

| congestion elasticity | headline, registered sites only | pure coordination, no losers |
|---|---|---|
| 0 (CI lower) | 1.73x (median 1.59x) | 1.000x |
| 0.026 (estimate) | 1.28x (median 1.10x) | 1.002x |
| 0.12 (CI upper) | 1.28x (median 1.06x) | 1.035x |
| 1.0 (master doc assumption) | 1.41x (median 1.13x) | 2.29x |

- **The coordination dividend came from an assumption.** The master doc's dividend was produced by
  assuming beta = 1. At the elasticity the data supports, coordination with no losers is worth about
  1.00-1.04x.
- **Larger gains need side payments.** The joint optimum is worth more, but it makes a third or more of
  trials slower. Sponsors would only join if the losers were compensated.
- **The no-loser gain over registered sites doesn't depend on congestion.** That 1.28-1.73x comes from
  moving trials, within the shared network of sites sponsors already use, toward sites with better
  track records and spare capacity. It rests on the site-rate model (section 2), which is the weakest
  link.
- **Idle sites push it higher, on weaker ground.** Letting trials use idle sites that have some history
  (`universe=history`) raises the gain to 1.6-2.2x, but leans harder on the site rates.

43 of 146 trials are flagged: their model time exceeds 120 months under their registered sites, mostly
because of parse or estimate failures. They stay in the instance as fixed background congestion and are
excluded from every number.

### 4. Portfolio clearing (the wedge): Regeneron, as of 1 Sept 2024

Setup: `region=US, sponsor=Regeneron, as_of=2024-09-01`. That covers Regeneron's 5 NSCLC trials
recruiting on that date, cleared across Regeneron's own registered U.S. site network, with every other
sponsor's trials held fixed. Eligibility is hand-encoded (`compiler/overrides.py`).

- **Self-competition.** The two fianlimab Phase 2/3 trials (NCT05785767, NCT05800015) shared 16
  registered U.S. sites, and every patient eligible for the first was eligible for the second
  (overlap 1.0).
- **No-loser clearing:** 1.27x (median 1.26x); all 5 trials faster. Across the elasticity range it
  is 1.24-2.08x. It is highest at beta = 0, because with any congestion, moves onto Regeneron's sites
  slightly slow other sponsors' trials there, and the no-loser cap protects those trials too. Rows
  that allow any idle U.S. site (`universe=history`, 3.6x) lean on noisy site rates and are not the
  claim. Grid: `data/robustness/US_Regeneron_2024-09-01.json`.
- **Pure coordination:** about 1.00x, consistent with section 1.

### 5. Term sheets

- **Physician codes use real CMS rates.** They are priced from the CMS 2026 RVU file (RVU26D, October
  release, conversion factor $33.4009), with GPCI locality adjustment matched by city name.
- **Lab codes are still placeholders.** CLFS codes are flagged unverified because CMS serves that file
  behind an AMA CPT license click-through, which a person has to accept. To load it, download
  `26clabq4.zip` from
  https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files/26clabq4
  and run `CLFS_ZIP=path/to/26clabq4.zip scripts/pipeline.sh`.

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

- **Eligibility parsing.** It is rule-based; only the Regeneron portfolio is hand-encoded. Basket and
  cohort trials are parsed as if every cohort applied to everyone.
- **Price tags and slot values are local.** They are warm-start re-solves, compared against the same
  procedure on the unchanged market.
- **Today's snapshot runs long.** It over-represents slow trials (length-biased sampling), so its
  absolute times are high (median 41 months). Past-date snapshots are the calibration check.
- **Academic-center flag.** The regex misses some centers (e.g. Dartmouth-Hitchcock).

## Next

- [ ] Load CLFS (needs a person to accept the AMA license); county-level Medicare locality match
- [ ] LLM-assisted eligibility parser with a review screen; hand-encode every trial shown in the demo
- [ ] Site-level enrollment data (the flywheel) is what would make the site-rate model trustworthy
- [ ] Side-payment / priority-credit mechanism, since coordination gains need transfers to be no-loser

## Checks in progress (17 Oct)

Pre-registered checks running in parallel worktrees, each committing its method before its results,
with adversarial audits. A result enters this README only after its audit.

| task | status | result so far |
|---|---|---|
| A. optimizer's curse holdout (choose with half the history, score with the other) | audit found issues; being fixed | the held-out number becomes the headline |
| B. where the joint optimum comes from (capacity settings, beta = 0) | fixed after audit; re-audit running | |
| C. transfer surplus of the joint optimum | waits for B | |
| D. browser QA | merged | 2,576 of 2,580 on-screen numbers match the API; the other 4 were backend inconsistencies, now fixed. 7 label and layout defects fixed. No phone-width breakage. Report: `docs/qa/2026-10-17-browser-qa.md` |
| E. hand-encoded eligibility for the 146 demo trials, basket and cohort labels, academic flag | encoding and verification done; integration next | basket and multi-cohort trials will be held out of headline numbers |
| F. attenuation check of beta | merged | see section 1 |

Two findings from D that the final numbers must handle:

- **Solver budget.** The solver stops at a 6 s limit, so the in-sample headline depends on CPU load:
  1.32x live vs 1.28x in the grid for US-Northeast.
- **Near-ties.** "Share faster" counted near-ties. The API now also reports a material threshold
  (>= 1 month): "91% faster" is 62% at >= 1 month.
