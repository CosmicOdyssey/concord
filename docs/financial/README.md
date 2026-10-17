# Sponsor-funded Financial Coordination pilot

This extends current Concord main `6f7d7f5a9af6ac438bfc062d22d32be251b6b056`. It preserves Findings, Overlap, Protocol to terms, Research, the original optimization engine and every historical output. No insurance claims, reimbursements, financing commitments or patient-identifiable records are processed.

**Mode: live computation of an explicitly synthetic financial fixture.** A real public Regeneron identifier (NCT05800015) supplies context through Concord's existing **illustrative authored** schedule. Neither the schedule nor the synthetic site network is a sponsor-approved protocol budget. The alternate public context NCT06627647 is also supported. The fixed demo enrollment target is independent of registered enrollment.

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

Open `http://127.0.0.1:5175/#financial`. No registry crawl, SQLite database, paid model or network service is required for this fixture. Missing original SQLite/rate-card inputs remain blockers for the corresponding original data-dependent views, not silently substituted inputs. Existing ratecard file, if deliberately supplied, is reused and hashed; absent-file prices retain explicit hypothetical labels.

Reproduce/download HTML, JSON and exact request from the CLI:

```sh
PYTHONPATH=backend backend/.venv/bin/python -m concord.financial
# Recompute a retained request, e.g. after downloading JSON and extracting its request object:
PYTHONPATH=backend backend/.venv/bin/python -m concord.financial --request data/work/financial/request.json
```

The output is ignored under `data/work/financial/`. This command reads only the authored protocols/rate functions and writes its own exports. It never builds or modifies a registry database. Default inputs live in `FinanceRequest` / `default_sites`; exact validated request, source/code/protocol/rate-card hashes, seed and assumptions accompany each export.

## Architecture and calculations

- `concord.financial` reuses `terms.load_protocol`, authored coverage rules, `standard_schedule` and `_price_code`. It qualifies the old routine/research labels into six responsibility classes and preliminary review states. The finite priced horizon includes screening, cycles 1–8, end-of-treatment and safety follow-up. Repeating/post-horizon nodes are excluded explicitly. The complete source protocol is retained unchanged.
- `concord.financial_allocation` enumerates at most 255 nonempty subsets of eight operator-defined sites. It uses existing `allocator.core.Instance` / `evaluate` unchanged. Core aggregate timing is a lower bound; costed duration also allows each site's integer participant allocation to finish after activation. Constant assumed rates and horizon deliverability cap each site's counts. This is a bounded subset screen with deterministic proportional participant assignments, not a proof of global optimality over all possible participant assignments.
- Budget commitment = new activation + monthly site payments × costed duration + participant-specific site/procedure/support commitments + sponsor administration. Baseline-active activation is assumed sunk and excluded consistently. Participants sum to the same target in each feasible scenario. Operator feasibility and support floors are constraints. Optional no-loser screening concerns this single trial's nominal duration only.
- A: baseline; B: same sites, assumed lower administration; C: eligible supersets of baseline using reduced administration; D: same sites with extra participant support; E: all eligible subsets with reduced administration and extra support. Choose fastest budget-feasible candidate, then lowest commitment, then stable IDs. Additional sites can cost more; a site may be rejected for horizon, capacity, budget or feasibility. No scenario changes payer assumptions to win the optimization.
- Sponsor budget **commitment includes unresolved contingency**. Modeled sponsor cash spending excludes that held reserve. Conditional payer/patient splits are scenario assumptions, never approvals. Unknown/review-required/conditional items go into sponsor contingency, without assigning a patient or insurer bill. Research items cannot be reassigned to payer or patient by an override. Commercial Medicare-derived allowed amounts require an explicit assumption; otherwise routine lines are reserved.
- Hospital revenue is the sum of modeled transfers received. Hospital resource cost uses an explicit 80% of site-payment assumptions plus 70% of procedure benchmarks; unknown supply uses a stated contingency proxy. Net contribution may be unfavorable; neither fair compensation nor a real hospital margin has been established. Sponsor and insurer administration and assumed support resource consumption are added once. Matching payments/receipts are excluded from the consolidated resource sum. This is a limited modeled resource boundary, not total healthcare expenditure.
- Sensitivity uses the same seeded independent mean-one lognormal site-rate multipliers for every fixed network. Integer participant assignments stay fixed. Durations and monthly operating costs are rescored without reoptimization. q10/q50/q90, budget/horizon exceedance fractions and calibration status are reported. Costs/prices themselves are not randomly varied; edit those assumptions for deterministic financial sensitivity.
- No saved-scenario cache: every request recomputes. All request fields, effective coverage amounts, protocol and numerical source identity feed the input hash. Pricing cache is refreshed on each financial request. Client edits abort in-flight work, clear comparison/export state and fence late responses by revision. Changing one trial clears its coverage overrides.

## Coverage sources and scope

Sources checked October 17, 2026:

- [CMS NCD 310.1, revision 12590](https://www.cms.gov/files/document/r12590ncd.pdf): qualifying-trial routine-cost principles and exclusions. Investigational administration can qualify depending on circumstances; the authored sponsor-paid administration rule is a conservative agreement assumption, not a blanket Medicare exclusion.
- [CMS SMD 21-005](https://www.medicaid.gov/federal-policy-guidance/downloads/smd21005.pdf): Medicaid qualifying-trial routine-cost benefit. Jurisdiction, plan, beneficiary and service review remain necessary.
- [NCI: Who Pays for Clinical Trials?](https://www.cancer.gov/research/participate/clinical-trials/paying): sponsor/research, routine-care and participant cost distinctions. Commercial plan amounts are not supplied by this guidance.

No drug acquisition/manufacturing cost, downstream clinical expenditure, actual participant exposure, insurer collaboration or realized savings is known. A hypothetical drug-supply reserve prevents silently treating supplied medicines as free resources, but does not establish a complete supply budget. No protocol expansion is authorized by changing a demo target.

## Verification and known limits

```sh
(cd backend && .venv/bin/python -m pytest -q)
(cd frontend && npm run test:financial && npm run build && npm run lint)
node /path/to/engineering-fleet/dist/cli.js verify --task concord-finance-delivery --json
```

Meaningful tests cover transfer conservation, resource/payment separation, single coverage attribution, reserved unknowns, commercial assumptions, budget and support bounds, activation/sunk costs, integer capacity, site completion timing, deterministic comparisons, paired sensitivity, request limits, negative/nonfinite rejection, report escaping/provenance, fee-function reuse and missing database isolation. Native Node tests cover financial client request/export/error/cancellation contracts; actual browser interactions cover the mounted React journey.

The original historical leakage and research cache findings remain documented in the preceding audit: start-date-only history filters do not guarantee outcome availability, later registry site plans are not dated snapshots, and legacy research caches omit some input identities. This pilot does not consume those histories, call the recruitment fit/backtests, modify their outputs, or present them as corrected prospective validation. Existing data-dependent tests may skip without their original SQLite/CMS bundle; those skips must be reported.

## Three-minute demonstration

1. Open Financial Coordination. Show the synthetic banner and public trial link. Inspect Coverage Review; mark one routine procedure UNKNOWN and explain the reserved amount.
2. Enter a fixed sponsor budget and compare. Show A/B administrative assumptions, C's additional costs and D's access-support reinvestment. Use the same target across alternatives.
3. Open Three-Party Economics. Compare sponsor spending, hospital contribution and unchanged conditional payer spending; point out that transfers and resource costs are separate.
4. In Reinvestment Lab change the support allocation or uncertainty spread, recompute, and inspect the paired assumptions. No clinical forecast is claimed.
5. Export HTML and JSON. Show the same request/run/hash, source references, unresolved costs and review requirements.
