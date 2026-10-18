# HackHarvard — 180-second Regeneron planning demonstration

Start the root README commands and open `#demo`. Keep sponsor credentials absent: the original demo does not need them. Do not use the old Portfolio Command figures as this fixture's results. The six existing scenes are the presentation; no duplicate demo route was added.

## 0:00–0:25 — The problem

“Concord helps a sponsor compare allocations across two Regeneron-context trials sharing hospitals. Trial identifiers come from the registry. The operating inputs are hypothetical: forty participants per trial, two activated hospitals, and a three-million-dollar ceiling. This is planning, not a recruitment forecast.”

Click **Next Scene**.

## 0:25–0:55 — The baseline

“The existing network is feasible under our entered limits. It models completion at 15.13 months. Hospital capacity is shared, and two more hospitals are available after an assumed activation delay. The question is whether the added capacity justifies its cost within the same budget.”

Click **Optimize Portfolio** once.

## 0:55–1:25 — Compute

“Concord now runs its actual optimizer and financial model locally. It uses the same targets, seed and thirty-two assumption draws. No external model or sponsor service is called. We show the real computation time rather than an invented progress bar.”

If computation completes early, continue explaining the fixed assumptions. If the API fails, explicitly choose **Load saved rehearsal (not live)** and identify the replay banner.

## 1:25–2:10 — Compare

“The allocation activates all four hypothetical hospitals. Modeled completion becomes 9.24 months, while expected sponsor expenditure rises from about 818 thousand to 981 thousand dollars. This is a trade-off, not a saving. Conservative commitment remains within the ceiling. Optimality applies only to this bounded candidate set and finite draw bank; the uncertainty range is not clinically calibrated.”

Click **Next Scene**.

## 2:10–2:45 — Money and evidence

“Hospital receipts, resource costs, participant sharing and sponsor support remain separate. Potential payer amounts are coverage classifications, not insurer commitments. Open the evidence report to inspect the actual inputs, seed, sources and result digest. Registry context is authentic; hospitals, costs and operating rates remain explicit assumptions.”

Open the report link if browser policy permits it. If blocked, use the exact exported report copied by `verify_report.py` and identify it as artifact replay. Do not claim a browser download succeeded.

## 2:45–3:00 — Conclusion

“We demonstrated a reproducible planning comparison and inspectable financial evidence. We did not demonstrate faster real enrollment, clinical efficacy or guaranteed savings. Next validation requires sponsor-approved feasibility, negotiated costs and prospective operating evidence.”

The timestamps are a narration plan, not proof of a measured human delivery. Browser computation, screenshots and exact result values are in the [campaign report](../operations/GRAND-MOBILIZATION-REPORT.md). Presentation timing depends on the speaker and must be rehearsed by the presenter.

## 120-second alternative

Spend 20 seconds on the synthetic-input disclosure, 20 on the feasible baseline, 15 triggering computation, 35 comparing the 15.13/9.24-month assumption results and increased expenditure, 20 showing source/digest evidence, and 10 stating limitations. Keep the same inputs and computation; omit detailed hospital accounting narration.

## Judge questions

- **Are these real recruitment forecasts?** No. Real registry context is combined with hypothetical operating inputs; historical predictive performance remains unverified prospectively.
- **Why can you claim optimality?** Exact enumeration is bounded to the admitted subset/policy search and fixed draw bank. Larger heuristic cases report an unknown gap.
- **Does insurance pay for faster trials?** No. Coverage classification and transfers do not create capacity or a supported recruitment effect.
- **What if outreach does nothing?** The local proposal evaluator rejects ineffective changes. Its default fixture has zero supported outreach effect.
- **Are the sponsor services live?** No. Photon carrier dispatch, remote Chalk and Factory inference remain unimplemented; the lab runs explicit local fallbacks.

## Reproduce the report fallback

For an actual saved run observed in the browser:

```sh
backend/.venv/bin/python docs/demo/final-polish/verify_report.py http://127.0.0.1:8005 RUN_ID data/work/readme-report
backend/.venv/bin/python -m http.server 8007 --bind 127.0.0.1 --directory data/work/readme-report
```

Open `http://127.0.0.1:8007/evidence.html`. This is the immutable export of that computation, not a new API calculation. The helper verifies that stored JSON, exported JSON and HTML-embedded JSON agree and retain a valid canonical digest.
