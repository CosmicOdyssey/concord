# Browser QA, 2026-10-17 (task D)

Every view of the frontend was opened in headless Chrome against the running dev server
(`http://localhost:5173`, main checkout, backend on `:8000`). The checks:

- Each number on screen was compared with the API response the page received for that request.
- Each of those responses was compared with a separate fetch of the same request.
- Each view was checked for layout breakage at 1400x900 and at 380x800 (phone, run last).

Fixes were tested on a dev server for this worktree (`:5174`, same backend).

**Result:** No number on screen was computed wrongly. 2,576 of 2,580 automated checks matched
the API exactly. The other 4 are inconsistencies inside the API responses themselves (backend,
reported below). Seven frontend defects were found and fixed:

- five labels that said the wrong thing about a number;
- one desktop layout clip that showed "+84.9" as "+8";
- one React console error.

Nothing breaks at phone width.

The most important findings concern the numbers themselves, not the UI. **The no-loser headline
and the joint optimum depend on solver time and CPU load.** For the same scenario:

- US-Northeast: 1.32x live vs 1.28x in the robustness grid;
- Regeneron portfolio: 1.18x live vs 1.27x in the grid.

**"91% of trials faster" counts trials that are faster by less than 0.005 months.** Only 62% of
trials are faster by at least one month.

## Method

- Harness: `docs/qa/browser-qa/` (commit f875e9a). `puppeteer-core` 23.11.1 drives the installed
  Chrome; the driver is installed in `data/work/D`, not in the repo. Run the scripts with
  `NODE_PATH=C:/Users/micha/Projects/concord/data/work/D/node_modules`.
  - `desktop.js`: opens every view at 1400x900, waits for data, takes screenshots, and records
    on-screen text plus every `/api/*` response body.
  - `compare.js`: recomputes every displayed value from those responses using the same
    formatting as `src/format.ts`, and diffs it with the screen. It also checks that the API's
    own numbers agree with each other, for example ratios and shares recomputed from the
    per-trial times.
  - `independent.js`: diffs each page response with a curl of the same request.
  - `layout.js`: checks for page overflow and for elements outside the viewport that are not
    inside a scroll box that fits on screen.
  - `verify.js`: checks the fixes at 1024, 1280, 1400 and 1440 px.
- Scenarios:
  - default US-Northeast, recruiting today;
  - the Regeneron preset (US, sponsor Regeneron, as of 2024-09-01);
  - price tags for SOHO-02 (NCT06452277), the trial with the most months saved;
  - the term sheet's default pair: Memorial Sloan Kettering × NCT04300556, the busiest site
    in the coordinated allocation and its first trial.
- Headless Chrome rendered the dark theme, so all screenshots are dark. Light mode was not
  screenshotted.

## View x check x result

| View | Check | Desktop 1400 | Phone 380 |
|---|---|---|---|
| Congestion map (4 allocation toggles) | Concentration table (sites used, top-10 share, AMC share, max) vs `sites[].load_*` and `counts.sites_used_*` | 132/132 match | no page overflow; table fits |
| | Busiest-10 list (load / cap, order) | match | ok |
| | Label "Of 1,376 candidate sites" | **wrong label (fixed)** | — |
| Clear it (assumptions open) | Headline tiles, decomposition table (5 x 7 cells), run line, assumptions, calibration, solver lines | match | tiles stack; decomposition scrolls inside its card |
| | Trials table, all 146 rows x 9 cells, and sort order | 1,241 checks match | table scrolls inside its card (1,120 px wide) |
| | "low-history rule model (3 sites affected)" | **wrong label (fixed)** | — |
| | Months saved column at 1280–1440 px | **clipped: "+84.9" showed as "+8" (fixed)** | n/a (scrolls) |
| | Console | **React key error (fixed)** | — |
| Robustness: current, default, Regeneron | "What survives" ranges and 16-row grid vs `/api/robustness` | 4 x 117 checks match | grid scrolls inside its card |
| | Caveat "3,400 completed trials" | **inaccurate (fixed)**: the primary estimate uses 2,730 trials | — |
| Portfolio (Regeneron, Sept 2024 preset) | Headline, decomposition, 5 own trials x 9 cells, 19 shared sites, background count | 102 checks match | ok |
| | "Counts … are not filtered by region" | **wrong (fixed)**: `/api/sponsors` filters by region | — |
| | Sponsor list counts vs instance | Pfizer and Spectrum listed with 2 trials but 1 in the instance (backend, not fixed) | — |
| Price tags (SOHO-02) | Trial header (4 T values, target, f) and 4 criteria (months, portfolio, pool), reference T | 16/16 match | ok |
| Slot values | 12 rows: capacity, rate [10–90%], n hist, months saved | 61/61 match | table scrolls inside its card |
| Pre-cleared terms (MSK x NCT04300556) | 3 tiles, 56-row coverage grid, 20 procedure lines, totals, per-patient and per-site items | 471/471 match | tables scroll inside their cards |
| | Expected site total = fixed + per-patient x expected patients | **$163 inconsistency from backend rounding (not fixed)** | — |
| Model & data | Data counts, crawl table, congestion card (estimate, CI, p, n), 9 specifications, backtest table (3 x 3 x 2), prior, eligibility compile (7 criteria, 0.8%) | 85/85 match | ok |
| | "Low-history rule: 3 sites below …" | **wrong label (fixed)** | — |
| | "(primary)" on all three within-site rows | **wrong label (fixed)** | — |
| All views | Same request fetched independently | 12/12 identical | — |
| All views | Page errors / console errors | 0 / 1 (fixed) | 0 / 0 after fix |

## Screen vs API mismatches

Every number on screen matched the response the page received, rounding included. The only
discrepancies are between the API's own fields, or between a number and its label.

| # | Where | Screen | API / truth | Kind | Fixed? |
|---|---|---|---|---|---|
| 1 | Clear it, assumptions | "low-history rule model (3 sites affected)" | `low_history_n` = 3 is the threshold (`LOW_HISTORY_N`: sites with fewer than 3 lung trials), not a count of sites | label (frontend) | yes |
| 2 | Model, backtest | "3 sites below the prior's 25th-percentile rate are capped" | `low_history_rule.n_below` = 3 is the same threshold | label (frontend) | yes |
| 3 | Map side panel | "Of 1,376 candidate sites" | 1,376 = all sites in the instance; 303 = `assumptions.candidate_sites` (open to reassignment), which the Clear view calls "candidate sites" | label (frontend) | yes |
| 4 | Portfolio | "Counts … are not filtered by region" | `/api/sponsors` filters by region (US-Northeast: Merck 12; US: 15) | label (frontend) | yes |
| 5 | Model, specifications | "Within site (primary)" on 3 rows | `primary` = `within_overlap` only | label (frontend) | yes |
| 6 | Robustness caveat | "within-site regression on 3,400 completed trials" | Card: 3,442 trials in the sample; the primary within-site estimate uses n = 2,730 trials | label (frontend, hard-coded) | yes (number removed) |
| 7 | Clear it, trials table at 1400 px | "+8", "+6", "+5" … | 84.9, 60.2, 56.3 … months; the scroll box clipped 28 px at 1400–1440 and 68 px at 1280 | layout (frontend) | yes |
| 8 | Terms, Expected site total | $47,711.03, with 6.2 expected patients and $4,818.44 per patient | $18,000 + $4,818.44 x 6.2 = $47,874.33. The backend rounds `expected_patients` to 1 dp (6.166 → 6.2) but computes the total from the unrounded value | backend rounding ($163) | no (backend) |
| 9 | Clear it, "Trials faster 91%" (also decomposition "Faster") | 91% | `share_faster` counts T_new < T_base − 1e-6 months. Recomputed from the per-trial T: 85% > 0.005 mo, 71% ≥ 0.1 mo, 62% ≥ 1 mo. Pure coordination: 25% faster, 3% by ≥ 1 mo | backend definition | no (backend) |
| 10 | Portfolio, sponsor list (US, 2024-09-01) | "Pfizer · 2 trials", "Spectrum … · 2 trials" | The clear instance has 1 trial each. The sponsors query lacks the `status NOT IN ('WITHDRAWN')` filter and `trial_model` join that `build()` uses (likely cause, not verified) | backend | no (backend) |

## Findings that weaken the pitch

1. **The no-loser headline is not reproducible to two digits.** The no-loser, joint-optimum
   and pure-coordination solves all stop at the time limit ("feasible, not proven optimal").
   Their results depend on solver time and machine load. Site selection (best response) is
   deterministic and matches exactly.

   | Comparison | US-NE live clear (6 s) | US-NE robustness grid (4 s) | Regeneron live clear (6 s) | Regeneron grid (4 s) |
   |---|---|---|---|---|
   | No-loser vs registered (headline) | **1.32x** (median 1.14x) | **1.28x** (1.10x) | **1.18x** (1.15x) | **1.27x** (1.26x) |
   | Site selection alone | 1.23x | 1.23x | 2.07x | 2.07x |
   | Pure coordination, no losers | 1.002x | 1.002x | 1.000x | 1.000x |
   | Joint optimum vs registered | 2.03x | 1.94x | 2.09x | 2.09x |
   | Joint optimum vs best response | 1.65x (38% slower) | 1.57x (42% slower) | 1.01x (40% slower) | 1.01x (40% slower) |

   The Regeneron live no-loser solve evaluated only 5,727 moves in 6 s, against 153,300 for
   US-Northeast. The 1.18x shown in the Portfolio view is under-searched. It sits below the
   grid's 1.27x for the identical scenario.

   The Robustness caveat says rows "can differ slightly" from the Clear it view. The gaps are
   0.04–0.09x on the headline.

   The backend caches each clear in memory, so every view agrees within one server process.
   A backend restart re-solves and can show a different headline.
2. **"Trials faster" is inflated by near-ties.** See mismatch 9: 91% on screen, 62% faster by at
   least a month.
3. **Nothing on screen says the headline is in-sample.** No held-out number exists yet (task A).
   This applies to the headline block, the $1.42B dollar conversion, the decomposition and the
   robustness grid. Not fixed: that is task G's rewrite.
4. **The β confidence interval is truncated at zero without saying so.** The assumptions panel
   shows "0.026 (95% CI 0.000 to 0.121)". The underlying coefficient CI is −0.121 to 0.068, so
   the β CI is −0.068 to 0.121, cut at 0. Not fixed: wording only.
5. **The congestion card's sample size can be misread.** "3,442 completed trials (68,474
   trial–site rows)" is the loaded sample. The primary within-site estimate uses 2,730 trials,
   and "2,730 clusters" means one cluster per trial.

## Other observations (not fixed)

- **Data hygiene (task E):** no trial in the US-Northeast instance has hand-encoded eligibility.
  All 146 are "rule-based parse"; the 5 Regeneron trials are hand-encoded. Dartmouth Hitchcock
  Medical Center is not flagged AMC; it appears in the busiest-10 list and the slot values.
- **Running backend is stale:** it does not include the main checkout's uncommitted
  `service.py` change that excludes basket and multi-cohort designs. `/api/clear` trials have
  no `design` field. Numbers will move when the backend reloads.
- **Price tags mix sign conventions:** "this trial, if relaxed −22.2 mo" (change in T) sits next
  to "portfolio 21.8 trial-mo" (months saved).
- **Uppercased β reads as "B":** table and field headers are uppercased, so "β" renders as the
  capital "Β" in "CONGESTION ELASTICITY Β" and in the Robustness grid header.
- **Phone tab bar:** it scrolls horizontally, but the active tab is not scrolled into view. On
  deep links or row clicks to "Price tags", the active tab is off-screen.
- **Phone tables:** wide tables (trials, decomposition, robustness grid, coverage grid) scroll
  inside their card and show no cue that more columns exist. The first column of the
  decomposition table wraps to many lines. They work, but they are cramped.
- **Not checked:**
  - map marker tooltips (hover on the canvas renderer);
  - light theme;
  - regions other than US-Northeast and the Regeneron preset;
  - assumption sliders and non-default scenarios;
  - the 404 "not precomputed" path in Robustness.

## Phone width (380x800, run last)

No view has page-level horizontal overflow: `document.documentElement.scrollWidth` is 380 on all
11 states. No element sticks out of the viewport except inside a horizontal scroll box that
fits on screen. Slot values reports 12 minibar spans as flagged; they are false positives,
clipped by the `.minibar` box itself inside the scrollable table.

Controls are usable:

- the Clear button is full width;
- form fields stack;
- the allocation toggles wrap to two rows;
- the tab bar scrolls.

No phone fixes were needed. After the fixes the phone pass was re-run on `:5174` with 0 console
errors.

## Fixes (commit c227eb2, frontend only)

- `summary.tsx`: "(3 sites affected)" → "(low history = fewer than 3 past lung trials)".
- `ModelView.tsx`:
  - low-history rule sentence rewritten as a threshold;
  - "(primary)" shown only on `data.primary`.
- `MapView.tsx`: "1,376 sites in the region instance (303 open to reassignment), 146 trials."
- `PortfolioView.tsx`: "Counts … are for trials with sites in {region}."
- `RobustnessView.tsx`: removed the hard-coded "3,400".
- `ClearView.tsx`: `key` on the sortable header cells (console error).
- `index.css`: trials-table headers may wrap.
  - Overflow of the scroll box went from 68 px at 1280 and 28 px at 1400–1440 to 0 at all three.
  - At 1024 px the table still scrolls, by design (min-width 1,120 px), now by 168 px instead of 324.

`npm run build`: zero TypeScript errors. `npm run lint` shows only warnings that were already
there. Re-run after the fixes:

- all 2,576 screen checks still match;
- the same 4 backend inconsistencies remain;
- 0 console errors.

## Screenshots (not committed)

Under `C:/Users/micha/Projects/concord/data/work/D/`:

- `desktop/`: original frontend, 1400x900:
  - `01_map_{actual,indep,coord,coord_free}`
  - `02_clear_default`
  - `03_robustness_{current,default,regeneron}`
  - `04_pricetags`, `05_slotvalues`, `06_terms`, `07_model`
  - `08_portfolio_{before,regeneron}`
  - `09_robustness_current_after_portfolio`
  - tall pages are cut into chunks in `desktop/crops/`
- `phone/`: original frontend, 380x800 at DPR 2. Full page plus `_top` viewport shot for every
  view; crops in `phone/crops/`.
- `desktop_fixed/`, `phone_fixed/`: the same passes on the fixed frontend (`:5174`).
- `verify_original/`: the same width checks on the original frontend (`:5173`).
- `verify_fixed/`:
  - `clear_trials_{1024,1280,1400,1440}.png`: trials-table fit;
  - `portfolio_label.png`.
- `api/`: independent API fetches.
- `*_log.json`: on-screen text and page-received API bodies.
- `*_compare.json`: per-check results.
