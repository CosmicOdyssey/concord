# Independent demo acceptance — Operation Concord

**Verdict: PASS for the bounded local presentation. Not a clinical or production-readiness verdict.**
Date: October 17, 2026. Repository `CosmicOdyssey/concord`; branch
`codex/concord-hackharvard-demo`, isolated checkout. Base `main` independently
read from GitHub and cloned at `06ec129f88af468af8dd70c42a07d3515f69806e`.
Main advanced during work. The unpublished demo commits were rebased onto
`e0bd6c7bd1484c3ba6646d7e6a23d95743671641`, preserving the new Terms-first
navigation and all upstream changes. Acceptance below was repeated on integrated
source. No existing Concord or Fleet checkout was modified. No PR merge or deployment.

## Existing capabilities audited before use

| Capability | Actual implementation/evidence | Limit |
|---|---|---|
| Site allocation | `allocator/core.py`; retained research APIs; portfolio event simulation tests | Historical SQLite absent here; data-dependent paths not operationally accepted |
| Regeneron scenarios | `data/portfolio/context.json`, `portfolio.demo()` | Current metadata, not historical as-of operational inputs |
| Sponsor financial coordination | `financial.py`, financial allocation/coverage tests | Synthetic costs, authored schedules; optional CMS file absent |
| Separate party accounting | Sponsor, hospital, insurer and participant ledgers; transfers reconcile | Not actual payments or accounting audit of a sponsor |
| Fixed-budget portfolio search | `portfolio.py`, `portfolio_search.py` | Conservative modeled scope/horizon; not full trial costs |
| Shared capacity and slots | `portfolio_simulation.py`; independent scalar oracle | Proportional synthetic throughput; outside trials/access unknown |
| Exact bounded optimization | Exhaustive network enumeration with deterministic admission | Exact for entered finite draw bank only |
| Larger heuristic search | Existing beam search; hybrid regression tests | Unknown global gap; `FEASIBLE_HEURISTIC` preserved |
| Recruitment sensitivity | Seeded common lognormal draw bank and interval summaries | In-sample assumption sensitivity, not a validated forecast |
| Evidence export/persistence | Atomic immutable saves, digest-validated loads and reports | Reports replay a stored result; not a fresh optimization |

The demo uses the same engine without editing the optimizer, simulator, allocator,
financial model, authored protocol or ratecard code. The added backend is a
presentation adapter with a baseline-only evaluator and an explicit optimization
POST. The general app remains reachable; Findings/navigation were browser-smoke-tested.
No assertion is made that unavailable data-dependent views were exercised.

## Fresh automated verification

Not the previously reported counts. Clean-base initial backend result:
**502 passed / 57 skipped / 2 failed**. The failures were ratecard-dependent
financial golden constants on the missing-CMS-file path, not a discovered model
benefit. The fixes replace those constants with independent sums of priced
routine lines, receipt/resource reconciliation and unchanged supply classification
invariants. No production arithmetic was changed and no test was skipped to pass.

Full configured Fleet verification after implementation and saved-evidence tests:
**PASS**, receipt `043a1e9b-7e0c-437f-ada1-b7a4e1d5d2ef`, 55.888 seconds,
dirty working-tree verification (not falsely called commit-bound):

- Backend: **549 passed, 85 skipped**, one inherited Starlette/httpx deprecation warning.
- Frontend: **29 passed** (15 financial + 6 portfolio + 8 demo).
- Separate typecheck: pass.
- Build: pass.
- Lint: pass; existing application warnings remain, no new demo warnings.
- `git diff --check`: pass.

The final clean-commit Fleet result is attached to the local task and reported in
the draft PR; versioned receipts necessarily precede their evidence-only commit.
The complete raw Fleet output is retained in ignored local Fleet state; the
versioned summary preserves IDs, timestamps, durations, pass/fail states and counts.

New checks cover deterministic inputs, baseline without optimization, actual
recomputation on rerun, request identity, capacity and slots, all draw completion,
party ledgers and reserve arithmetic, no invented savings, labels, report
identity, exact equality to an independent **Fraction-based scalar exhaustive
oracle**, unavailable/altered saved evidence and explicit replay. Socket creation
is blocked in the no-outbound-backend test. Browser checks use the real backend,
not mocked response interception.

One interim verification (`12bd9b6d-1c91-427a-a6a1-ed5c525e5b05`) overlapped
source synchronization during the unpublished rebase and correctly failed with
28 source-change-fence failures. It was **not** accepted. Source was then frozen,
the runtime restarted, and full verification repeated successfully. The source
guard was not weakened. Raw invalidated output is preserved locally.

## Real browser acceptance

Connected browser at **1440 × 900**; actual locally built application and loopback
HTTP API. Runner: `scripts/demo-browser-acceptance.mjs`; raw scene observations:
`browser-rehearsals.json`; extra cases: `browser-edge-cases.json`.

| Rehearsal | Server compute | Main clicks | Automated journey |
|---|---:|---:|---:|
| 1 | 356.0 ms | 4 | 1,637 ms |
| 2 | 384.8 ms | 4 | 1,613 ms |
| 3 | 367.0 ms | 4 | 1,619 ms |

All three completed consecutively with **distinct real computation timestamps**,
the same deterministic run ID `516465c380548233a0419d0408018d76`, exact-model
`OPTIMAL`, 678 cached candidate/policy evaluations, and the expected comparison.
These are automated action/observation times, **not three spoken 180-second talks**.
Each includes one setup Reset outside the four main clicks. Optional report makes
five; scene 3 advances on real completion without another interaction.

Additional real checks:
- Refresh resets to baseline; return from general Findings resets Demo Mode.
- Previous/Next navigation works; no automatic optimizer execution on load.
- Reset during an **observed in-flight** computation does not restore the late
  result. It aborts client observation; an already running pure server computation
  can still finish and save evidence. No claim of server-side cancellation.
- With a real static-only server and no API, HTTP 404 is honestly shown, with no
  silent replay. Explicit saved load validates the byte checksum and shows the
  **SAVED RESULT REPLAY** banner. Refresh does not silently restore saved state.
- Browser JSON download was parsed and independently digest-validated. Browser
  HTML export also downloaded and contained the same result hash. Its source-tab
  automation download-event wait timed out because the link opens another tab;
  the actual downloaded file was verified. The UI/evidence scene is sufficient
  for the pitch without opening a download window.
- Live demo browser console errors: **0** in the inspected log.
- Real screenshots: `screenshots/01-problem.jpg`, `02-comparison.jpg`,
  `03-evidence.jpg`, `04-saved-fallback.jpg`. No fabricated recording: the connected
  browser exposed visibility/viewport, not a screen-recording capability.

Raw downloaded live result: `evidence/browser-result.json`; its genuine receipt
says code checkpoint `e13cc8bf5e84be79b2ea117a74a4e6d29daca71e`, dirty=true.
That is intentional provenance, not rewritten to the later documentation commit.
Fallback snapshot `frontend/public/demo/saved-result.json` was separately generated
from that **clean** code checkpoint (dirty=false), run
`4b9207c1b4b89f27a853ff68cb56fa42`, at 334.829 ms. Live and saved identities are
not conflated. Neither result is a hand-authored outcome.

## Startup and spoken-script timing

Fresh owned-process startup through first baseline response: **439.448 ms**;
baseline computation: **3.099 ms**. Dependencies and the frontend were already
installed/built; this is not a claim about installation time or every laptop.

The 180-second script has **319 whitespace-counted words**; at 135 words/minute
its nominal speech is 141.8 seconds. Locally installed Samantha speech synthesis
at 145 words/minute produced **154.362 seconds of audio** (including its pauses),
leaving about 25 seconds for clicks and visual pauses. The 120-second script has
**218 words**; the same synthetic voice produced **109.768 seconds**, leaving
about 10 seconds. These are **synthetic-voice measurements**, not an assertion of
human presenter rehearsal. Human pacing, room legibility and venue hardware remain
to be checked. No timing is invented from a recording that does not exist.

## Scientific/economic and provider boundaries

Primary outcome and precise financial values are in `README.md`. The expenditure
increase is **$162,692.55**, not a saving. The $3M ceiling is not binding in this
fixture. No claim of 1.56×/1.28× real-world improvement, clinical efficacy or
insurer partnership is used.

The two registry titles/sponsors were independently re-fetched from their public
ClinicalTrials.gov v2 endpoints **during engineering**, not during presentation.
Both titles, sponsors and complete-response hashes match the existing bundle;
see `registry-recheck.json`. This verifies metadata only, not operational assumptions.
No real patient data, real hospital budgets or private credentials are used.

Primary executor and final technical gate: current Codex session. A single
existing **local Ollama gemma3:4b** advisory QA call used **7,283 prompt / 489 output
tokens**, 22.418 seconds wall latency, no tools, no paid API; model digest and raw
response in `local-review.json`. This was a direct bounded loopback call recorded
in Fleet as a **worker claim, not a fabricated Fleet provider invocation**. Its
generic synthetic-data/validation cautions are retained. Its suggestion that
recruitment rates are not considered is inaccurate: rates are explicit assumed
inputs. No model approval substituted for deterministic acceptance. Codex-session
usage is not independently metered here; local electricity is unmeasured.
No Claude or Astra invocation, new agent identity or automatic failover.

## Readiness distinctions

- **Implemented:** isolated Demo Mode, versioned inputs, actual existing optimizer,
  comparison, party accounting, disclosure, reset/navigation, reports, saved fallback,
  two timed scripts and executable acceptance runner.
- **Independently tested:** backend independent oracle/arithmetic, all available
  regression suites, frontend contracts and Fleet deterministic verification.
- **Live verified:** three real browser journeys, genuine recomputation, in-flight
  reset fencing, failure-to-explicit-replay path, exports and source metadata.
- **Operationally safe:** bounded **local presentation** with synthetic operations,
  loopback-only serving, no service credentials, no deployment or premium calls.
- **Not proven:** clinical forecasting/acceleration, insurer payment, complete trial
  costing, real capacity, unavailable SQLite-dependent functionality, prospective
  outcomes, production security, venue hardware or human three-minute delivery.

No further product features are needed for this demo. Do not merge or deploy this
branch without separate operator approval.
