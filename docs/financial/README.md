# Sponsor-funded Financial Coordination pilot

A sponsor-budget worksheet for one trial. It prices the authored visit schedule, splits each line between sponsor, insurer and participant under explicit coverage assumptions, and compares five budget scenarios at a fixed participant target over a budgeted contract period. No insurance claims, reimbursements, financing commitments or patient-identifiable records are processed.

**Mode: live computation of an explicitly synthetic financial fixture.** A real public Regeneron identifier (NCT05800015) supplies context through Concord's existing **illustrative authored** schedule. Neither the schedule nor the synthetic site network is a sponsor-approved protocol budget. The alternate public context NCT06627647 is also supported. The fixed demo participant target is independent of registered enrollment.

> **17 Oct 2026 rework (decisions.md #24).** An earlier version ranked scenarios by modeled months from synthetic recruitment rates and activation lags, and its "Reinvestment Lab" chained lower costs to added sites to shorter modeled time. That model is removed. The product owner's ruling: insurance payouts and Medicare estimates inform fair-market-value estimates and sponsor-site negotiation, but an insurer paying more does not mean the sponsor pays less, or that negotiation or the trial goes faster. The field-by-field API contract is in [CONTRACT.md](CONTRACT.md).

## What it computes

**Coverage worksheet** (`coverage()`). Every non-repeating authored visit (screening, cycles 1-8, end of treatment, safety follow-up) is priced per participant. Each line gets one of six responsibility states: `SPONSOR`, `POTENTIALLY_PAYER_COVERED`, `POTENTIALLY_PATIENT_COST_SHARING`, `CONDITIONAL`, `UNKNOWN`, `REVIEW_REQUIRED`.

- `unit_rate` is the fee-schedule **benchmark** (Medicare amount via `terms._price_code`, else Concord's standard schedule, else a labelled $75 placeholder).
- `sponsor_unit_rate` = benchmark x `sponsor_rate_multiplier`: an explicit stand-in for the rate the sponsor negotiates with the site for a research item. This is the one place a benchmark feeds the sponsor's numbers, as an input to fair-market-value reasoning.
- `SPONSOR` lines are paid at `sponsor_unit_rate`. `UNKNOWN`, `CONDITIONAL` and `REVIEW_REQUIRED` lines are held as **sponsor contingency** at `sponsor_unit_rate`, never billed to an insurer or participant.
- `POTENTIALLY_PAYER_COVERED` (routine care) lines are billed to insurance under coverage rules. Their insurer/participant split is the benchmark x `payer_fraction` (Medicare; Medicaid with the Medicare benchmark as a stand-in; commercial only when `commercial_rate_assumption` is set). For a commercial plan without that assumption both amounts are `null` (UNKNOWN). They are **not** moved onto the sponsor.
- Authored research items cannot be overridden to insurer or participant responsibility (422). The investigational-supply line is a sponsor contingency that cannot be assigned to insurers or participants.

**Five scenarios** (`compare()`), all at the same participant target, budget and budgeted contract period. They are listed A to E, not ranked; no scenario is recommended.

| ID | Label | Network | Administration | Participant support |
|---|---|---|---|---|
| A | Existing site network | baseline-active sites | `admin_cost` | `support_per_participant` |
| B | Lower sponsor administrative cost | A's | `admin_cost x (1 - admin_reduction)` (an assumption, not measured savings) | A's |
| C | Site network with enough stated capacity | capacity rule (below) | A's | A's |
| D | Expanded participant access support | A's | A's | `support_per_participant + extra_support` |
| E | B + C + D combined | capacity rule | B's | D's |

Capacity rule (`financial_allocation.capacity_network`): keep the existing network if its stated capacity covers the target. Otherwise enumerate the existing sites plus every subset of the other operator-feasible sites (at most 128 networks), and take the capacity-sufficient network with the lowest sponsor commitment (ties: fewer sites, then sorted ids). The budget does not change the choice; an over-budget result is reported as such. In the default fixture the two baseline sites state 120 places for a 60-participant target, so C equals A and E equals B + D. Lower the baseline capacities to see C add a site.

**Sponsor commitment** for a network (`financial_allocation.evaluate_plan`):

```
participants per site = target split in proportion to stated capacity
                        (exact largest-remainder integer rounding, ties by site id)
commitment = activation of added sites            (baseline-active activation is sunk, excluded)
           + sum(site monthly cost) x budgeted contract period (budget_period_months, an input)
           + sum(participants x site per-participant cost)
           + target x (sponsor + reserve per participant from the coverage worksheet)
           + target x participant support
           + sponsor administration
```

A plan is **feasible** when the selected sites' stated capacity covers the target, the commitment is within budget, every selected site is operator-flagged feasible and support meets `minimum_support`. A network without enough capacity is reported as not costed (`sponsor_total: null`); no partial price is invented. An over-budget network is still costed, so the overrun is visible.

**Budget reallocation** (per scenario): sites added beyond the existing network, line-by-line change against A for each budget line, and the total commitment change against A (`null` when A could not be costed).

**Three-party ledger** (`economics()`): sponsor-to-hospital, sponsor-to-participant, insurer-to-hospital and participant-to-hospital transfers, conserved to zero. Hospital resource cost is a separate explicit assumption (80% of site-payment lines, 70% of procedure benchmarks, the drug reserve as a supply proxy). Consolidated resource cost counts delivery, sponsor and insurer administration and support once and excludes matching transfers. Insurer downstream clinical cost and unresolved participant exposure stay UNKNOWN. When insurer amounts are UNKNOWN, insurer payments, participant cost sharing and hospital revenue/contribution are `null` and left out of the transfer balance.

**Cost-input sensitivity** (`sensitivity()`): seeded, paired, mean-one lognormal multipliers (log spread `cost_spread`) on each site's activation (added sites only), monthly and per-participant costs. The same draws apply to a site in every scenario; networks and participant split stay fixed. Reports q10/q50/q90 of the sponsor commitment and the share of draws over budget. Not calibrated intervals.

**Provenance**: input and result SHA-256, source/protocol/rate-card hashes, git commit, every request field echoed; no scenario cache.

## What it does not compute

- **No time.** No modeled months, durations, enrollment or recruitment rates, activation lags, time to fill, negotiation length or trial length. The budgeted contract period is an input that prices monthly site costs; it is not a forecast. Site `rate` and `activation_lag_months` and the request's `no_loser` are gone from the schema (posting them is a 422).
- **No ranking or recommendation.** `recommended_scenario_id` and the "fastest feasible" rule are removed.
- **No payer-to-sponsor savings.** `payer_kind`, `payer_fraction` and `commercial_rate_assumption` change only the insurer and participant lines. Tests hold every scenario's plan, sponsor economics, budget reallocation and sensitivity identical across all of them.
- No coverage determination, claim, contract, insurer collaboration, realized savings, drug acquisition cost, downstream clinical expenditure or actual participant exposure.

## Payer and Medicare amounts: how they are used

- Medicare and insurer amounts for routine care are **benchmarks**: they inform fair-market-value reasoning and are inputs to the sponsor's budget negotiation with each site or hospital (`sponsor_rate_multiplier` makes that step explicit).
- **Who is billed** for an item follows coverage rules (for Medicare, NCD 310.1 routine costs in qualifying trials), not negotiation: research-only items stay with the sponsor; routine care is billed to the participant's insurer subject to plan and coverage review.
- The sponsor's commitment for research items **does not fall because an insurer pays more**, and does not rise because an insurer pays less or its amount is unknown.
- Nothing here models negotiation length, enrollment speed or trial duration.

## Run locally

From the repository root, with Python 3.14 and Node 26 (the tested versions):

```sh
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
(cd frontend && npm ci)
backend/.venv/bin/python -m uvicorn concord.api.main:app --app-dir backend --host 127.0.0.1 --port 8002
# separate terminal
(cd frontend && API_TARGET=http://127.0.0.1:8002 npm run dev -- --host 127.0.0.1 --port 5175 --strictPort)
```

Open `http://127.0.0.1:5175/#financial`. The Financial view is being restyled and moved to this contract separately; until that lands it still expects the removed fields. No registry crawl, SQLite database, paid model or network service is required for this fixture. An existing rate card, if supplied, is reused and hashed; absent-file prices keep explicit hypothetical labels.

Reproduce HTML, JSON and the exact request from the CLI:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m concord.financial
# Recompute a retained request:
PYTHONPATH=backend backend/.venv/bin/python -m concord.financial --request data/work/financial/request.json
```

Output goes to the ignored `data/work/financial/` (or `--output DIR`). The command reads only the authored protocols and rate functions. Default inputs live in `FinanceRequest` / `default_sites`.

## Coverage sources and scope

Sources checked October 17, 2026:

- [CMS NCD 310.1, revision 12590](https://www.cms.gov/files/document/r12590ncd.pdf): which routine costs in qualifying trials Medicare covers, and exclusions. Investigational administration can qualify depending on circumstances; the authored sponsor-paid administration rule is a conservative agreement assumption, not a blanket Medicare exclusion.
- [CMS SMD 21-005](https://www.medicaid.gov/federal-policy-guidance/downloads/smd21005.pdf): Medicaid qualifying-trial routine-cost benefit. Jurisdiction, plan, beneficiary and service review remain necessary.
- [NCI: Who Pays for Clinical Trials?](https://www.cancer.gov/research/participate/clinical-trials/paying): sponsor/research, routine-care and participant cost distinctions. Commercial plan amounts are not supplied by this guidance.

## Verification and known limits

```sh
(cd backend && CONCORD_DATA_DIR=<data dir> .venv/bin/python -m pytest -q tests/test_financial.py tests/test_financial_allocation.py)
(cd frontend && npm run test:financial && npm run build && npm run lint)
```

Backend tests cover: the stated arithmetic and capacity split, the capacity rule (keeps A when A has capacity, picks the lowest-commitment extension otherwise, ignores infeasible sites, deterministic), scenario levers changing exactly their own budget line, sponsor-commitment invariance across 24 payer assumption combinations, the sponsor rate multiplier pricing research items but not insurer amounts, UNKNOWN commercial amounts staying off the sponsor, transfer conservation and resource/payment separation, single coverage attribution and reserved unknowns, paired cost sensitivity (and its collapse at zero spread), rejection of the removed time inputs, a key and text scan of the JSON and HTML for any time, speed or recommendation output, report escaping/provenance and database isolation.

The original historical leakage and research cache findings remain documented in the preceding audit. This pilot does not consume those histories or the recruitment fit.

## Three-minute demonstration

1. Open Financial Coordination. Show the synthetic banner and public trial link. In the coverage worksheet, mark one routine procedure UNKNOWN and show it moving into sponsor contingency.
2. Switch the payer between Medicare, Medicaid and commercial, and move the payer share: the insurer and participant lines change; the sponsor commitment does not.
3. Compare A to E: B's administrative assumption, D's support increase, and C's capacity rule (lower a baseline site's capacity to see it add the cheapest site that covers the target).
4. Open the three-party ledger: transfers versus resource costs, UNKNOWN downstream costs.
5. Change the cost spread and seed; inspect the paired commitment ranges. Export HTML and JSON and show the matching hashes.
