# Morning handoff (17 Oct)

App running at http://localhost:5173 (UI) and http://localhost:8000 (API). Everything is on `main` and
pushed. Overnight decisions, with reasons: [docs/decisions.md](decisions.md) (17 entries).

## Read this first

**One result cuts against the pivot's stated premise.** The final holdout rerun (task A's pre-registered
script, unchanged, beta 0.093, 46 US-Northeast trials) shows:

| | in-sample | held-out, alternating split | held-out, time split |
|---|---|---|---|
| Coordination: joint optimum vs each trial's best response | 1.42x | 1.05x (47% slower) | 1.05x (51% slower) |
| Site selection alone: best response vs registered sites | 1.76x | 1.73x | 1.70x |

- **The data supports:** coordination gains across trials largely disappear out of sample.
- **The data doesn't support:** "choosing sites from registry data doesn't beat sponsors' own choices out
  of sample". In our model it does, by about 1.7x held-out. That is still scored by our enrollment model,
  which typically misses by about 2x, not by observed enrollment.
- **Update (17 Oct): calibrated to observed enrollment, it is about 1.2x.** Re-scoring the same allocations
  with site rates shrunk by the observed-outcome slope (post hoc, not pre-registered): site selection alone is
  1.18x (alternating) and 1.17x (time) held-out at b = 0.33, and 1.07x / 1.06x at b = 0.16. Coordination is
  1.03x held-out either way. b = 1 reproduces the table above exactly.

The Findings page and README state all of these as measured. The finding's title now says "coordination gains
largely disappear; site-selection gains shrink once scores are calibrated to observed enrollment". The product rule is unaffected: no product
view shows a predicted speedup.

## What works end to end

QA covered the full demo path at 1440 px and 390 px, in light and dark mode. 438 on-screen numbers were
checked against the API with no mismatches, and there were no console errors. Report:
[handoff/qa-2026-10-18.md](handoff/qa-2026-10-18.md).

| view | status | screenshot |
|---|---|---|
| Findings (landing) | works | [01-findings.png](handoff/screens/01-findings.png) |
| Portfolio overlap, Regeneron preset | works | [02a-overlap-regeneron-top.png](handoff/screens/02a-overlap-regeneron-top.png), [02c-overlap-pair-detail.png](handoff/screens/02c-overlap-pair-detail.png) |
| Protocol to terms, NCT05800015 | works | [03a schedule](handoff/screens/03a-terms-schedule-grid.png), [04 coverage](handoff/screens/04-terms-coverage-override.png), [05 budget](handoff/screens/05-terms-budget-site.png), [06 two sites](handoff/screens/06-terms-compare-two-sites.png), [07 term sheet](handoff/screens/07-terms-termsheet.png) |
| Research (old clearing views, labelled in-sample) | works; a clear takes about 1.5 min | [10-research-clear.png](handoff/screens/10-research-clear.png) |

**Broken: nothing found.** One rough edge: at 390 px the terms budget table needs a sideways swipe to see
its last columns. Fixing it would be a restyle, so I left it.

## 3-minute demo click path

1. **Findings** (`#findings`), 60 s. Three findings with tables:
   - Congestion: beta about 0.09 vs the assumed 1.0.
   - Allocation: coordination doesn't hold out of sample.
   - Site-level data is the constraint.
   - Point at the parser-version table: the estimate moved with each fix, and we show that.
2. **Portfolio overlap** (`#overlap/regeneron`), 60 s. The preset loads Regeneron on 1 Sept 2024 with the
   fianlimab pair selected (NCT05785767 x NCT05800015):
   - 16 shared registered U.S. sites.
   - 100% of the PD-L1 >= 50% trial's eligible patients also qualify for the all-comers trial (26% the
     other way).
   - The criteria diff shows the only differences: PD-L1 >= 50% and never-smokers excluded.
   - Across all NSCLC sponsors since 2015 the same pattern recurs: 21 pairs with reviewed eligibility (note
     at the bottom of Findings).
3. **Protocol to terms** (`#terms-flow/NCT05800015`), 60 s:
   - The schedule grid is labelled illustrative, authored from public trial information.
   - Coverage labels with rules R1-R5; toggle one reviewer override.
   - Budget at NYU Langone (Manhattan locality).
   - "Compare two sites" against a Mississippi site: every dollar of difference traces to published GPCI
     values.
   - Export the term sheet.
   - Close on the label: decision support, not a fair-market-value legal opinion.

## Every number the app shows, and its source

| view | numbers | source |
|---|---|---|
| Findings: congestion | beta 0.09 (95% CI 0.00 to 0.30, floored at 0; coefficient -0.093 [-0.297, +0.111], p 0.37); pooled -0.107 (p 0.055); 4 subset rows; parser versions -0.136 / -0.027 / -0.088 | `analysis/congestion.py` on the current DB -> meta `congestion_test`, `data/robustness/congestion_v2.json` |
| Findings: allocation | US-Northeast and Regeneron tables (in-sample, alternating, time split; share slower) | `data/robustness/holdout.json` (final rerun), copied to `data/findings/sources/holdout_final.json` |
| Findings: implication | typical held-out miss 1.9x (site model) vs 2.8x (naive); 7,486 of 11,710 U.S. sites (64%) with < 3 lung trials; 0 site-level enrollment counts in the registry | DB meta `backtest`; `site_model` |
| Findings: related note | 21 same-sponsor pairs (10 sponsors), >= 10 shared sites and >= 80% overlap one way, 19 upper bounds; broad count 134 with caveats | `data/findings/self_overlap.json` (`python -m concord.overlap`) |
| Portfolio overlap | 37 sponsors; 5 trials; 5 of 10 pairs share a site; 16 shared sites; 100% / 26%; 31.8 months both recruiting (estimated, past); site counts 8 / 9 / 23 / 29 / 8; other sponsors' trials per site | `/api/overlap`: CT.gov registered sites and dates, synthetic population (n = 20,000), hand-encoded eligibility |
| Protocol to terms | NCT05800015 at NYU Langone (Manhattan, GPCI 1.064 / 1.162 / 1.586, CF 33.4009), no reviewer overrides: $6,568.67 per participant through cycle 8; vs a Mississippi site $6,193.66 (-$375.01). With QA's one override (cycle-7 CT chest -> routine): $6,329.61 vs $6,008.18 (-$321.43, unchanged by the lab file; lab prices moved the total by +$1.07). Per site $18,000 (proposed standard) | CMS 2026 PFS RVU26D, GPCI 2026 and CLFS Q4 2026 (all real); non-procedure items are the proposed standard schedule |
| Research | in-sample model results, each labelled "not a claim" | `/api/clear`, robustness grids at beta 0.093 |

## Needs you

- ~~CLFS lab fee schedule~~ **Done (17 Oct):** loaded from `clfs_cy2026_q4v1.zip` (2,117 codes). The demo
  protocols now have 0 placeholder lab lines; the "placeholder" labels show only if a total still contains one.
- **Decide how to pitch the site-selection result** (top of this file).
- **Open audit notes** (all disclosed in the README; none blocks the demo):
  - The two-way SE clips negative eigenvalues, so the CI width depends somewhat on how controls are coded
    (`congestion_v2_se_diagnostics.json`).
  - Task B never ran its own time split; that column came from its auditor.
  - Task C (transfers) is not merged, by your decision.
- **Cleanup you may want (not done; irreversible):** 12 agent worktrees under `.claude/worktrees/` and
  their branches. They're ignored by git and safe to remove with `git worktree remove` once you've looked.

## Which split the ~1.7x site-selection figure uses (added before you left)

Both splits exist in `data/robustness/holdout.json` (`scenarios.<scenario>.splits.<split>.summary.indep_vs_actual`),
so nothing was rerun. US-Northeast, best response vs registered sites:

| split | in-sample (half history) | held-out (geomean) | by direction | share slower held-out |
|---|---|---|---|---|
| alternating | 1.59x | 1.73x | 1.52x / 1.97x | 14% |
| time (older half -> newer half, and reverse) | 1.72x | 1.70x | 1.88x / 1.54x | 13% |

The "~1.7x" quoted overnight is either: 1.73x on the alternating split or 1.70x on the time split. Full-history
in-sample is 1.76x. Regeneron (5 trials): 1.69x alternating, 1.42x time split (1.63x / 1.23x by direction).

## Observed-outcome check of site-rate scores (added before you left)

Completed trials started 2018+ (n = 1,094; industry Phase II/III n = 390), registered site lists scored with pre-2018 rates: slope of actual log enrollment rate on the score 0.16 [0.07, 0.24], p 0.0003 (industry Phase II/III 0.33 [0.16, 0.50], p 0.0001), with phase, log site count and start-year controls.
Reading: the scores carry real signal on observed enrollment, but predicted differences between site lists are about 3-6x larger than observed ones, so the model's ~1.7x site-selection gains are likely overstated. Script `analysis/selection_validation.py`, output `data/findings/selection_validation.json`. Now on the Findings page, with the calibrated re-score
(`analysis/selection_calibrated.py`, `data/findings/selection_calibrated.json`) and a unit test
(`tests/test_selection_validation.py`).

## Added 17 Oct (afternoon)

- **Site scores tab** (`#site-scores`, after Protocol to terms): each U.S. site's historical lung-trial enrollment
  score with every step that forms it (prior, the site's own trials, posterior, low-history cap, calibrated value)
  and the observed-outcome check at the top. Default order is history depth, not score; sorting by score shows a
  not-a-forecast note. Scores equal the stored `site_model.lam_eff` for all 27,434 fitted sites (tested). Capped,
  unfitted and non-U.S. sites get no percentile. Browser QA: `docs/qa/browser-qa/site_scores.js`, all checks pass.
  Screens `docs/handoff/screens/05*`.
- **Overlap**: shared sites that can't be counted (sponsors that anonymize sites on CT.gov: AstraZeneca fully;
  Novartis, Avistone, Hummingbird partly) now show nothing instead of "sites hidden" or a false 0.
- **Findings**: the observed-outcome check and the calibrated re-score are on the page; site selection held out is
  about 1.2x calibrated (post hoc), 1.7x uncalibrated.
- **Redesign in progress** (not in the app yet): three design directions on a canvas for the user to choose from.
