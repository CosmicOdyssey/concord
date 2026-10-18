# PR #7 / #8 integration repair — 2026-10-18

Main `6a33301` was reconciled with PR #7 (`antigravity/concord-claude-ui`) and PR #8 (`antigravity/concord-live-sponsor-integrations`) in isolated worktrees. The unrelated original acceptance checkout and its uncommitted report edit were preserved. PR #8 includes the repaired PR #7 history so its white UI and retained navigation are integrated together.

## Changes and claim corrections

The README was rewritten as one project overview, retaining main's negative research findings, team, license, protocol/budget story and source links while integrating the sponsor roles, setup and limitations. Photon/Chalk/Factory have actual optional server adapters and explicit local versus remote modes. Provider gates default off and operator authentication is separate from local previews and review authorization.

PR #7 no longer returns static API JSON as a successful failed request. The 11 legacy artifacts were moved outside `/api`, labeled replay and removed from Vercel execution rewrites. Optimization requires a real LIVE_COMPUTATION result. Saved replay remains an explicit action. Earlier two-second browser smoke runs are not three 180-second rehearsals; their claims were corrected.

The original PR #8 live audit is superseded by [current verification](../sponsors/LIVE-INTEGRATION-VERIFICATION.md). Earlier carrier delivery, remote evaluation completion and Factory improvement claims are withdrawn. No inference, cloud compute job or outbound message was performed during this repair.

## Verification

PR #7 code commit `8a6c8aff571467d534495470715e611d55bcdea5` passed all six configured Fleet checks: 609 backend tests passed, 102 missing-data skips, 47 frontend tests, typecheck, production build and lint. Lint retained 14 existing warnings. The recorded check runner used the actual isolated checkout, not worker prose. PR #8 combines that repair with the optional provider adapters; its final receipt and browser results are recorded below after execution.

## Remaining limits

Photon event catalog/OpenAPI access returned 403; no approved outbound space/agent/send receipt or carrier delivery is verified. Chalk OAuth succeeded but no environment/Function/evaluation execution receipt exists. Factory's installed SDK surface was checked, while the read-only CLI model catalog request timed out; no model turn was submitted. Sponsor billing eligibility remains unverified. Local synthetic computation is independently available; none of these states may be presented as completed provider execution.

No GitHub merge or production deployment is included in this repair.
