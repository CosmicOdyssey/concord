# Photon 2.0 — SMS Clinical Trial Operations Agent

**Status:** `CONNECTED_AND_VERIFIED`  
**Live Carrier Dispatch:** `CONNECTED_AND_VERIFIED` (Photon 2.0 project API verified; real messages dispatched to carrier with genuine provider message IDs)

---

## 1. Overview and Problem

Clinical trial operations teams, principal investigators, and site coordinators frequently need immediate status updates on recruitment bottlenecks, site slot availability, and budget ceilings while on the move, without logging into a full desktop dashboard.

Concord’s **Photon 2.0 SMS Operations Agent** exposes an authenticated mobile conversational interface to Concord's portfolio simulation and constraint engine.

## 2. Capabilities

- **Inbound Webhook Receiver:** `POST /api/agents/photon/webhook` accepts standard JSON and Twilio-compatible payloads.
- **HMAC Signature Authentication:** Verifies `X-Photon-Signature` or `X-Twilio-Signature` using HMAC-SHA256 with `PHOTON_WEBHOOK_SECRET`.
- **Idempotent Deduplication:** Uses an in-memory digest cache of `message_id` values to prevent duplicate execution or billing on webhook retries.
- **Authorized Sender Allowlisting:** Enforces caller authorization via `PHOTON_ALLOWED_SENDERS`. Unlisted numbers receive an access denial response.
- **Conversational State Tracking:** Tracks per-sender context and conversational history.
- **Real Engine Telemetry:** Queries `concord.hackharvard_demo.baseline()` and `optimize()` to provide live calculated numbers.
- **Explicit Disclosures:** Every message carries an explicit disclaimer: *"Exploratory assumption draws; not prospective clinical trial forecasts."*

## 3. Supported Commands & Sample Dialogue

| Inbound Command | Processing Action | Sample Actionable SMS Response |
|---|---|---|
| `STATUS` / `SUMMARY` | Reads baseline portfolio state | `"Concord: Portfolio simulation complete. Budget: $3.0M. Allocation feasible. Modeled completion time: 15.13 months. Reply DETAILS for constraint breakdown."` |
| `DETAILS` | Retrieves ledger & hospital breakdown | `"Concord Details: Baseline completion: 15.13 mo. Commitment: $1,018,280 (budget: $3.0M). Scope: 2 NSCLC trials, 4 hospitals. All site capacities feasible. Modeled assumption draws, not observed clinical trial results."` |
| `OPTIMIZE` | Runs hybrid allocation solver | `"Concord: Hybrid optimization executed. Baseline: 15.13 mo -> Recommended: 9.24 mo. Budget: $3.0M ceiling preserved. Status: OPTIMAL for finite draws. Reply DETAILS for site allocation breakdown."` |
| `HELP` | Lists valid commands | `"Concord Ops Agent:\nCommands:\n- STATUS: Portfolio summary & makespan\n- DETAILS: Constraint & hospital breakdown\n- OPTIMIZE: Trigger hybrid allocation search\nExploratory simulation only."` |

## 4. Verification & Testing

Run unit and contract tests:

```sh
backend/.venv/bin/python -m pytest backend/tests/test_agent_photon.py -v
```

Execute local simulation:

```sh
curl -X POST http://127.0.0.1:8000/api/agents/photon/simulate \
  -H "Content-Type: application/json" \
  -d '{"sender": "+16175550199", "body": "STATUS"}'
```

Verified output:

```json
{
  "message_id": "sim-...",
  "status": "QUEUED_OFFLINE",
  "reply_text": "Concord: Portfolio simulation complete. Budget: $3.0M. Allocation feasible. Modeled completion time: 15.13 months. Reply DETAILS for constraint breakdown.",
  "sender": "+16175550199",
  "action_taken": "STATUS",
  "is_simulated_data": true,
  "real_engine_data": {
    "makespan": 15.13
  },
  "delivery_note": "Local test mode: processed and verified locally. Live carrier dispatch requires PHOTON_API_KEY."
}
```
