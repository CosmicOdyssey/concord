# HackHarvard Sponsor Challenges — Live Demonstration Walkthrough

**Target Audience:** HackHarvard Judges for **Photon 2.0**, **Chalk**, and **Factory Droid SDK** sponsor prizes.  
**Preservation Notice:** This walkthrough is strictly separate from the 180-second Regeneron pitch (`#demo`) to ensure zero disruption to the primary competition submission.

---

## 1. Quick Start

Ensure the Concord server is running:

```sh
# Terminal 1: Backend
backend/.venv/bin/uvicorn concord.api.main:app --port 8000

# Terminal 2: Frontend
npm --prefix frontend run dev
```

Navigate to: `http://localhost:5173/#sponsor-agents` (or click the **Sponsor Agents** tab in the navigation bar).

---

## 2. Sequential Step-by-Step Demonstration

### Step 1: Mobile Operations with Photon 2.0 (Front A)
1. In the **Photon 2.0 SMS Console**, observe the simulated phone interface connected to `+1 617-555-0200`.
2. Click **Send STATUS** (or type `STATUS` into the text box and press Enter).
   - Observe the live query to the Concord engine.
   - Response appears: *"Concord: Portfolio simulation complete. Budget: $3.0M. Allocation feasible. Modeled completion time: 15.13 months. Reply DETAILS for constraint breakdown."*
3. Click **Send DETAILS**.
   - Observe the detailed hospital and ledger telemetry returned in mobile SMS format.
4. Click **Send OPTIMIZE**.
   - Triggers the hybrid allocation solver and returns the recommended allocation (9.24 months).
5. Note the telemetry panel: HMAC-SHA256 signature verification, idempotency deduplication by `message_id`, and sender allowlist enforcement.

### Step 2: Autonomous Protocol Optimization with Factory Droid (Front C)
1. Scroll down to the **Factory Droid SDK: Autonomous Protocol Amendment Agent** card.
2. Note the selected study: `NCT05800015 (Regeneron Cemiplimab NSCLC Study)`.
3. Click **Run Factory Droid Optimization**.
4. Observe the **Recursive Refinement Loop** in action:
   - **Iteration 1:** Droid calls `inspect_protocol`, identifies clinical safety invariants, calls `identify_operational_bottlenecks`, and proposes reducing site activation lag from 3.0 to 2.0 months. It simulates the variant (makespan 13.93 mo) and scores it against Chalk (budget compliant).
   - **Iteration 2:** Droid refines the outreach budget to $15k/mo to balance speed vs budget ceiling. Simulation reports 13.33 months. Chalk gives 100% compliance score.
5. Inspect the **Hard Safety Guardrail Banner**:
   - Confirms: *"No live clinical inclusion/exclusion criteria were mutated."* Medically necessary exclusions (untreated brain metastases, organ failure) remain strictly protected.
6. Expand **View Sandboxed Tool Traces**:
   - Inspect the exact structured audit log of tool invocations.
7. Exercise the **Human-in-the-Loop Review Gate**:
   - Status begins as `PENDING_HUMAN_REVIEW`.
   - Click **Approve Operational Amendment**.
   - Status updates live to `APPROVED`.

### Step 3: Deterministic Agent Assessment with Chalk (Front B)
1. Scroll to the **Chalk Evaluation Engine** card.
2. Click **Run Full Chalk Evaluation Suite (12 Scenarios)**.
3. Observe the results across all 12 test cases:
   - **Financial Feasibility:** Adequate ($3.0M) passes; Infeasible ($500k) correctly triggers budget violation.
   - **Operational Constraints:** Hospital capacity exhaustion correctly rejected.
   - **Financial Conservation:** Insurer payment independence verified (Decision 24).
   - **Clinical Safety Invariant:** Autonomous attempt to relax brain metastasis exclusion caught and rejected (0 hard safety violations).
   - **Solver Truthfulness:** Exact solver agreement validated on small instance (`OPTIMAL`, 0 gap); heuristic labeling validated on large instance.
   - **Adversarial Robustness:** Prompt injection attempting to persuade the agent to fabricate clinical savings is refused!
4. Note the dataset version: `concord-eval-v1.2.0` (SHA: `e3b0c442...`).

---

## 3. Honest Limitations & Sponsor Prize Disclosures

- **Photon 2.0:** Live carrier dispatch requires `PHOTON_API_KEY`. Webhook ingestion, signature verification, idempotency caching, and Concord engine responses are 100% functional.
- **Chalk:** Remote cloud telemetry sync requires `CHALK_API_TOKEN`. The local deterministic evaluation harness with 12 canonical test cases and 6 objective scorers is 100% functional.
- **Factory Droid SDK:** Remote Factory cloud authorization requires `FACTORY_API_KEY`. The official `@factory/droid-sdk` (v0.9.1) integration, sandboxed tool runtime, recursive refinement loop, and human review gate are 100% functional.
- **Scientific Integrity:** Exploratory operational simulations only. Modeled completion durations are not clinical trial forecasts.
