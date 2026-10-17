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
