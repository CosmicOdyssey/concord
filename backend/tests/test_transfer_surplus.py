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


def test_like_for_like_rows_surplus_screens_movable_only():
    rows = [
        {"nct_id": "a", "movable": True, "delta": 10.0, "delta_held": 400.0, "T_registered_held": 500.0},
        {"nct_id": "b", "movable": True, "delta": 5.0, "delta_held": 4.0, "T_registered_held": 50.0},
        {"nct_id": "c", "movable": True, "delta": -2.0, "delta_held": -3.0, "T_registered_held": 60.0},
        {"nct_id": "d", "movable": False, "delta": -1.0, "delta_held": 2.0, "T_registered_held": 900.0},
    ]
    full = TS.rows_surplus(rows, "delta", screened=False)
    scr = TS.rows_surplus(rows, "delta", screened=True)
    held_scr = TS.rows_surplus(rows, "delta_held", screened=True)
    assert (full["G"], full["L"], full["L_bg"], full["S"]) == (15.0, 2.0, 1.0, 12.0)
    assert (scr["G"], scr["S"], scr["trials_counted"]) == (5.0, 2.0, 2)  # background loss kept when screened
    assert (held_scr["G"], held_scr["L"], held_scr["L_bg"], held_scr["S"]) == (4.0, 3.0, 0.0, 1.0)
    setting = {"directions": [{"choose": "A", "score": "B", "per_trial": {"coord_free_vs_actual": rows}}]}
    lfl = TS.like_for_like(setting)["coord_free_vs_actual"]
    assert lfl["by_direction"][0]["largest_held_minus_half"][0]["nct_id"] == "a"
    assert lfl["by_direction"][0]["largest_held_minus_half"][0]["screened_out"] is True
    assert abs(lfl["mean"]["held_out_change_screened"] - (1.0 / 2.0 - 1)) < 1e-12
