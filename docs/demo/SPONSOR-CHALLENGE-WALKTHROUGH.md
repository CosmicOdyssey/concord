# Sponsor lab walkthrough

Start the backend and frontend using the root README. Run `#demo`, then open `#sponsor-agents`.

1. Inspect each provider's actual readiness and missing prerequisites. Status checks do not send messages, deploy Functions or start inference.
2. Use the local Photon STATUS preview. Inspect `LOCAL_SIMULATION` and synthetic operating context; no carrier message is sent.
3. Evaluate local proposals. The frozen fixture should reject ineffective changes with zero benefit. Inspect actual local tool traces, assumptions and review status.
4. Run the local acceptance suite explicitly. Inspect the actual 15-case result and `LOCAL_DETERMINISTIC` label.
5. Remote controls are separate, require an operator token and explicit confirmation, and must remain disabled until account, recipient/model/environment and spending prerequisites are established. Failures stay visible. An accepted Photon request is not delivered; an executed remote evaluation may fail its checks.
6. Return to `#demo`; its computation and evidence remain independent. If the real backend fails, choose explicitly labeled saved replay or restore the backend; no automatic fixture success is permitted.

This walkthrough authorizes no real recipient, paid provider usage or deployment. See [current verification](../sponsors/LIVE-INTEGRATION-VERIFICATION.md).
