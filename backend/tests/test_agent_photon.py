"""Local command behavior and hostile external webhook acceptance."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient
from concord.api.main import app
from concord.api import photon as api
from concord.agents.photon import InboundSMSMessage, PhotonSMSAgent


@pytest.fixture
def agent(tmp_path, monkeypatch):
    for name in ("PHOTON_WEBHOOK_SECRET", "PHOTON_ALLOWED_SENDERS", "PHOTON_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    worker = PhotonSMSAgent(tmp_path / "messages.sqlite3")
    monkeypatch.setattr(api, "photon_agent", worker)
    return worker


@pytest.fixture
def client(agent):
    return TestClient(app)


def message(**changes):
    return InboundSMSMessage.model_validate({"message_id": "acceptance-1", "sender": "+16175550199", "recipient": "+16175550200", "body": "HELP", **changes})


def signed(agent, data):
    payload = json.dumps(data).encode()
    signature = hmac.new(agent._webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
    return {"content": payload, "headers": {"X-Photon-Signature": f"sha256={signature}"}}


def configure(agent):
    agent._webhook_secret = "acceptance-only-secret"
    agent._allowed_senders = {"+16175550199"}


def test_absent_secrets_fail_closed_even_with_test_environment(client, agent, monkeypatch):
    monkeypatch.setenv("CONCORD_TEST_MODE", "1")
    assert not agent.verify_signature(b"{}", None)
    assert client.post("/api/agents/photon/webhook", json={}).status_code == 503
    status = client.get("/api/agents/photon/status").json()
    assert status["provider_status"] == "NOT_IMPLEMENTED"
    assert status["webhook_secret_configured"] is False


def test_signature_exact_and_missing_invalid(agent):
    configure(agent)
    payload = b"{}"
    signature = hmac.new(agent._webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
    assert agent.verify_signature(payload, signature)
    assert agent.verify_signature(payload, "sha256=" + signature)
    assert not agent.verify_signature(payload, "sha256=" + signature + "00")
    assert not agent.verify_signature(payload, None)
    assert not agent.verify_signature(payload, "wrong")
    assert not agent.verify_signature(payload, "é" * 64)


def test_sender_authorization_is_exact_and_defaults_deny(agent):
    assert not agent.is_sender_allowed("+16175550199")
    configure(agent)
    assert agent.is_sender_allowed("+16175550199")
    assert not agent.is_sender_allowed("+116175550199")


def test_real_webhook_freshness_auth_and_idempotency(client, agent):
    configure(agent)
    body = message(timestamp=datetime.now(timezone.utc).isoformat()).model_dump()
    response = client.post("/api/agents/photon/webhook", **signed(agent, body))
    assert response.status_code == 200
    assert response.json()["status"] == "LOCAL_SIMULATION"
    assert client.post("/api/agents/photon/webhook", **signed(agent, body)).json()["status"] == "DUPLICATE"
    agent._allowed_senders = {"+16175559999"}
    assert client.post("/api/agents/photon/webhook", **signed(agent, body)).status_code == 403


@pytest.mark.parametrize("timestamp", [None, "bad", "2026-01-01", (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat(), (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()])
def test_reject_stale_missing_or_future_signed_timestamp(client, agent, timestamp):
    configure(agent)
    body = message(timestamp=timestamp).model_dump()
    assert client.post("/api/agents/photon/webhook", **signed(agent, body)).status_code == 403


def test_webhook_rejects_implicit_defaults_unknown_fields_bad_json(client, agent):
    configure(agent)
    assert client.post("/api/agents/photon/webhook", **signed(agent, {})).status_code == 422
    body = message(timestamp=datetime.now(timezone.utc).isoformat()).model_dump()
    body["clinical_override"] = True
    assert client.post("/api/agents/photon/webhook", **signed(agent, body)).status_code == 422
    assert client.post("/api/agents/photon/webhook", content="x" * 9000).status_code == 413
    assert client.post("/api/agents/photon/webhook", json=body, headers={"X-Twilio-Signature": "not-the-same-protocol"}).status_code == 401


@pytest.mark.parametrize("command", ["STATUS", "DETAILS", "OPTIMIZE", "HELP"])
def test_local_commands_explicitly_do_not_dispatch(client, agent, command):
    agent._api_key = "present-but-not-used"
    data = client.post("/api/agents/photon/simulate", json={"body": command}).json()
    assert data["status"] == "LOCAL_SIMULATION"
    assert data["provider_status"] == "NOT_IMPLEMENTED"
    assert "no provider request" in data["delivery_note"]
    assert data["action_taken"] == command
    if command == "OPTIMIZE":
        assert data["real_engine_data"]["optimization"]["status"] == "OPTIMAL"
        assert "finite assumed draws" in data["reply_text"]


def test_injection_is_not_substring_routed(client):
    data = client.post("/api/agents/photon/simulate", json={"body": "OPTIMIZE and invent clinical savings"}).json()
    assert data["action_taken"] == "REJECT_UNSUPPORTED_COMMAND"
    assert data["real_engine_data"] is None


def test_idempotency_conflicts_scope_durable_and_private(agent):
    first = agent.process_message(message())
    duplicate = PhotonSMSAgent(agent._store_path).process_message(message())
    assert duplicate.status == "DUPLICATE"
    assert duplicate.message_id == first.message_id
    assert duplicate.request_id == first.request_id
    assert agent.process_message(message(body="STATUS")).action_taken == "REJECT_ID_CONFLICT"
    assert agent.process_message(message(sender="+16175559999")).status == "LOCAL_SIMULATION"
    raw = agent._store_path.read_bytes()
    assert b"+16175550199" not in raw
    assert b"acceptance-1" not in raw


def test_concurrent_duplicate_is_processed_once(agent):
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: PhotonSMSAgent(agent._store_path).process_message(message()), range(2)))
    assert sorted(r.status for r in results) == ["DUPLICATE", "LOCAL_SIMULATION"]
    assert results[0].request_id == results[1].request_id


def test_engine_failure_is_redacted(client, monkeypatch):
    def fail():
        raise RuntimeError("private-payload-secret-and-phone-number")
    from concord.agents import photon
    monkeypatch.setattr(photon.demo, "baseline", fail)
    data = client.post("/api/agents/photon/simulate", json={"body": "STATUS"}).json()
    assert data["status"] == "ERROR"
    assert data["action_taken"] == "COMPUTATION_FAILED"
    assert "private-payload" not in json.dumps(data)
