# HackHarvard: 180-second Concord demonstration

Use the merged Portfolio Command workflow, not the unmerged `#demo` proposal in
[draft PR #3](https://github.com/CosmicOdyssey/concord/pull/3). This campaign does
not duplicate that feature or depend on its approval. This script is for an
**NSCLC-focused exploratory planning demonstration**, not a clinical forecast.

## Setup and timing

Follow the [repository Quick Start](../../README.md#quick-start). Open
[Portfolio Command](http://127.0.0.1:5178/#portfolio-command) before presenting.
Use the bundled two-trial request: $3,000,000 ceiling, seed 7, 128 draws, spread
0.25. Reset before every run. Set only **Assume administrative savings are
realizable**; disclose that input aloud. Leave the zero support effect and 15%
hypothetical operations effect unchanged. Do not tune inputs to improve a headline.

The scene plan ends at **2:45**, leaving 15 seconds. Clicks overlap narration.
[Timing and three connected-browser runs](final-polish/VERIFICATION.md) distinguish
actual automation latency, optional local synthetic-speech timing and unmeasured
human delivery. Practice aloud on the venue machine before judging.

## Exact narration and clicks

### 0:00–0:20 — Problem and truth boundary

**Click:** open the portfolio route; point at the synthetic-operations banner.

> Concord brings trial sites, sponsor budgets and shared capacity into one workspace. Today we are showing exploratory planning for lung cancer trials. The public trial identities are real; the hospitals, recruitment rates, costs and intervention effects are explicit assumptions. Nothing here proves that a real clinical trial finishes sooner.

### 0:20–0:40 — Two competing trials

**Click:** **02 Trial Portfolio**. Show both Regeneron-context titles and targets.

> These are two Regeneron trial records from ClinicalTrials.gov. We have entered forty remaining participants for each trial, not imported actual recruitment progress. Their budgets use one illustrative financial schedule, explicitly marked as a proxy for the second trial. We can inspect every input before computing.

### 0:40–1:00 — Shared site capacity

**Click:** **03 Site Capacity**. Show hospitals A and B and baseline assignments.

> Both trials initially use the same synthetic hospitals. Their enrollment rates compete for each hospital's shared monthly capacity; completed trials release capacity. New sites also have activation delays and costs. Unknown feasibility or capacity cannot silently become a usable site. These constraints explain what the optimizer is allowed to change.

### 1:00–1:18 — Fixed budget and explicit savings

**Click:** **04 Financial Allocation**, check **Assume administrative savings are realizable**.

> The sponsor budget stays fixed at three million dollars. We explicitly assume an administrative reduction can release seventy-five thousand dollars. That assumption changes the budget available for comparison; it does not itself change recruitment. Participant support also has zero assumed recruitment effect in this example.

### 1:18–1:40 — Actual computation

**Click:** **Run portfolio comparison**. Wait for **Comparison computed and saved**;
then **01 Executive Overview**. Do not narrate a successful run while it is loading.

> This button runs the existing optimizer now. It checks the entered financial and shared-capacity constraints using the same seeded draws for each alternative. This small example qualifies for exact enumeration. Optimal means best within these inputs and finite draws, not a globally best clinical decision or a validated forecast.

### 1:40–2:05 — Comparison, not a promise

**Click:** **05 Scenario Lab**. Compare A, B, D and F.

> The baseline finishes at fifteen point one three modeled months. Financial efficiency saves money but leaves that schedule unchanged. Extra support at zero rate effect also saves no time. The joint scenario shows eight point eight five months, with higher expected spending than the baseline. That difference depends on assumed allocation and operations effects, not observed acceleration.

### 2:05–2:25 — What insurance does

**Click:** **04 Financial Allocation**. Point to potential payer, cost sharing and reserve.

> Financial responsibility is a separate worksheet. Routine care may be insurer-funded only after coverage review; research costs remain sponsor responsibilities. Unknown responsibility stays reserved. An insurer paying more does not automatically reduce sponsor commitment. Travel support is separate from participant cost sharing, and transfers are separate from resource costs.

### 2:25–2:45 — Evidence and limitations

**Click:** **06 Evidence and Reports**; show the run ID, seed and limitations.
Open the exact saved report using the verified report path below.

> The saved evidence contains this exact request, source hashes, seed, results and limitations. Opening it replays an immutable snapshot rather than running a new simulation. Our demonstrated result is live computation on synthetic operational assumptions, with real registry context only. The contribution is a transparent planning comparison, not a clinical outcome claim.

## Verified numbers to point at

These are outputs of the unmodified bundled model with savings explicitly
realizable and **no CMS ratecard loaded**, not values hardcoded into the app.
Different price inputs legitimately change financial totals; recheck before use.

| Scenario | Final modeled months | Expected USD including reserve (rounded) |
| --- | ---: | ---: |
| A — fixed baseline | 15.13 | 1,018,305 |
| B — financial efficiency | 15.13 | 943,305 |
| C — more sites | 9.22 | 1,105,508 |
| D — extra support | 15.13 | 967,305 |
| E — better allocation | 9.22 | 1,180,508 |
| F — joint search | 8.85 | 1,152,502 |

Whole-dollar browser values; the exact cents are retained in the API evidence.
The optimized objective is priority-weighted completion; the headline reports
unweighted final completion separately. The $3M ceiling is checked against the
conservative commitment, not just expected spending. Full drug costs and costs
beyond the authored visit/horizon scope remain unknown.

## Evidence report and fallback

First try the existing **Download evidence HTML/JSON** links. If browser download
policy blocks them, do not call that a successful browser download. Verify and
materialize the **actual browser-observed run**, substituting its visible ID:

```sh
backend/.venv/bin/python docs/demo/final-polish/verify_report.py http://127.0.0.1:8005 RUN_ID data/work/readme-report
backend/.venv/bin/python -m http.server 8007 --bind 127.0.0.1 --directory data/work/readme-report
```

Open [the local evidence snapshot](http://127.0.0.1:8007/evidence.html). It is the
unchanged HTML response for that saved run, with matching embedded JSON/digest;
this auxiliary static viewer does not replace or intercept computation. Its
availability requires the command above. Label it **artifact replay** aloud.

If computation fails during the presentation, stay in **06 Evidence and Reports**,
enter the previously verified run ID and choose **Load saved scenario**. Confirm
**SAVED EVIDENCE REPLAY** and restored inputs. If the backend is unavailable, use
the already materialized local report. State: “This is a saved evidence snapshot
from our prior verified computation; no new calculation is running.” If no
verified artifact is available, show the input/limitation screen and disclose the
failure. Never substitute an attractive screenshot for a live result.

## 120-second abbreviated version

0:00–0:20 banner and trial context; 0:20–0:40 capacity and fixed budget;
0:40–1:00 computation; 1:00–1:25 comparison; 1:25–1:45 financial responsibility;
1:45–2:00 saved report and limitations. Use the same inputs and click order,
omitting extra ledger expansion.

> Concord compares trial allocations and budgets in one reviewable workspace. These two public Regeneron trial identities are real. The hospitals, progress, rates and costs are synthetic assumptions, not operational evidence.
>
> Both trials share hospitals with limited monthly capacity. New sites take time and cost money. Our sponsor ceiling stays at three million dollars, and unknown site feasibility is not treated as approval. We explicitly assume an administrative reduction is realizable.
>
> We now run the existing optimizer with common seeded draws. Exactness applies to this bounded model, not to a real trial's future. The baseline is fifteen point one three modeled months. Financial efficiency and support at zero effect do not improve its schedule. Joint allocation and the assumed operations effect give eight point eight five months while increasing expected spending over baseline. Those are scenario comparisons, not measured benefits.
>
> Potential routine-care coverage needs human review. More insurer payment does not automatically lower sponsor costs or speed recruitment. Unknown responsibility is reserved, and support is not netted against cost sharing.
>
> Here is the immutable evidence report: inputs, source hashes, seed, results and limitations. Reopening it is saved artifact replay. We have demonstrated transparent live planning on synthetic operations with real registry context. Historical forecasting and clinical acceleration remain unvalidated.

## Five difficult judge questions

1. **Have you shown that Concord accelerates actual trials?** No. The live demo
   computes conditional scenarios on synthetic operational/financial inputs.
   Historical model scores are not observed treatment outcomes or prospective validation.
2. **Is the optimizer genuinely exact?** Only when the 12-edge and 500,000
   event-work admission bounds are met. It exhausts candidate subsets on the
   entered finite draw bank. Larger workloads retain bounded heuristics and unknown gaps.
3. **Does insurance finance faster recruitment?** No automatic link is modeled.
   Coverage review determines responsibility; payer-share assumptions do not
   reduce sponsor commitment. Portfolio timing changes only through explicit site/rate inputs.
4. **What prevents a polished but irreproducible result?** Frozen request/context,
   common seed/draws, runtime/source hashes, independent mathematical checks,
   immutable saved JSON and a matching report. Three actual browser runs are
   recorded; neither tests nor a digest prove assumptions true.
5. **Why lung cancer, and can this generalize?** Recruitment/population research
   is NSCLC-specific and limited by inferred site enrollment and historical
   information availability. Budget/schedule interfaces are reusable software;
   other-disease clinical validation, authentic site data and calibrated effects are future work.
