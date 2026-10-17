# Concord final integration report

Status: **INTEGRATED AND MERGED** for the original implementation and audit corrections. GitHub confirms PRs [#1](https://github.com/CosmicOdyssey/concord/pull/1) and [#2](https://github.com/CosmicOdyssey/concord/pull/2) merged. This supplemental acceptance commit records verification and test refinements after that handoff; its publication and merge are separately identifiable in Git history. No production deployment was performed.

## Repository history and preservation

| Milestone | Exact commit |
| --- | --- |
| PR #1 original financial implementation | `89e75752db40f482856c66b019df543e6802bdcc` |
| PR #1 resulting main merge | `f51b13fa7c84dbd9f06b331b906500c28403e40b` |
| PR #2 original portfolio implementation | `59f0c33d52d7928fd136b3c58c4db87b87c0836c` |
| Independent acceptance remediation | `ac0204603eb906c8d2dafff0900c0f214392c6de` |
| Main preserved during initial reintegration | `a2ce5d2abf130d61512d08641bdcfc3250b0c2d2` (recovery ref `codex/recovery-main-a2ce5d2`) |
| Initial ordinary integration merge | `f2a9f680fb6e428d072a5c2d588bab82027dc21e` |
| Recovered hybrid correction | `efc659f7a191a73a952b49e5a7bc25b24357e40d` |
| PR #2 final implementation head | `ea3b17771180f5b71c1753464fcdce2f926a76f1` |
| PR #2 resulting main merge | `fdc89637c9331c6f4b9f28af5b247d3e6814663d` |
| Fresh-main acceptance starting point | `bea5e260c122c8cc250f225dbc5677ecd8f7bed4` |
| Synchronized main verified by this follow-up | `724be3ec504c1f6fd62c539d4e7ee53f473766cd` |

The original PR #2 branch was fast-forwarded to the audit and merged with then-current main. Recovery refs preserve the audit and portfolio heads. During an interrupted handoff, Antigravity recovered the implementation, synchronized newer main, and merged PR #2. Those actions are distinguished from this Codex acceptance run; a worker report alone was not treated as proof. `pr1-observed.json` and `pr2-observed.json` record GitHub's merge observations. The separate post-merge handoff documentation commit was `ce613f47f63fb49e0db1360fde1c7d8e6ff7d7d1` as reported by the old checkout; consult the recovery ref `codex/recovery-concurrent-ce613f4` for its authoritative full object ID.

Acceptance used a connected worktree on `codex/concord-final-verification`, preserving the old checkout and all concurrent product changes. After PR #2 had merged, a supplemental verification PR was necessary to deliver this report and regression refinements. No replacement implementation, force-push, branch deletion or history rewrite was used.

## Optimizer defect and correction

The reproduced counterexample has **four trials, three sites and twelve candidate edges**, not two trials/four sites. Every trial initially finishes at month 12. Adding capacity to fewer than all four trials leaves the maximum completion objective at 12. The old beam search stopped after depth three and could not cross that plateau to the feasible four-month allocation. Timing evaluation and the independent scalar simulator agree; bounded candidate search caused the gap.

`counterexample-before.json` preserves the audit result. `exact-case-comparison.json` and `numerical-summary.json` show the corrected allocation and independent optimum both equal **4.0 months**, with zero objective gap. The original 12-month result was 8 months above this synthetic optimum. These are software-test results, not observed trial acceleration. The fractional default-horizon regression now returns **3.5**, not truncated **3** months.

The original allocator contract, shared-capacity event simulator and financial coverage/economics architecture are preserved. The hybrid search is admitted to exact enumeration only when:

```text
eligible edges <= 12
2**eligible_edges * effective_draws * (all_edges + trials + 2) <= 500000
```

Identical draw rows require one effective evaluation; otherwise all supplied draws are evaluated. Exact search exhausts usable subsets, including budget, activation delays, shared capacity, static trial slots, hospital contribution, no-loser and deadline constraints. Add-only strategy C has an explicit restricted search domain. Joint strategy F compares its admissible intervention policies. `OPTIMAL` and gap zero refer only to that entered model and finite draw bank. Infeasibility is proven only within the same scope. Unrounded objective values drive selection and deterministic tie breaking.

Larger requests retain deterministic beam width 3, depth 3 and at most 96 visited networks per policy. The best feasible explored candidate is retained. Termination is recorded, with `FEASIBLE_HEURISTIC` or `NO_FEASIBLE_FOUND`; lower bound and gap remain UNKNOWN. A failed heuristic does not prove infeasibility. Fixed A/B/D scenarios are labeled `FIXED_COMPARISON`.

## Verification evidence

All six configured Fleet checks passed in the precommit execution (`precommit-fleet.json`). Its dirty working tree binding was correctly rejected for task attachment; it is not promotion evidence. Before promotion, repeat `fleet verify --task concord-final-acceptance --json` on the clean acceptance commit; Fleet's durable task and verification history must bind that exact commit. The report's own commit is found with `git log -1 -- docs/integration/FINAL-INTEGRATION-REPORT.md`, avoiding a self-referential hash.

| Check | Observed result |
| --- | --- |
| Full backend suite | **556 passed, 102 skipped**, one Starlette/httpx deprecation warning |
| Financial + hybrid targeted tests | **73 passed** |
| Frontend financial / portfolio / comparison contracts | **15 / 6 / 8 passed** |
| TypeScript and production Vite build | Passed |
| Lint | Exit 0; 14 existing warnings, retained in `final-frontend-lint.log` |
| Independent scalar Fraction enumeration | 19 named cases; no false infeasibility, time mismatch or nonzero gap |
| Hybrid regression suite | 26 tests, including 18 seeded random portfolios and three stochastic full-draw oracle cases |
| Financial accounting counterfactuals | Passed; full party/resource ledgers in `financial-invariants.json` |
| npm audit / pip-audit | No reported known vulnerabilities at run time |
| Credential-pattern scan | No matching private-key/common token patterns; heuristic scope documented in `credential-pattern-scan.json` |

The first fresh-main full run had two failures from hard-coded financial totals dependent on an absent CMS ratecard. `pre-refinement-backend.log` preserves those failures and all skip reasons. Test refinements independently sum rounded line amounts using Decimal, verify payer/participant conservation, and retain the supply reclassification invariants. No production financial behavior was changed. The equal-cost regression now exercises a real tie, and the stochastic oracle correctly enforces the documented mean hospital contribution constraint.

Financial verification distinguishes transfers from resource consumption. Investigational supply remains a sponsor resource proxy, outside hospital receipts/resources. Access support is not netted against participant cost sharing. Changing payer share does not reduce sponsor commitment. UNKNOWN responsibility remains reserved; unknown payment is not silently zero. The worksheet outputs no timing model. Portfolio timing changes only under its separate explicit operational assumptions.

## Actual browser and export workflow

Chrome exercised the fresh integrated API at port 8005 and frontend at 5178: load the bundled Regeneron context, inspect targets and synthetic hospitals, inspect capacity and UNKNOWN choices, run the fixed-budget optimizer, compare six scenarios, explicitly realize administrative savings, observe stale output on edits, restore saved inputs/results, leave and reopen the portfolio page, and restore again. Sponsor budget was independently opened and its five budget scenarios computed through the UI. Request logs showed HTTP 200 for demo, compare, saved-run and both export routes. Browser snapshots and `browser-overview.png` retain the visible results. Console capture contains three asynchronous extension-message errors; successful application HTTP/rendering evidence is recorded separately rather than claiming an empty console.

With savings explicitly realizable, A/B/D finish at **15.13 months**; B reduces expected commitment by **$75,000** with no time gain. D adds **$24,000** over B and still saves zero time at the default zero support effect. C/E finish at **9.22 months** and F at **8.85 months** under hypothetical rates/effects. This demonstrates conditional scenario mechanics, not clinical benefit or realized operating performance.

Browser-observed run `204036ccde6145586c7b5ec832fdfa31` has digest `204036ccde6145586c7b5ec832fdfa3180ffa15e33ac356d3035d0e8d9f912c5`. `verify_exports.py` checks the actual saved endpoint, canonical digest, JSON equality, HTML-embedded full JSON, browser-observed values and reproducible scenarios. A later unrelated Git synchronization changes the evidence address because commit provenance is hashed; scenario results remain identical. `export-verification.json` records both commits and raw export checksums.

Both download links were clicked, but no matching file appeared in Downloads. Browser download success is **not verified**; earlier acceptance recorded organizational blocking. The permitted independent content/checksum fallback passed. GET responses explicitly identify `artifact-replay`; restored UI says `SAVED EVIDENCE REPLAY`. The original computation mode stays recorded as its origin. No cache lookup substitutes old scenarios into a new computation.

Current main intentionally hides Sponsor budget and Portfolio Command from its primary navigation. Their tested deep links remain available; this campaign preserves that newer product decision. Demonstrators must use the direct routes below.

## Dataset and scientific limits

The minimal reproducible dataset is checked in: `data/portfolio/context.json` and `demo-request.json`. Manifest hashes, seed 7 and 128 draws are in `demo-manifest.json`. ClinicalTrials.gov supplies real identifiers, titles and sponsor context captured October 17, 2026. Hospitals, rates, progress, financial inputs and effects are explicitly synthetic assumptions. Both trial budgets use an illustrative NCT05800015 schedule, with an explicit proxy for NCT05785767. Missing ratecards use labeled approximate benchmarks, not claimed verified CMS amounts.

The fresh checkout has no `data/concord.db`, full `data/ratecard.json`, original registry crawl or frozen historical as-of snapshots. **102 tests skip** on these dependencies; see the preserved skip log. No historical bundle was fabricated or overwritten. Legacy Research outputs remain retrospective/in-sample or saved replay, not newly rerun leakage-free historical validation. Their numerical clinical performance claims remain unverified. This live synthetic planning demo is independently useful but does not establish prospective performance, actual site capabilities, sponsor/payer participation, outcomes or acceleration. P10–P90 ranges are uncalibrated finite-draw sensitivity, not predictive intervals. Static slots, finite priced visits/horizon and assumed resource ratios limit interpretation.

## Reproduction

From a clean checkout of the acceptance commit, with Python 3.14 and Node 26:

```sh
uv venv backend/.venv
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
npm --prefix frontend ci
PYTHONPATH=backend backend/.venv/bin/python -m concord.portfolio --request data/portfolio/demo-request.json --output data/work/portfolio/reproduction
PYTHONPATH=backend backend/.venv/bin/python -m backend.tests.acceptance_reference docs/integration/exact-case-comparison.json
PYTHONPATH=backend backend/.venv/bin/python -m backend.tests.acceptance_financial docs/integration/financial-invariants.json
backend/.venv/bin/python -m pytest -q -rs backend/tests
npm --prefix frontend run test:financial
npm --prefix frontend run test:portfolio
npm --prefix frontend run test:compare
npm --prefix frontend run build
npm --prefix frontend run lint
PYTHONPATH=backend backend/.venv/bin/python -m uvicorn concord.api.main:app --host 127.0.0.1 --port 8005
```

In a second terminal: `cd frontend` then `API_TARGET=http://127.0.0.1:8005 npm run dev -- --host 127.0.0.1 --port 5178 --strictPort`. Open `http://127.0.0.1:5178/#portfolio-command` and `http://127.0.0.1:5178/#financial`. Run, inspect evidence, and use its actual run ID with `backend/.venv/bin/python docs/integration/verify_exports.py http://127.0.0.1:8005 RUN_ID`. The verifier pins this report's demonstrated scenario; use the same inputs for its browser-value assertions. No credentials, model inference or network refresh are required. Optional registry refresh is documented in `docs/portfolio/README.md`; it is not restoration of historical operational data. That earlier README's beam-only description is superseded by this report and runtime hybrid metadata.

## Fleet and merge gates

Campaign: `CONCORD-FINAL-INTEGRATION`, Fleet 0.4.0. Initial recovery task `concord-final-integration` belonged to the old checkout/handoff. Fresh-main task `concord-final-verification` retains its immutable bea5e26 anchor and records its supersession after newer main synchronization. Final task `concord-final-acceptance` anchors 724be3e and requires portfolio computation, saved replay and financial browser evidence. Its scope is tests, integration documentation and project check configuration; production code/data are prohibited. That task passed without a policy override. The subsequent CI-only task is described separately below.

Actual capability inspection found no automatic provider routes/economic executors. Direct Codex work was therefore used, with deterministic Fleet orchestration; no routine provider dispatch success is invented. The external Antigravity handoff is separately attributed. No Claude/Astra calls or Fleet architecture changes were made.

GitHub reports WRITE access, no main branch protection rule and no configured status checks for the original PRs. This is **not a claim of green remote CI**. The clean supplemental evidence commit `41cba0f3d55e48a79da255a896a011b0166b4bc4` passed all six Fleet checks with exact binding (verification `059f0a81-1679-402d-9773-0cf9d23f4c47`), plus all three required browser rules; Codex approved that local patch.

Because attaching the supplemental PR requires real remote CI, the bounded follow-up task `concord-acceptance-ci` adds `.github/workflows/concord-acceptance.yml`: the same backend/frontend contracts, typecheck/build and lint, on PRs and main pushes. Official GitHub action revisions are pinned to full SHAs resolved through GitHub's API. Permissions are `contents: read`, checkout credentials are not persisted, there are no secrets, deployment steps or model calls, and the job has a 15-minute limit. The workflow path is classified high-risk by Fleet; final Codex review explicitly approves this exact addition under that path control. This is an approval of a new test workflow, not a bypass of remote CI, required review or branch protection.

Supplemental promotion requires passing exact-commit local and remote checks, final Codex review, an up-to-date conflict-free branch, and reinspection of any actual repository requirements. The original merges are confirmed in GitHub; resulting main through the synchronized checkpoint is 724be3e. The supplemental PR's actual resulting merge commit and CI conclusion must be read from GitHub and reported at delivery. Failure to obtain remote checks leaves the supplemental PR unmerged.
