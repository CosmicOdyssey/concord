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
