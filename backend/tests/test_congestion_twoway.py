"""Two-way (trial, site) clustered variance of concord.analysis.congestion on small synthetic data."""

import numpy as np

from concord.analysis.congestion import _ols_cluster, _ols_twoway, twoway_vcov


def _data(n: int, seed: int = 0):
    rng = np.random.default_rng(seed)
    X = np.column_stack([rng.normal(size=n), np.ones(n), rng.normal(size=n)])
    y = X @ np.array([-0.3, 1.0, 0.5]) + rng.normal(size=n)
    return X, y, rng


def test_equals_trial_clustered_when_every_trial_has_its_own_site_trial_level():
    X, y, _ = _data(60)
    trials = np.array([f"T{i}" for i in range(60)])
    b1, se1, _ = _ols_cluster(y, X, trials)
    b2, se2, info = _ols_twoway(y, X, trials, np.arange(60), np.array([f"S{i}" for i in range(60)]))
    assert np.allclose(b1, b2)
    assert np.allclose(se1, se2, rtol=1e-10, atol=0)
    assert info["clusters_site"] == info["clusters_trial_site"] == 60


def test_equals_trial_clustered_when_every_trial_has_its_own_site_row_level_weighted():
    # 20 trials with 1-4 rows each, all of a trial's rows at a site no other trial uses.
    X, y, rng = _data(1)
    reps = rng.integers(1, 5, size=20)
    trials = np.repeat([f"T{i}" for i in range(20)], reps)
    X, y, rng = _data(len(trials), seed=1)
    w = rng.uniform(0.2, 1.0, size=len(trials))
    sites = np.array([t.replace("T", "S") for t in trials])
    _, se1, _ = _ols_cluster(y, X, trials, w)
    _, se2, _ = _ols_twoway(y, X, trials, np.arange(len(trials)), sites, w)
    assert np.allclose(se1, se2, rtol=1e-10, atol=0)


def test_equals_site_clustered_when_each_trial_is_one_observation_at_one_site():
    # V_trial and V_trial&site are then the same matrix, so V = V_site.
    X, y, rng = _data(80, seed=2)
    trials = np.array([f"T{i}" for i in range(80)])
    sites = np.array([f"S{i}" for i in rng.integers(0, 12, size=80)])
    _, se_site, _ = _ols_cluster(y, X, sites)
    _, se2, _ = _ols_twoway(y, X, trials, np.arange(80), sites)
    assert np.allclose(se_site, se2, rtol=1e-10, atol=0)


def test_multi_membership_matches_brute_force():
    rng = np.random.default_rng(3)
    n, k = 9, 2
    scores = rng.normal(size=(n, k))
    bread = np.linalg.inv(np.array([[2.0, 0.3], [0.3, 1.5]]))
    trials = np.array([f"T{i}" for i in range(n)])
    member = {0: ["a", "b"], 1: ["a"], 2: ["b", "c"], 3: ["c"], 4: ["a", "c", "d"], 5: ["d"], 6: ["d"],
              7: ["b"], 8: ["a", "d"]}
    mo = np.array([i for i in range(n) for _ in member[i]])
    ms = np.array([s for i in range(n) for s in member[i]])
    V, info = twoway_vcov(scores, bread, trials, mo, ms)

    adj = lambda G: G / (G - 1) * (n - 1) / (n - k)  # noqa: E731
    M_t = sum(np.outer(scores[i], scores[i]) for i in range(n))
    site_sum = {s: sum(scores[i] for i in range(n) if s in member[i]) for s in "abcd"}
    M_s = sum(np.outer(v, v) for v in site_sum.values())
    M_ts = sum(len(member[i]) * np.outer(scores[i], scores[i]) for i in range(n))
    G_ts = sum(len(v) for v in member.values())
    expect = bread @ (adj(n) * M_t + adj(4) * M_s - adj(G_ts) * M_ts) @ bread
    ev, vec = np.linalg.eigh((expect + expect.T) / 2)
    expect = (vec * np.clip(ev, 0, None)) @ vec.T
    assert np.allclose(V, expect, rtol=1e-12, atol=1e-14)
    assert info["clusters_site"] == 4 and info["clusters_trial_site"] == G_ts
    assert np.linalg.eigvalsh(V).min() >= -1e-12


# ------------------------------------------------------------------------------ audit fixes


def _multi_membership(seed: int = 4, n: int = 120, n_sites: int = 15):
    """Trial-level data with multi-membership and a categorical control (three 'years')."""
    rng = np.random.default_rng(seed)
    year = rng.integers(0, 3, size=n)
    x = rng.normal(size=n)
    logn = rng.normal(size=n)
    y = -0.2 * x + 0.3 * logn + 0.5 * (year == 1) + rng.normal(size=n)
    member = [rng.choice(n_sites, size=rng.integers(1, 4), replace=False) for _ in range(n)]
    mo = np.array([i for i in range(n) for _ in member[i]])
    ms = np.array([f"S{s}" for i in range(n) for s in member[i]])
    return y, x, logn, year, mo, ms


def test_unclipped_coefficient_variance_does_not_depend_on_control_coding():
    from concord.analysis.congestion import _ols_twoway_full

    y, x, logn, year, mo, ms = _multi_membership()
    trials = np.array([f"T{i}" for i in range(len(y))])
    one = np.ones(len(y))
    codings = [
        np.column_stack([x, one, logn, year == 1, year == 2]),        # first year as base
        np.column_stack([x, one, logn, year == 0, year == 1]),        # last year as base
        np.column_stack([x, one, 0.1 * logn, year == 1, year == 2]),  # rescaled control
    ]
    fits = [_ols_twoway_full(y, X.astype(float), trials, mo, ms) for X in codings]
    b0, _, v0, _ = fits[0]
    for b, _, v, _ in fits[1:]:
        assert np.isclose(b[0], b0[0], rtol=0, atol=1e-12)
        assert np.isclose(v[0], v0[0], rtol=1e-9, atol=0)


def test_negative_unclipped_variance_falls_back_to_trial_clustered():
    from concord.analysis.congestion import CI_METHOD_NOT_ESTIMABLE, SE_METHOD, _combine

    x = np.array([0.0, 1.0])
    ok = _combine(-0.1, 0.05, 0.04 ** 2, 0.03, 10, 10, x, 20, {"negative_eigenvalues_clipped": 0})
    assert ok["twoway_estimable"] and ok["ci_method"] == SE_METHOD
    assert np.isclose(ok["se"], 0.05) and np.isclose(ok["se_twoway_unclipped"], 0.04)
    bad = _combine(-0.1, 0.05, -0.001, 0.03, 10, 10, x, 20, {"negative_eigenvalues_clipped": 3})
    assert not bad["twoway_estimable"] and bad["ci_method"] == CI_METHOD_NOT_ESTIMABLE
    assert np.isclose(bad["se"], 0.03) and bad["ci95"] == bad["ci95_trial_only"] and bad["p"] == bad["p_trial_only"]
    assert np.isclose(bad["se_twoway_clipped"], 0.05) and bad["se_twoway_unclipped"] is None


def test_default_beta_is_what_the_service_serves():
    import json
    import sqlite3

    from concord.analysis.congestion import default_beta
    from concord.service import congestion_beta

    for coef, ci in ((-0.087, [-0.291, 0.117]), (-0.3, [-0.5, -0.1]), (0.05, [-0.02, 0.12])):
        primary = {"coef": coef, "ci95": ci, "ci_method": "m"}
        con = sqlite3.connect(":memory:")
        con.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        con.execute("INSERT INTO meta VALUES ('congestion_test', ?)",
                    (json.dumps({"results": {"within_overlap": {**primary, "p": 0.5}}}),))
        served = congestion_beta(con)
        d = default_beta(primary, "note", [])
        assert np.isclose(d["value"], served["beta"]) and np.allclose(d["ci95"], served["ci95"])
        assert min(d["ci95"]) >= 0
