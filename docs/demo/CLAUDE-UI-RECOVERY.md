# Concord UI recovery and demonstration evidence

## Correction to the original acceptance claim

The original PR #7 report claimed a live, resilient demonstration while the frontend silently substituted static JSON for failed backend requests. One precomputed response was explicitly labeled `LIVE_COMPUTATION`. Those claims are withdrawn. Static files do not establish live optimization, sponsor API execution, phone delivery, or availability guarantees.

The historical receipt in [screens/acceptance-receipt.json](screens/acceptance-receipt.json) records three navigation passes lasting 2,173, 2,065 and 2,063 milliseconds. They were **not** three 180-second narrated rehearsals. Its sponsor checks swallowed action errors and observed a fabricated client-side SMS reply. They do not demonstrate actual backend or remote sponsor execution. Existing screenshots remain historical visual artifacts, not new acceptance evidence.

## UI work preserved

The contributor's white light-theme canvas, typography and presentation styling remain. Current main's retained-tab navigation and shell architecture remain. Historical screenshot observations recorded a light theme and white document/body backgrounds; they do not establish the current deployment's state. No deployment was performed as part of this repair.

## Corrected computation and replay contract

- The default demo loads its baseline from `GET /api/hackharvard-demo`. The Optimize action requires an actual successful `POST /api/hackharvard-demo/optimize` response labeled `LIVE_COMPUTATION`.
- HTTP errors, authentication failures, unavailable services and malformed responses remain errors. They do not trigger static API copies or synthetic success.
- **Load saved rehearsal (ARTIFACT_REPLAY; not live)** is an explicit user choice. It loads the existing checksum-verified `/demo/saved-result.json`, preserves its original timestamps, run and input identities, and displays `ARTIFACT_REPLAY`. It performs no new computation. The original saved bytes and digest are preserved; their historical `SAVED_RESULT_REPLAY` label is normalized in the displayed result.
- The bundled registry records provide trial context. Hospital capacities, costs and recruitment assumptions are synthetic. Neither live computation nor replay demonstrates actual clinical outcomes or trial acceleration.
- Legacy static snapshots, including extensionless files, were moved from action-shaped `/api` paths into `frontend/public/archives/pr7-static-api/`, labeled `ARTIFACT_REPLAY`, and are not used as automatic fallbacks. Hosting rewrites for demo, agents and evaluations were removed. The SPA rewrite excludes both `/api` and `/api/**`; missing API actions fail rather than serving index HTML or archived JSON. Read-only research findings snapshots remain separate.

## Sponsor actions

Photon simulation, local Droid proposals, human review and Chalk evaluation clients require the backend. A backend failure cannot become a saved proposal, a forged evaluation report or a hardcoded SMS response. The local simulation endpoint is still a simulation, even when its backend computation succeeds. Real carrier delivery, remote Chalk execution and Factory runtime execution require separate backend implementation and verified provider receipts; no such external execution is established by this repair.

## Verification scope

Transport regression tests cover actual loopback HTTP 401, 403, 404, 405 and 503 responses and network refusal across all sponsor helpers, plus explicit live/replay identity checks and saved-artifact checksum validation. These checks verify failure handling and contracts; they are not browser acceptance or remote sponsor receipts.

[scripts/live-browser-acceptance.mjs](../../scripts/live-browser-acceptance.mjs) now describes and records **navigation/transport smoke checks**, captures actual POST responses and fails when an action fails. It does not silently load replay, catch action failures as success, claim narration timing, or assert carrier/provider execution. It requires an explicit `DEMO_URL`. A current browser acceptance receipt must be produced independently against the final merged backend/frontend before claiming end-to-end readiness.
