import numpy as np
import pytest

from concord.allocator import core


def tiny(o=0.8, k=(1, 1, 2)):
    """3 sites, 2 trials. Site 0 is the famous one everyone wants."""
    return core.Instance(
        lam=np.array([3.0, 1.0, 1.0]), a=np.full(3, 2.0), k=np.array(k), f=np.array([1.0, 0.8]),
        N=np.array([20.0, 15.0]), n_max=np.array([2, 2]), w=np.ones(2),
        o=np.array([[1.0, o], [o, 1.0]]), feasible=np.ones((3, 2), dtype=bool),
    )


def test_state_incremental_matches_fresh():
    inst = tiny(k=(2, 2, 2))
    rng = np.random.default_rng(0)
    st = core.State(inst)
    for _ in range(40):
        s, p = rng.integers(inst.S), rng.integers(inst.P)
        predicted = st.objective() + st.delta_toggle(s, p)
        st.toggle(s, p)
        fresh = core.State(inst, st.x)
        assert st.objective() == pytest.approx(predicted)
        assert st.objective() == pytest.approx(fresh.objective())
        np.testing.assert_allclose(st.R, fresh.R)


@pytest.mark.parametrize("o,k", [(0.8, (1, 1, 2)), (0.2, (2, 1, 1)), (1.0, (2, 2, 2)), (0.0, (1, 1, 1))])
def test_coordinate_reaches_exhaustive_optimum(o, k):
    inst = tiny(o, k)
    _, best = core.exhaustive(inst)
    x, stats = core.coordinate(inst, time_limit=2)
    assert stats["objective"] == pytest.approx(best, rel=1e-6)


def test_coordinated_never_worse_than_independent():
    rng = np.random.default_rng(1)
    S, P = 30, 8
    o = rng.uniform(0.2, 0.9, (P, P))
    inst = core.Instance(lam=rng.gamma(0.8, 1.0, S), a=np.full(S, 6.0), k=rng.integers(1, 3, S),
                         f=rng.uniform(0.2, 1.5, P), N=rng.uniform(10, 60, P), n_max=np.full(P, 5), w=np.ones(P),
                         o=(o + o.T) / 2, feasible=np.ones((S, P), dtype=bool))
    x_ind = core.independent(inst)
    x_coord, _ = core.coordinate(inst, x0=x_ind, time_limit=2)
    s = core.summarize(inst, x_ind, x_coord)
    assert s["poa"] >= 1.0 - 1e-9
    assert (x_coord.sum(axis=1) <= inst.k).all() and (x_coord.sum(axis=0) <= inst.n_max).all()


def test_independent_piles_onto_best_site():
    inst = tiny(k=(2, 1, 2))
    x = core.independent(inst)
    assert x[0].all()  # both trials pick the famous site


def _random(seed=3, S=40, P=10, beta=1.0):
    rng = np.random.default_rng(seed)
    o = rng.uniform(0.1, 0.9, (P, P))
    return core.Instance(lam=rng.gamma(0.8, 1.0, S), a=np.zeros(S), k=rng.integers(1, 3, S),
                         f=rng.uniform(0.3, 1.5, P), N=rng.uniform(10, 60, P), n_max=np.full(P, 4), w=np.ones(P),
                         o=(o + o.T) / 2, feasible=np.ones((S, P), dtype=bool), beta=beta)


@pytest.mark.parametrize("beta", [1.0, 0.14])
def test_no_loser_caps_hold_and_still_improve(beta):
    inst = _random(beta=beta)
    x_ind = core.independent(inst)
    T_ind = core.evaluate(inst, x_ind)
    x, stats = core.coordinate(inst.replace(caps=T_ind), x0=x_ind, time_limit=2)
    T = core.evaluate(inst, x)
    assert (T <= T_ind + 1e-6).all()
    assert T.sum() <= T_ind.sum() + 1e-9


def test_background_trials_do_not_move():
    inst = _random()
    x0 = core.independent(inst)
    movable = np.ones(inst.P, dtype=bool)
    movable[:3] = False
    bg = x0.copy()
    bg[:, movable] = False
    x, _ = core.coordinate(inst.replace(movable=movable), x0=bg, time_limit=1)
    assert (x[:, ~movable] == x0[:, ~movable]).all()


def test_no_loser_matches_exhaustive_on_tiny():
    inst = tiny(0.8, (2, 1, 2))
    x_ind = core.independent(inst)
    capped = inst.replace(caps=core.evaluate(inst, x_ind))
    _, best = core.exhaustive(capped)
    _, stats = core.coordinate(capped, x0=x_ind, time_limit=2)
    assert stats["objective"] == pytest.approx(best, rel=1e-6)
