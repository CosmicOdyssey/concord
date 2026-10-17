# HackHarvard · 180-second presentation

Setup: start the local launcher, open `#demo`, Reset, choose an appropriate theme,
set 1440 × 900 at 100% zoom. No typing, registry navigation or research-tab visit.
The script below uses verified fixture calculations, **not clinical outcomes**.
Allow pauses for reading figures; speak naturally, not faster to squeeze in detail.
Timing estimates and the synthetic-voice check are in `ACCEPTANCE.md`; human
presenter timing must still be rehearsed. Only blockquotes are spoken.

<!-- 180:start -->
## 0:00–0:25 · Scene 1 — The problem

**Click:** none. **Visible:** two trials, shared A/B hospitals, C/D available, $3M ceiling.

> A sponsor has two competing trials, a fixed budget, and shared hospitals. Where should the next dollar go? Concord makes that allocation decision inspectable. These trial names come from Regeneron registry records. The hospitals, enrollment targets, costs, and recruitment rates are hypothetical—not real operating data.

**Cue:** point to hospitals A/B; wait for judges to read the capacity bars.

## 0:25–0:55 · Scene 2 — The baseline

**Click 1:** Next Scene. **Visible:** 15.13 modeled months; $818,280 expenditure; 37.8% budget reserved.

> Here is the fixed baseline. Both trials share two hospitals, so their modeled recruitment demand hits the entered capacity limits. Completion averages fifteen point one three months. Expected sponsor spending is about eight hundred eighteen thousand dollars, plus a separate contingency. This baseline is feasible; it is not evidence of an actual hospital failure.

**Cue:** point to peak load 3/3; explain an available hospital still takes time and money to activate.

## 0:55–1:25 · Scene 3 — Run Concord

**Click 2:** Optimize Portfolio. The transient computation scene becomes Compare Outcomes automatically.
**Visible:** real compute duration, OPTIMAL, 678 candidate/policy evaluations.

> Now I am running the existing optimizer, not playing back a prepared answer. It uses the same thirty-two seeded assumption draws for every candidate. It checks shared capacity, trial slots, sponsor commitments, and a no-loser condition on each trial’s expected time. No external API or AI call is required.

**Cue:** wait until the completed status appears; no fake loading hold. Use the remaining scene time to identify the method.

## 1:25–2:10 · Scene 4 — Compare outcomes

**Click:** none. **Visible:** 15.13 → 9.24 months, $818,280 → $980,972, 2 → 4 hospitals.

> The chosen allocation activates four hospitals instead of two. Modeled completion becomes nine point two four months. But sponsor spending rises to about nine hundred eighty-one thousand dollars. This is additional investment, not a saving. Conservative commitments reserve forty-nine point four percent of the fixed budget. Capacity and slots remain feasible. Optimal means exact for this small entered model and finite draw bank—not a global clinical optimum. These ranges describe assumed recruitment uncertainty, not validated forecasts.

**Cue:** pause on the expenditure row, then the budget reservation row. Do not describe a guaranteed speedup.

## 2:10–2:45 · Scene 5 — Financial coordination and evidence

**Click 3:** Next Scene. Optional **click 4:** Open Evidence Report; otherwise keep the in-page evidence visible.
**Visible:** sponsor, hospital and potential payer amounts; participant lines; source and result hashes.

> The financial ledger separates sponsor expenditure, hospital receipts and resource assumptions, and potentially covered routine care. No insurer has committed to pay. Participant cost sharing and travel support stay separate. The report preserves inputs, allocation, search status, arithmetic, and source hashes from this exact computation. Registry context is real metadata; the operating assumptions and approximate prices are not verified sponsor data.

**Cue:** point to the run ID and disclosures. The HTML export downloads a saved evidence snapshot; it does not recompute.

## 2:45–3:00 · Scene 6 — Conclusion

**Click 4** (or 5 with report): Next Scene.

> Concord turns a fixed-budget allocation question into a reproducible, auditable comparison. Today we demonstrated computation and financial reconciliation—not clinical efficacy, guaranteed savings, or proven recruitment acceleration. Real operating data and prospective validation come next.
<!-- 180:end -->

## If the computation takes too long

At roughly 10 seconds: say, “The live computation is still pending. I will show a
clearly labeled saved rehearsal rather than claim an answer we have not received.”
At the 15-second timeout, use **Load saved rehearsal (not live)**. If the browser
itself fails, open the local saved HTML report. Never announce that saved evidence
was just computed. Do not retry repeatedly on stage.

<!-- 120:start -->
## 120-second version

**0:00–0:20, scene 1.** No click.

> A sponsor has two competing trials, shared hospitals and a fixed three-million-dollar budget. Where should the next dollar go? Concord compares site allocations. Trial identifiers come from Regeneron registry context; targets, hospitals, recruitment and costs are explicitly hypothetical.

**0:20–0:40, scene 2.** Next Scene.

> The baseline uses two hospitals. Shared capacity constrains recruitment. Modeled completion averages fifteen point one three months, with about eight hundred eighteen thousand dollars of sponsor expenditure and a separate contingency. This is a feasible assumption-based baseline, not an observed clinical result.

**0:40–0:55, scene 3.** Optimize Portfolio; wait for the actual response.

> This click executes the existing engine with fixed inputs and seeded draws. It checks the budget, site capacity and each trial’s expected-time protection. Nothing is replayed silently.

**0:55–1:25, scene 4.** No click.

> Four hospitals produce nine point two four modeled months, but sponsor expenditure increases to about nine hundred eighty-one thousand dollars. This is investment, not savings. Conservative commitments reserve forty-nine point four percent of the budget. Optimal applies only to this finite assumed problem; recruitment ranges are not calibrated forecasts.

**1:25–1:45, scene 5.** Next Scene; omit export.

> The ledger separates sponsor, hospital, potential insurer and participant responsibilities. Coverage is not a payment promise. Evidence identifies the inputs, result hashes, method and synthetic assumptions. Approximate procedure prices are not verified sponsor costs.

**1:45–2:00, scene 6.** Next Scene.

> Concord makes an allocation decision reproducible and inspectable. We demonstrated computation, not proven clinical acceleration or guaranteed savings. The next step is real operating data and prospective validation.
<!-- 120:end -->

## Technical Q&A

- **Is this a forecast?** No. Independent mean-one lognormal edge-rate shocks are entered assumptions. P10–P90 are in-sample draw summaries, not calibrated predictive probabilities. Historical performance is unverified here.
- **What is optimized?** Expected maximum priority-weighted enrollment completion, subject to feasibility, conservative budget, hospital contribution floor and expected per-trial no-loser constraints. We separately display unweighted final completion.
- **Exact or heuristic?** Existing admission is ≤12 eligible edges and ≤500,000 bounded event-work units. The eight-edge, 32-draw fixture has bound 98,304; exact search examines all 256 subsets per policy. Larger workloads retain bounded beam search and `FEASIBLE_HEURISTIC` with unknown gap.
- **Why 678 evaluations?** The existing engine memoizes network/policy evaluations across its comparison strategies. This is not 678 distinct hospitals or independent clinical experiments.
- **Is the entire budget spent?** No. This illustration is capacity-limited, not budget-binding. Conservative commitment reserves 49.4% of the ceiling; it is neither actual expenditure nor a mandate to spend the remainder.
- **Where did the improvement come from?** More activated site capacity. No support/operations recruitment boost; no realized administrative savings. Expected sponsor expenditure increases by $162,692.55.
- **What about patient access?** The synthetic targets and travel/lodging support are retained; cost sharing is separate. Geography, outside-trial competition and actual clinical access are not modeled.
- **Are prices and coverage verified?** The isolated demo uses inherited approximate placeholder prices and an illustrative protocol proxy. Classification does not establish qualifying-trial eligibility, plan coverage or insurer commitment; those require review.
- **What can be reproduced?** The exact fixture, seed, draw count, finite-model result and reconciled ledger, with code/source hashes. Report opening replays immutable evidence; Optimize actually recomputes.
