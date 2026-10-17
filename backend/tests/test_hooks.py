"""Shared hooks for holdout analyses. Skipped when the data has not been built."""
import sqlite3

import numpy as np
import pytest

from concord.paths import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")


def test_full_history_rate_table_reproduces_default_build():
    from concord import service
    from concord.model import recruitment as R
    con = sqlite3.connect(DB_PATH)
    p = service.Params(max_trials=40)
    b_db = service.build(p)
    b_tab = service.build(p, rates=R.fit_rate_table(con))
    assert np.array_equal(b_db.inst.lam, b_tab.inst.lam)
    assert np.array_equal(b_db.inst.movable, b_tab.inst.movable)
    T = service.rescore(b_tab, {"actual": b_db.x_actual})["actual"]
    assert np.allclose(T, service.core.evaluate(b_db.inst, b_db.x_actual))


def test_splits_partition_history():
    from concord.model import recruitment as R
    con = sqlite3.connect(DB_PATH)
    for split in (R.split_alternating(con), R.split_time(con)):
        assert set(split.values()) == {"A", "B"}
        a = sum(v == "A" for v in split.values())
        assert abs(a - (len(split) - a)) <= 0.02 * len(split)
