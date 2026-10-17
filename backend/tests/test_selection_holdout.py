"""Pure helpers of the optimizer's-curse holdout (no DB needed)."""
import math

import numpy as np

from concord.analysis import selection_holdout as H


def _block(ratio, med=1.0, faster=0.5, slower=0.1, worst=0.0):
    return {"ratio": ratio, "median_speedup": med, "share_faster": faster, "share_slower": slower,
            "worst_slowdown_months": worst}


def test_geomean_and_retained_share():
    assert math.isclose(H._gm([1.21, 1.0]), 1.1)
    assert H._gm([1.2, None]) is None
    dirs = [{side: {c: _block(r) for c in H.COMPARISONS} for side, r in (("in_sample", 1.44), ("held_out", 1.2))}
            for _ in range(2)]
    s = H.summarize(dirs)[H.HEADLINE]
    assert math.isclose(s["in_sample"]["ratio_geomean"], 1.44)
    assert math.isclose(s["held_out"]["ratio_geomean"], 1.2)
    assert math.isclose(s["retained_log_share"], 0.5)


def test_bootstrap_ratio_brackets_point_estimate():
    rng = np.random.default_rng(1)
    base = rng.uniform(10, 30, 60)
    new = base / rng.uniform(1.0, 1.5, 60)
    mv = np.ones(60, dtype=bool)
    lo, hi = H.bootstrap_ratio(base, new, mv)
    point = base.sum() / new.sum()
    assert lo < point < hi
    assert H.bootstrap_ratio(base, new, np.zeros(60, dtype=bool)) is None


def test_alloc_round_trip(tmp_path):
    from concord.analysis import selection_holdout as H
    rng = np.random.default_rng(2)
    X = {"actual": rng.random((7, 4)) < 0.3, "coord": rng.random((7, 4)) < 0.3, "indep": np.zeros((7, 4), bool)}
    mv = np.array([True, False, True, True])
    H._ALLOC.clear()
    H.keep_alloc("US-Northeast.full", X, mv)
    H.keep_alloc("US-Northeast.alternating.A->B", X, ~mv)
    path = tmp_path / "a.npz"
    np.savez_compressed(path, **H._ALLOC)
    out = H.load_alloc(path)
    assert set(out) == {"US-Northeast.full", "US-Northeast.alternating.A->B"}
    for k, x in X.items():
        assert np.array_equal(out["US-Northeast.full"]["x"][k], x)
    assert np.array_equal(out["US-Northeast.full"]["movable"], mv)
    assert np.array_equal(out["US-Northeast.alternating.A->B"]["movable"], ~mv)


def test_floor_alignment_matches_effective_rates_rule():
    from concord.analysis import selection_holdout_posthoc as PH
    table = {"label": "t", "unseen": 0.1, "lam_mean": {"a": 0.5, "b": 0.05, "c": 0.4, "d": 0.3},
             "lam_eff": {"a": 0.1, "b": 0.05, "c": 0.4, "d": 0.3}, "n_hist": {"a": 1, "b": 2, "c": 5, "d": 0}}
    al = PH.aligned_table(table, 0.2)
    assert al["unseen"] == 0.2
    assert al["lam_eff"] == {"a": 0.2, "b": 0.05, "c": 0.4, "d": 0.2}
    fs = PH.floor_stats(table, ["a", "b", "c", "d", "zz"])
    assert fs["n_sites_with_history"] == 3 and math.isclose(fs["median_uncapped_candidate_rate"], 0.4)
    assert math.isclose(fs["relative_floor"], 0.25)
