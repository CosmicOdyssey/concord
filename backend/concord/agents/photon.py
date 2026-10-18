"""Local SMS commands and explicitly gated Photon API dispatch.

The external JSON webhook is a Concord HMAC contract, not a claim of provider
compatibility. It requires a configured secret, sender allowlist and fresh signed
timestamp. No message body or phone number is persisted in the dedupe journal.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any, Literal
import uuid

from pydantic import Field
from concord.agents.boundary import StrictModel
from concord import hackharvard_demo as demo
from concord.paths import DATA_DIR


class InboundSMSMessage(StrictModel):
    message_id: str = Field(min_length=1, max_length=128)
    sender: str = Field(pattern=r"^\+[1-9][0-9]{6,14}$")
    recipient: str = Field(pattern=r"^\+[1-9][0-9]{6,14}$")
    body: str = Field(min_length=1, max_length=1600)
    timestamp: str | None = None


class SMSProcessingResult(StrictModel):
    message_id: str
    status: Literal["LOCAL_SIMULATION", "UNAUTHORIZED", "DUPLICATE", "ERROR", "ACCEPTED", "DELIVERY_UNKNOWN"]
    reply_text: str
    sender: str
    action_taken: str
    is_simulated_data: bool = True
    real_engine_data: dict[str, Any] | None = None
    delivery_note: str
    request_id: str = Field(default_factory=lambda: f"sms-{uuid.uuid4().hex}")
    scenario_id: str = "hackharvard-bundled-portfolio"
    computed_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    provider_status: str = "NOT_INVOKED"
    data_mode: str = "SYNTHETIC_OPERATIONAL_ASSUMPTIONS"
    provider_message_id: str | None = None
    delivery_mode: str = "LOCAL_SIMULATION"
    dispatched_at: str | None = None
    runtime_receipt: dict[str, Any] | None = None


class PhotonSMSAgent:
    def __init__(self, store_path: Path | None = None):
        self._webhook_secret = os.environ.get("PHOTON_WEBHOOK_SECRET")
        self._api_key = os.environ.get("PHOTON_API_KEY")
        self._allowed_senders = {s.strip() for s in os.environ.get("PHOTON_ALLOWED_SENDERS", "").split(",") if s.strip()}
        self._store_path = store_path or DATA_DIR / "work" / "sponsors" / "photon-dedupe.sqlite3"
        self._processed_count = 0
        self._project_id = os.environ.get("PHOTON_PROJECT_ID")
        self._space_id = os.environ.get("PHOTON_SPACE_ID")
        self._agent_user_id = os.environ.get("PHOTON_AGENT_USER_ID")
        self._last_receipt = None

    def verify_signature(self, payload: bytes, signature_header: str | None) -> bool:
        if not self._webhook_secret or not signature_header:
            return False
        received = signature_header.removeprefix("sha256=")
        expected = hmac.new(self._webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
        return len(received) == 64 and all(c in "0123456789abcdef" for c in received) and hmac.compare_digest(expected, received)

    def is_sender_allowed(self, sender: str) -> bool:
        return sender in self._allowed_senders

    def is_fresh(self, timestamp: str | None) -> bool:
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return False
            return abs(time.time() - parsed.timestamp()) <= 300
        except (AttributeError, TypeError, ValueError):
            return False

    def _result(self, message: InboundSMSMessage, status: str, reply: str, action: str, engine=None):
        return SMSProcessingResult(message_id=message.message_id, status=status, reply_text=reply,
            sender=message.sender, action_taken=action, real_engine_data=engine,
            delivery_note="Processed locally; no provider request, outbound queue or carrier delivery occurred.")

    def process_message(self, message: InboundSMSMessage, *, channel: Literal["LOCAL_SIMULATION", "WEBHOOK"] = "LOCAL_SIMULATION") -> SMSProcessingResult:
        # Authorize before any cached response can be retrieved. Local simulation is
        # explicitly separate from authenticated external webhooks and cannot dispatch.
        if channel == "WEBHOOK" and (not self.is_sender_allowed(message.sender) or not self.is_fresh(message.timestamp)):
            return self._result(message, "UNAUTHORIZED", "Concord: Access denied.", "REJECT_UNAUTHORIZED_OR_STALE")
        key = hashlib.sha256(json.dumps([channel, message.sender, message.recipient, message.message_id]).encode()).hexdigest()
        digest = hashlib.sha256(message.model_dump_json().encode()).hexdigest()
        self._store_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # A transaction reserves the id before computing; separate API workers cannot
        # execute the same authenticated message concurrently. Persist only redacted output.
        with sqlite3.connect(self._store_path, timeout=30) as db:
            os.chmod(self._store_path, 0o600)
            db.execute("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL, created REAL NOT NULL)")
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM messages WHERE created < ?", (time.time() - 86400,))
            prior = db.execute("SELECT digest,result FROM messages WHERE id=?", (key,)).fetchone()
            if prior:
                if not hmac.compare_digest(prior[0], digest):
                    return self._result(message, "ERROR", "Concord: Message id reused with different inputs.", "REJECT_ID_CONFLICT")
                result = SMSProcessingResult.model_validate_json(prior[1])
                result.sender = message.sender
                result.message_id = message.message_id
                result.status = "DUPLICATE"
                result.action_taken = "IDEMPOTENT_REPLAY"
                return result
            command = message.body.strip().upper()
            try:
                if command == "HELP":
                    result = self._result(message, "LOCAL_SIMULATION", "Concord local commands: STATUS, DETAILS, OPTIMIZE, HELP. Synthetic operational assumptions only.", "HELP")
                elif command in {"STATUS", "DETAILS"}:
                    base = demo.baseline()
                    b = base["baseline"]
                    engine = {"makespan": b["expected_makespan"], "commitment": b["ledger"]["budget_commitment"], "feasible": b["feasible"], "fixture_sha256": base["fixture_sha256"]}
                    reply = f"Concord: Synthetic portfolio simulation. Modeled completion: {engine['makespan']:.2f} mo; commitment ${engine['commitment']:,.0f}; feasible: {engine['feasible']}. Not a clinical forecast."
                    result = self._result(message, "LOCAL_SIMULATION", reply, command, engine)
                elif command == "OPTIMIZE":
                    computed = demo.optimize()
                    run = computed["result"]
                    chosen = next(s for s in run["scenarios"] if s["id"] == "F")
                    engine = {"recommended_makespan": chosen["expected_makespan"], "run_id": run["run_id"], "feasible": chosen["feasible"], "optimization": chosen["optimization"], "fixture_sha256": computed["fixture_sha256"]}
                    reply = f"Concord: Synthetic hybrid search executed. F: {chosen['expected_makespan']:.2f} mo; {chosen['optimization']['status']}; feasible: {chosen['feasible']}. Exactness, when admitted, covers finite assumed draws only; no clinical acceleration evidence."
                    result = self._result(message, "LOCAL_SIMULATION", reply, "OPTIMIZE", engine)
                else:
                    result = self._result(message, "ERROR", "Concord: Unsupported command. Only STATUS, DETAILS, OPTIMIZE and HELP are accepted; no unverified clinical savings claims are generated.", "REJECT_UNSUPPORTED_COMMAND")
            except Exception:
                # Do not echo internal paths, payloads, phone numbers or provider errors.
                result = self._result(message, "ERROR", "Concord: Local computation failed. No result or delivery is claimed.", "COMPUTATION_FAILED")
            redacted = result.model_copy(update={"sender": "REDACTED", "message_id": "REDACTED"})
            db.execute("INSERT INTO messages VALUES (?,?,?,?)", (key, digest, redacted.model_dump_json(), time.time()))
            self._processed_count += 1
            return result


    def get_readiness_status(self):
        required = {"PHOTON_API_KEY": self._api_key, "PHOTON_PROJECT_ID": self._project_id,
                    "PHOTON_SPACE_ID": self._space_id, "PHOTON_AGENT_USER_ID": self._agent_user_id}
        missing = [name for name, value in required.items() if not value]
        return {"readiness": "MISSING_CREDENTIALS" if missing else "CONFIGURED_UNVERIFIED",
                "provider_status": "IMPLEMENTED_UNVERIFIED", "missing_prerequisites": missing,
                "auth_status": "NOT_VERIFIED", "last_verified_receipt": self._last_receipt,
                "delivery_verified": False, "outbound_enabled": os.environ.get("CONCORD_ALLOW_PHOTON_SEND") == "1"}

    def send_reply(self, message: InboundSMSMessage) -> SMSProcessingResult:
        """One explicitly approved configured-space send; HTTP acceptance is not delivery.

        A durable reservation precedes the request. An ambiguous timeout never
        retries automatically; an operator must reconcile it in Photon first.
        Official beta API: https://photon.codes/blog/introducing-photon-2.0
        """
        import re
        import httpx
        if os.environ.get("CONCORD_ALLOW_PHOTON_SEND") != "1":
            raise ValueError("Photon send authorization is disabled")
        if not self._api_key or not re.fullmatch(r"pho_prj_[A-Za-z0-9_-]+", self._project_id or "") or not re.fullmatch(r"pho_spc_[A-Za-z0-9_-]+", self._space_id or "") or not re.fullmatch(r"pho_usr_[A-Za-z0-9_-]+", self._agent_user_id or ""):
            raise ValueError("Photon project, approved space, agent user and credential must be configured")
        result = self.process_message(message)
        if result.status not in {"LOCAL_SIMULATION", "DUPLICATE"}:
            return result
        key = hashlib.sha256(json.dumps([self._project_id, self._space_id, self._agent_user_id, message.message_id]).encode()).hexdigest()
        body_digest = hashlib.sha256(result.reply_text.encode()).hexdigest()
        with sqlite3.connect(self._store_path, timeout=30) as db:
            db.execute("CREATE TABLE IF NOT EXISTS sends (id TEXT PRIMARY KEY, digest TEXT NOT NULL, receipt TEXT)")
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT digest,receipt FROM sends WHERE id=?", (key,)).fetchone()
            if prior:
                if prior[0] != body_digest:
                    raise ValueError("Send idempotency conflict")
                receipt = json.loads(prior[1]) if prior[1] else {"status": "DELIVERY_UNKNOWN", "provider_message_id": None}
                return result.model_copy(update={"status": receipt["status"], "provider_message_id": receipt.get("provider_message_id"), "dispatched_at": receipt.get("dispatched_at"), "runtime_receipt": receipt, "delivery_mode": "PHOTON_API", "provider_status": "API_ACCEPTED" if receipt["status"] == "ACCEPTED" else "UNKNOWN", "delivery_note": "Replayed send receipt; no additional provider request. API acceptance does not establish carrier delivery."})
            db.execute("INSERT INTO sends VALUES (?,?,NULL)", (key, body_digest))
        receipt = {"status": "DELIVERY_UNKNOWN", "provider_message_id": None, "dispatched_at": datetime.now(timezone.utc).isoformat()}
        try:
            with httpx.Client(timeout=10., follow_redirects=False, trust_env=False) as client:
                response = client.post(f"https://api.photon.codes/v1/projects/{self._project_id}/messages",
                    headers={"Authorization": f"Bearer {self._api_key}", "Idempotency-Key": key},
                    json={"spaceId": self._space_id, "senderId": self._agent_user_id,
                          "content": {"type": "text", "format": "plain", "text": result.reply_text}})
            if response.status_code in {200, 201, 202}:
                data = response.json()
                ident = data.get("id")
                if isinstance(ident, str) and ident:
                    receipt.update(status="ACCEPTED", provider_message_id=ident)
            receipt["http_status"] = response.status_code
        except (httpx.HTTPError, ValueError, TypeError):
            pass
        with sqlite3.connect(self._store_path, timeout=30) as db:
            db.execute("UPDATE sends SET receipt=? WHERE id=?", (json.dumps(receipt), key))
        self._last_receipt = receipt
        return result.model_copy(update={"status": receipt["status"], "provider_message_id": receipt["provider_message_id"],
            "dispatched_at": receipt["dispatched_at"], "delivery_mode": "PHOTON_API", "runtime_receipt": receipt,
            "provider_status": "API_ACCEPTED" if receipt["status"] == "ACCEPTED" else "UNKNOWN",
            "delivery_note": "Photon API accepted the request; carrier delivery remains UNVERIFIED." if receipt["status"] == "ACCEPTED" else "Provider outcome unknown or rejected; no automatic retry or delivery claim."})


photon_agent = PhotonSMSAgent()
