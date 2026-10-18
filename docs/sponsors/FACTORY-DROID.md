# Factory Droid proposals

The existing local evaluator and an optional genuine Factory SDK runner share the original Concord optimization engine. The default is local execution; no credential silently changes the mode.

## Local evaluation

`POST /api/agents/droid/run` with `execution_mode: "LOCAL"` executes Python proposal validation and paired seeded simulations, at most three iterations. The frozen fixture has no supported outreach effect or baseline lag to remove, so its ordinary result is `NO_BENEFICIAL_CHANGE`, zero improvement and a rejected recommendation. Failed, unsafe, over-budget and ineffective proposals retain the baseline.

## Optional Factory SDK execution

`npm --prefix frontend ci` installs pinned `@factory/droid-sdk` 0.9.1 and zod. Install a compatible official `droid` CLI and set `FACTORY_DROID_EXEC_PATH` if it is not on PATH. Configure `FACTORY_API_KEY`, an explicit `FACTORY_MODEL_ID`, `CONCORD_SPONSOR_OPERATOR_TOKEN`, and `CONCORD_ALLOW_FACTORY_RUN=1`. Verify included inference eligibility before enabling execution.

`GET /api/agents/droid/status` reports prerequisites without model inference. `POST /api/agents/droid/run`, with `X-Concord-Operator-Token`, `execution_mode: "LIVE_FACTORY"`, a known `trial_id` and `max_iterations` from 1 to 3, invokes `scripts/factory-droid-runner.mjs` on the server.

The runner checks the model catalog and rejects unavailable, disabled, automatic, Claude/Anthropic or Astra routes. It creates an isolated session, disables built-in skills and non-Concord tools, consumes the actual SDK stream, and requires a successful terminal result with structured proposals and an actual simulation-tool trace. Session creation alone is not execution. Only three bounded MCP tools are exposed: inspect protocol, identify operational bottlenecks, and simulate an operational variant. Each calls the existing Python engine; model prose is not a computation receipt.

The original engine independently recomputes returned proposals. Clinical criteria remain immutable, operating assumptions remain synthetic, and a proposal can correctly produce no benefit. The SDK abort deadline is 120 seconds; the Python process-tree deadline is 150 seconds. The Python tool bridge has a 15-second deadline and a bounded result size. Only the scoped Factory credential/configuration is passed to the child; Photon/Chalk secrets are excluded.

An authentic result identifies the SDK session, actual tool trace, terminal status and provider-reported usage when available. Failures return a visible 503 and never substitute local success. Catalog presence, installed SDKs and API keys remain `IMPLEMENTED_UNVERIFIED` until execution succeeds.

**Observed status:** the actual installed SDK exports were checked offline. A checksum-verified official Droid 0.174.0 binary answered `--version`; a read-only catalog request timed out without an authenticated catalog receipt. No Factory model turn was run during this repair. Compatibility/authentication and a permitted model remain live blockers.

## Review boundary

`/api/agents/droid/review` separately requires `CONCORD_REVIEW_TOKEN` via `X-Concord-Review-Token`; missing configuration returns 503, invalid authentication 401 and repeated/nonpending review 409. Review is process-local and neither applies a protocol nor constitutes sponsor, institutional, IRB or clinical authorization. The public lab has no review approval control.

Official contract: [Factory TypeScript SDK](https://docs.factory.com/sdk/typescript).
