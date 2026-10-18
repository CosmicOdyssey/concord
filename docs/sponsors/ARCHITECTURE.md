# Concord Sponsor Agent Integration Architecture

**Version:** 1.0.0  
**Branch:** `antigravity/concord-sponsor-agents`  
**Base:** `15f232a1e12e5f5279d6300625265247d8b0d708` (`main` with merged PR #3)  

## 1. System Overview

Concord integrates three sponsor-challenge technologies on top of its verified scientific optimization engine:

1. **Photon 2.0 (Front A):** SMS clinical trial operations agent providing real-time, concise portfolio summaries, feasibility checks, and budget alerts to trial managers and site investigators over mobile SMS.
2. **Chalk (Front B):** Deterministic evaluation engine providing versioned datasets, task functions, and objective multi-attribute scoring (budget compliance, capacity limits, exact solver agreement, missing information handling, prompt injection defense).
3. **Factory Droid SDK (Front C):** Autonomous, constrained protocol-improvement agent operating in an auditable recursive refinement loop (Proposal → Simulation → Chalk Evaluation → Feedback → Revised Proposal) with sandboxed tools and human-in-the-loop approval gates.

```
                      ┌────────────────────────────────────────┐
                      │              Mobile Users              │
                      └───────────────────┬────────────────────┘
                                          │ SMS (Twilio / Webhook)
                                          ▼
                      ┌────────────────────────────────────────┐
                      │          Photon 2.0 Agent              │
                      │  - Webhook & HMAC Verification         │
                      │  - Allowlisting & Idempotency Cache    │
                      │  - Concise Formatted SMS Responses     │
                      └───────────────────┬────────────────────┘
                                          │
    ┌─────────────────────────────────────┴─────────────────────────────────────┐
    │                                                                           │
    ▼                                                                           ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────────────┐
│     Factory Droid Protocol Agent      │   │            Chalk Evaluations           │
│  - Sandboxed Tool Runtime             │   │  - 12 Versioned Scenarios              │
│  - Bounded Recursive Refinement       │◄──┤  - 10 Independent Scorers              │
│  - Safety & Constraint Guardrails     │──►│  - Hard Safety Violation Enforcement   │
│  - Human-in-the-Loop Review Gate      │   │  - Deterministic Reproducibility       │
└───────────────────┬───────────────────┘   └────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│                       Concord Core Engine Boundary (Read-Only)                     │
│  - Portfolio Simulation (concord.portfolio_simulation)                             │
│  - Hybrid Exact/Heuristic Solver (concord.portfolio_search)                        │
│  - Financial Ledgers & CMS Benchmarks (concord.terms, concord.ratecard)             │
│  - Public Context from ClinicalTrials.gov (NCT05800015 / NCT05286580)              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Security & Safety Invariants

1. **Engine Immutability:** External agents interact with Concord through typed request/response boundaries (`concord.agents.boundary`). The underlying scientific optimization algorithms and financial ledger calculations remain unmodified.
2. **Clinical Safety Boundary:** The Factory Droid agent is strictly prohibited from mutating canonical clinical protocols or relaxing medically necessary eligibility criteria. Automated optimizations are constrained to operational parameters (site activation timing, recruitment outreach capacity, scheduling burden). Any eligibility modifications are flagged `UNVALIDATED` and require explicit human medical review.
3. **No Phantom Round-Trips:** In the absence of live provider credentials (e.g. unverified carrier numbers or external cloud tokens), the system provides fully verifiable offline test harnesses and transparently reports execution state as `IMPLEMENTED — NOT LIVE VERIFIED` or `BLOCKED — CREDENTIALS OR ACCESS`, never faking live remote calls.
4. **Zero PHI & Secret Isolation:** No Protected Health Information is ingested, processed, or logged. API credentials are read exclusively from environment variables and never committed to version control.
5. **Pitch Independence:** The original 180-second Regeneron demo (`#demo`) is isolated from agent endpoints and remains fully functional and deterministic.
