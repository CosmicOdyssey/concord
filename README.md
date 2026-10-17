# Concord

A clearing mechanism for clinical-trial enrollment capacity. HackHarvard 2026, Regeneron track.

Today each sponsor picks sites on its own from the same shortlist, so trials pile onto the same
academic centers and compete for the same patients. Concord allocates sites **across all concurrent
trials at once** and attaches pre-cleared terms (Medicare-indexed rate card, standard non-procedure
schedule, coverage analysis) to each match. The headline number is the **coordination dividend**:
how much faster the same trials fill when sites are allocated jointly.

## Layout

```
backend/concord/
  ingest/ctgov.py       ClinicalTrials.gov API v2 crawler (stdlib only, resumable, ~45 req/min)
  ingest/normalize.py   raw pages -> SQLite (trials, sites, trial_sites); site dedupe; anonymized-site flag
  compiler/             eligibility text -> predicates; synthetic NSCLC population; schedule-of-assessments DAG
  model/recruitment.py  Poisson–gamma site rates (EM over trial-level enrollment) + backtest
  model/build.py        builds trial_model / site_model / meta tables
  allocator/core.py     congestion model, independent baseline, greedy + local search + ILS clearing solver
  ratecard/medicare.py  rate card, coverage grid, standard schedule, term sheet
  service.py            regional instance builder; actual vs independent vs coordinated; price tags; slot values
  api/main.py           FastAPI
frontend/               Vite + React + TS (map, clearing, price tags, term sheet, model/data)
scripts/pipeline.sh     crawl -> normalize -> build
```

## Run it

```bash
# backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # macOS/Linux: .venv/bin/pip
../scripts/pipeline.sh                             # ~2 min: crawl 7.2k NSCLC studies, normalize, fit
.venv/Scripts/python -m pytest
.venv/Scripts/python -m uvicorn concord.api.main:app --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev          # http://localhost:5173, proxies /api -> :8000
```

Other indications: `NAME=breast COND="breast cancer" scripts/pipeline.sh` (the instance builder currently
filters to lung trials; generalizing the `is_lung` flag is a small change).

## API

| Endpoint | What |
|---|---|
| `GET /api/status` | crawl state, counts, model prior, backtest |
| `POST /api/clear` `{region, activation_lag, overlap_scale, capacity_scale}` | actual vs independent vs coordinated allocation, PoA, dividend |
| `GET /api/trials/{nct}/price-tags` | months of enrollment each eligibility criterion costs |
| `GET /api/slot-values` | where one more trial slot is worth the most |
| `GET /api/protocol/demo` | demo schedule-of-assessments DAG |
| `GET /api/termsheet?site_id&nct_id` | capability check, coverage grid, budget, ACTA-style terms |
| `POST /api/compile/eligibility` `{text}` | criteria text -> predicates with provenance |

Interactive docs at `http://localhost:8000/docs`.

## Where things stand (16 Oct 2026, first pass)

**Data.** 7,221 interventional NSCLC studies crawled; 40.5k sites after dedupe; 148k trial–site links.
About 20% of site rows are sponsor-anonymized ("Research Site", "Local Institution"); they are kept as
per-city pseudo-sites, used in the actual allocation, and excluded as candidates.

**Backtest** (fit on trials started before 2018, predict enrollment duration for 1,094 later trials):
median |log error| 0.88 for the site model vs 0.99 for a naive median-rate baseline; the model is closer
on 63% of trials. Both are still ~2.4x off on a typical trial, so per-site evidence is weak, as the
master doc anticipated. Two things we tried made held-out prediction *worse* and are off by default:
dividing out regex-parsed eligibility, and de-congesting historical rates (`recruitment.O_BAR`).

**Clearing, US-Northeast** (146 recruiting industry Phase II/III trials, 1,376 sites):

| | value |
|---|---|
| median time to fill, independent → coordinated | 41 → 25 months (1.56x) |
| trials faster / slower under coordination | 77% / 16% |
| trimmed PoA (106 trials with plausible times) | 1.59 |
| sites used, independent → coordinated | 332 → 488 |

40 trials are flagged (model time over 120 months), mostly from the eligibility parser producing a very
small eligible fraction. Their raw contribution dominates the untrimmed PoA, so the UI leads with the
robust numbers. Absolute times run high (median 56 months for the registered allocation): calibration
is the next modeling task.

## Assumptions to defend (all in code, all adjustable)

- Enrollment window = 65% of start → primary completion (`recruitment.ENROLL_FRACTION`).
- Site flow is calibrated so the registered allocation reproduces historical rates; idle sites get no
  boost (conservative for the dividend). `service.Params.calibrate`.
- Equal activation lag (6 months) at every site, so the dividend comes only from congestion.
- Capacity k_s = peak concurrent industry Phase II/III lung trials the site has run.
- The independent baseline respects capacity first-come by start date, which is generous to the status quo.
- Synthetic population prevalences: `compiler/population.py`. Rate card amounts are **placeholders**
  (`verified=False`) until the CMS PFS/CLFS/GPCI files are loaded.

## Next (maps to the master doc's H10–H24 milestones)

- [ ] Load real CMS PFS + CLFS + GPCI files; drop placeholder amounts
- [ ] LLM-assisted eligibility parser behind `extract_criteria`, with a review screen (fixes most flagged trials)
- [ ] FDA clinical investigator inspection list join for the quality screen
- [ ] Calibrate absolute times (enrollment window, prior strength) against the backtest
- [ ] Sensitivity sweep of PoA over overlap and capacity
- [ ] Single-sponsor portfolio view (the wedge): concurrent trials of one sponsor sharing sites
