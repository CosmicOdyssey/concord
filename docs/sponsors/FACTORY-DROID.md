# Droid-style local proposal evaluator

**VERIFIED LOCALLY:** `/api/agents/droid/run` invokes a Python evaluator with a fixed tool allowlist, strict proposal schema and at most three iterations. It uses the existing capacity/financial engine, paired seeded shocks and explicit operating assumptions. Unknown trials produce UNKNOWN evidence, not invented clinical criteria.

**NOT IMPLEMENTED:** Factory SDK/model execution. The old frontend imported an enum but invoked no SDK agent. The unused dependency has been removed; the convenience client calls the local API only.

No-benefit, over-budget, unsafe or failed proposals are rejected. The default frozen demonstration has no evidence-backed outreach effect and no baseline lag to remove, so it correctly returns `NO_BENEFICIAL_CHANGE`, zero improvement and a rejected recommendation. A failed refinement retains the baseline. Clinical criteria cannot be mutated by these tools.

`/review` requires server-side `CONCORD_REVIEW_TOKEN` via `X-Concord-Review-Token`; missing configuration returns 503, invalid authentication 401, repeated/nonpending review 409. A recorded review is process-local and does not apply a protocol or constitute sponsor/IRB/clinical authorization. The public lab exposes no approve button or browser-held reviewer credential.

The base `#demo` calculation uses local deterministic computation on synthetic operating inputs and bundled registry context. It does not depend on this sponsor service. Source-backed context is not observed recruitment, negotiated pricing, clinical eligibility evidence or prospective validation.
