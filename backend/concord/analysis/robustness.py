"""Try to break the result: congestion elasticity x low-history rule.

    python -m concord.analysis.robustness --region US-Northeast

Writes data/robustness/<region>[_<sponsor>][_<as_of>].json, which the API serves.
"""

from __future__ import annotations

import argparse
import json

from concord import service
from concord.paths import DATA_DIR


def path_for(p: service.Params):
    parts = [p.region] + ([p.sponsor.replace(" ", "_")] if p.sponsor else []) + ([p.as_of] if p.as_of else [])
    return DATA_DIR / "robustness" / ("_".join(parts) + ".json")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="US-Northeast")
    ap.add_argument("--sponsor", default=None)
    ap.add_argument("--as-of", default=None)
    ap.add_argument("--time-limit", type=float, default=4.0)
    a = ap.parse_args()
    p = service.Params(region=a.region, sponsor=a.sponsor, as_of=a.as_of, time_limit=a.time_limit)
    out = service.robustness(p)
    path = path_for(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    for r in out["rows"]:
        h, c = r["coord_vs_actual"], r["coordination_no_loser_vs_indep"]
        print(f"{r['beta_label']:22s} beta={r['beta']:.3f} {r['low_history']:8s} {r['universe']:10s} "
              f"no-loser vs registered {h['ratio']:.2f}x (median {h['median_speedup']:.2f}x) | "
              f"selection {r['indep_vs_actual']['ratio']:.2f}x | coordination no-loser {c['ratio']:.3f}x | "
              f"coordination free {r['coord_free_vs_indep']['ratio']:.3f}x slower {r['coord_free_vs_indep']['share_slower']:.2f}")
    print("->", path)


if __name__ == "__main__":
    main()
