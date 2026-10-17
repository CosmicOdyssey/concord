# Financial Coordination acceptance evidence

> **Time model removed, 17 Oct 2026 (decisions.md #24).** The evidence below was recorded against the first version, which derived "costed assumed months" from synthetic recruitment rates and activation lags, picked the "fastest feasible" scenario, applied a nominal no-loser duration bound, varied recruitment rates in its sensitivity and reported a modeled time change in the Reinvestment Lab. All of that is gone. The product owner ruled that insurance payouts and Medicare estimates bear on fair-value estimates and sponsor-site negotiation but do not mean the sponsor pays less, or that negotiation or the trial goes faster, when an insurer pays more; a chain from lower costs to added sites to shorter modeled time implied exactly that. The scenarios are now a sponsor-budget comparison at a fixed target over a budgeted contract period (see README.md and CONTRACT.md). The months column, scenario commitments, test counts and browser journey below describe the old version and no longer match the API. Current default commitments: A 662,387.40; B 632,387.40; C 662,387.40 (equals A: the existing network has the capacity); D 680,387.40; E 650,387.40. Same-day review corrections (decisions.md #24) also changed the ledger: the investigational-supply reserve is a sponsor-side supply proxy rather than a hospital cost (default hospital contribution 200,489.40), participant access support is no longer netted against routine cost sharing, Medicaid shows no enrollee cost sharing, and extending a short network fills existing sites first.

Verified October 17, 2026. Initial inspected main: `6f7d7f5a9af6ac438bfc062d22d32be251b6b056`. Integrated upstream main: `6db7e6fbbd62c616a0345a9a2e97774869ad0869` (retains the concurrently added Site scores view). Implementation source verified clean at `31d5674a8ab9c2e62a9293b4aafccaa0ff2f6140`; this document and screenshot are acceptance artifacts added afterward. No optimization-engine or historical-output files changed relative to integrated main.

## Executed checks

| Check | Observed result |
|---|---|
| Original inspected-main pytest baseline | 353 passed, 30 skipped; missing original SQLite/CMS inputs |
| Integrated feature backend pytest | **390 passed, 43 skipped**, one existing Starlette/httpx deprecation warning; added Site scores tests require unavailable original inputs |
| New financial backend tests | **37 passed**, no financial-test skips |
| Native Node financial client tests | **4 passed**, no skips |
| Frontend TypeScript and production build | passed; Financial view lazy-loaded, about 25.3 KB / 7.2 KB gzip |
| Frontend lint | exit 0; 17 existing warnings after upstream Site scores integration, none in new financial files |
| Fleet configured verification | all four checks passed against clean source commit above; dirty-tree and earlier iteration checks kept separately |
| git diff whitespace check | passed |
| Original-data isolation | financial API journey succeeds with every sqlite3.connect forbidden; original engine/history outputs unchanged |
| Default numerical execution | 0.020 seconds measured once in-process on this machine; import/server/browser overhead excluded |

Commands are in the adjacent README and `.fleet/config.json`. No dependency upgrades or new runtime dependencies were needed. Native client tests require a Node version with TypeScript stripping (tested Node 26.11.1); backend tested with Python 3.14.7.

## Actual Chrome journey

Against local Vite 5175 -> FastAPI 8002 -> existing authored protocol/price functions -> financial subset screen/ledger -> React:

1. Opened Financial Coordination from its real hash route and computed all five default scenarios; all five feasible under their explicit assumptions.
2. Inspected the three-party ledger, payer administration, participant exposure, hospital contribution and transfer balance.
3. Opened Reinvestment Lab and observed seeded paired rate-shock ranges.
4. Marked the screening oncology visit UNKNOWN in Coverage Review. Old result and export controls disappeared immediately until recomputation.
5. Entered sponsor budget $100; all five alternatives displayed INFEASIBLE and no funded recommendation existed. Restored the budget and recomputed.
6. Downloaded actual HTML and JSON with the UI buttons. The UI reported completion for input `9911bb8eddd9773096668ebc39afe0b0c70bbf0534f32f168b2d36a659e6eee7`. JSON exactly equaled a fresh API recomputation, its result hash recomputed correctly, and HTML contained the identical result hash. This reviewed run's result SHA-256: `fab078187d2afc92493faa64aca1e281d5a94494ba1dfb857e721ffa720c6696`.
7. Browser console capture reported no errors or warnings in the tested financial journey.
8. Captured [the complete working screen](overview.png). Its amounts include the operator's UNKNOWN correction, so they intentionally differ from untouched defaults below.

**Browser tooling limitations:** the button download observer timed out even though the actual HTML file downloaded successfully; completion was verified in the UI and on disk. The browser policy blocked file:// navigation to preview the downloaded HTML. No workaround was used and browser preview is not counted as passed. Downloaded HTML was inspected from disk for sources, escaping, result hash and matching evidence. Native downloads, fresh API equality and automated report tests passed.

## Untouched default synthetic example

Budget $1,500,000; demo target 60; seed 7; 256 draws; hypothetical rates. Dollar values below are commitments including reserve, not realized expenditures.

| Scenario | Commitment USD | Costed assumed months | Change in modeled resources vs A |
|---|---:|---:|---:|
| A existing allocation | 643,133.13 | 17.33 | 0 |
| B assumed lower administration | 613,133.13 | 17.33 | -30,000 |
| C additional feasible sites | 739,199.80 | 10.80 | +70,853.33 |
| D extra participant support | 631,133.13 | 17.33 | -12,000 |
| E combined comparison | 757,199.80 | 10.80 | +88,853.33 |

B's $30,000 reduction is an input assumption, not observed savings. D applies $18,000 of that assumed reduction to participant support. Additional sites in C/E increase costs; the conditional insurer expenditure stays unchanged across all alternatives. No shared-savings claim, observed trial acceleration or actual insurer collaboration follows from these figures. Unresolved patient liability and downstream clinical expenditure remain UNKNOWN.

## Fleet runtime and worker status

The documented entry point `node /path/to/engineering-fleet/dist/cli.js` was inspected and executed. Fleet initialized this repository, created durable tasks, recorded worker outputs and ran configured verification. `capabilities` reports only manual `codex-existing` coding in this campaign; no automatic coding route/economic executor is configured. GPT-6.1 Sol availability/allowance was not established. Accordingly implementation used conventional Codex workers with separate file ownership, not a claimed Fleet provider dispatch.

| Workstream | Worker | Result / failure |
|---|---|---|
| Coverage/API/ledger/report integration | supervising Codex | implemented and independently ran all checks |
| Budget/subset allocation | Codex allocation worker | completed bounded module and 12 initial tests; supervisor added per-site finish constraint and regression |
| Dashboard | Codex frontend worker | completed UI/typechecks; follow-up hit usage limit; supervisor completed persistent client tests |
| Invariant validation | Codex validation worker | saved tests; hit usage limit; supervisor ran/extended tests |

No automatic retry, reserve escalation, Claude or Astra invocation, or metered provider call was made. Fleet provider dispatch count is zero. Local task tracking/verification is active; provider-driven orchestration is unavailable. Worker claims alone were not treated as verification. Durable campaign tasks: `concord-finance` and integration task `concord-finance-delivery`; records remain local under ignored `.fleet/state`.

## Limits and next gate

Ready only for the labeled synthetic financial pilot. Original registry/database/CMS source bundles and actual negotiated site budgets were unavailable here. Historical leakage and legacy research cache issues remain identified and unchanged; they are not used by the financial demo. Hospital resources/margins, insurer shares, support usage, drug supply reserve, capability feasibility and recruitment are assumptions requiring real pilot validation. Payer amounts remain conditional and no binding coverage determination is produced. Dataset-dependent skipped tests and browser file preview are not successful acceptance evidence.
