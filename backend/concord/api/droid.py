"""Local proposals and authenticated review records; never clinical authorization."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import os
from threading import RLock
from typing import Literal
from fastapi import APIRouter, Header, HTTPException
from pydantic import Field
from concord.agents.boundary import StrictModel
from concord.agents.droid import DroidRecommendation, execute_droid_protocol_agent, execute_live_factory, get_droid_status
from concord.agents.sponsor_runtime import require_operator

router = APIRouter(prefix="/api/agents/droid", tags=["Local operational proposal evaluator"])
_STORED_RECOMMENDATIONS: dict[str, DroidRecommendation] = {}
_REVIEW_LOCK = RLock()


class RunDroidRequest(StrictModel):
    trial_id: str = Field("NCT05800015", pattern=r"^[A-Za-z0-9_-]{1,40}$")
    max_iterations: int = Field(3, ge=1, le=3)
    execution_mode: Literal["LOCAL", "LIVE_FACTORY"] = "LOCAL"


class ReviewRecommendationRequest(StrictModel):
    recommendation_id: str = Field(min_length=1, max_length=128)
    decision: Literal["APPROVED", "REJECTED"]
    reviewer_notes: str = Field(min_length=1, max_length=500)


@router.post("/run")
def run_droid_agent(req: RunDroidRequest, x_concord_operator_token: str | None = Header(None)) -> dict:
    if req.execution_mode == "LIVE_FACTORY":
        require_operator(x_concord_operator_token, "CONCORD_ALLOW_FACTORY_RUN")
    try:
        rec = (execute_live_factory if req.execution_mode == "LIVE_FACTORY" else execute_droid_protocol_agent)(trial_id=req.trial_id, max_iterations=req.max_iterations)
    except ValueError:
        if req.execution_mode == "LIVE_FACTORY":
            raise HTTPException(503, {"code": "FACTORY_EXECUTION_BLOCKED_OR_FAILED", "missing_prerequisites": get_droid_status()["missing_prerequisites"], "message": "No live Factory result claimed; check SDK, CLI, account/model and authorized usage."}) from None
        raise HTTPException(422, "Trial or operational proposal is unsupported") from None
    with _REVIEW_LOCK:
        if len(_STORED_RECOMMENDATIONS) >= 100:
            del _STORED_RECOMMENDATIONS[next(iter(_STORED_RECOMMENDATIONS))]
        _STORED_RECOMMENDATIONS[rec.recommendation_id] = rec
    return rec.model_dump()


@router.get("/recommendations")
def list_recommendations() -> list[dict]:
    with _REVIEW_LOCK:
        return [rec.model_dump() for rec in _STORED_RECOMMENDATIONS.values()]


@router.get("/recommendations/{rec_id}")
def get_recommendation(rec_id: str) -> dict:
    with _REVIEW_LOCK:
        if rec_id not in _STORED_RECOMMENDATIONS:
            raise HTTPException(404, "Recommendation not found")
        return _STORED_RECOMMENDATIONS[rec_id].model_dump()


@router.post("/review")
def review_recommendation(rev: ReviewRecommendationRequest, x_concord_review_token: str | None = Header(None)) -> dict:
    expected = os.environ.get("CONCORD_REVIEW_TOKEN")
    if not expected:
        raise HTTPException(503, "Authenticated review is disabled; configure CONCORD_REVIEW_TOKEN")
    if not x_concord_review_token or not hmac.compare_digest(x_concord_review_token.encode(), expected.encode()):
        raise HTTPException(401, "Reviewer authentication required")
    with _REVIEW_LOCK:
        rec = _STORED_RECOMMENDATIONS.get(rev.recommendation_id)
        if rec is None:
            raise HTTPException(404, "Recommendation not found")
        if rec.human_approval_status != "PENDING_HUMAN_REVIEW":
            raise HTTPException(409, "Proposal is not pending review")
        if rev.decision == "APPROVED" and rec.disposition != "PROPOSED_FOR_REVIEW":
            raise HTTPException(409, "Only a feasible beneficial proposal can be reviewed")
        rec.human_approval_status = rev.decision
        # Do not persist untrusted free text as evidence or present this as formal
        # clinical/sponsor sign-off. Local review records expire with this process.
        rec.review_audit.append({"decision": rev.decision, "recorded_at": datetime.now(timezone.utc).isoformat(),
                                 "scope": "AUTHENTICATED_LOCAL_REVIEW_ONLY",
                                 "notes_sha256": hashlib.sha256(rev.reviewer_notes.encode()).hexdigest()})
        return {"recommendation_id": rec.recommendation_id, "human_approval_status": rec.human_approval_status,
                "message": "Authenticated local review recorded; no clinical protocol or application was modified.",
                "review_audit": rec.review_audit}


@router.get("/status")
def provider_status():
    return get_droid_status()
