"""FastAPI Endpoints for Factory Droid Protocol Planning Agent."""
from __future__ import annotations

from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from concord.agents.droid import DroidRecommendation, execute_droid_protocol_agent

router = APIRouter(prefix="/api/agents/droid", tags=["Factory Droid Protocol Agent"])

_STORED_RECOMMENDATIONS: dict[str, DroidRecommendation] = {}


class RunDroidRequest(BaseModel):
    """Execution request for Factory Droid."""
    trial_id: str = Field("NCT05800015", pattern=r"^[A-Za-z0-9_-]{1,40}$")
    max_iterations: int = Field(3, ge=1, le=5)


class ReviewRecommendationRequest(BaseModel):
    """Human review decision on a proposed protocol amendment."""
    recommendation_id: str
    decision: Literal["APPROVED", "REJECTED"]
    reviewer_notes: str = Field(min_length=1, max_length=500)


@router.post("/run")
def run_droid_agent(req: RunDroidRequest) -> dict:
    """Execute Factory Droid protocol amendment optimization."""
    rec = execute_droid_protocol_agent(trial_id=req.trial_id, max_iterations=req.max_iterations)
    _STORED_RECOMMENDATIONS[rec.recommendation_id] = rec
    return rec.model_dump()


@router.get("/recommendations")
def list_recommendations() -> list[dict]:
    """List all generated Droid recommendations and their approval status."""
    return [rec.model_dump() for rec in _STORED_RECOMMENDATIONS.values()]


@router.get("/recommendations/{rec_id}")
def get_recommendation(rec_id: str) -> dict:
    """Get a specific Droid recommendation by ID."""
    if rec_id not in _STORED_RECOMMENDATIONS:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return _STORED_RECOMMENDATIONS[rec_id].model_dump()


@router.post("/review")
def review_recommendation(rev: ReviewRecommendationRequest) -> dict:
    """Submit human review decision for an agent proposal."""
    if rev.recommendation_id not in _STORED_RECOMMENDATIONS:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    
    rec = _STORED_RECOMMENDATIONS[rev.recommendation_id]
    rec.human_approval_status = rev.decision
    return {
        "recommendation_id": rec.recommendation_id,
        "human_approval_status": rec.human_approval_status,
        "reviewer_notes": rev.reviewer_notes,
        "message": f"Recommendation successfully marked {rev.decision}."
    }
