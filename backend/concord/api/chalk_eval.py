"""FastAPI Router for Chalk Evaluations."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from concord.evals.chalk_eval import (
    CHALK_SCENARIOS,
    DATASET_SHA256,
    DATASET_VERSION,
    EvaluationReport,
    run_chalk_evaluations,
    runtime_sources_current,
)

router = APIRouter(prefix="/api/evals/chalk", tags=["Chalk Evaluations"])

_LATEST_REPORT: EvaluationReport | None = None


@router.get("/scenarios")
def get_scenarios() -> dict:
    """Return the versioned independent local acceptance scenarios."""
    return {
        "dataset_version": DATASET_VERSION,
        "dataset_sha256": DATASET_SHA256,
        "scenarios_count": len(CHALK_SCENARIOS),
        "scenarios": [s.model_dump() for s in CHALK_SCENARIOS],
    }


@router.post("/run")
def trigger_evaluation_run() -> dict:
    """Execute complete Chalk evaluation suite and store result."""
    global _LATEST_REPORT
    try:
        report = run_chalk_evaluations()
    except ValueError as error:
        if str(error) == "Source changed since runtime start; restart before evaluation":
            raise HTTPException(409, detail={"code": "STALE_RUNTIME", "message": str(error)}) from error
        raise
    _LATEST_REPORT = report
    return report.model_dump()


@router.get("/latest")
def get_latest_evaluation() -> dict:
    """Return the most recent evaluation report or report that no run has been executed."""
    global _LATEST_REPORT
    if _LATEST_REPORT is None:
        raise HTTPException(404, "No local evaluation run yet; use explicit POST /api/evals/chalk/run")
    if not runtime_sources_current() or _LATEST_REPORT.dataset_sha256 != DATASET_SHA256:
        raise HTTPException(409, detail={"code": "STALE_EVALUATION", "message": "Saved evaluation does not match current sources or dataset; restart and explicitly rerun."})
    return _LATEST_REPORT.model_dump()


@router.get('/status')
def provider_status():
    from concord.evals.chalk_connection import get_chalk_status
    return get_chalk_status()


from fastapi import Header
from concord.agents.sponsor_runtime import require_operator
from concord.agents.boundary import StrictModel


class RemoteEvaluationRequest(StrictModel):
    confirm_live: bool


@router.post('/remote-run')
def trigger_remote_evaluation(req: RemoteEvaluationRequest, x_concord_operator_token: str | None = Header(None)):
    require_operator(x_concord_operator_token, 'CONCORD_ALLOW_CHALK_RUN')
    if not req.confirm_live:
        raise HTTPException(422, 'Explicit remote-compute confirmation required')
    from concord.evals.chalk_connection import run_remote_chalk
    try:
        return run_remote_chalk()
    except Exception:
        # Do not surface API tokens, deployment logs or partial local results as
        # a completed remote run. Existing local receipt remains independent.
        raise HTTPException(503, {'code': 'CHALK_REMOTE_EXECUTION_FAILED',
            'message': 'Remote execution not verified. Check environment, Evaluations, authenticated Function queue, dataset storage and optional dependencies. No completed remote result claimed.'}) from None
