"""Locality distribution and spread comparison for a protocol's terms (P2.5, P2.6).

No forecasting and no market data. Two read-only views over the same pricing the budget uses:

1. Locality distribution. The protocol's per-participant procedure lines (sponsor-paid research items with
   a CPT/HCPCS code, fixed schedule: screening through cycle 8, end of treatment and safety follow-up) priced
   in EVERY Medicare payment locality in the loaded CMS GPCI table, at 100% of Medicare, with exactly the
   budget's per-line formula and rounding (terms._price_code). Physician fee schedule (PFS) lines move with the
   locality's GPCIs; lab (CLFS) lines are national amounts, so they add the same constant everywhere.
   Each locality counts once (unweighted by sites or beneficiaries).

2. Spread comparison. The per-participant dollar range each of three drivers produces, as computed:
   (a) geography: min-max (and p10-p90) of the procedure cost across localities (from 1.);
   (b) the "% of Medicare" multiplier band at a selected site: procedure cost at the low and high multiplier
       (a user-set band; the default 100%-150% is an assumption, not a benchmark);
   (c) non-procedure fees: the proposed standard schedule's per-participant items (coordinator time and the
       per-visit research fees on the fixed schedule) x a user-set band (default 75%-125%, an assumption: there is no public
       benchmark for these fees).
   Institutional overhead (a rate on items and coordinator time) is outside all three ranges.

Decision support. Not a fair-market-value legal opinion.
"""

from __future__ import annotations

import math
import re

from concord import terms
from concord.ratecard import medicare

GPCI_ASSUMPTION = "Each Medicare locality counts once, whatever its number of sites or beneficiaries"
MULT_BAND_DEFAULT = (1.0, 1.5)
FEE_BAND_DEFAULT = (0.75, 1.25)
MULT_BAND_LABEL = "Assumption: a negotiating band for the % of Medicare, set by the user (default 100%-150%)"
FEE_BAND_LABEL = ("Assumption: no public benchmark for these fees; band set by the user (default 75%-125%) "
                  "around the proposed standard schedule")
OVERHEAD_NOTE = ("Institutional overhead (a rate on research items and coordinator time) is not in these ranges; "
                 "it scales with them. Per-site one-time fees and per-occurrence visits are outside the "
                 "per-participant scope.")
PERCENTILE_METHOD = ("Percentile rank among localities = (localities priced lower + half of those priced the same) "
                     "/ all localities x 100")
QUANTILE_METHOD = "Median, p10 and p90 by linear interpolation between ranked localities"


def _r2(x: float) -> float:
    return round(x + 0.0, 2)


def _quantile(sorted_vals: list[float], q: float) -> float:
    """Linear interpolation between closest ranks (numpy's default 'linear' method)."""
    if not sorted_vals:
        raise ValueError("no values")
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def percentile_rank(value: float, values: list[float]) -> float:
    """Mid-rank percentile of `value` among `values` (ties count half), 0-100."""
    if not values:
        raise ValueError("no values")
    below = sum(1 for v in values if v < value - 0.005)
    same = sum(1 for v in values if abs(v - value) <= 0.005)
    return 100.0 * (below + 0.5 * same) / len(values)


def _gpci_release() -> tuple[str, str] | None:
    """(two-digit year, release letter) of the loaded CMS RVU file, read from its zip name (rvu26d.zip -> 26, D).
    The GPCI table (Addendum E) ships in the same zip, so it carries the same year and release."""
    src = medicare._cms().get("pfs", {}).get("source", "")  # noqa: SLF001 - same package
    m = re.search(r"rvu(\d\d)([a-d])\.zip", src, re.I)
    return (m[1], m[2].upper()) if m else None


def _gpci_source() -> str:
    src = medicare._cms().get("pfs", {}).get("source", "")  # noqa: SLF001 - same package
    if not src:
        return "CMS GPCI table not loaded"
    zip_name = src.split(", ")[-1]
    rel = _gpci_release()
    if rel is None:
        return f"CMS GPCI table (Addendum E) in {zip_name}"
    yy, letter = rel
    return f"CMS RVU{yy}{letter} GPCI20{yy} table (Addendum E, CY 20{yy} GPCIs) in {zip_name}"


def _gpci_short() -> str:
    """Short in-sentence name of the loaded GPCI table, e.g. 'CMS CY 2026 GPCI table'."""
    rel = _gpci_release()
    return f"CMS CY 20{rel[0]} GPCI table" if rel else "CMS GPCI table"


def _clfs_source() -> str | None:
    c = medicare._cms().get("clfs")  # noqa: SLF001
    return c.get("source") if c else None


def _all_localities() -> list[dict]:
    return medicare._cms().get("pfs", {}).get("localities", [])  # noqa: SLF001


def _proc_lines(nct: str, overrides: dict[str, str] | None) -> tuple[list[dict], list[str]]:
    """Per-participant procedure lines: sponsor-paid (research after overrides), CPT-priced, fixed visits.
    Returns the lines (one per node, in schedule order) and the unpriced codes (never counted as zero)."""
    p = terms.load_protocol(nct)
    cov = terms._coverage(p, overrides)  # noqa: SLF001 - same package; validates overrides
    procs = {x["id"]: x for x in p["procedures"]}
    kinds = {v["id"]: v["kind"] for v in p["visits"]}
    lines, unpriced = [], []
    for n in p["nodes"]:
        proc = procs[n["procedure"]]
        if kinds[n["visit"]] == "repeat" or cov[n["id"]]["coverage"] != "research" or proc["pricing"] != "cpt":
            continue
        if terms._price_code(proc["code"], None) is None:  # noqa: SLF001
            unpriced.append(proc["code"])
            continue
        lines.append({"node_id": n["id"], "visit_id": n["visit"], "code": proc["code"], "label": proc["label"]})
    return lines, sorted(set(unpriced))


def _price_lines(lines: list[dict], loc: dict | None, multiplier: float = 1.0) -> dict:
    """Sum the lines at one locality exactly as terms.budget does: per line, the locality amount rounded to the
    cent (terms._price_code), times the multiplier, rounded to the cent.

    Three buckets, by the line's schedule: "pfs" (CMS-verified PFS lines, adjusted by the locality's GPCIs),
    "lab" (CLFS lines: national amounts, verified or placeholder) and "unadjusted" (any other line without RVUs,
    e.g. a placeholder for a PFS code missing from the CMS file: a national amount, not adjusted by locality,
    and never counted as CLFS)."""
    cache: dict[str, dict] = {}
    pfs = lab = other = 0.0
    n_pfs = n_lab = n_placeholder = n_other = 0
    for l in lines:
        r = cache.get(l["code"])
        if r is None:
            r = cache[l["code"]] = terms._price_code(l["code"], loc)  # noqa: SLF001
        amt = _r2(r["amount"] * multiplier)
        if r.get("rvu"):
            pfs += amt
            n_pfs += 1
        elif r.get("schedule_label") == "CLFS":
            lab += amt
            n_lab += 1
            n_placeholder += 1 if r.get("placeholder") else 0
        else:
            other += amt
            n_other += 1
    return {"pfs": _r2(pfs), "lab": _r2(lab), "unadjusted": _r2(other), "total": _r2(pfs + lab + other),
            "n_pfs": n_pfs, "n_lab": n_lab, "n_placeholder": n_placeholder, "n_unadjusted": n_other}


def _loc_key(l: dict) -> str:
    return f"{l['state']}-{l['locality']}"


def _distribution(nct: str, overrides: dict[str, str] | None) -> dict:
    lines, unpriced = _proc_lines(nct, overrides)
    locs = _all_localities()
    if not locs:
        raise terms.TermsError("CMS GPCI table not loaded (data/ratecard.json)")
    rows = []
    for l in locs:
        g = {"gpci_work": l["gpci_work"], "gpci_pe": l["gpci_pe"], "gpci_mp": l["gpci_mp"], "name": l["name"]}
        s = _price_lines(lines, g)
        rows.append({"key": _loc_key(l), "state": l["state"], "code": l["locality"], "name": l["name"],
                     "gpci_work": l["gpci_work"], "gpci_pe": l["gpci_pe"], "gpci_mp": l["gpci_mp"],
                     "pfs": s["pfs"], "lab": s["lab"], "unadjusted": s["unadjusted"], "total": s["total"]})
    totals = sorted(r["total"] for r in rows)
    for r in rows:
        r["percentile"] = round(percentile_rank(r["total"], totals), 1)
    nat = _price_lines(lines, None)
    lo, hi = totals[0], totals[-1]
    stats = {
        "n": len(rows), "min": lo, "max": hi, "median": _r2(_quantile(totals, 0.5)),
        "p10": _r2(_quantile(totals, 0.1)), "p90": _r2(_quantile(totals, 0.9)),
        "min_localities": [r["key"] for r in rows if abs(r["total"] - lo) < 0.005],
        "max_localities": [r["key"] for r in rows if abs(r["total"] - hi) < 0.005],
        "national": nat["total"],
    }
    return {"lines": lines, "unpriced": unpriced, "rows": rows, "stats": stats, "lab_constant": rows[0]["lab"],
            "unadjusted_constant": rows[0]["unadjusted"], "n_pfs_lines": nat["n_pfs"], "n_lab_lines": nat["n_lab"],
            "n_placeholder_lines": nat["n_placeholder"], "n_unadjusted_lines": nat["n_unadjusted"]}


def _budget_procedure_total(b: dict) -> float:
    """The budget's own per-participant procedure total: sponsor lines priced from PFS or CLFS, fixed visits."""
    return _r2(sum(l["amount"] for v in b["visits"] if v["kind"] != "repeat" for l in v["lines"]
                   if l["payer"] == "Sponsor" and l["amount"] is not None and l["schedule"] in ("PFS", "CLFS")))


def _site_mark(nct: str, site_id: str, dist: dict, overrides: dict[str, str] | None) -> dict:
    site = terms._site(nct, site_id)  # noqa: SLF001
    loc = site["locality"]
    check = _budget_procedure_total(terms.budget(nct, site_id, 1.0, overrides))
    out = {"site_id": site_id, "label": site["label"], "locality": loc, "budget_procedure_total": check}
    if loc is None:
        own = _price_lines(dist["lines"], None)
        return {**out, "key": None, "total": own["total"], "pfs": own["pfs"], "lab": own["lab"],
                "unadjusted": own["unadjusted"], "percentile": None,
                "n_below": None, "n_same": None,
                "note": "No Medicare locality resolved: national amounts, not placed among localities"}
    key = f"{loc['state']}-{loc['code']}"
    row = next((r for r in dist["rows"] if r["key"] == key), None)
    if row is None:
        raise terms.TermsError(f"locality {key} of {site_id} is not in the GPCI table")
    totals = [r["total"] for r in dist["rows"]]
    return {**out, "key": key, "total": row["total"], "pfs": row["pfs"], "lab": row["lab"],
            "unadjusted": row["unadjusted"], "percentile": row["percentile"],
            "n_below": sum(1 for t in totals if t < row["total"] - 0.005),
            "n_same": sum(1 for t in totals if abs(t - row["total"]) <= 0.005), "note": None}


def _sources() -> dict:
    pfs = medicare._cms().get("pfs", {})  # noqa: SLF001
    return {"gpci": _gpci_source(), "gpci_short": _gpci_short(), "pfs": pfs.get("source"), "conversion_factor": pfs.get("conversion_factor"),
            "clfs": _clfs_source(), "standard": terms.STANDARD_SOURCE}


def locality_distribution(nct: str, site_a: str | None = None, site_b: str | None = None,
                          overrides: dict[str, str] | None = None) -> dict:
    """The protocol's per-participant procedure cost in every Medicare locality at 100% of Medicare, with the
    selected sites marked and placed among the localities."""
    dist = _distribution(nct, overrides)
    sites = [_site_mark(nct, s, dist, overrides) for s in (site_a, site_b) if s]
    p = terms.load_protocol(nct)
    return {
        "nct_id": nct, "label": p["label"], "disclaimer": terms.DISCLAIMER, "multiplier": 1.0,
        "scope": "Sponsor-paid coded procedure lines per participant, screening through cycle 8, end of treatment "
                 "and safety follow-up (per-occurrence visits excluded), at 100% of Medicare",
        "formula": "Per PFS line: (work RVU x work GPCI + PE RVU x PE GPCI + MP RVU x MP GPCI) x conversion factor, "
                   "rounded to the cent, as in the budget. CLFS lines: national amount, the same in every locality.",
        "n_pfs_lines": dist["n_pfs_lines"], "n_lab_lines": dist["n_lab_lines"],
        "n_placeholder_lines": dist["n_placeholder_lines"], "lab_constant": dist["lab_constant"],
        "n_unadjusted_lines": dist["n_unadjusted_lines"], "unadjusted_constant": dist["unadjusted_constant"],
        "unadjusted_note": ("Placeholder fee-schedule prices for codes missing from the CMS file are national "
                            "amounts, not adjusted by locality: they add the same constant everywhere"),
        "lab_note": ("Lab (CLFS) lines are national limitation amounts, not geographically adjusted: they add the "
                     "same constant to every locality and do not widen the spread"),
        "unpriced_codes": dist["unpriced"], "localities": dist["rows"], "stats": dist["stats"], "sites": sites,
        "weighting": GPCI_ASSUMPTION, "percentile_method": PERCENTILE_METHOD, "quantile_method": QUANTILE_METHOD,
        "sources": _sources(),
    }


def _band(lo: float, hi: float, name: str, lo_min: float, hi_max: float) -> tuple[float, float]:
    for v in (lo, hi):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise terms.TermsError(f"{name} must be finite numbers")
    if not (lo_min <= lo <= hi <= hi_max):
        raise terms.TermsError(f"{name}: need {lo_min:g} <= low <= high <= {hi_max:g} (fractions, 1 = 100%)")
    return float(lo), float(hi)


def _fees(b: dict) -> list[dict]:
    """Per-participant non-procedure fees from the budget: coordinator time and the standard-priced research
    lines (per-visit research fees on the fixed schedule), grouped by standard schedule item."""
    fixed = [v for v in b["visits"] if v["kind"] != "repeat"]
    std = {i["id"]: i for i in b["standard_schedule"]}
    out: dict[str, dict] = {}
    coord = _r2(sum(v["coordinator"] for v in fixed))
    if coord:
        c = std["coordinator"]
        out["coordinator"] = {"id": "coordinator", "label": c["label"], "unit_amount": c["amount"],
                              "count": sum(1 for v in fixed if v["coordinator"]), "amount": coord,
                              "edited": c["edited"]}
    for v in fixed:
        for l in v["lines"]:
            if l["payer"] != "Sponsor" or l["schedule"] != "Standard" or l["amount"] is None:
                continue
            it = std[l["standard_item"]]
            g = out.setdefault(it["id"], {"id": it["id"], "label": it["label"], "unit_amount": it["amount"],
                                          "count": 0, "amount": 0.0, "edited": it["edited"]})
            g["count"] += 1
            g["amount"] = _r2(g["amount"] + l["amount"])
    return list(out.values())


def spreads(nct: str, site_a: str, site_b: str | None = None, mult_lo: float = MULT_BAND_DEFAULT[0],
            mult_hi: float = MULT_BAND_DEFAULT[1], fee_lo: float = FEE_BAND_DEFAULT[0],
            fee_hi: float = FEE_BAND_DEFAULT[1], overrides: dict[str, str] | None = None,
            standard: dict[str, float] | None = None) -> dict:
    """Per-participant dollar ranges from (a) geography, (b) the multiplier band at each selected site and
    (c) a band on the non-procedure fees, as computed."""
    mult_lo, mult_hi = _band(mult_lo, mult_hi, "multiplier band", 0.1, 5.0)
    fee_lo, fee_hi = _band(fee_lo, fee_hi, "fee band", 0.0, 5.0)
    if site_b == site_a:
        site_b = None
    dist = _distribution(nct, overrides)
    st = dist["stats"]
    geo = {"id": "geography", "low": st["min"], "high": st["max"], "width": _r2(st["max"] - st["min"]),
           "p10": st["p10"], "p90": st["p90"], "width_p10_p90": _r2(st["p90"] - st["p10"]), "median": st["median"],
           "min_localities": st["min_localities"], "max_localities": st["max_localities"], "n": st["n"],
           "quantity": "Procedure lines per participant at 100% of Medicare, across all localities",
           "source": _gpci_source(), "assumption": GPCI_ASSUMPTION}
    mult = []
    for sid in (site_a, site_b):
        if not sid:
            continue
        site = terms._site(nct, sid)  # noqa: SLF001
        loc = site["locality"]
        g = loc and {"gpci_work": loc["gpci_work"], "gpci_pe": loc["gpci_pe"], "gpci_mp": loc["gpci_mp"],
                     "name": loc["name"]}
        lo, base, hi = (_price_lines(dist["lines"], g, m) for m in (mult_lo, 1.0, mult_hi))
        mult.append({"id": f"multiplier:{sid}", "site_id": sid, "label": site["label"], "locality": loc,
                     "low": lo["total"], "high": hi["total"], "width": _r2(hi["total"] - lo["total"]),
                     "at_100": base["total"], "m_low": mult_lo, "m_high": mult_hi,
                     "quantity": "Procedure lines per participant at this site, low to high % of Medicare",
                     "source": f"{_gpci_source()}; {_clfs_source() or 'CLFS not loaded'}",
                     "assumption": MULT_BAND_LABEL})
    b = terms.budget(nct, site_a, 1.0, overrides, standard)
    items = _fees(b)
    base = _r2(sum(i["amount"] for i in items))
    for i in items:
        i["low"], i["high"] = _r2(i["amount"] * fee_lo), _r2(i["amount"] * fee_hi)
    fees = {"id": "fees", "low": _r2(base * fee_lo), "high": _r2(base * fee_hi),
            "width": _r2(base * fee_hi - base * fee_lo), "base": base, "f_low": fee_lo, "f_high": fee_hi,
            "items": items, "edited": any(i["edited"] for i in items),
            "quantity": "Non-procedure fees per participant (coordinator time and per-visit research fees on the "
                        "fixed schedule)",
            "source": terms.STANDARD_SOURCE, "assumption": FEE_BAND_LABEL}
    p = terms.load_protocol(nct)
    return {"nct_id": nct, "label": p["label"], "disclaimer": terms.DISCLAIMER, "geography": geo,
            "multiplier": mult, "fees": fees, "overhead_note": OVERHEAD_NOTE, "lab_constant": dist["lab_constant"],
            "unpriced_codes": dist["unpriced"], "sources": _sources()}
