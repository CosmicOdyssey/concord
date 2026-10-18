# Concord

Turn a clinical trial protocol into a site budget both sides can check: every procedure priced from public Medicare
rates, with a source on every line. Built for HackHarvard 2026 (Regeneron track) by the Bruno Bears, Brown University.

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

## Isolated synthetic planning and sponsor acceptance

The original `#demo` and `#sponsor-agents` routes remain available by direct link, outside the primary navigation. The presentation continues to lead with Protocol to terms and the research findings. The planning demo computes on synthetic operating inputs and registry context; modeled completion is not a product forecast or an observed clinical outcome. Follow the [planning narration and limitations](docs/demo/HACKHARVARD-180-SECOND-SCRIPT.md).

## HackHarvard Sponsor Integrations

The [Sponsor Agents lab](http://127.0.0.1:5178/#sponsor-agents) contains local demonstrations,
not completed external sponsor connections:

| Integration | Current execution | External blocker |
| --- | --- | --- |
| [Photon](docs/sponsors/PHOTON.md) | Local command simulator and fail-closed inbound webhook contract | No carrier adapter, official provider contract or round-trip receipt |
| [Chalk](docs/sponsors/CHALK-EVALUATIONS.md) | Versioned 15-case deterministic acceptance suite using actual engine/boundary calls | No remote Chalk client or execution receipt |
| [Factory Droid](docs/sponsors/FACTORY-DROID.md) | Bounded local proposal evaluator; can reject ineffective changes | No Factory runtime invocation or authenticated execution receipt |

Credentials alone do not implement those missing connections. No live credential is exposed to the browser.
The unused SDK enum dependency was removed; the primary demo remains independent of sponsor SDKs.
See [walkthrough](docs/demo/SPONSOR-CHALLENGE-WALKTHROUGH.md),
[independent evidence](docs/sponsors/INTEGRATION-EVIDENCE.md) and the
[campaign report](docs/operations/GRAND-MOBILIZATION-REPORT.md).

## Quick Start

Tested with **Python 3.14, Node 26 and uv**. From the repository root:

```sh
uv venv --python 3.14 backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
npm --prefix frontend ci
PYTHONPATH=backend backend/.venv/bin/python -m concord.portfolio --request data/portfolio/demo-request.json --output data/work/readme-demo
PYTHONPATH=backend backend/.venv/bin/python -m uvicorn concord.api.main:app --host 127.0.0.1 --port 8005
```

In a second terminal:

```sh
cd frontend
API_TARGET=http://127.0.0.1:8005 npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

The CLI writes `request.json`, `evidence.json` and `evidence.html` under the ignored
output directory. The two planning routes work **without historical SQLite,
credentials, model inference or a fresh network fetch**, after installing
dependencies. Use free ports, or stop your own earlier development server first.
For Windows, use `Scripts/python` and your shell's environment-variable syntax;
the commands above were verified on macOS.

Historical overlap, site scores and Research need the optional registry/model
database; detailed site pricing needs the CMS ratecard. Missing data is shown as
unavailable, with approximate prices explicitly labeled where supported. Do not
run `scripts/pipeline.sh` over an existing dataset without preserving it. See
[data boundaries and recovery](docs/research/README.md).

## Validation and Limitations

- Real ClinicalTrials.gov records supply **context**, not measured site operations.
- Portfolio operational and financial inputs are synthetic unless explicitly sourced.
- Historical enrollment predictive performance remains **limited and unverified
  as a prospective forecast**; an as-of-safe historical rerun is unavailable.
- Exact optimization is restricted to bounded instances. Larger admitted workloads
  use feasible heuristics with **unknown optimality gap**. See the
  [precise search limits](docs/portfolio/README.md#search-and-optimality).
- Modeled time differences and sensitivity ranges are not observed clinical
  benefits, calibrated prediction intervals or guaranteed savings.
- Coverage analysis is preliminary and requires human review. It is not insurance
  approval, a billing-compliance determination or an insurer partnership.
- Recruitment models and synthetic population assumptions are NSCLC-specific.
  Reusable schedule/budget infrastructure does not imply disease-wide validation.

The [integration audit](docs/integration/FINAL-INTEGRATION-REPORT.md) retains the earlier
optimizer and accounting evidence. Current software verification, missing-data skips,
provider blockers and browser receipts are recorded in the
[campaign report](docs/operations/GRAND-MOBILIZATION-REPORT.md).
These checks do not establish clinical performance.


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
