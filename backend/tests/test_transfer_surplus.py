"""Invariants of the task C compensation rule (no data needed)."""
import numpy as np

from concord.analysis import transfer_surplus as TS


def _T(base, new):
    return {"indep": np.array(base, float), "coord_free": np.array(new, float), "actual": np.array(base, float)}


def test_surplus_and_scheme_balance_and_no_loser():
    T = _T([10, 20, 30, 500], [5, 12, 33, 501])  # trial 3 is background (implausible, T > 120)
    M = np.array([True, True, True, False])
    s = TS.surplus(T, ("coord_free", "indep"), M, ~M, T["actual"])
    assert (s["G"], s["L"], s["L_bg"]) == (13.0, 3.0, 1.0)
    assert s["S"] == 9.0 and s["L_bg_flagged_implausible"] == 1.0
    credit, payment = TS.scheme(T["indep"] - T["coord_free"], M, ~M)
    assert np.isclose(credit.sum(), payment.sum()) and np.isclose(credit.sum(), 4.0)
    net = (T["indep"] - T["coord_free"]) + credit - payment
    assert (net >= -1e-12).all()
    assert np.isclose(s["compensation"]["share_of_gains_winners_keep"], 9 / 13)


def test_no_scheme_without_surplus_and_ex_post():
    d_in = np.array([2.0, -3.0])
    M = np.array([True, True])
    assert TS.scheme(d_in, M, ~M) is None
    d_in = np.array([4.0, -1.0])
    summary, net = TS.ex_post(d_in, np.array([1.0, -2.0]), M, ~M)
    # winner pays 1 and realizes 1 -> 0; loser gets 1 and realizes -2 -> -1
    assert summary["worse_off_movable"] == 1 and np.isclose(summary["shortfall_total"], 1.0)
    assert np.isclose(summary["realized_total_surplus"], -1.0) and np.allclose(net, [0.0, -1.0])
