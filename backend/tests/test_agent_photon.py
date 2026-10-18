"""Tests for Photon 2.0 SMS Clinical Operations Agent."""
import hashlib
import hmac
import pytest
from fastapi.testclient import TestClient

from concord.api.main import app
from concord.agents.photon import InboundSMSMessage, photon_agent


@pytest.fixture
def client():
    return TestClient(app)


def test_photon_status_endpoint(client):
    res = client.get("/api/agents/photon/status")
    assert res.status_code == 200
    data = res.json()
    assert data["provider"] == "Photon 2.0 SMS Operations Agent"
    assert "channel" in data
    assert "data_disclosure" in data


def test_photon_signature_verification():
    secret = "test-secret-123"
    photon_agent._webhook_secret = secret
    payload = b'{"message_id": "m1", "sender": "+16175550199", "body": "STATUS"}'
    
    valid_sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert photon_agent.verify_signature(payload, valid_sig) is True
    assert photon_agent.verify_signature(payload, f"sha256={valid_sig}") is True
    assert photon_agent.verify_signature(payload, "invalid_sig_0000") is False


def test_photon_allowlist_enforcement():
    photon_agent._allowed_senders = {"+16175550199"}
    assert photon_agent.is_sender_allowed("+16175550199") is True
    assert photon_agent.is_sender_allowed("+16175559999") is False

    # Reset allowlist for subsequent tests
    photon_agent._allowed_senders = set()


def test_photon_simulate_status_command(client):
    res = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "STATUS",
        "message_id": "test-sim-001"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ("DELIVERED", "QUEUED_OFFLINE")
    assert "Concord: Portfolio simulation complete" in data["reply_text"]
    assert "Budget: $3.0M" in data["reply_text"]
    assert data["is_simulated_data"] is True


def test_photon_simulate_details_command(client):
    res = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "DETAILS",
        "message_id": "test-sim-002"
    })
    assert res.status_code == 200
    data = res.json()
    assert "Concord Details:" in data["reply_text"]
    assert "Commitment:" in data["reply_text"]


def test_photon_simulate_optimize_command(client):
    res = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "OPTIMIZE",
        "message_id": "test-sim-003"
    })
    assert res.status_code == 200
    data = res.json()
    assert "Hybrid optimization executed" in data["reply_text"]
    assert "Recommended:" in data["reply_text"]


def test_photon_simulate_help_command(client):
    res = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "HELP",
        "message_id": "test-sim-004"
    })
    assert res.status_code == 200
    data = res.json()
    assert "Concord Ops Agent:" in data["reply_text"]
    assert "STATUS" in data["reply_text"]
    assert "DETAILS" in data["reply_text"]


def test_photon_idempotent_duplicate_handling(client):
    msg_id = "test-idempotent-unique-99"
    res1 = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "STATUS",
        "message_id": msg_id
    })
    assert res1.status_code == 200
    assert res1.json()["status"] in ("DELIVERED", "QUEUED_OFFLINE")

    # Second call with identical message_id must be handled idempotently
    res2 = client.post("/api/agents/photon/simulate", json={
        "sender": "+16175550199",
        "body": "STATUS",
        "message_id": msg_id
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "DUPLICATE"
    assert data2["action_taken"] == "IDEMPOTENT_REPLAY"
    assert data2["reply_text"] == res1.json()["reply_text"]


def test_photon_timestamp_replay_tolerance():
    from datetime import datetime, timezone
    secret = "test-secret-123"
    photon_agent._webhook_secret = secret
    payload = b'{"message_id": "m-ts-test", "sender": "+16175550199", "body": "STATUS"}'
    valid_sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    now_ts = str(datetime.now(timezone.utc).timestamp())
    stale_ts = str(datetime.now(timezone.utc).timestamp() - 600.0) # 10 min ago (> 5 min)

    # Fresh timestamp passes
    assert photon_agent.verify_signature(payload, valid_sig, timestamp_header=now_ts) is True
    # Stale timestamp (>300s) fails
    assert photon_agent.verify_signature(payload, valid_sig, timestamp_header=stale_ts) is False


def test_photon_live_dispatch_and_receipt(monkeypatch):
    class MockResponse:
        status_code = 200
        def json(self):
            return {"id": "msg_photon_live_12345", "status": "sent"}

    class MockClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, url, json, headers):
            assert "messages" in url
            assert headers["Authorization"].startswith("Bearer ")
            return MockResponse()

    monkeypatch.setattr("httpx.Client", MockClient)
    photon_agent._api_key = "live_photon_test_key"
    photon_agent._photon_number = "+16175550100"

    res = photon_agent.process_message(InboundSMSMessage(
        message_id="msg-live-dispatch-test",
        sender="+16175550199",
        recipient="+16175550100",
        body="STATUS",
    ))

    assert res.status == "DELIVERED"
    assert res.provider_message_id == "msg_photon_live_12345"
    assert res.delivery_mode == "LIVE_CARRIER"
    assert "Dispatched via Photon API" in res.delivery_note

    # Verify readiness status transitions to CONNECTED_AND_VERIFIED
    status = photon_agent.get_readiness_status()
    assert status["readiness"] == "CONNECTED_AND_VERIFIED"
    assert status["last_verified_receipt"]["provider_message_id"] == "msg_photon_live_12345"

    # Reset credentials
    photon_agent._api_key = None
    photon_agent._photon_number = None
    photon_agent._last_receipt = None

