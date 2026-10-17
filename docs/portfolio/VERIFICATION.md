# Portfolio Command acceptance — 2026-10-17

Baseline: `f51b13fa7c84dbd9f06b331b906500c28403e40b`, merged PR #1.
Feature branch: `codex/concord-portfolio-command`; draft PR base: `main`.
The final commit is identified by the branch HEAD, GitHub draft PR and Fleet's
exact-SHA verification record, avoiding a self-referential commit identifier here.

## Deterministic checks

| Check | Fresh baseline | Portfolio implementation |
|---|---:|---:|
| Backend `python -m pytest -q backend/tests` | 390 passed, 43 skipped | 412 passed, 43 skipped |
| Financial frontend contracts | 4 passed | 4 passed |
| Portfolio frontend contracts | absent | 6 passed |
| TypeScript + Vite production build | passed | passed |
| oxlint | 17 pre-existing warnings, no errors | same 17 warnings, none in new files |
| `git diff --check` | clean | clean |

Backend retains one existing Starlette/httpx deprecation warning. Data-dependent
skips are unchanged; they are not evidence that legacy historical models passed.
The 22 new portfolio checks include analytical staggered-activation and shared
capacity-release examples, enrollment conservation, financial transfer/resource
accounting, horizon budget bounds, hospital floor, deadline and no-loser constraints,
UNKNOWN handling, input rejection, identical seeded runs, changed-input identity,
unchanged coverage, zero-effect support, saved-report tampering, HTML escaping,
real ASGI endpoint compatibility, frozen dataset equality and runtime-source drift.

Run the configured final gate with the installed actual Fleet CLI:

```sh
node /Users/sadius/engineering-fleet/dist/cli.js verify \
  --task concord-portfolio-command --json
```

Fleet records a clean exact commit and runs backend tests, both frontend contract
suites, build/typecheck and lint. It is task tracking and deterministic verification;
automatic provider inference dispatch is unavailable and was not claimed.

## Browser → API → saved evidence → response

Actual Chrome interactions used <http://127.0.0.1:5176/#portfolio-command>, Vite
proxying the worktree's FastAPI server on port 8003. All six dashboard sections
were opened; no fixture responses or intercepted prerecorded results were used.

| Boundary | Observed evidence |
|---|---|
| UI → demo | Synthetic-operation badge, two source-backed Regeneron records, editable targets and assumptions; API `GET /demo` 200 |
| Run → simulation | Actual button → `POST /compare` 200 → computed six-strategy table and schedule |
| Financial integration | Party ledgers, contribution, reserve, marginal investment and source references render from response |
| Savings gate | Initially unavailable; explicitly checking realization releases $75,000; B preserves A's timing |
| No automatic acceleration | D adds $24,000 support relative to B, preserves 15.13-month makespan; F omits this zero-effect extra support |
| Shared capacity | Site Capacity reports A/B/C peaks at 3/3/4 participants per month, within assumed caps; allocated flows and billable months shown |
| Input changes | Budget edit marks old evidence stale; $1 computation is ineligible, with budget violation and no recommendation |
| Saved replay | Loading the prior run restores original $3,000,000 budget, inputs, run ID and results |
| Creation | SIM-NEW appears with simulated progress and UNKNOWN feasibility/rate; saved replay restores original two-trial request |
| Exports | Actual JSON and HTML browser downloads; JSON equals stored object and canonical digest; HTML contains same digest and all six completion values |
| Console | No captured warnings/errors at browser acceptance |
| Visual review | Corrected initial dark-background contrast; actual screenshots in `overview.png` and `scenarios.png` |

Download automation waited after the JSON download had completed; recovered by
reading the specifically named downloaded file. Chrome's ordinary multiple-file
download permission and a locked-Mac interruption were resolved after the user
unlocked the Mac. HTML then downloaded successfully; no browser security bypass.

The precommit browser evidence ID was `fb09d601eb583d9e124da6c112f63851` (seed 7,
128 common draws, savings explicitly realized). Its digest is
`fb09d601eb583d9e124da6c112f63851c51b346f95b433d91852fae9c103cd11`.
This records a working-tree acceptance artifact, not a clean-commit claim. A fresh
comparison after commit can produce a different evidence ID because commit/dirty
provenance is part of the hash, while the numerical results reproduce unchanged.

| Strategy | Expected final months | Expected sponsor USD incl. reserve | Conservative commitment USD |
|---|---:|---:|---:|
| A fixed baseline | 15.13 | 1,018,304.91 | 1,133,866.40 |
| B realized financial efficiency | 15.13 | 943,304.91 | 1,058,866.40 |
| C more sites | 9.94 | 1,050,576.45 | 1,309,266.40 |
| D extra support, zero rate effect | 15.13 | 967,304.91 | 1,082,866.40 |
| E better allocation | 9.94 | 1,125,576.45 | 1,384,266.40 |
| F joint search | 9.53 | 1,097,829.59 | 1,359,266.40 |

These are **synthetic assumption-based model outputs**, not observed recruitment,
validated prediction intervals, clinical outcomes or evidence of trial acceleration.
F includes a hypothetical operations investment/effect. No historical claims are
corrected or newly validated by this scenario table. Original allocator, financial
engine, Research outputs and 22 historical findings/robustness artifacts are unchanged.

## Remaining limitations

No source-verified operating rates, shared capacities, current participant progress,
full protocol or calibrated intervention effects are available. The financial proxy
and finite cost scope remain explicit. Legacy Research temporal leakage/cache-key
issues remain outside this feature and are documented in README. Local evidence
storage has no multiuser access/retention service. Fleet has a manual adapter but no
economic executor/confirmed provider account budget. No inference, Claude/Astra
escalation, merge or production deployment was performed for this campaign.
