# Portfolio Command

Concord is a planning tool. This demonstration runs **live computation on synthetic
operational assumptions**, with two current ClinicalTrials.gov records providing
Regeneron trial identifiers, titles and sponsor context only. It is not live trial
operations, a historical forecast, a sponsor engagement or clinical validation.

## Reproduce

From the repository root (Python 3.14 / Node 26 used for acceptance):

```sh
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
PYTHONPATH=backend backend/.venv/bin/python -m concord.portfolio \
  --request data/portfolio/demo-request.json --output data/work/portfolio/reproduction
PYTHONPATH=backend backend/.venv/bin/python -m uvicorn concord.api.main:app --host 127.0.0.1 --port 8003
```

In another terminal:

```sh
cd frontend
npm ci
API_TARGET=http://127.0.0.1:8003 npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
```

Open <http://127.0.0.1:5176/#portfolio-command>. No database, credentials, cloud
compute, model inference or network access is required for the frozen demo.
`scripts/portfolio_context.py` optionally refreshes public registry **context**;
this changes its provenance hash and does not regenerate operational assumptions.
The checked-in `context.json` and `demo-request.json` are the minimal dataset.

## Architecture and mathematics

The original allocator and financial APIs are preserved. A new bounded adapter
uses the original `allocator.core.Instance` contract for trial targets, weights,
feasibility and shared concurrent-trial slots. Its timing equation and search
are separate: the original mean-lag approximation cannot represent the required
activation and completion events. No original solver equations are rewritten.

For a selected, activated edge e=(site s,trial i), raw rate r_e is multiplied by
an independent, mean-one lognormal shock (`log sigma = spread`) and any explicit
intervention effect. At each event, usable rates are

`q_e = r_e * min(1, site_monthly_capacity / sum(raw_active_rates_at_site))`.

The simulator advances to the next activation, trial completion or horizon,
integrates enrollment, and releases completed trials' capacity immediately.
Continuous fractional enrollment is a fluid approximation. Slots are reserved
statically across the chosen network, a conservative restriction. No measured
eligibility overlap or background workload is available; neither is inferred.

Objectives selectable in the UI:

- `weighted_makespan`: mean over draws of `max_i(priority_i * T_i)`.
- `sum_duration`: mean over draws of `sum_i(priority_i * T_i)`.
- `min_cost_deadline`: minimize expected sponsor cost plus reserve, with each
  trial's expected duration no greater than its selected deadline.

Unweighted final completion `E[max_i T_i]` is reported separately. Every candidate
must finish in every sampled draw within the horizon to be recommended. Incomplete
draws are horizon-censored; displayed capped times are lower bounds, not an
estimate of eventual completion. This sample constraint is not an assurance
outside the draws. Optional no-loser means each trial's expected duration cannot
increase versus the untouched baseline on that same draw bank.

Search is deterministic beam search (width 3, depth 3, at most 96 visited networks
per intervention policy), exploring add/drop/swap neighborhoods. All candidate
scores use the same seeded full draw bank. This is an in-sample scenario analysis,
not an exact global optimum or an out-of-sample performance claim. Joint search
also chooses whether to fund operations or extra support; zero-effect support
is omitted from joint candidates. A remains immutable regardless of the search.

## Financial conservation

The portfolio reuses PR #1's `financial.coverage` and `financial.economics` for each
trial, then sums party-specific ledgers. Coverage is fixed across scenarios and
never a decision variable. UNKNOWN/CONDITIONAL/REVIEW_REQUIRED responsibility is
held in sponsor contingency, without assumed insurer/patient payment.

Sponsor budget commitment conservatively reserves:

1. Selected new activation costs (baseline activation treated as sunk), plus any
   selected operations investment per trial.
2. Operating **and monitoring** costs for every selected edge for the full horizon.
3. Maximum selected per-participant recruitment/screening cost × remaining target.
4. Fixed authored procedure/reserve costs, access support and administration.

Expected costs instead use each edge's simulated active months and enrollment.
The former bounds the latter within this finite modeled scope. Actual treatment
beyond the authored visits, actual drug acquisition and complications are unknown.
The NCT05800015 schedule is an illustrative proxy for NCT05785767 and is labeled.

Hospital contribution must meet the selected floor per trial under inherited
resource-cost assumptions. Resources and money transfers are reported separately.
Support has a minimum $200 assumption and is never reduced to accelerate trials.
Administrative reductions free budget only when `savings_realized=true`. Support
changes rates only through an explicit nonzero assumption; its default effect is
zero. Operations' default 15% effect is also hypothetical and costs $25,000/trial.

Marginal investment rows compare each single investment to fixed A, with paired
time differences, extra expected costs, incremental budget commitment, enrollment
gain at month min(12,horizon), gain/dollar, critical-path effect and break-even
cost per month saved. Break-even requires an assumed sponsor value per month; it
does not monetize clinical benefit. Retain funds when no feasible time gain exists.

## Evidence integrity and data boundaries

`POST /api/portfolio-command/compare` computes and saves the complete result.
`GET /api/portfolio-command/runs/{id}` restores those exact inputs and results.
`GET .../report/json` and `/report/html` export the same saved object, without
recomputation. Canonical SHA-256 includes the full validated request, source
hashes, protocol and coverage inputs, ratecard presence/hash, runtime versions
and results. Immutable writes publish atomically; conflicting or tampered content
fails closed. There is no mutable scenario-result cache. Client edits cancel the
pending request and mark displayed old results stale; JSON imports validate on
the server before entering editor state.

Seeded P10–P90 intervals and deadline fractions are **assumption-based draw
summaries**, not calibrated clinical prediction intervals or success probabilities.
Registry capture time and response digest are recorded. Registry outcomes, current
enrollment totals, site lists, completion dates and recruitment models are never
imported as historical prediction features. No outcomes are invented.

The older Research evaluation's start-date-only training cutoff and incomplete
legacy robustness cache keys remain outside this feature. Its historical outputs
are unchanged and must not be presented as newly corrected or validated. This
portfolio avoids those paths entirely. Historical as-of snapshots and validated
operating inputs remain prerequisites for scientifically supported forecasts.

## Three-minute demonstration

1. Open Portfolio Command; show two registry-context trials and the explicit
   synthetic-operation badge. In Trial Portfolio and Site Capacity show targets,
   simulated progress, candidate hospitals, capacities and UNKNOWN options.
2. Run the fixed-budget comparison. In Scenario Lab compare A–F; the financial
   efficiency scenario initially has no savings available and no time change.
3. In Financial Allocation explicitly assume savings realizable and run again.
   Show released administration and marginal candidate investments. Coverage and
   patient cost sharing remain fixed; support never silently increases rates.
4. Show D's higher spending with zero months saved, then the joint search's
   selected intervention policy and enrollment schedule under its assumptions.
5. Show common draws, bounds and limitations. Download both evidence formats.
   Change budget, observe stale indication, then load the saved run ID to restore
   the exact demonstrated scenario.

## Follow-up boundaries

Remaining limitations: no source-verified operational progress/capacities/rates,
no calibrated effects, illustrative protocol proxy, limited cost horizon, bounded
heuristic, local saved-run storage with no retention/authentication service, and
no correction of legacy Research claims. This is a local hackathon planning demo;
deploying a multiuser service requires separate access/storage design and review.

No production deployment or merge is part of this change.
