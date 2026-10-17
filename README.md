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

### 1. Does congestion slow enrollment? Not measurably within a site.

`analysis/congestion.py`: 3,442 completed lung trials, 68k trial-site rows. Outcome: log per-site-month
enrollment rate. Exposure: competitors recruiting at the same site when the trial started (fixed in
advance; counting over the whole window would mechanically penalize slow trials), weighted by
eligibility overlap. Controls: phase, site count, sponsor type, start year.

| | coef on log(1 + sum of overlaps) | 95% CI | p |
|---|---|---|---|
| model assumption (master doc eq. 2) | -1 | | |
| pooled across sites | -0.110 | [-0.160, -0.060] | <0.001 |
| **within site** (same site, busy vs quiet periods) | **-0.027** | **[-0.121, +0.068]** | 0.58 |

Unweighted competitor counts are null within site too. Across sites, busier sites are slower per trial,
but that is confounded with site type (experienced academic centers enroll ~0.04 patients/month per
trial vs 0.11-0.34 elsewhere). The allocator now uses the within-site estimate as beta, with its CI as
the sensitivity range. An earlier run showed -0.136 (p = 0.03). That came from a parser bug: "Key
Exclusion Criteria" headers weren't recognized, so exclusions were read as requirements. It is fixed.

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
- **No-loser clearing:** 1.27x (median 1.26x); all 5 trials faster.
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
