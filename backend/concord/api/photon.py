"""Explicit local simulation and a fail-closed Concord JSON webhook contract."""
from __future__ import annotations

import json
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field, ValidationError
from concord.agents.boundary import StrictModel
from concord.agents.sponsor_runtime import require_operator
from concord.agents.photon import InboundSMSMessage, photon_agent

router = APIRouter(prefix="/api/agents/photon", tags=["Photon local adapter"])


class SimulateSMSRequest(StrictModel):
    sender: str = Field("+16175550199", pattern=r"^\+[1-9][0-9]{6,14}$")
    body: str = Field("STATUS", min_length=1, max_length=1600)
    message_id: str | None = Field(None, min_length=1, max_length=128)


@router.post("/webhook")
async def handle_photon_webhook(request: Request, x_photon_signature: str | None = Header(None, alias="X-Photon-Signature")) -> dict:
    if not photon_agent._webhook_secret or not photon_agent._allowed_senders:
        raise HTTPException(503, "Webhook disabled: configure signing secret and exact sender allowlist")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 8192:
            raise HTTPException(413, "Webhook payload too large")
    raw = bytes(chunks)
    if not photon_agent.verify_signature(raw, x_photon_signature):
        raise HTTPException(401, "Invalid webhook signature")
    try:
        message = InboundSMSMessage.model_validate(json.loads(raw))
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(422, "Invalid normalized webhook payload") from None
    if not photon_agent.is_sender_allowed(message.sender) or not photon_agent.is_fresh(message.timestamp):
        raise HTTPException(403, "Unauthorized sender or stale signed timestamp")
    return photon_agent.process_message(message, channel="WEBHOOK").model_dump()


@router.post("/simulate")
def simulate_sms(sim: SimulateSMSRequest) -> dict:
    import uuid
    message = InboundSMSMessage(message_id=sim.message_id or f"sim-{uuid.uuid4().hex}",
        sender=sim.sender, recipient="+16175550200", body=sim.body)
    return photon_agent.process_message(message).model_dump()


@router.get("/status")
def get_agent_status() -> dict:
    return {
        "provider": "Photon local SMS command adapter",
        **photon_agent.get_readiness_status(),
        "live_api_configured": False,
        "credential_present": bool(photon_agent._api_key),
        "webhook_secret_configured": bool(photon_agent._webhook_secret),
        "allowlist_active": bool(photon_agent._allowed_senders),
        "allowed_senders_count": len(photon_agent._allowed_senders),
        "messages_processed_count": photon_agent._processed_count,
        "channel": "LOCAL_SIMULATION; optional authenticated Concord JSON webhook, not verified Photon compatibility",
        "engine_scope": "Concord synthetic portfolio computation",
        "data_disclosure": "Synthetic operations; no carrier delivery or validated clinical forecast.",
    }


class SendSMSRequest(SimulateSMSRequest):
    message_id: str = Field(min_length=1, max_length=128)
    confirm_live: bool


@router.post("/send")
def send_computed_reply(req: SendSMSRequest, x_concord_operator_token: str | None = Header(None)) -> dict:
    require_operator(x_concord_operator_token, "CONCORD_ALLOW_PHOTON_SEND")
    if not req.confirm_live:
        raise HTTPException(422, "Explicit live-send confirmation required")
    try:
        message = InboundSMSMessage(message_id=req.message_id, sender=req.sender, recipient="+16175550200", body=req.body)
        return photon_agent.send_reply(message).model_dump()
    except ValueError:
        raise HTTPException(503, {"code": "PHOTON_CONFIGURATION_OR_IDEMPOTENCY_ERROR", "required": ["PHOTON_API_KEY", "PHOTON_PROJECT_ID", "PHOTON_SPACE_ID", "PHOTON_AGENT_USER_ID"]}) from None
