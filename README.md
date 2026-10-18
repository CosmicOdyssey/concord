# Concord

Turn a clinical trial protocol into a site budget both sides can check: every procedure priced from public Medicare
rates, with a source on every line. Built for HackHarvard 2026 (Regeneron track) by the Bruno Bears, Brown University.

Live demo: https://cosmicodyssey.github.io/concord/ (runs from the team's laptop during judging).

Concord started as a "clearing house" that would allocate sites across a sponsor's concurrent trials. Tested on 7,221
NSCLC trials from ClinicalTrials.gov, the idea did not hold up: coordination gains fell from 1.42x in sample to about
1.05x on held-out trials, and competing trials barely slow each other within a site (elasticity 0.09, against an
assumed 1.0). So the product now does what public data can actually answer:

- **Protocol to terms** (`#terms-flow`): a protocol's schedule of assessments becomes a coverage grid (routine care vs
  research, under Medicare NCD 310.1, every rule shown and overridable) and a per-participant budget priced from the
  CMS 2026 physician and clinical lab fee schedules at the site's Medicare locality. It shows the anchored share (how
  much of the budget public rates settle), a two-site comparison split by Medicare's geographic adjustments, each
  line's price step by step, a check of a site's proposed budget (CSV), and term sheet and counter-proposal exports.
  Any trial can be added by NCT ID.
- **Portfolio overlap** (`#overlap`): where a sponsor's concurrently recruiting trials share registered sites and
  eligible patients (lung cancer in full; breast cancer, shared sites only).
- **Findings** (`#findings`), **Site scores** (`#site-scores`) and **Research** (`#research`): the tests behind the
  pivot, each U.S. site's historical enrollment evidence with its validation, and the earlier model, labelled as
  in-sample output. Figures with captions: [docs/figures](docs/figures/README.md).

Rules for the whole app: every number has a public source or a visible "assumption" label, and no view shows a
predicted speedup, time-to-fill or enrollment rate as a product claim. Decision support, not a fair-market-value legal
opinion or coverage advice.

## Layout

```
backend/concord/
  ingest/                 ClinicalTrials.gov API v2 crawler and normalizer -> SQLite (trials, sites, trial_sites)
  compiler/               eligibility text -> predicates; synthetic NSCLC population; schedule-of-assessments DAG
  ratecard/               CMS physician fee schedule (RVU + GPCI, 109 localities) and lab fee schedule (CLFS)
  terms.py                protocol to terms: coverage, budget, comparison, term sheet
  anchoring.py            anchored share (public rates / proposed standard / open)
  terms_spread.py         locality distribution and spreads
  line_detail.py          one line's price, step by step
  proposal.py             site proposal check and counter-proposal
  trial_import.py         add any trial by NCT ID (registry fetch, cited schedule draft, SoA CSV upload)
  overlap.py              portfolio overlap
  model/, site_scores.py  Poisson-gamma site rates, low-history cap, overdispersion intervals
  analysis/               congestion regressions, held-out tests, observed-outcome check (pre-registered)
  api/                    FastAPI
frontend/                 Vite + React + TypeScript
scripts/pipeline.sh       crawl -> normalize -> build -> congestion test -> CMS rate card -> robustness grids
```

## Run it

```bash
# backend
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # macOS/Linux: .venv/bin/pip
../scripts/pipeline.sh                             # ~10 min: crawl, fit, tests, CMS rate card
.venv/Scripts/python -m pytest
.venv/Scripts/python -m uvicorn concord.api.main:app --port 8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev          # http://localhost:5173, proxies /api -> :8000
```

## API

Interactive docs for every route at `http://localhost:8000/docs`. The main ones:

| Endpoint | What |
|---|---|
| `GET /api/terms-flow/trials` | protocols (hand-authored demos and trials added by NCT ID) |
| `GET /api/terms-flow/{nct}/protocol`, `/sites`, `/budget?site_id` | schedule and coverage grid, registered U.S. sites, priced budget with anchored share |
| `GET /api/terms-flow/{nct}/compare?site_a&site_b` | two-site comparison, gap split by Medicare's geographic adjustments |
| `GET /api/terms-flow/{nct}/locality-distribution`, `/spreads` | the protocol priced in all 109 Medicare localities; spreads by geography and multiplier band |
| `GET /api/terms-flow/{nct}/line-detail?node_id&site_a` | one line's price, step by step, with the CMS source |
| `POST /api/terms-flow/{nct}/proposal-check`, `/counter-proposal.html` | check a site's proposed budget (CSV); export a counter-proposal |
| `GET /api/terms-flow/{nct}/termsheet.md`, `/termsheet.html` | term sheet export |
| `POST /api/terms-flow/add-trial` `{nct_id}` | add a trial from ClinicalTrials.gov; `/{nct}/soa-csv` uploads its schedule |
| `GET /api/overlap?sponsor&as_of&region`, `/api/overlap/sponsors`, `/api/overlap/indications` | portfolio overlap |
| `GET /api/site-scores`, `/summary`, `/{site_id}` | site scores, method and validation, one site's breakdown |
| `GET /api/findings`, `/api/congestion-test`, `/api/robustness` | research results |

## License

The code is released under the [MIT License](LICENSE). Data the app reads keeps its own terms: ClinicalTrials.gov
records, and CMS fee schedules (CPT codes and descriptors are © American Medical Association; the CMS rate files are
downloaded locally and not redistributed here). No sponsor endorsement, insurer relationship or institutional
affiliation is implied.
