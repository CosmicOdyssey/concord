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
