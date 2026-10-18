# Sponsor boundary architecture

The original portfolio, financial and protocol services remain the computation authority. Sponsor SDKs are optional adapters around those services; provider failure never replaces a result with a fixture.

| Boundary | Local path | Optional remote path |
| --- | --- | --- |
| Photon | Bounded planning commands; authenticated normalized Concord webhook | Fixed-project/space/agent API send with durable idempotency; API acceptance distinct from delivery |
| Chalk | Explicit versioned 15-case acceptance run | Actual Compute Functions/Evaluation and result-row validation |
| Factory | Paired deterministic proposal evaluation | Streamed SDK proposal with bounded engine tools, independently recomputed locally |

Remote actions require a server-side per-provider gate and `X-Concord-Operator-Token`. The UI keeps the operator token only in memory and clears it after an attempted remote action; credentials never become `VITE_*` variables, browser storage or URL parameters. Status GETs are read-only configuration checks and never execute jobs. Explicit confirmation controls separate remote actions from previews.

Photon incoming normalized webhook HMAC/timestamp/sender authorization is independent of outgoing operator authorization. The normalized schema has not been verified against Photon Beta's provider event catalog. Review authorization is separate again and does not promote code, modify a protocol or approve clinical activity.

Request/scenario IDs, timestamps, input/source digests and typed execution modes establish provenance. A local function trace is not an SDK receipt; a remote job result is not necessarily a passing suite; a message accepted by an API is not carrier delivery. Archived JSON is explicitly replay and cannot satisfy execution endpoints. Static hosting needs a separate real API backend.

See [Photon](PHOTON.md), [Chalk](CHALK-EVALUATIONS.md), [Factory](FACTORY-DROID.md) and [verification](LIVE-INTEGRATION-VERIFICATION.md).
