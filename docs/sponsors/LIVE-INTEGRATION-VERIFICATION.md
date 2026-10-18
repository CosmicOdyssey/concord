# Sponsor execution verification — 2026-10-18

This document supersedes the original PR #8 activation audit. Its claims of completed carrier dispatch, completed cloud evaluations, 12-case canonical coverage and Factory-driven improvement were not supported by the reviewed implementation. They are withdrawn as acceptance claims; original text remains in Git history. A stored provider message/dataset identifier without a verifiable invocation/result chain does not establish current execution.

| Provider | Implemented path | Evidence observed in this repair | Remaining live blocker |
| --- | --- | --- | --- |
| Photon Beta 2.0 | Operator-gated fixed-space API send; durable idempotency; acceptance/delivery distinction | Official read-only event catalog and OpenAPI requests returned HTTP 403. No outbound request or delivery was attempted. | Approved space/agent configuration, account/API access, approved recipient and spending eligibility; authenticated Beta inbound event schema remains unverified. |
| Chalk | Optional actual Compute task/scorer, 15-case dataset upload/run/read lifecycle | OAuth client-credentials token exchange returned HTTP 200 with a token; token was neither printed nor retained. Optional pinned dependencies and real image builder checked without deploying decorators. | Environment/queue/storage eligibility and explicit compute authorization; no remote deployment/run/result receipt. |
| Factory | Official SDK stream, restrictive engine MCP tools, terminal-result validation and independent computation | SDK exports checked offline. Official Droid 0.174.0 checksum/version verified; read-only catalog probe timed out after 25 seconds. No prompt or model turn submitted. | Compatible authenticated catalog, permitted explicit model and included inference eligibility. |

No secret values or real phone numbers belong in tracked receipts. Gates default off. Frontend status checks are safe to inspect without execution; local checks and previews remain separately available.

## What the checks prove

Offline HTTP contract tests cover missing configuration, invalid operator credentials, explicit confirmation, stable send identity, ambiguous provider outcome, bounded tool access, model reserves, proposal rejection and complete/error-free remote result rows. Actual installed SDK type/export/image checks validate the integration surface without provider jobs. Browser verification exercises real local frontend → API → engine responses and visible failures. None of these proves a remote provider succeeded.

The local 15-case suite uses actual synthetic acceptance inputs and engine functions, not clinical outcomes. Clinical criteria remain immutable. A failed remote suite stays failed; a no-benefit proposal stays rejected. No unsupported trial acceleration is established.

See [repair verification](../operations/PR7-PR8-REPAIR.md) for exact code revisions, checks and browser evidence, and the individual [Photon](PHOTON.md), [Chalk](CHALK-EVALUATIONS.md), [Factory](FACTORY-DROID.md) documents for reproducible configuration.
