# Architecture and API reference

Paths are relative to the repository root. Historical routes may need the optional
SQLite/ratecard bundle; they are not part of the data-free planning demonstration.

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


## Integrated planning routes

| Endpoint | Behavior |
| --- | --- |
| `GET /api/financial/demo` | Labeled synthetic worksheet and public trial context |
| `POST /api/financial/compare` | Five sponsor-budget scenarios; no time model |
| `POST /api/financial/report?format=json` or `html` | Recomputes the supplied worksheet inputs and exports |
| `GET /api/portfolio-command/demo` | Two real trial context records and synthetic operational inputs |
| `POST /api/portfolio-command/validate` | Validate edited inputs |
| `POST /api/portfolio-command/compare` | Live scenario computation and immutable save |
| `GET /api/portfolio-command/runs/{id}` | Explicit artifact replay; no fresh computation |
| `GET /api/portfolio-command/runs/{id}/report/{json|html}` | Exact saved evidence export |

Portfolio search is implemented in `portfolio_search.py`, using the existing
`portfolio_simulation.py` event simulator and `financial.py` coverage/ledgers.
Interactive API documentation is served at `/docs` on the local backend.
