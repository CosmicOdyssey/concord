"""Photon 2.0 SMS Webhook and Management Endpoints."""
from __future__ import annotations

import json
from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from concord.agents.photon import InboundSMSMessage, SMSProcessingResult, photon_agent

router = APIRouter(prefix="/api/agents/photon", tags=["Photon SMS Agent"])


class SimulateSMSRequest(BaseModel):
    """Local simulation request for testing Photon SMS workflow."""
    sender: str = Field("+16175550199", pattern=r"^\+?[0-9\-\s\(\)]{7,25}$")
    body: str = Field("STATUS", min_length=1, max_length=1600)
    message_id: str | None = None


@router.post("/webhook")
async def handle_photon_webhook(
    request: Request,
    x_photon_signature: str | None = Header(None, alias="X-Photon-Signature"),
    x_twilio_signature: str | None = Header(None, alias="X-Twilio-Signature"),
) -> dict:
    """Handle inbound webhook from Photon 2.0 SMS service."""
    raw_body = await request.body()
    signature = x_photon_signature or x_twilio_signature
    
    if not photon_agent.verify_signature(raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        data = json.loads(raw_body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Malformed JSON payload: {e}")

    # Map standard or Twilio-style webhook fields
    message = InboundSMSMessage(
        message_id=data.get("message_id") or data.get("MessageSid") or data.get("id", "msg-test"),
        sender=data.get("sender") or data.get("From") or data.get("from", "+16175550100"),
        recipient=data.get("recipient") or data.get("To") or data.get("to", "+16175550200"),
        body=data.get("body") or data.get("Body") or data.get("text", "STATUS"),
        timestamp=data.get("timestamp"),
    )

    result = photon_agent.process_message(message)
    return result.model_dump()


@router.post("/simulate")
def simulate_sms(sim: SimulateSMSRequest) -> dict:
    """Simulate an SMS interaction directly without external network webhook."""
    import uuid
    msg_id = sim.message_id or f"sim-{uuid.uuid4().hex[:12]}"
    message = InboundSMSMessage(
        message_id=msg_id,
        sender=sim.sender,
        recipient="+16175550200",
        body=sim.body,
    )
    result = photon_agent.process_message(message)
    return result.model_dump()


@router.get("/status")
def get_agent_status() -> dict:
    """Get current Photon SMS agent operational status."""
    status_info = photon_agent.get_readiness_status()
    status_info.update({
        "provider": "Photon 2.0 SMS Operations Agent",
        "live_api_configured": bool(photon_agent._api_key),
        "phone_number_configured": bool(photon_agent._photon_number),
        "webhook_secret_configured": bool(photon_agent._webhook_secret),
        "allowlist_active": bool(photon_agent._allowed_senders),
        "channel": "SMS / Webhook",
        "engine_scope": "Concord Portfolio Simulation & Hybrid Search",
    })
    return status_info
