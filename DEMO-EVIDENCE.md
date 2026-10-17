# Demonstration evidence and reproduction

## Mode and acceptance boundary

Live computation on **SYNTHETIC OPERATIONAL INPUT** and **HYPOTHETICAL FINANCIAL INPUT**, with **REAL REGISTRY DATA** for context only. Saved retrieval/report endpoints are **artifact replay** of that computation. This is not historical replay of validated recruitment outcomes and no live sponsor relationship exists. Historical model performance is **UNVERIFIED**; missing data is never silently replaced with a synthetic database.

Runtime source after remediation: 555f3f86efaa338de1eff45570af3f4d0a1c38d9. The primary browser run c6184699e99d58a5d3cf71d09fefc09e originated at 63ffadfca23b24e0c649ec2e9fe64d0023e64313 with dirty=true because audit evidence/tests were being collected. Its executed source hashes are recorded, match the remediated production portfolio engine, and are more precise than claiming a clean final-head browser run. Later correction 555f3f86efaa338de1eff45570af3f4d0a1c38d9 only qualifies the other historical Findings table; that change was separately browser-checked. Final exact clean commit verification is recorded by Fleet after committing these reports.

Browser result SHA-256: c6184699e99d58a5d3cf71d09fefc09ea408f2a00a644eac54b8afe9468f67a5. It is a content digest, not proof that assumptions are true.

## Actual browser exercise

Chrome tab 1783081691 at http://127.0.0.1:5177/#portfolio-command; isolated API http://127.0.0.1:8004. Original implementation servers/checkouts retained.

| Action | Observed outcome |
|---|---|
| Open bundled portfolio and run | Six strategies computed and saved; synthetic labels visible; default unrealized admin savings = $0 |
| Inspect Trial Portfolio | Real titles/IDs with SIMULATED OPERATIONS; financial proxy warning visible |
| Inspect Site Capacity | Shared caps and static slots shown; initial peak rates never exceed entered caps |
| Change budget to $1.5M and SYN-C capacity basis UNKNOWN; run | New final time 12.01 months; conservative commitment $1,377,466; changed evidence instead of stale cache |
| Enter budget -1 and run | Visible 422 error and explicit previous-input evidence warning; no fresh result claimed |
| Restore budget/capacity; enable realized administration; run | Six matched scenarios; A 15.13 months / $1,018,305; B same duration / $943,305; F 9.53 / $1,097,830 |
| Financial view and coverage | Live single-trial calculation, transfer balance $0, downstream and unresolved exposure UNKNOWN; coverage review and approximate/unpriced source labels visible |
| Export JSON and HTML links | Both endpoint responses 200; Chrome displays “Blocked by your organization”; no new audit download observed. Browser delivery BLOCKED |
| Refresh and restore saved ID | Inputs restored; badge SAVED EVIDENCE REPLAY; same scenario values |
| Invalid saved ID | “Enter a 32-character saved run ID”; no load |
| Findings | Historical allocation and prediction error tables visibly Archived / UNVERIFIED and Provisional |
| Research with missing DB | Visible 503: data/concord.db missing, run scripts/pipeline.sh first |

Snapshots are docs/acceptance/browser-*.txt and browser-final.png / browser-scenarios.png. Screenshots were visually inspected. The browser console at the final restored page had no captured errors/warnings. Selector mismatches during automation were corrected using actual visible text; they are not counted as application failures.

Direct HTTP verification reads the actual browser run, not a prerecorded assertion fixture: report JSON equals saved API JSON; HTML embedded full JSON equals it; digest recomputes; all six visible rounded values match; POST of the same request reproduces scenario arrays. See delivery-verification.json and verify_delivery.py. report-endpoint.* files are saved HTTP responses, **not successful browser downloads**. The export-delivery blocker remains until actual browser-downloaded files can be compared in an approved environment; no browser policy was weakened.

## Provenance matrix

| Classification | Original source / version and date | Fields / transformation / calculation | Reproduce |
|---|---|---|---|
| REAL REGISTRY DATA | data/portfolio/context.json, capture 2026-10-17T16:45Z, per-record source URL and raw-response hash | NCT05800015/NCT05785767 ID, title, sponsor, registered start only; no enrollment progress or site operations imported | Checked-in /api/portfolio-command/demo; optional python3 scripts/portfolio_context.py refreshes current context and changes its version |
| SYNTHETIC OPERATIONAL INPUT | data/portfolio/demo-request.json, versioned by Git | Assumed 40 remaining per trial, fictional SYN-* hospitals, rates, caps, slots, lags, priorities and feasibility; live event simulation | Run demo request / browser editor; source hashes in evidence |
| HYPOTHETICAL FINANCIAL INPUT | backend/concord/compiler/protocols/NCT05800015.json and NCT06627647.json; authored schedules, not sponsor protocols | Fixed procedure quantities, approximate rate constants, negotiated-schedule placeholders, explicit missing-price fallback; proxy for NCT05785767 | Financial/portfolio APIs; source hashes in evidence |
| HYPOTHETICAL FINANCIAL INPUT | backend/concord/financial.py / financial_allocation.py; seed and full request recorded | 80% site / 70% procedure resource assumptions, drug reserve, payer share and admin reduction | coverage/economics/price, financial-stress generator |
| COMPUTED SCENARIO OUTPUT | browser-run-api.json and report-endpoint.*; exact digest above | Shared-capacity event timing, conservative costs, six strategy comparisons on common seed 7 / 128 draws | POST original request; verify_delivery.py checks identical scenarios |
| HISTORICAL MODEL ESTIMATE | data/findings and data/robustness archived research, original source files retained | Archived ratios/coefficients; incompatible robustness params now rejected; predictive status UNVERIFIED | Compatible GET returns labeled artifact replay; source files inspectable; cannot validly reconstruct as-of training |
| UNKNOWN | Missing dated registry snapshots, site enrollment counts, actual contract/drug prices and payer approvals | No fabricated quantities; null/reserve/review-required states; no calibrated clinical outcomes | Obtain authentic dated inputs and repeat independent audit before real claims |

Registry primary URLs: https://clinicaltrials.gov/api/v2/studies/NCT05800015 and https://clinicaltrials.gov/api/v2/studies/NCT05785767. The raw response bytes were not bundled; their recorded hashes cannot be independently reconstructed from the context extract alone, and today's response may change. Reproduction of the bounded demo uses the committed extract without a fresh registry call.

Policy source references are displayed by the application (CMS NCD 310.1, Medicaid SMD21-005 and NCI). This audit verifies conditional labels and arithmetic, not case-specific policy adjudication; it does not assert those policies prove payer responsibility.

## Reproduction commands

From /Users/sadius/concord-independent-acceptance:

```sh
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
npm --prefix frontend ci
backend/.venv/bin/python -m pytest -q -rs backend/tests
PYTHONPATH=backend:backend/tests backend/.venv/bin/python -m acceptance_reference docs/acceptance/numerical-corrected.json
PYTHONPATH=backend:backend/tests backend/.venv/bin/python -m acceptance_financial docs/acceptance/financial-stress.json
npm --prefix frontend run test:financial
npm --prefix frontend run test:portfolio
npm --prefix frontend run build
npm --prefix frontend run lint
```

Start separate terminals:

```sh
cd backend
.venv/bin/python -m uvicorn concord.api.main:app --host 127.0.0.1 --port 8004
```

```sh
cd frontend
API_TARGET=http://127.0.0.1:8004 npm run dev -- --host 127.0.0.1 --port 5177
```

Open http://127.0.0.1:5177/#portfolio-command, run once, optionally enable the explicit administrative realization assumption and run again. Evidence section supplies immutable run ID and report links. Refresh returns initial editor state; restore by saved ID. The request saved in browser-run-api.json can be replayed; the CLI command below was executed successfully and wrote request.json, evidence.json and evidence.html under ignored data/work/acceptance-cli. historical evidence can also be inspected directly from the committed HTTP response files. Saved runtime store files live under ignored data/work/portfolio and need POST regeneration on a fresh checkout. Run IDs change if code/evidence metadata changes even when scenario numbers stay equal.

```sh
backend/.venv/bin/python docs/acceptance/verify_delivery.py http://127.0.0.1:8004 c6184699e99d58a5d3cf71d09fefc09e
npm --prefix frontend audit --json
uvx --from pip-audit pip-audit -r backend/requirements.txt -f json
node /Users/sadius/engineering-fleet/dist/cli.js verify --task concord-independent-acceptance --json
```

The delivery script requires that exact browser-observed saved run in the local store; it fails 404 on a fresh clone rather than fabricating the run. Seed/runtime dependency versions are preserved in its checked-in result. To generate a new demo without it, use the existing CLI:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m concord.portfolio --request data/portfolio/demo-request.json --output data/work/acceptance-cli
```

Python runtime tested: 3.14.7; NumPy 2.5.4, FastAPI 0.143.3, Pydantic 2.14.1. Frontend lockfile supplies exact dependencies. Backend 443 pass / 43 skip; frontend 10 pass; typecheck/build pass; lint 17 warnings. All skips are listed verbatim below (whitespace normalized):

```text
SKIPPED [1] backend/tests/test_findings.py:9: data/concord.db not built
SKIPPED [1] backend/tests/test_findings_api.py:162: data/concord.db not built
SKIPPED [1] backend/tests/test_hooks.py:12: data/concord.db not built
SKIPPED [1] backend/tests/test_hooks.py:25: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:36: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:45: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:60: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:74: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:98: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:109: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:130: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:143: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:162: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:174: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:185: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:208: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:227: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:236: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:253: data/concord.db not built
SKIPPED [1] backend/tests/test_overlap.py:273: data/concord.db not built
SKIPPED [1] backend/tests/test_overrides.py:26: /Users/sadius/concord-independent-acceptance/data/demo_trials.json not present
SKIPPED [1] backend/tests/test_site_scores.py:40: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:49: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:62: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:75: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:97: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:108: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:121: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:130: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:153: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:175: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:190: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:205: data/concord.db not built
SKIPPED [1] backend/tests/test_site_scores.py:218: data/concord.db not built
SKIPPED [1] backend/tests/test_terms.py:93: data/ratecard.json not built
SKIPPED [2] backend/tests/test_terms.py:106: data/concord.db not built
SKIPPED [1] backend/tests/test_terms.py:133: data/ratecard.json not built
SKIPPED [1] backend/tests/test_terms.py:149: data/concord.db not built
SKIPPED [2] backend/tests/test_terms.py:172: data/ratecard.json not built
SKIPPED [1] backend/tests/test_terms.py:194: data/concord.db not built
SKIPPED [1] backend/tests/test_terms.py:226: data/concord.db not built
```

Missing concord.db/ratecard skips block historical predictive acceptance. Rebuilding today's dataset is not a historical leakage repair. No broad expensive historical drill or external model inference was used.

## Fleet execution honesty

Fleet 0.4.0: routes empty, economicExecutors empty, only codex-existing manual adapter, account budget list empty, invocation history empty. It tracks this campaign; direct Codex performs the audit and independent reference calculations. No provider orchestration or independent model review is claimed. Claude/Astra reserves untouched.

Campaign manifest: docs/acceptance/campaign.json. Mutable task/verification evidence remains ignored under .fleet/state, so it can bind to an exact clean commit without recursive hashes. The first managed worktree request addressed the unrelated chat repository and failed invalid-ref; it was recovered by creating an explicit Git worktree from the actual Concord repository at the preserved PR #2 SHA. No original branch was reset.
