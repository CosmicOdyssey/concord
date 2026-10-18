# Report on the mentor feedback ("Protocol to Terms is the product"), 17 Oct 2026, 16:10-18:10

All items below are on `main`, pushed, with backend tests (630 passed), the frontend build, the financial tests and a
live-app browser check passing after each merge. Screenshots: `docs/handoff/screens/mentor/`.

## Done

| Item | Where | Screenshot |
|---|---|---|
| Scope 1: landing leads with Protocol to terms (exact headline and subhead), primary button opens Terms, overlap second with the Regeneron preset; nav order Protocol to terms, Portfolio overlap, What we tested | Landing | 01, 02 |
| Mentor 13: Terms is the first tab; Financial Coordination (Sponsor budget) and Portfolio Command kept out of the main navigation | App header | 01 |
| Scope 2: one non-lung Regeneron Phase 3, SIENNA (NCT06541704, pozelimab + cemdisiran in geographic atrophy), hand-authored from the public record, priced; sites from a static registry snapshot (no DB rebuild) | Terms | 08 |
| Scope 3: one more indication, breast cancer, site overlap only (own DB file, 387 trials), labelled "site overlap only; eligibility overlap is available for lung cancer" | Portfolio overlap | 10 |
| P1.1 anchored share (one bar + numbers) | Terms, Budget | 03 |
| P1.2 ranges: procedure lines x a user-set band (default 100%-150%, assumption); totals low-high | Terms, Budget | 03 |
| P1.3 site proposal check (paste/upload CSV, SYNTHETIC sample), P1.4 counter-proposal HTML export with a source on every line | Terms, Site proposal | 06, 07 |
| P2.5 locality distribution (all 109 Medicare localities, sites marked with percentiles) | Terms, Compare | 04 |
| P2.6 spread comparison (geography, multiplier band, non-procedure fees) | Terms, Compare | 04 |
| P2.7 category breakdowns (who pays, cost type, visit, anchoring) | Terms, Budget | 03 |
| P2.8 plain-language GPCI labels (Doctor's time; Practice costs (rent, staff, equipment); Malpractice insurance), technical terms in tooltips | Terms | 05 |
| P3.9 overhead % editable, labelled an assumption | Terms, Budget | 03 |
| P3.10 non-facility (office) rates stated; hospital outpatient facility fees (OPPS) not included | Terms, Budget | 03 |
| P3.11 lab prices are one national CLFS amount and do not vary by site | Terms | 03 |
| P3.12 two-site lead explains why budgets differ (Medicare's geographic adjustment), not which site is cheaper | Terms, Compare | 05 |

## NCT05800015: anchored share and the three spreads

Default Site A: NYU Langone Health Perlmutter Cancer Center, New York, NY (Medicare locality NY 01 Manhattan).
Per-participant sponsor amount (screening through cycle 8, end of treatment and safety follow-up): **$6,568.67**.

| Anchor | Amount | Share |
|---|---|---|
| Anchored to public rates (13 PFS lines $1,294.77 + 5 CLFS lines $45.18) | $1,339.95 | 20.4% |
| Anchored to a proposed standard (per-visit fees $1,990 + coordinator time $1,925) | $3,915.00 | 59.6% |
| Open to negotiation (overhead at 25%, an assumption) | $1,313.72 | 20.0% |

Range at the 100%-150% band (assumption): $6,568.67 to $7,406.11 per participant.

Spreads (per participant):

| Driver | Low | High | Range | Basis |
|---|---|---|---|---|
| (a) Geography: procedure lines across all 109 localities at 100% of Medicare | $1,033.74 (AR-13 Arkansas) | $1,580.04 (CA-65 San Jose area) | $546.30 (p10-p90 $269.98; median $1,188.76) | CMS RVU26D GPCI2026; lab lines add a constant $45.18 |
| (b) Multiplier band 100%-150% at Site A (Manhattan, 87th percentile) | $1,339.95 | $2,009.90 | $669.95 | assumption |
| (b) Same at Site B (Hattiesburg Clinic, MS 00, 1st percentile) | $1,039.93 | $1,559.90 | $519.97 | assumption |
| (c) Non-procedure fees (proposed standard $3,915) at 75%-125% | $2,936.25 | $4,893.75 | $1,957.50 | assumption: no public benchmark for these fees |

## Sources used

- CMS 2026 Physician Fee Schedule RVU file, October release (rvu26d.zip: PPRRVU2026_Oct_nonQPP.csv, non-facility PE RVU
  column; GPCI2026.csv, all 109 localities), conversion factor $33.4009.
- CMS Clinical Laboratory Fee Schedule CY 2026 Q4 (clfs_cy2026_q4v1.zip), national amounts.
- Medicare NCD 310.1 (routine costs in clinical trials) for coverage labels.
- ClinicalTrials.gov (registry facts, registered sites; API v2 for SIENNA's snapshot and the breast-cancer DB).

## What could not be sourced (labelled as assumptions or left unpriced)

- The 100%-150% multiplier band and the 75%-125% non-procedure band: user-set assumptions.
- Overhead 25% and every proposed-standard amount ($175 coordinator per visit, $85 dispensing, $60 sample kit, $150
  tissue, $100 image upload, $40 questionnaire, $75 survival contact, $18,000 per-site one-time fees): Concord's
  proposal, labelled "a starting point to negotiate against, not market data".
- The site proposal sample: SYNTHETIC prices, labelled as such everywhere.
- SIENNA: vaccine products 90734, 90620, 90677 (no CMS amount: status E/X, zero RVUs) and three visual-function tests
  with no CPT code are listed as unpriced, never counted as $0. 80 of its 153 U.S. sites have no resolved Medicare
  locality (no public county basis added) and use national amounts, flagged.
- Demo protocols are hand-authored from public information (illustrative), not sponsors' protocols.
- Overlap preview: "recruiting on a date" uses an estimated enrollment window (65% of start-to-primary-completion,
  an assumption); eligibility overlap is on a synthetic population.

## Note on the requested $195.46 check (term-sheet line detail, in progress)

For CPT 71260 the CMS 2026 files give **$191.25 at NY locality 01 Manhattan** and **$195.46 at NY locality 02 NYC
Suburbs/Long Island** ((1.13 x 1.064 + 3.77 x 1.189 + 0.09 x 1.857) x $33.4009). $195.46 matches the second lung
protocol's Site A in Westbury, NY (locality 02). The line-detail table being built reproduces both from the files and
states the locality.

## In progress at the end of the budget

- Term-sheet line detail: the step-by-step price table (requested at 17:25).
- Smooth step switching in Protocol to terms (real tabs with a soft fade).
- "Any trial": add a trial by NCT ID; schedule from an uploaded SoA CSV or a cited draft from the registry.
- Landing "How Concord compares" section from `docs/competitive-landscape.md`.
