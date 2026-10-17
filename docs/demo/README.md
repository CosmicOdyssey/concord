# Concord · HackHarvard 180-second demo

Entry: **`http://127.0.0.1:18080/#demo`**. Desktop target: **1440 × 900**, browser zoom 100%.
Use the existing Calm theme control; dark and light are supported. No deployment is necessary.

## Reproduce (macOS/Linux, Node 22.18+ and Python 3.11+)

```sh
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
cd frontend && npm ci && npm run build && cd ..
python3 scripts/run-demo.py
```

`uv` is optional: use `python3 -m venv backend/.venv` then
`backend/.venv/bin/python -m pip install -r backend/requirements.txt` instead.
Dependencies must be installed **before** going offline. Run from this checkout;
no private credentials, external AI, registry fetch, SQLite bundle or live external
API is needed. Fonts and saved evidence are bundled locally. The launcher clears
inherited service credentials, binds only `127.0.0.1`, uses isolated ignored
`.fleet/state/hackharvard-demo-data`, and stops only its own child on Ctrl-C.
The normal `frontend` Vite + backend workflow is unchanged.

## Four main clicks, six scenes

Open `#demo` (setup, not a presentation interaction).
1. **Next Scene**: the computed fixed baseline.
2. **Optimize Portfolio**: actual POST → existing engine → comparison; the
   transient computing scene advances on the real response, not on a timer.
3. **Next Scene**: financial responsibility and the exact run's evidence.
4. **Next Scene**: conclusion.

Optional fifth interaction: **Open Evidence Report** in scene 5. It exports the
immutable result currently shown, without running again. The inherited HTML
endpoint downloads an attachment; the same report's provenance is already
visible in the evidence scene. Do not depend on a download window during the pitch.
Reset and Previous Scene are rehearsal controls, not additional required steps.
Refresh and Reset always restore scene 1 and recompute the fixed baseline. Every
Optimize click really recomputes; the content-addressed run ID may remain identical.

## What the numbers mean

Fixture: `data/demo/hackharvard-request.json`. Two existing Regeneron-context trial
identifiers; four explicitly **synthetic** hospitals; 40 hypothetical remaining
participants per trial; $3M modeled budget; seed 7; 32 draws; independent mean-one
lognormal rate spread 0.25. This is **in-sample assumption sensitivity**, not a
calibrated enrollment prediction. New sites have a hypothetical 3-month lag.
No rate effect from support or operations; administrative savings are unrealized.

The fixture is the existing portfolio demo with only the draw count reduced from
128 to 32 (bounded repeatable presentation and exact admission) and the optional
operations effect set from 0.15 to zero (no assumed efficiency boost). No optimizer,
financial model, search admission threshold or scientific algorithm changed.
Objective: expected maximum **priority-weighted** completion (priorities 1.2 and
1.0), not the unweighted portfolio-completion measure shown for readability.
`OPTIMAL` means exact enumeration on this entered model/draw bank only.
The existing large-case `FEASIBLE_HEURISTIC` label and unknown gap are preserved.

Verified fixture outputs with bundled placeholder rates:

| Measure | Fixed baseline | Recommended allocation |
|---|---:|---:|
| Modeled final enrollment completion | 15.13 months | 9.24 months |
| P10–P90 assumed completion | 14.050–16.541 months | 8.631–9.785 months |
| Expected sponsor expenditure | $818,279.54 | $980,972.09 |
| Sponsor contingency, not expenditure | $200,000 | $200,000 |
| Expected sponsor costs including reserve | $1,018,279.54 | $1,180,972.09 |
| Conservative budget commitment | $1,133,866.40 | $1,481,066.40 |
| Budget reserved | 37.8% | 49.4% |
| Distinct hospitals / trial–site assignments | 2 / 4 | 4 / 8 |
| Capacity/slots | Feasible | Feasible |
| Censored draws | 0 | 0 |

The recommendation uses **$162,692.55 more expected sponsor expenditure**; it does
not demonstrate a saving. This example's budget is not binding: it demonstrates
capacity reallocation within a ceiling, not that the entire $3M must be spent.
Usable administrative savings: $0. Coverage, participant cost sharing and support
are unchanged between these allocations. No clinical acceleration is established.

## Provenance and limits

- `data/portfolio/context.json` is bundled current registry-context metadata,
  carrying source URLs, reported capture dates and response hashes. It is **not**
  an historical as-of data set, complete protocol, or outcome validation.
- The missing historical SQLite bundle is **not** reconstructed or implied.
- Both trials use Concord's illustrative authored NCT05800015 financial schedule;
  it is an explicit proxy for trial 2, not its actual protocol.
- This isolated demo has no CMS ratecard file. Procedure prices are approximate
  placeholders, not independently verified CMS rates or negotiated sponsor costs.
- Potential insurer amount is a responsibility/coverage assumption, not insurer
  participation, confirmed coverage, reimbursement or a financing partnership.
- Patient geography, clinical eligibility, external trials, real staffing,
  downstream outcomes and actual hospital margins remain unvalidated.
- The app's earlier predictive headlines are not used. Historical predictive
  performance is **UNVERIFIED for this demo**.

## Failure and fallback

If computation has not completed after about 10 seconds, explain the pending
state. The client fails after 15 seconds; no outcome is substituted. Choose
**Load saved rehearsal (not live)** explicitly. Its banner, timestamps, hashes
and report say **SAVED RESULT REPLAY**. Saved bytes are SHA-256 checked against
the capture digest; an altered file is rejected. Saved artifacts are a genuine
prior computation, not an animation or a hand-authored result.

If all browser interaction fails, open `frontend/public/demo/saved-report.html`
as a local file. Say that it is the saved rehearsal. Never claim another live run.

To intentionally refresh the fallback after reviewed code changes:
`backend/.venv/bin/python scripts/capture-demo.py`, inspect the genuine capture
and dirty/source identity, then rebuild the frontend. This is an explicit operator
step, not part of presentation startup. Do not overwrite evidence merely to make
numbers more attractive.

## Verification

```sh
(cd backend && .venv/bin/python -m pytest -q)
(cd frontend && npm test && npm run typecheck && npm run build && npm run lint)
node "$FLEET_CLI" verify --json
```

`FLEET_CLI` is the installed existing Engineering Fleet `dist/cli.js`; on the
acceptance machine it is `/Users/sadius/engineering-fleet-hackharvard/dist/cli.js`.
The tracked `.fleet/config.json` runs every deterministic check. Fleet campaign:
**CONCORD-HACKHARVARD-DEMO**, local task `concord-demo-implementation`. It never
creates a remote execution authority, consumes a previous mission approval or
modifies the Fleet daemon/supervisor. See `ACCEPTANCE.md` for actual fresh results.
