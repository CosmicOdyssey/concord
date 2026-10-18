"""FastAPI Router for Chalk Evaluations."""
from __future__ import annotations

from fastapi import APIRouter
from concord.evals.chalk_eval import (
    CHALK_SCENARIOS,
    DATASET_SHA256,
    DATASET_VERSION,
    EvaluationReport,
    run_chalk_evaluations,
)

router = APIRouter(prefix="/api/evals/chalk", tags=["Chalk Evaluations"])

_LATEST_REPORT: EvaluationReport | None = None


@router.get("/scenarios")
def get_scenarios() -> dict:
    """Return the canonical 12 Chalk evaluation scenarios."""
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
    report = run_chalk_evaluations()
    _LATEST_REPORT = report
    return report.model_dump()


@router.get("/latest")
def get_latest_evaluation() -> dict:
    """Return the most recent evaluation report or generate a fresh one."""
    global _LATEST_REPORT
    if _LATEST_REPORT is None:
        _LATEST_REPORT = run_chalk_evaluations()
    return _LATEST_REPORT.model_dump()
