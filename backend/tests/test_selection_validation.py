"""Observed-outcome check and calibrated re-scoring: fast unit tests, plus a check of the committed output."""
import json
import math

import numpy as np
import pytest

from concord.analysis.selection_calibrated import calibrate
from concord.analysis.selection_validation import _ols_hc1
from concord.paths import FINDINGS_DIR


def test_ols_hc1_recovers_known_slope():
    rng = np.random.default_rng(0)
    n = 2000
    x = rng.normal(size=n)
    c = rng.normal(size=n)
    y = 0.4 * x + 0.2 * c + rng.normal(scale=0.5, size=n)
    X = np.column_stack([x, np.ones(n), c])
    b, se = _ols_hc1(y, X)
    assert abs(b[0] - 0.4) < 4 * se[0]
    assert 0 < se[0] < 0.05


def _table():
    return {"label": "toy", "lam_eff": {"a": 0.1, "b": 1.0, "c": 10.0, "z": 5.0},
            "n_hist": {"a": 3, "b": 4, "c": 5, "z": 0}, "unseen": 0.05}


def test_calibrate_identity_and_flattening():
    us = {"a", "b", "c", "z"}
    t = _table()
    same = calibrate(t, 1.0, us)
    for s, v in t["lam_eff"].items():
        assert same["lam_eff"][s] == pytest.approx(v)
    assert same["unseen"] == pytest.approx(t["unseen"])
    flat = calibrate(t, 0.0, us)
    m = np.mean([math.log(0.1), math.log(1.0), math.log(10.0)])  # only sites with fitted history set m
    assert flat["calibration"]["m"] == pytest.approx(m)
    assert all(v == pytest.approx(math.exp(m)) for v in flat["lam_eff"].values())


def test_calibrate_shrinks_log_differences_by_b():
    t = calibrate(_table(), 0.5, {"a", "b", "c"})
    assert math.log(t["lam_eff"]["c"] / t["lam_eff"]["a"]) == pytest.approx(0.5 * math.log(10.0 / 0.1))


@pytest.mark.skipif(not (FINDINGS_DIR / "selection_validation.json").exists(), reason="validation not run")
def test_committed_validation_output_is_consistent():
    d = json.loads((FINDINGS_DIR / "selection_validation.json").read_text(encoding="utf-8"))
    for key in ("primary", "industry_phase2_3"):
        r = d[key]
        assert r["n"] > 100
        assert r["ci95"][0] < r["slope"] < r["ci95"][1]
        assert 0 <= r["p"] <= 1
