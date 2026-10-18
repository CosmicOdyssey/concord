# Factory Droid SDK — Autonomous Protocol Amendment Planning Agent

**Status:** `LIVE AND VERIFIED (LOCAL RUNTIME WITH @factory/droid-sdk v0.9.1 & RECURSIVE REFINEMENT)`  
**Remote Factory Cloud Auth:** `BLOCKED — CREDENTIALS OR ACCESS` (requires `FACTORY_API_KEY`; the local sandboxed agent runtime, official `@factory/droid-sdk` integration, bounded refinement loop, and human review gate are 100% functional and verified)

---

## 1. Overview and Problem

Clinical trials frequently face enrollment delays due to operational bottlenecks: slow institutional review, prolonged site contracting, lack of patient travel support, or coordinator staffing shortages.

The **Factory Droid SDK Protocol Planning Agent** examines a trial's operational parameters, identifies bottlenecks, evaluates candidate amendments through simulation, scores outcomes against Chalk, and presents auditable recommendations for human medical and statistical review.

## 2. Invariants and Clinical Safety Boundaries

1. **Immutable Clinical Protocol:** Droid is strictly prohibited from mutating canonical clinical protocols or live research datasets.
2. **No Medical Criteria Relaxation:** Medically necessary inclusion or exclusion criteria (e.g. ECOG performance, active organ dysfunction, untreated brain metastases) can never be relaxed autonomously.
3. **Operational Levers Only:** Automated optimizations are strictly restricted to operational levers:
   - Site activation lag (streamlined contracting).
   - Monthly outreach budget (patient recruitment & travel support stipends).
   - Shared site coordinator capacity (dedicated research nurse slots).
4. **Bounded Recursive Refinement:** Operates in an evaluate-and-revise loop bounded to 2–3 iterations.
5. **Human-in-the-Loop Gate:** All generated recommendations default to `PENDING_HUMAN_REVIEW` and require formal sponsor/investigator approval before any adoption.

## 3. Sandboxed Tool Definitions

Droid executes computational work using typed, sandboxed tools rather than unrestricted shell or filesystem access:

```typescript
// Registered Droid Tools
[
  "inspect_protocol",
  "identify_operational_bottlenecks",
  "simulate_operational_variant",
  "evaluate_with_chalk"
]
```

- `inspect_protocol(trial_id)`: Reads trial eligibility, schedule of assessments, routine care vs sponsor-paid items, and safety invariants.
- `identify_operational_bottlenecks(trial_id)`: Detects candidate operational parameters without touching medical inclusion criteria.
- `simulate_operational_variant(trial_id, activation_lag, outreach_budget)`: Evaluates candidate parameters using Concord's simulation engine.
- `evaluate_with_chalk(simulation_result)`: Evaluates outcomes against objective Chalk budget compliance and truthfulness scorers.

## 4. Recursive Refinement Execution Loop

```
                     ┌────────────────────────┐
                     │ 1. Inspect Protocol &  │
                     │  Identify Bottlenecks  │
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
        ┌───────────►│  Generate Operational  │
        │            │   Amendment Proposal   │
        │            └───────────┬────────────┘
        │                        │
        │                        ▼
        │            ┌────────────────────────┐
        │            │ 2. Run Engine Variant  │
        │            │       Simulation       │
        │            └───────────┬────────────┘
        │                        │
        │                        ▼
        │            ┌────────────────────────┐
        │            │  3. Score Outcome with │
        │            │       Chalk Evals      │
        │            └───────────┬────────────┘
        │                        │
        │                        ▼
┌───────┴────────┐   ┌────────────────────────┐
│ Feedback Loop  │   │ 4. Evaluate Stop Gate: │
│ (Max 3 Iters)  │◄──┤  Converged, Budget OK, │
└────────────────┘   │  or Constraint Failed? │
                     └───────────┬────────────┘
                                 │ (Stop Condition Met)
                                 ▼
                     ┌────────────────────────┐
                     │ 5. Generate Auditable  │
                     │ Recommendation Artifact│
                     └───────────┬────────────┘
                                 │
                                 ▼
                     ┌────────────────────────┐
                     │ 6. Human Review Gate   │
                     │  (Pending Sign-Off)    │
                     └────────────────────────┘
```

## 5. Verification & Testing

Run Droid unit tests:

```sh
backend/.venv/bin/python -m pytest backend/tests/test_agent_droid.py -v
```

Execute Droid optimization via API:

```sh
curl -X POST http://127.0.0.1:8000/api/agents/droid/run \
  -H "Content-Type: application/json" \
  -d '{"trial_id": "NCT05800015", "max_iterations": 3}'
```

Submit Human-in-the-Loop Review:

```sh
curl -X POST http://127.0.0.1:8000/api/agents/droid/review \
  -H "Content-Type: application/json" \
  -d '{
    "recommendation_id": "droid-rec-...",
    "decision": "APPROVED",
    "reviewer_notes": "Operational parameter adjustments verified; clinical protocol unchanged."
  }'
```
