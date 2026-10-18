# Sponsor boundary architecture

Each response keeps its own typed domain schema. Request/scenario IDs, timestamps, source digests, local execution labels and structured failures establish provenance without coupling the core optimizer to sponsor SDKs.

The original demo calls the existing portfolio services. Messaging calls bounded local functions; evaluation calls explicit tests of those services; proposals call paired engine simulations. Sponsor exceptions do not intercept or replace the original demo API.

External webhook authentication is separate from the explicitly local simulation endpoint. Review authentication is separate from proposal computation. No credentials are delivered to frontend code. Local function traces are not external SDK tool receipts.

See [Photon](PHOTON.md), [Chalk](CHALK-EVALUATIONS.md), [Droid](FACTORY-DROID.md), [acceptance evidence](INTEGRATION-EVIDENCE.md).
