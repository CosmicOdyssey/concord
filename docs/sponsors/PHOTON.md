# Photon-style local messaging boundary

**VERIFIED LOCALLY:** `/api/agents/photon/simulate` runs HELP, STATUS, DETAILS and OPTIMIZE on local synthetic planning inputs. Every response says `LOCAL_SIMULATION`; no request dispatches a carrier SMS.

**NOT IMPLEMENTED:** outbound Photon API client, official provider-specific signature contract, retry/timeout behavior for remote dispatch, carrier receipt or live round trip. `PHOTON_API_KEY` presence never establishes delivery. No real recipient was messaged.

`POST /api/agents/photon/webhook` is a local HMAC-SHA256 contract, not a claim of compatibility with an unverified Photon service. It requires `PHOTON_WEBHOOK_SECRET`, an exact E.164 allowlist in `PHOTON_ALLOWED_SENDERS`, `X-Photon-Signature` over raw bytes and a fresh signed payload timestamp. Missing configuration returns 503; invalid signatures and unauthorized senders fail before command execution/dedupe lookup.

Durable private SQLite idempotency binds sender, message ID and payload digest. A repeated authorized request returns its original result; conflicting reuse is rejected. Authentication, age and sender checks precede cache access. Sender identifiers are hashed in the journal; raw phone numbers and command text are not journaled. This is a single local process contract, not distributed carrier exactly-once delivery. Configure private state retention before production use.

Tests: `backend/tests/test_agent_photon.py`, including missing secret, bad/non-ASCII HMAC, expired/future timestamp, exact sender matching, unauthorized cached-response access, restart dedupe and altered payload reuse.

The base `#demo` calculation uses local deterministic computation on synthetic operating inputs and bundled registry context. It does not depend on this sponsor service. Source-backed context is not observed recruitment, negotiated pricing, clinical eligibility evidence or prospective validation.
