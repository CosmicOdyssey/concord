"""Render the research and pricing figures in docs/figures/ from data/work/figures/figure_data.json.

    backend/.venv/Scripts/python scripts/figures/export_figure_data.py   # data (needs the local DB and rate card)
    <python with matplotlib> scripts/figures/make_figures.py             # PNGs, 1500 x 1000 px

Palette (validated with the dataviz validator, light surface): teal #0E7AA8 and sand #C27A1C as the two series hues,
gray #8A97A3 for de-emphasis, ink/muted text tokens. Sand always marks an assumption or the model's prior belief.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402
from matplotlib.ticker import FixedLocator, FuncFormatter  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / "data" / "work" / "figures" / "figure_data.json").read_text(encoding="utf-8"))
OUT = ROOT / "docs" / "figures"

TEAL, SAND, GRAY = "#0E7AA8", "#C27A1C", "#8A97A3"
INK, MUTED, RULE, SURFACE = "#14212B", "#5A6975", "#DCE3E8", "#FFFFFF"

plt.rcParams.update({
    "font.family": "Segoe UI", "font.size": 10, "text.color": INK,
    "axes.edgecolor": RULE, "axes.labelcolor": MUTED, "axes.labelsize": 9.5, "axes.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False, "axes.facecolor": SURFACE,
    "xtick.color": MUTED, "ytick.color": MUTED, "xtick.labelsize": 9, "ytick.labelsize": 9,
    "xtick.major.size": 0, "ytick.major.size": 0, "xtick.major.pad": 5, "ytick.major.pad": 6,
    "grid.color": RULE, "grid.linewidth": 0.6, "legend.frameon": False, "legend.fontsize": 9,
    "figure.facecolor": SURFACE, "savefig.facecolor": SURFACE, "text.parse_math": False,
    "xtick.minor.size": 0, "ytick.minor.size": 0,
})


def frame(title: str, subtitle: str, source: str, *, size=(7.5, 5.0)):
    fig = plt.figure(figsize=size, dpi=200)
    fig.text(0.045, 0.955, title, fontsize=14, fontweight="semibold", color=INK, va="top")
    fig.text(0.045, 0.895, subtitle, fontsize=9.5, color=MUTED, va="top", linespacing=1.45)
    fig.text(0.045, 0.03, source, fontsize=7.5, color=MUTED, va="bottom", linespacing=1.4)
    return fig


def save(fig, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / name, dpi=200)
    plt.close(fig)
    print("->", OUT / name)


def money(v: float) -> str:
    return f"${v:,.0f}"


# 1. Held-out test: the coordination gain disappears, site selection survives but shrinks once calibrated
def fig_holdout() -> None:
    h = DATA["holdout"]
    names = list(h)
    labels = ["Coordination across a sponsor's trials\n(joint plan vs each trial on its own)",
              "Site selection\n(model's sites vs registered sites)",
              "Site selection, scores calibrated\nto observed enrollment (b = 0.33)",
              "Site selection, calibrated\n(b = 0.16, all-trials slope)"]
    fig = frame("In-sample gains shrink on trials the model never saw",
                "Predicted time-to-enroll ratio of the model's plan against its comparison, U.S. Northeast.\n"
                "Held out = trials kept out of fitting (alternating and time-ordered splits).",
                "Source: data/robustness/holdout.json, data/findings/selection_calibrated.json (pre-registered held-out "
                "test, 7,221 NSCLC trials).\nModel estimates from public registry data; a research result, not a "
                "product claim. Concord's product makes no time predictions.")
    ax = fig.add_axes([0.37, 0.17, 0.585, 0.58])
    ys = np.arange(len(names))[::-1]
    for y, n in zip(ys, names):
        r = h[n]
        held = [r["held_out_alternating"], r["held_out_time"]]
        ax.plot([min(held), r["in_sample"]], [y, y], color=RULE, lw=2, zorder=1, solid_capstyle="round")
        ax.scatter(r["in_sample"], y, s=70, facecolor=SURFACE, edgecolor=SAND, lw=2, zorder=3)
        ax.scatter(r["held_out_alternating"], y, s=62, color=TEAL, edgecolor=SURFACE, lw=1.5, zorder=4)
        ax.scatter(r["held_out_time"], y, s=62, marker="D", color=TEAL, edgecolor=SURFACE, lw=1.5, zorder=4)
        ax.text(r["in_sample"] + 0.025, y, f"{r['in_sample']:.2f}x", va="center", fontsize=9, color=INK)
        ax.text(min(held) - 0.025, y, f"{np.mean(held):.2f}x", va="center", ha="right", fontsize=9, color=INK,
                fontweight="semibold")
    ax.axvline(1.0, color=MUTED, lw=1, ls=(0, (3, 3)), zorder=0)
    ax.text(1.0, len(names) - 0.45, "1.0 = no gain", fontsize=8.5, color=MUTED, ha="left", va="bottom")
    ax.set_yticks(ys, labels, fontsize=9, color=INK)
    ax.set_xlim(0.9, 1.92)
    ax.set_ylim(-0.6, len(names) - 0.2)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.1f}x"))
    ax.grid(axis="x")
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Predicted enrollment-time ratio (comparison ÷ model's plan)")
    ax.legend(handles=[
        Line2D([], [], marker="o", ls="", markerfacecolor=SURFACE, markeredgecolor=SAND, mew=2, ms=8, label="In sample"),
        Line2D([], [], marker="o", ls="", color=TEAL, ms=8, label="Held out, alternating split"),
        Line2D([], [], marker="D", ls="", color=TEAL, ms=7, label="Held out, time split"),
    ], loc="upper left", bbox_to_anchor=(0.035, 0.815), bbox_transform=fig.transFigure, ncol=3, handletextpad=0.3,
        columnspacing=1.4)
    save(fig, "01-holdout-gains.png")


# 2. Congestion: estimated elasticity across specifications against the assumed 1.0
def fig_congestion() -> None:
    c = DATA["congestion"]
    rows = c["rows"]
    groups = [("Main specifications", "main"), ("Subsets (within site)", "subset"),
              ("Eligibility parser versions (within site)", "parser")]
    fig = frame("Competing trials barely slow each other within a site",
                "Congestion elasticity: how much one more overlapping trial at the same site slows enrollment there.\n"
                "Point estimates with 95% intervals (clustered by trial and site). Our first model assumed 1.0.",
                "Source: data/robustness/congestion_v2.json; 3,442 completed NSCLC trials, 68,474 trial-site rows, "
                "site fixed effects.\nElasticity = minus the regression coefficient on overlap-weighted competing "
                "exposure. The pooled row ignores site differences and is shown for contrast.")
    ax = fig.add_axes([0.375, 0.17, 0.58, 0.64])
    y = 0
    ticks, tlabels, heads = [], [], []
    for title, g in groups:
        heads.append((y, title))
        y -= 1
        for r in [r for r in rows if r["group"] == g]:
            default = r["label"].startswith("Within the same site")
            confounded = "confounded" in r["label"]
            col = GRAY if confounded else TEAL
            ax.plot([r["lo"], r["hi"]], [y, y], color=col, lw=2, solid_capstyle="round", zorder=2)
            ax.scatter(r["elasticity"], y, s=80 if default else 46, color=col, edgecolor=SURFACE, lw=1.5, zorder=3)
            ticks.append(y)
            tlabels.append(r["label"].replace("Within the same site (default)", "Within the same site (headline)"))
            if default:
                ax.text(r["hi"] + 0.03, y, f"{r['elasticity']:.2f}  [{r['lo']:.2f}, {r['hi']:.2f}]", va="center",
                        fontsize=9, color=INK, fontweight="semibold")
            y -= 1
        y -= 0.4
    for hy, title in heads:
        ax.text(-0.455, hy, title.upper(), transform=ax.get_yaxis_transform(), fontsize=7.5, color=MUTED,
                fontweight="semibold", va="center")
    ax.axvline(0, color=MUTED, lw=1, ls=(0, (3, 3)), zorder=1)
    ax.axvline(c["assumed"], color=SAND, lw=2, zorder=1)
    top = heads[0][0] + 0.8
    ax.text(0.015, top, "0 = no slowdown", fontsize=8.5, color=MUTED, va="bottom")
    ax.text(c["assumed"] - 0.015, top, "1.0 = assumed in\nour first model", fontsize=8.5, color=SAND, va="bottom",
            ha="right", fontweight="semibold")
    ax.set_yticks(ticks, tlabels, fontsize=8.8, color=INK)
    ax.set_ylim(y + 0.6, top + 0.9)
    ax.set_xlim(-0.35, 1.08)
    ax.grid(axis="x")
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Congestion elasticity (0 = no effect, 1 = full assumed effect)")
    save(fig, "02-congestion-forest.png")


# 3. Observed-outcome check: added-variable plots of actual enrollment against the public site score
def fig_validation() -> None:
    v = DATA["validation"]
    fig = frame("Public site scores predict real enrollment only weakly",
                "Each dot is a completed trial started 2018 or later, scored with site rates fit only on earlier trials.\n"
                "Both axes adjusted for phase, number of sites and start year (added-variable plot).",
                "Source: backend/concord/analysis/selection_validation.py (pre-registered; read-only reproduction of "
                "its rows), data/findings/selection_validation.json.\nA slope of 1 would mean the score predicts "
                "enrollment one-for-one; the observed slope is used to shrink the scores in Site scores.")
    panels = [("industry", "Industry-sponsored Phase 2/3 (primary)"), ("all", "All completed trials (sensitivity)")]
    lim = 2.6
    for i, (key, title) in enumerate(panels):
        d = v[key]
        ax = fig.add_axes([0.085 + i * 0.47, 0.19, 0.4, 0.5])
        x, yv = np.array(d["x"]), np.array(d["y"])
        ax.scatter(x, yv, s=9, color=GRAY, alpha=0.45, lw=0, zorder=2, rasterized=True)
        xx = np.array([-lim, lim])
        ax.plot(xx, xx, color=SAND, lw=1.6, ls=(0, (4, 3)), zorder=3)
        ax.plot(xx, d["slope"] * xx, color=TEAL, lw=2.4, zorder=4, solid_capstyle="round")
        lo, hi = d["ci95"]
        ax.fill_between(xx, lo * xx, hi * xx, color=TEAL, alpha=0.12, lw=0, zorder=1)
        ax.set_xlim(-lim, lim)
        ax.set_ylim(-lim * 1.25, lim * 1.25)
        ax.axhline(0, color=RULE, lw=0.8, zorder=0)
        ax.axvline(0, color=RULE, lw=0.8, zorder=0)
        ax.set_title(title, fontsize=10, color=INK, loc="left", pad=8, fontweight="semibold")
        ax.text(0.03, 0.96, f"slope {d['slope']:.2f}  [{lo:.2f}, {hi:.2f}]\nn = {d['n']:,} trials", transform=ax.transAxes,
                va="top", fontsize=9, color=INK, linespacing=1.4,
                bbox=dict(boxstyle="round,pad=0.35", fc=SURFACE, ec="none", alpha=0.85))
        ax.text(lim * 0.97, lim * 0.97 + 0.12, "slope 1", color=SAND, fontsize=8.5, ha="right", va="bottom")
        ax.set_xlabel("Site score (log mean pre-2018 site rate), adjusted")
        if i == 0:
            ax.set_ylabel("Actual enrollment per site-month (log), adjusted")
        else:
            ax.tick_params(labelleft=False)
    fig.legend(handles=[Line2D([], [], color=TEAL, lw=2.4, label="Fitted slope with 95% interval"),
                        Line2D([], [], color=SAND, lw=1.6, ls=(0, (4, 3)), label="Slope 1 (score fully predictive)")],
               loc="upper left", bbox_to_anchor=(0.035, 0.815), ncol=2, columnspacing=1.6)
    save(fig, "03-observed-outcome-check.png")


# 4. Site scores: Poisson-gamma shrinkage, the low-history cap and NB2 interval widths
def fig_scores() -> None:
    s = DATA["scores"]
    het = s["heterogeneity"]
    fig = frame("Site enrollment scores: shrinkage, a cap and honest intervals",
                f"Poisson-gamma empirical Bayes rates for {s['us']['sites']:,} U.S. sites (patients per month per lung trial). "
                "Sites with 1-2\nprior trials are capped at the 25th percentile of the prior; intervals widen for "
                f"trial-to-trial overdispersion (NB2, 1/k = {het['inv_k']:.2f}).",
                "Source: backend/concord/site_scores.py, site_model.py; /api/site-scores/summary. Intervals are 80% "
                "(p10 to p90).\nScores are relative and noisy (see the observed-outcome check); Concord uses them to "
                "describe sites, never to predict a trial's speed.")
    # (a) histogram
    ax = fig.add_axes([0.085, 0.19, 0.48, 0.56])
    bins = s["histogram"]["bins"]
    w = s["histogram"]["bin_log10"]
    lo = np.array([b["lo"] for b in bins])
    a3 = np.array([b["history_3plus"] for b in bins])
    a1 = np.array([b["low_history"] for b in bins])
    gap = 0.012
    ax.bar(lo + w / 2, a3, width=w - gap, color=TEAL, lw=0, zorder=2)
    ax.bar(lo + w / 2, a1, width=w - gap, bottom=a3, color=SAND, lw=0, zorder=2, edgecolor=SURFACE)
    cap = math.log10(s["prior"]["p25"])
    ax.axvline(cap, color=INK, lw=1, ls=(0, (3, 3)), zorder=3)
    ax.text(-0.97, ax.get_ylim()[1] * 0.97, f"cap {s['prior']['p25']:.3f}\n(prior p25)", fontsize=8.3,
            color=INK, va="top")
    ticks = [-3, -2, -1, 0, 1]
    ax.xaxis.set_major_locator(FixedLocator(ticks))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{10.0 ** v:g}"))
    ax.set_xlim(lo.min() - 0.1, lo.max() + w + 0.1)
    ax.grid(axis="y")
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Site score, patients per month (log scale)")
    ax.set_ylabel("U.S. sites")
    ax.set_title("Distribution of scores", fontsize=10, loc="left", pad=8, fontweight="semibold", color=INK)
    ax.legend(handles=[Patch(color=TEAL, label="3+ prior trials"), Patch(color=SAND, label="1-2 prior trials (capped)")],
              loc="upper right", bbox_to_anchor=(1.0, 0.8), handlelength=1, handleheight=1)
    # (b) interval width by history depth
    bx = fig.add_axes([0.67, 0.19, 0.29, 0.56])
    bk = s["buckets"]
    xs = np.arange(len(bk))
    nb = np.exp([b["median_log_width"] for b in bk])
    po = np.exp([b["median_log_width_poisson"] for b in bk])
    bx.plot(xs, po, color=GRAY, lw=2, marker="o", ms=6, mec=SURFACE, mew=1.2, zorder=2)
    bx.plot(xs, nb, color=TEAL, lw=2, marker="o", ms=7, mec=SURFACE, mew=1.2, zorder=3)
    bx.set_yscale("log")
    bx.yaxis.set_major_locator(FixedLocator([1, 2, 5, 10, 20, 50]))
    bx.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}x"))
    bx.set_ylim(1, 50)
    bx.set_xticks(xs, [b["label"] for b in bk])
    bx.set_xlim(-0.4, len(bk) - 0.6)
    bx.grid(axis="y")
    bx.spines["left"].set_visible(False)
    bx.text(xs[0] + 0.2, nb[0] * 1.05, f"{nb[0]:.0f}x", fontsize=8.5, color=INK, va="bottom", fontweight="semibold")
    bx.text(xs[-1], nb[-1] * 1.25, f"{nb[-1]:.1f}x", fontsize=8.5, color=INK, ha="center", va="bottom",
            fontweight="semibold")
    bx.text(xs[0], po[0] / 1.2, f"{po[0]:.1f}x", fontsize=8.5, color=MUTED, ha="center", va="top")
    bx.set_xlabel("Prior trials at the site")
    bx.set_ylabel("Interval width (p90 ÷ p10)")
    bx.set_title("Uncertainty by history", fontsize=10, loc="left", pad=8, fontweight="semibold", color=INK)
    bx.legend(handles=[Line2D([], [], color=TEAL, lw=2, marker="o", label="With overdispersion (shown)"),
                       Line2D([], [], color=GRAY, lw=2, marker="o", label="Poisson only")],
              loc="lower left", fontsize=8.3)
    save(fig, "04-site-scores.png")


# 5. Locality distribution: one protocol priced in all 109 Medicare localities
def fig_localities() -> None:
    d = DATA["pricing"]["distribution"]
    locs = sorted(d["localities"], key=lambda l: l["total"])
    st = d["stats"]
    sites = {f"{x['locality']['state']}-{x['locality']['code']}": x for x in d["sites"]}
    fig = frame("The same protocol, priced in all 109 Medicare localities",
                "Sponsor-paid coded procedures per participant for NCT05800015 (fianlimab, first-line NSCLC) at 100% of "
                "Medicare.\nEach dot is one locality: CMS 2026 RVUs × that locality's three GPCIs × $33.4009, plus "
                f"lab lines (a national ${d['lab_constant']:.2f}).",
                "Source: CMS PFS 2026 RVU file (rvu26d, non-facility) and CY 2026 GPCI table, all 109 localities; CMS "
                "CLFS 2026 Q4.\nEach locality counts once. Per-visit fees, coordinator time and overhead are not "
                "geographically adjusted and are excluded here.")
    ax = fig.add_axes([0.1, 0.16, 0.86, 0.63])
    xs = np.arange(1, len(locs) + 1)
    vals = np.array([l["total"] for l in locs])
    ax.axhspan(st["p10"], st["p90"], color=TEAL, alpha=0.06, lw=0, zorder=0)
    ax.axhline(st["median"], color=MUTED, lw=1, ls=(0, (3, 3)), zorder=1)
    ax.text(len(locs) + 0.5, st["median"], f"median {money(st['median'])}", fontsize=8.5, color=MUTED, ha="right",
            va="bottom")
    ax.text(55, st["p90"] - 8, "p10 to p90 of localities", fontsize=8.5, color=TEAL, ha="center", va="top")
    ax.scatter(xs, vals, s=16, color=GRAY, lw=0, zorder=2)
    marks = [(k, TEAL if i == 0 else SAND) for i, k in enumerate(sites)]
    for key, col in marks:
        i = next(j for j, l in enumerate(locs) if l["key"] == key)
        site = sites[key]
        ax.scatter(xs[i], vals[i], s=90, color=col, edgecolor=SURFACE, lw=2, zorder=4)
        name = site["label"].split(",")[0]
        pct = locs[i]["percentile"]
        txt = f"{name}\n{locs[i]['name'].title()} ({key}), {money(vals[i])}, p{pct:.0f}"
        right = xs[i] > len(locs) / 2
        ax.annotate(txt, (xs[i], vals[i]), xytext=(-14 if right else 16, 22 if right else 62), textcoords="offset points",
                    ha="right" if right else "left", fontsize=8.6, color=INK, linespacing=1.35,
                    arrowprops=dict(arrowstyle="-", color=col, lw=1.2, shrinkA=0, shrinkB=6))
    for i, side in ((0, "left"), (len(locs) - 1, "right")):
        ax.text(xs[i], vals[i] + (-28 if i == 0 else 22), f"{locs[i]['name'].title()} {money(vals[i])}", fontsize=8,
                color=MUTED, ha=side, va="top" if i == 0 else "bottom")
    ax.set_xlim(-2, len(locs) + 3)
    ax.set_ylim(vals.min() - 90, vals.max() + 110)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: money(v)))
    ax.set_xticks([1, 28, 55, 82, 109])
    ax.grid(axis="y")
    ax.spines["left"].set_visible(False)
    ax.set_xlabel("Medicare localities, ranked from lowest to highest")
    ax.set_ylabel("Per participant, procedures + labs")
    save(fig, "05-locality-distribution.png")


# 6. Two-site gap decomposition
def fig_gap() -> None:
    p = DATA["pricing"]
    s = p["compare_summary"]
    a, b = "NYU Langone", "Hattiesburg Clinic"
    assert p["compare_sites"]["a"].startswith(a) and p["compare_sites"]["b"].startswith(b)
    parts = [("Practice costs\n(rent, staff, equipment)", -s["from_pe"], TEAL),
             ("Overhead on the difference\n(25%, an assumption)", -s["delta_overhead"], SAND),
             ("Malpractice insurance", -s["from_mp"], TEAL),
             ("Doctor's time", -s["from_work"], TEAL)]
    total = -s["delta_per_participant"]
    ta, tb = p["compare_totals"]["a"], p["compare_totals"]["b"]
    fig = frame(f"Why two sites' budgets for one protocol differ by {money(total)}",
                f"Per-participant sponsor budget for NCT05800015: ${ta:,.2f} at {a} (Medicare locality NY-01 "
                f"Manhattan)\nvs ${tb:,.2f} at {b} (MS-00 Mississippi), split by Medicare's three geographic "
                "adjustments (GPCIs).",
                "Source: /api/terms-flow/NCT05800015/compare. Each procedure line is re-priced with one GPCI changed at "
                f"a time; parts sum to the gap\n(rounding {s['rounding']:+.2f}). Per-visit fees and coordinator time "
                "are the same at both sites; lab prices are national. Explains why budgets differ.")
    ax = fig.add_axes([0.3, 0.17, 0.63, 0.55])
    left = 0.0
    rows = parts + [("Total difference", total, INK)]
    ys = np.arange(len(rows))[::-1]
    for y, (label, v, col) in zip(ys, rows):
        start = 0.0 if label == "Total difference" else left
        ax.barh(y, v, left=start, height=0.56, color=col, lw=0, zorder=2)
        ax.text(start + v + 5, y, f"{'+' if label != 'Total difference' else ''}${v:,.2f}", va="center", fontsize=9.5,
                color=INK, fontweight="semibold" if label == "Total difference" else "normal")
        if label != "Total difference":
            ax.plot([start + v, start + v], [y - 0.28, y - 0.72], color=MUTED, lw=0.8, zorder=1)
            left += v
    ax.set_yticks(ys, [r[0] for r in rows], fontsize=9.2, color=INK)
    ax.set_xlim(0, total * 1.17)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:,.0f}"))
    ax.grid(axis="x")
    ax.spines["left"].set_visible(False)
    ax.set_xlabel(f"Per participant, {a} minus {b}")
    ax.legend(handles=[Patch(color=TEAL, label="Medicare geographic adjustment (public CMS data)"),
                       Patch(color=SAND, label="Assumption"), Patch(color=INK, label="Total")],
              loc="upper left", bbox_to_anchor=(0.035, 0.815), bbox_transform=fig.transFigure, ncol=3,
              handlelength=1, handleheight=1, columnspacing=1.4)
    save(fig, "06-two-site-gap.png")


# 7. Anchored share across protocols
SHORT = {
    "NCT05800015": "Fianlimab, 1L NSCLC",
    "NCT06541704": "SIENNA, geographic atrophy",
    "NCT06627647": "ARTEMIDE-Lung03, 1L NSCLC",
    "NCT06966700": "Sac-TMT, breast cancer",
    "NCT07064473": "Vicadrostat + empagliflozin, T2D",
    "NCT07564414": "CagriSema, obesity",
}


def fig_anchored() -> None:
    rows = DATA["pricing"]["anchored"]
    rows = [r for r in rows if not r["added"]] + [r for r in rows if r["added"]]
    fig = frame("How much of each budget public rates already settle",
                "Per-participant sponsor budget at each trial's first U.S. site, split by what anchors each dollar.\n"
                "Overhead is a flat 25% on top, so the open share is 20% everywhere; the public share is what varies.",
                "Source: /api/terms-flow/{nct}/budget (anchoring.shares). Public = CMS PFS 2026 and CLFS 2026 Q4 "
                "amounts. Proposed standard = Concord's\nper-visit and coordinator fees, labelled \"a starting point "
                "to negotiate against, not market data\". Open = overhead at 25%, an assumption.")
    ax = fig.add_axes([0.335, 0.15, 0.555, 0.58])
    n = len(rows)
    ys = np.arange(n)[::-1].astype(float)
    ys[:3] += 0.75
    for y, head in ((ys[0] + 0.62, "Hand-authored demo protocols"),
                    (ys[3] + 0.62, "Added by NCT ID, schedule drafted from the registry record")):
        ax.text(-0.54, y, head.upper(), transform=ax.get_yaxis_transform(), fontsize=7.5, color=MUTED,
                fontweight="semibold", va="center")
    segs = [("public", "Public CMS rates", TEAL, SURFACE), ("standard", "Proposed standard", SAND, INK),
            ("open", "Open (overhead, assumption)", GRAY, INK)]
    gap = 0.004
    for y, r in zip(ys, rows):
        left = 0.0
        for key, _, col, tc in segs:
            share = r[key] / r["total"]
            ax.barh(y, share - gap, left=left, height=0.62, color=col, lw=0, zorder=2)
            if share > 0.035:
                ax.text(left + share / 2, y, f"{share:.0%}", ha="center", va="center",
                        fontsize=9 if share > 0.07 else 7.8, color=tc,
                        fontweight="semibold" if key == "public" else "normal")
            left += share
        ax.text(1.015, y, money(r["total"]), va="center", fontsize=9, color=INK)
    ax.text(1.015, ys[0] + 0.45, "per participant", fontsize=8, color=MUTED, va="bottom")
    ax.set_yticks(ys, [f"{SHORT.get(r['nct'], r['nct'])}\n{r['nct']}" for r in rows], fontsize=8.8, color=INK)
    ax.set_xlim(0, 1)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0%}"))
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1])
    ax.spines["left"].set_visible(False)
    ax.spines["bottom"].set_visible(False)
    ax.set_ylim(ys.min() - 0.6, ys.max() + 0.95)
    ax.legend(handles=[Patch(color=c, label=l) for _, l, c, _ in segs], loc="upper left", bbox_to_anchor=(0.035, 0.815),
              bbox_transform=fig.transFigure, ncol=3, handlelength=1, handleheight=1, columnspacing=1.4)
    save(fig, "07-anchored-share.png")


if __name__ == "__main__":
    fig_holdout()
    fig_congestion()
    fig_validation()
    fig_scores()
    fig_localities()
    fig_gap()
    fig_anchored()
