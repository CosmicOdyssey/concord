# PR #7 / #8 integration repair — 2026-10-18

Main `6a33301` was initially reconciled with PR #7 (`antigravity/concord-claude-ui`) and PR #8 (`antigravity/concord-live-sponsor-integrations`) in isolated worktrees. The unrelated original acceptance checkout and its uncommitted report edit were preserved. PR #8 includes the repaired PR #7 history so its white UI and retained navigation are integrated together.

A concurrent main update to `759205e9319fe4f5df5dfb2292ad4629febf0b65` was then reconciled into both PRs. Its permanent GitHub Pages demo link, submission link and tunnel-watchdog source are preserved. The watchdog was inspected but not executed; this repair launched no tunnel and published no deployment. Application source is unchanged by that final main merge.

## Changes and claim corrections

The README was rewritten as one project overview, retaining main's negative research findings, team, license, protocol/budget story and source links while integrating the sponsor roles, setup and limitations. Photon/Chalk/Factory have actual optional server adapters and explicit local versus remote modes. Provider gates default off and operator authentication is separate from local previews and review authorization.

PR #7 no longer returns static API JSON as a successful failed request. The 11 legacy artifacts were moved outside `/api`, labeled replay and removed from Vercel execution rewrites. Optimization requires a real LIVE_COMPUTATION result. Saved replay remains an explicit action. Earlier two-second browser smoke runs are not three 180-second rehearsals; their claims were corrected.

The original PR #8 live audit is superseded by [current verification](../sponsors/LIVE-INTEGRATION-VERIFICATION.md). Earlier carrier delivery, remote evaluation completion and Factory improvement claims are withdrawn. No inference, cloud compute job or outbound message was performed during this repair.

## Verification

PR #7 code commit `8a6c8aff571467d534495470715e611d55bcdea5` passed all six configured Fleet checks: 609 backend tests passed, 102 missing-data skips, 47 frontend tests, typecheck, production build and lint. Lint retained 14 existing warnings. The recorded check runner used the actual isolated checkout, not worker prose. PR #8 integrated code commit `0e62377c419a688dd4c8e3eeeed517e74317dce4` passed all six checks on a clean checkout: **618 backend tests passed, 102 missing-data skips, 55 frontend tests passed**, plus typecheck, production build and lint (14 existing warnings). The backend retains one Starlette/httpx deprecation warning. `npm audit --omit=dev` reported zero vulnerabilities. [PR #7 receipt](pr7-pr8-repair/fleet-pr7.json) · [PR #8 receipt](pr7-pr8-repair/fleet-pr8.json).

Actual Chrome interactions on the integrated branch exercised all six demo scenes, backend optimization, the local STATUS request, proposal rejection and explicit local 15-case acceptance. The live demo returned `OPTIMAL`, 678 candidate/policy evaluations and 406.2 ms recorded server compute; the run ID was `1e076872f49047647a3b2915b0bf35b6`. Its 15.13→9.24 month modeled difference used synthetic inputs and increased sponsor expenditure, not clinical evidence or savings. HTML and JSON exports returned HTTP 200 with attachment headers. Direct browser navigation to the HTML attachment was blocked by the client; export transport was verified separately over HTTP, not claimed as an in-tab render.

Stopping only the repair's API process and reloading produced an explicit HTTP 502 error with no substituted result. Clicking the saved-rehearsal control then displayed `ARTIFACT_REPLAY — saved evidence; no new computation`. The backend was restored afterward. This is a smoke workflow, not a timed 180-second rehearsal.

Browser evidence: [local sponsor results](pr7-pr8-repair/sponsor-local.ax.txt), [live computation](pr7-pr8-repair/live-demo.ax.txt), [backend failure](pr7-pr8-repair/backend-down.ax.txt), [explicit replay](pr7-pr8-repair/explicit-replay.ax.txt), [live JSON report](pr7-pr8-repair/live-report.json). Screenshots: [sponsor readiness](pr7-pr8-repair/sponsor-readiness.png), [live demo](pr7-pr8-repair/live-demo.png), [replay](pr7-pr8-repair/explicit-replay.png).

## Remaining limits

Photon event catalog/OpenAPI access returned 403; no approved outbound space/agent/send receipt or carrier delivery is verified. Chalk OAuth succeeded but no environment/Function/evaluation execution receipt exists. Factory's installed SDK surface was checked, while the read-only CLI model catalog request timed out; no model turn was submitted. The user confirmed on 2026-10-18 that all three sponsor accounts have included hackathon credits with paid overages disabled. This resolves the billing eligibility question, but does not establish provider access, a permitted model, an active Chalk environment or an approved Photon destination. Local synthetic computation is independently available; none of these states may be presented as completed provider execution.

No GitHub merge or production deployment is included in this repair.
