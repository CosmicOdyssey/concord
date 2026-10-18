# Sponsor integration evidence

The merged PR #5 at `a840d40ece0fde73474b35e479e6d6b72254abaa` and original PR #8 contained claims that exceeded their evidence. Credential presence was treated as connection/delivery, local scripted evaluation as SDK execution, and canned scenario outputs as verification. Those affirmative live claims are withdrawn. Git history preserves the original text; it is not current acceptance evidence.

The repaired implementation preserves the local demonstrations and adds explicitly gated real API/SDK paths. It verifies webhook authentication/idempotency, transport failures, provider-response parsing, actual-engine proposal rejection, and remote result completeness. Transport mocks test software contracts; they do not establish provider execution.

- [Versioned 15-case dataset](../operations/grand-mobilization/acceptance-dataset-v2.json)
- [Earlier actual local HTTP receipt](../operations/grand-mobilization/local-evaluation-receipt.json)
- [Earlier campaign/browser reproduction](../operations/GRAND-MOBILIZATION-REPORT.md)
- [Current provider status and withdrawn claims](LIVE-INTEGRATION-VERIFICATION.md)
- [Current PR repair verification](../operations/PR7-PR8-REPAIR.md)

No real outbound message, remote Chalk evaluation or Factory inference was performed in this repair. Configuration/authentication probes are reported separately. Synthetic operational inputs remain labeled even when their computation runs on a real backend or provider.
