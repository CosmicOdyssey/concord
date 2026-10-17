"""Side-by-side table of two selection_holdout.py runs (e.g. before and after a change of trial set).

    python -m concord.analysis.selection_holdout_compare --a <abs>/holdout_preE.json --b <abs>/holdout.json \
        [--label-a pre-E --label-b post-E] [--out <abs>/holdout_compare.json]

No solving: reads the saved summaries. Use it to report a rerun next to the run it replaces (task G
must not mix numbers from different runs).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from concord.analysis import selection_holdout as H


def rows(res: dict) -> dict:
    out = {"n_movable_full_data": res["full_data"]["n_movable"], "n_trials": res["full_data"]["n_trials"]}
    for c in H.COMPARISONS:
        r = {"full_in": res["full_data"]["in_sample"][c]["ratio"]}
        for sp, s in res["splits"].items():
            r[f"{sp}_in"] = s["summary"][c]["in_sample"]["ratio_geomean"]
            r[f"{sp}_out"] = s["summary"][c]["held_out"]["ratio_geomean"]
            r[f"{sp}_out_share_slower"] = s["summary"][c]["held_out"]["share_slower_mean"]
        out[c] = r
    return out


def compare(a: dict, b: dict) -> dict:
    return {name: {"a": rows(a["scenarios"][name]), "b": rows(b["scenarios"][name])}
            for name in a["scenarios"] if name in b["scenarios"]}


def main() -> None:
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--label-a", default="a")
    ap.add_argument("--label-b", default="b")
    ap.add_argument("--out")
    x = ap.parse_args()
    A, B = (json.loads(Path(p).read_text()) for p in (x.a, x.b))
    res = compare(A, B)
    f = lambda v: "-" if v is None else f"{v:.3f}"
    for name, r in res.items():
        print(f"\n== {name} ==  movable {r['a']['n_movable_full_data']} ({x.label_a}) / "
              f"{r['b']['n_movable_full_data']} ({x.label_b}); deterministic {A.get('deterministic')} / "
              f"{B.get('deterministic')}")
        for c in H.COMPARISONS:
            ka = r["a"][c]
            cells = []
            for k in ka:
                if k.endswith("share_slower"):
                    continue
                cells.append(f"{k} {f(ka[k])} / {f(r['b'][c].get(k))}")
            print(f"{c:31s} " + " | ".join(cells))
    if x.out:
        Path(x.out).write_text(json.dumps({"label_a": x.label_a, "label_b": x.label_b, "a": x.a, "b": x.b,
                                           "scenarios": res}, indent=1))
        print("->", x.out)


if __name__ == "__main__":
    main()
