# Research, evidence and scientific limits

Concord's recruitment research is an **NSCLC proof of concept**. Its synthetic
population is a modeling device, not patient data. Reusable protocol, budget and
registry-import interfaces are software infrastructure, not validation in another
disease area. Existing examples outside NSCLC are not new disease models and are
not expanded by this documentation campaign.

## Preserved research

- [Historical experiments and corrections](HISTORICAL-EXPERIMENTS-AND-CORRECTIONS.md)
  preserves the former README's regression tables, eligibility-parser versions,
  holdout/robustness comparisons, failed hypotheses and withdrawn claims verbatim.
  Its archived next steps and app descriptions are historical, not current promises.
- [Decisions log](../decisions.md) retains the product pivot and accounting rulings.
- [Independent acceptance evidence](../../DEMO-EVIDENCE.md) records the earlier
  audit checkpoint, including leakage, missing data and browser-delivery limits.
- [Integrated acceptance report](../integration/FINAL-INTEGRATION-REPORT.md)
  supersedes older software-test totals and the former beam-only optimizer behavior.
- [Current demo verification](../demo/final-polish/VERIFICATION.md) records this
  branch's reproduction, browser rehearsals and limitations.

## What the historical numbers cannot establish

The original research used registry-reported trial-level enrollment and inferred
site shares, not observed site-level recruitment. Start-date-only training filters
can admit outcomes learned after an evaluation cutoff; current registry site lists
are not historical as-of snapshots. Full-history site models and later calibration
also limit causal or prospective interpretation. Splitting history does not by
itself remove these information-availability problems.

Congestion estimates do not establish a causal slowdown. Held-out model scores
are not measured acceleration. Parser dependence, variance-estimation issues,
optimizer's curse, no-loser failures out of sample and weak coordination findings
are retained in the archive. None is removed to make the demonstration look better.

## Available data and recovery boundary

The frozen planning demonstration needs only checked-in
`data/portfolio/context.json`, `demo-request.json`, authored schedules and software
dependencies. Its operational and financial assumptions are explicitly synthetic.
Saved evidence is artifact replay of that computation, not historical outcome replay.

A fresh checkout does not include `data/concord.db`, the full CMS ratecard, original
registry crawl or authentic historical as-of snapshots. Database-dependent views
may report unavailable; rates without loaded files remain labeled placeholders.
The current skipped-test log identifies each dependency. Never substitute a
synthetic SQLite database and label it restored registry data.

`scripts/pipeline.sh` can fetch current registry data and rebuild research tables;
it is **not a restoration of an original frozen historical snapshot** and may
replace tables. Preserve an owner's existing raw data and database first, use a
separate recovery location, and record capture dates/hashes. The bounded demo does
not require running this pipeline. Raw registry bytes are not bundled with its
context extract, so recorded response hashes cannot be independently reconstructed
from the extract alone.

Actual site enrollment, capacities, negotiated prices, complete sponsor protocols
and payer approvals remain prerequisites for stronger operating claims. Obtaining
these inputs and rerunning an as-of-safe evaluation is future work, not a completed
validation result.
