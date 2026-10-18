# Chalk-style local acceptance evaluation

**VERIFIED LOCALLY:** `POST /api/evals/chalk/run` explicitly executes a versioned 15-case deterministic dataset against actual Concord engine and boundary functions. GET latest returns 404 until a run exists. It never starts evaluation implicitly.

**NOT IMPLEMENTED:** remote Chalk SDK/API execution or synchronization. `CHALK_API_TOKEN` does not alter the local engine label. No remote receipt or sponsor verification is claimed.

The versioned [dataset](../operations/grand-mobilization/acceptance-dataset-v2.json) covers budget, capacity, unsupported clinical changes, no beneficial reinvestment, payer transfers, future registry context, exact/heuristic claims, injection, unauthorized SMS, export tampering, stale inputs, absent enrollment evidence, missing credentials and recursive refinement failure. Actual trajectories and hashes are retained in the [local HTTP receipt](../operations/grand-mobilization/local-evaluation-receipt.json). Dataset changes invalidate the previous receipt.

Historical rejection only tests the context date boundary; it does not recover unavailable as-of datasets or validate old forecasting claims. These are bounded software acceptance cases, not a proof over every possible input or a clinical evaluation.

The base `#demo` calculation uses local deterministic computation on synthetic operating inputs and bundled registry context. It does not depend on this sponsor service. Source-backed context is not observed recruitment, negotiated pricing, clinical eligibility evidence or prospective validation.
