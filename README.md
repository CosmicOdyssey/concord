# Concord

**Turn a clinical trial protocol into a site budget both sides can check.** Concord connects protocol procedures, public Medicare price benchmarks, coverage assumptions and portfolio context in one reviewable workflow. Every priced line carries its source; unsupported operating inputs remain visible assumptions.

Built for **HackHarvard 2026, Regeneron track**, by the Bruno Bears from Brown University. Concord also includes a sponsor integration lab for **Photon 2.0, Chalk and Factory Droid**, alongside an explicitly synthetic planning demonstration.

## What you can do

| Workflow | What Concord computes | Evidence boundary |
| --- | --- | --- |
| **Protocol to terms** — `#terms-flow` | Coverage grid, per-participant budget, two-site comparison, proposed-budget CSV review and term-sheet/counter-proposal exports | Public CMS 2026 physician/lab benchmarks where loaded; authored protocol interpretation requires review. Not negotiated prices or a coverage decision. |
| **Portfolio overlap** — `#overlap` | Shared registered sites and eligibility context across a sponsor's trials | NSCLC eligibility analysis; breast-cancer shared-site counts. Registry overlap does not establish causal recruitment competition. |
| **Findings and site scores** — `#findings`, `#site-scores` | Historical enrollment evidence, uncertainty and tests of the original coordination idea | Historical evidence, not prospective forecasts. Earlier allocation models remain under Research. |
| **Sponsor budget** — `#financial` | Budget scenarios, financial responsibility and evidence exports | Synthetic worksheet; payer benchmarks do not automatically reduce sponsor expenditure. No time model. |
| **Portfolio Command** — `#portfolio-command` | Capacity- and budget-constrained allocation with paired seeded comparisons | Synthetic hospitals, costs, rates and activation assumptions; exactness applies only to admitted bounded searches. |
| **Regeneron demonstration** — `#demo` | Six scenes covering baseline, optimization, financial trade-offs and evidence | Live local computation requires the backend. Explicitly loaded saved evidence is replay. Modeled completion is not a clinical outcome. |

The main presentation leads with Protocol to terms and the research findings. Planning and sponsor-lab routes remain directly accessible without duplicating the primary navigation.

## Photon, Chalk and Factory Droid

Open **`#sponsor-agents`** to inspect sponsor-related operations and their execution status. The original calculation services work without sponsor credentials; a missing or failed provider must never become a successful fixture response.

| Sponsor | Role in Concord | Provider path and evidence |
| --- | --- | --- |
| **[Photon 2.0](docs/sponsors/PHOTON.md)** | Messaging access to bounded planning commands and operational status | Local commands plus an operator-authorized Photon 2.0 project API send to a fixed configured space and agent. API acceptance is recorded separately from delivery; no first-space or arbitrary-recipient fallback. |
| **[Chalk](docs/sponsors/CHALK-EVALUATIONS.md)** | Reproducible evaluation of constraints, accounting, evidence and failure handling | The versioned 15-case local suite remains available. An opt-in Chalk Compute Evaluation deploys the actual task/scorer, uploads a pinned dataset and reads remote result rows; upload alone is never completion. |
| **[Factory Droid](docs/sponsors/FACTORY-DROID.md)** | Propose operational adjustments, evaluate them and retain or reject them | An opt-in official server-side Droid SDK runner consumes the agent stream, exposes bounded engine tools and validates its terminal result. Local paired evaluation remains available and rejects ineffective proposals; clinical criteria stay immutable. |

Provider actions require server-side credentials, an explicit per-provider execution gate and an operator token. The lab reports each provider’s prerequisites and displays authentic receipts or a visible failure. Authentication configuration alone is never proof of a completed run or delivery. Local and remote evaluation results remain separate. See the [sponsor walkthrough](docs/demo/SPONSOR-CHALLENGE-WALKTHROUGH.md), [architecture](docs/sponsors/ARCHITECTURE.md) and [integration evidence](docs/sponsors/INTEGRATION-EVIDENCE.md).

### Configure the provider connections

Copy `.env.example` to the ignored `.env` and configure the accounts you intend to use. Keep credentials server-side. Install the optional Python sponsor dependencies with `uv pip install --python backend/.venv/bin/python -r backend/requirements-sponsors.txt`; the pinned Node SDK is installed by `npm --prefix frontend ci`. Start the API with `--env-file .env` when using that file.

- **Photon 2.0:** configure the project API key, project, fixed space and agent user IDs. The preview never sends. A real send requires the Photon execution gate, operator authentication, explicit confirmation and a stable request ID. API acceptance does not prove carrier/iMessage delivery. The local signed webhook contract remains distinct from an unverified provider event schema.
- **Chalk:** configure client ID/secret, environment and the explicit compute gate. The environment needs Compute Evaluations and an active function queue. Deployment and compute can incur usage; no cloud decorators run during ordinary API startup.
- **Factory:** install a compatible official `droid` CLI, configure its executable and an explicit permitted model, then enable its execution gate. The runner uses only the scoped Factory credential and bounded tool inputs. Auto routing and Claude/Astra reserve models remain blocked. Opening a session is not a completed agent run.

Exact variable names, endpoint schemas, timeouts and execution evidence are documented in [Photon](docs/sponsors/PHOTON.md), [Chalk](docs/sponsors/CHALK-EVALUATIONS.md), [Factory](docs/sponsors/FACTORY-DROID.md) and [integration verification](docs/sponsors/LIVE-INTEGRATION-VERIFICATION.md). Do not enable paid overages or send to unapproved recipients.

## Run Concord

Verified development environment: **Python 3.14, Node 26 and uv**. From the repository root:

```sh
uv venv --python 3.14 backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
npm --prefix frontend ci
PYTHONPATH=backend backend/.venv/bin/python -m uvicorn concord.api.main:app --host 127.0.0.1 --port 8005
```

In a second terminal:

```sh
cd frontend
API_TARGET=http://127.0.0.1:8005 npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

Open [Protocol to terms](http://127.0.0.1:5178/#terms-flow), the [Regeneron demo](http://127.0.0.1:5178/#demo), or the [sponsor lab](http://127.0.0.1:5178/#sponsor-agents). Use free ports or stop only your own prior server. Windows uses `.venv/Scripts/python` and the shell's environment-variable syntax.

The planning demo, financial worksheet and local sponsor checks use bundled inputs after dependency installation. Historical overlap/site scores/Research require the optional registry/model database; detailed pricing requires the CMS ratecard. Missing data stays unavailable or explicitly approximate. Restore those inputs using the [documented data boundaries](docs/research/README.md); preserve an existing dataset before running `scripts/pipeline.sh`.

Generate a standalone planning report without a server:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m concord.portfolio --request data/portfolio/demo-request.json --output data/work/readme-demo
```

The ignored output directory contains `request.json`, `evidence.json` and `evidence.html`. Follow the [180-second planning script](docs/demo/HACKHARVARD-180-SECOND-SCRIPT.md), [portfolio assumptions](docs/portfolio/README.md) and [financial methodology](docs/financial/README.md). A script duration is not evidence of a timed human rehearsal.

## Computation, replay and provider evidence

- **Live local computation:** an actual backend request computes a result from recorded inputs, seed and source hashes. The operating data may still be synthetic.
- **Saved evidence replay:** explicitly opening a stored report or rehearsal shows the saved result and its provenance. It does not execute optimization or a sponsor API.
- **Provider execution:** a remote service must return an authentic receipt. Authentication configuration, a local mock, a queued request and accepted delivery are distinct states.

The white UI does not change those boundaries. Static hosting alone cannot execute FastAPI optimization or sponsor POST requests. Backend failures remain visible; users can choose saved replay separately.

## Research and scientific limits

Concord began as a clearing house for concurrent trials. Tests on **7,221 NSCLC trials** weakened that premise: coordination gains fell from **1.42× in sample to about 1.05× held out**, while estimated within-site congestion elasticity was **0.09**, against an earlier assumed 1.0. These are research findings, not clinical acceleration claims. Methods, figures, uncertainty and negative results remain in [Findings](docs/figures/README.md), [the research archive](docs/research/README.md) and the repository history.

Registry identifiers and titles supply context, not observed site capacity, negotiated costs or future enrollment. The synthetic demo's completion differences are conditional model outputs, not calibrated prediction intervals or guaranteed savings. No prospective multi-indication forecasting, insurer partnership, clinical efficacy or coverage approval is established. An as-of-safe historical rerun requires authentic time-versioned inputs that are not supplied by the demo.

Clinical criteria remain immutable in automated operational tools. A recorded review is not sponsor, institutional, IRB or clinical authorization. Medicare benchmarks and preliminary coverage interpretations require professional review before use.

## Verification

```sh
PYTHONPATH=backend backend/.venv/bin/python -m pytest -q -rs backend/tests
npm --prefix frontend test
npm --prefix frontend run test:compare
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run lint
```

The [campaign report](docs/operations/GRAND-MOBILIZATION-REPORT.md) records exact commits, clean-checkout reproduction, actual browser workflows, test counts, missing-data skips and provider blockers. Earlier screenshots and worker reports retain their original provenance; their claims do not override current execution checks. Interactive backend documentation is at `http://127.0.0.1:8005/docs`.

## Code map

- `backend/concord/api/`: HTTP endpoints; `agents/` and `evals/`: sponsor boundaries and acceptance.
- `backend/concord/terms.py`, `ratecard/`, `anchoring.py`, `proposal.py`: protocol, pricing and budget review.
- `backend/concord/portfolio/`, `financial/`: constrained planning, accounting and evidence.
- `backend/concord/ingest/`, `model/`, `analysis/`: registry recovery and historical research.
- `frontend/`: React, TypeScript and Vite; `data/portfolio/`: frozen synthetic planning inputs.

## Team and license

Repository contributors include [CosmicOdyssey](https://github.com/CosmicOdyssey), [kevinsrun](https://github.com/kevinsrun) and [akshatsinghania](https://github.com/akshatsinghania); see the [contributor history](https://github.com/CosmicOdyssey/concord/graphs/contributors).

Code is released under the [MIT License](LICENSE). ClinicalTrials.gov and CMS data retain their source terms; CPT codes and descriptors are © American Medical Association. Source rate files are downloaded locally and are not redistributed here. No sponsor endorsement or insurer relationship is implied.
