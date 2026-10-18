# Photon 2.0 integration

Concord uses the Photon **Beta / 2.0 project API**, not the separate Spectrum API. Official [version selection](https://photon.codes/docs/llms.txt), [API clients](https://photon.codes/docs/beta/api-client/index) and [timeouts/idempotency](https://photon.codes/docs/beta/api-client/retries-and-timeouts) define the integration boundary. The configured project uses the `pho_prj_` identifier family and bearer credentials.

The local simulator calls real Concord planning functions with explicitly synthetic operating data and never sends a message. Its signed `/webhook` is a local contract: configured secret, fresh signed payload timestamp, exact sender allowlist and private sender/payload-scoped SQLite deduplication. It is not evidence that an undocumented Photon event payload is compatible.

`POST /api/agents/photon/send` is the separate provider path. It requires `confirm_live`, a stable `message_id`, `X-Concord-Operator-Token`, `CONCORD_ALLOW_PHOTON_SEND=1` and explicitly configured project/space/agent-user IDs. It sends only the bounded planning-command reply to that configured destination; it never chooses the first space or creates an arbitrary recipient conversation. A provider message ID records API acceptance, not delivery. An uncertain timeout must not be presented as success or blindly retried with a new identity.

`GET /api/agents/photon/status` reports missing prerequisites, configured-versus-observed status and any verified receipt. Credential presence alone is `CONFIGURED_UNVERIFIED`. No real message is authorized by running the local preview.

During this repair, read-only requests to the configured event catalog and the public OpenAPI URL returned HTTP 403. No message was sent; no credential validity or successful delivery is inferred. A genuine version-pinned event schema and an approved recipient/space are required before claiming the provider-backed inbound round trip.

See `.env.example` and the [integration verification](LIVE-INTEGRATION-VERIFICATION.md) for exact settings and current blockers. Clinical trial operations shown here are hypothetical; registry context is not clinical or recruitment evidence.
