# Concord — Clinical Trial Planning & Financial Coordination

**Coordinate clinical trial sites, sponsor budgets, and portfolio capacity in one evidence-aware workspace.**

Concord helps pharmaceutical sponsors compare site allocations, trial costs,
shared capacity and financial responsibility. It is an **NSCLC-focused proof of
concept**, with source-linked worksheets and clearly labeled exploratory planning.
Modeled completion times are not observed clinical outcomes or validated forecasts.

## The Problem

Sponsors, research sites and insurers work with different pieces of a trial:
protocol procedures, routine-care coverage, site contracts, recruitment capacity
and budgets. Concurrent trials can share sites while their budgets and capacity
assumptions remain separate. Concord brings those inputs into a reviewable
comparison. Registry overlap does **not** establish that competition causally
slows recruitment.

## What Concord Does

| Capability | Evidence-backed tools | Exploratory planning tools |
| --- | --- | --- |
| Trial portfolios | Historical registered-site overlap and trial context | Multi-trial allocation under entered constraints |
| Sites | Historical site evidence, with validation limits | Assumed shared capacity, slots, activation delays and recruitment rates |
| Financial coordination | Source-linked protocol, coverage and rate-card worksheets | Synthetic site costs, sponsor budgets, reinvestment and sensitivity |
| Comparisons | Traceable budget lines and preliminary responsibility | Budget-constrained scenarios and modeled completion times |
| Evidence | Source references, assumptions and exports | Seeded scenario results saved with content digests |

“Evidence-backed” means sources and calculations can be inspected; it does not
mean every authored protocol, coverage interpretation or operating assumption is
verified. **Sponsor budget** has no time model. **Portfolio Command** separately
simulates recruitment under explicit assumptions; insurer payment amounts do not
automatically lower sponsor costs or accelerate a trial.

## Demo — HackHarvard in Three Minutes

After [Quick Start](#quick-start), open the actual
[Portfolio Command route](http://127.0.0.1:5178/#portfolio-command).
Follow the [180-second script, 120-second alternative and judge Q&A](docs/demo/HACKHARVARD-180-SECOND-SCRIPT.md):
two Regeneron-context trials → shared synthetic hospitals → fixed budget → live
optimization → comparison → assumptions and evidence.

The [Sponsor budget worksheet](http://127.0.0.1:5178/#financial) is a separate
financial view. Both routes are intentionally outside the main navigation; the
primary navigation remains Protocol to terms, Portfolio overlap, Findings, Site
scores and Research. No hosted deployment or video is claimed.

[Actual browser screenshot](docs/demo/final-polish/overview.png) ·
[Rehearsal and verification evidence](docs/demo/final-polish/VERIFICATION.md)

## How It Works

**ClinicalTrials.gov context → trial portfolio → financial and operational
constraints → scenario computation → comparison → evidence report.**

Registry records provide real identifiers, titles and sponsor context. The frozen
planning demo supplies explicitly synthetic hospitals, progress, capacity, costs
and rate effects; its authored financial schedule is illustrative. Computation
runs locally using the existing financial ledgers and capacity simulator. Reports
retain inputs, source hashes, seed and limitations. Loading a saved report is
labeled **SAVED EVIDENCE REPLAY**, rather than a new calculation.

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

The [integration audit](docs/integration/FINAL-INTEGRATION-REPORT.md) records the
independent optimizer correction and accounting checks. The latest merged CI
baseline passed **556 backend tests and 29 frontend tests**, with **102 missing-data
skips**; those checks establish software behavior, not clinical performance.
Current branch results and every skip reason are in the [demo verification record](docs/demo/final-polish/VERIFICATION.md).

## Research Documentation

The [research index](docs/research/README.md) distinguishes archived findings from
current acceptance evidence. Full regression tables, parser-version audits,
holdout and robustness grids, negative findings and withdrawn interpretations are
preserved in [Historical experiments and corrections](docs/research/HISTORICAL-EXPERIMENTS-AND-CORRECTIONS.md).
The original [decisions log](docs/decisions.md) remains intact.

Future work requires authentic site-level operational evidence, dated training
snapshots and coverage review. Shared interfaces may support later expansion;
this campaign adds no disease model, parser or dataset.

## Technology Stack and Repository Structure

Python/FastAPI, SQLite, NumPy/SciPy; React/TypeScript/Vite; Engineering Fleet for
task tracking and deterministic verification. No external AI call is required
for the frozen demo.

```text
backend/concord/       Protocols, financial ledgers, capacity simulation, search and API
frontend/             Calm interface and source-linked comparisons
data/portfolio/       Frozen registry-context extract and synthetic demo request
docs/demo/            Presentation script, screenshots and verification
docs/research/        Archived experiments, corrections and scientific limits
.fleet/               Project verification configuration; local records are ignored
```

[Architecture and API reference](docs/reference/ARCHITECTURE-AND-API.md) ·
[Financial contract](docs/financial/CONTRACT.md) ·
[Portfolio mathematics and reproduction](docs/portfolio/README.md)

## Team and HackHarvard

Built for **HackHarvard 2026, Regeneron Healthcare Track**. Repository contributions
are credited to [CosmicOdyssey](https://github.com/CosmicOdyssey) and
[kevinsrun](https://github.com/kevinsrun); see the
[contributor history](https://github.com/CosmicOdyssey/concord/graphs/contributors).
No sponsor endorsement, insurer relationship, award or institutional affiliation
is implied.
