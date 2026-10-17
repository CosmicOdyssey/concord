"""Budget transparency for Protocol to terms: what each sponsor dollar is anchored to, a negotiation band
around Medicare on coded lines, and category breakdowns. Pure functions over the dict terms.budget() builds;
no forecasting, no market data.

Anchoring (per sponsor-paid line and per per-participant dollar):
  public    "Anchored to public rates": a coded line priced from a loaded CMS file (PFS at the site's
            locality, or the CLFS national amount), at the % of Medicare the user set.
  standard  "Anchored to a proposed standard": an unedited item of Concord's proposed standard
            non-procedure schedule (per-visit fees, coordinator time).
  open      "Open to negotiation": everything else, i.e. the overhead %, placeholder prices, edited
            standard items and unpriced items (counted as $0 and flagged).

Band: every line anchored to public rates (priced from a loaded CMS file) is also shown at Medicare x
band_lo and Medicare x band_hi (an assumption the user sets, default 100% to 150%); every other line,
placeholder prices included, keeps its point value, and overhead follows its rate. Totals carry the resulting low and high.
"""

from __future__ import annotations

import math

BAND_DEFAULT = (1.0, 1.5)
BAND_MIN, BAND_MAX = 0.1, 5.0
BAND_NOTE = ("Assumption: a negotiation band you set around the Medicare rate (default 100% to 150%). Not market "
             "data and not a fair-market-value finding. Only coded lines priced from a loaded CMS file "
             "(physician and lab fee schedule) move with it; proposed standard fees, coordinator time and "
             "placeholder prices stay at their point value, and overhead follows its rate.")
OVERHEAD_NOTE = ("Assumption: the overhead rate is a proposed default (25% in Concord's proposed standard "
                 "schedule), not a public rate. Edit it to the site's negotiated indirect rate.")
RVU_BASIS = ("Physician lines use Medicare's non-facility rates: the non-facility practice expense RVU (the "
             "office setting, where the practice bears its own costs) from the CMS PFS relative value file. "
             "Hospital outpatient facility fees (OPPS) are not included, so a hospital-based site may bill a "
             "separate facility fee that this budget does not show.")
LAB_NOTE = ("Lab lines use the CMS clinical laboratory fee schedule (CLFS) national payment rate (CLFS RATE "
            "column): one national number per test, so lab prices do not vary by site.")
LAB_NOTE_PLACEHOLDER = ("Lab lines without a CLFS amount use a placeholder national amount (not from a CMS file) "
                        "and count as open to negotiation; they stay at their point value in the range.")

ANCHORS: list[dict] = [
    {"id": "public", "label": "Anchored to public rates",
     "definition": "Coded lines priced from a loaded CMS file: the 2026 physician fee schedule at the site's "
                   "Medicare locality, or the clinical lab fee schedule national amount, at the % of Medicare "
                   "you set."},
    {"id": "standard", "label": "Anchored to a proposed standard",
     "definition": "Unedited items of Concord's proposed standard non-procedure schedule (per-visit fees and "
                   "coordinator time): Concord's proposed starting point (not a public rate) to negotiate against, "
                   "not market data."},
    {"id": "open", "label": "Open to negotiation",
     "definition": "Everything else: the overhead %, placeholder prices, standard items you edited, and "
                   "unpriced items (counted as $0 and flagged)."},
]
ANCHOR_LABEL = {a["id"]: a["label"] for a in ANCHORS}

# Cost types for the breakdown (per participant, fixed schedule).
COST_TYPES: list[tuple[str, str]] = [
    ("physician", "Physician procedures"),
    ("lab", "Lab"),
    ("imaging", "Imaging"),
    ("coordinator", "Coordinator time"),
    ("per_visit", "Per-visit fees"),
    ("pharmacy", "Pharmacy"),
    ("overhead", "Overhead"),
    ("unpriced", "Unpriced or no site charge"),
]
PHASES: list[tuple[str, str]] = [
    ("screening", "Screening"),
    ("treatment", "Treatment cycles"),
    ("eot", "End of treatment"),
    ("follow_up", "Follow-up"),
]


def _r2(x: float) -> float:
    return round(x + 0.0, 2)


def check_band(lo: float, hi: float) -> tuple[float, float]:
    for name, v in (("band_lo", lo), ("band_hi", hi)):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"{name} must be a finite number")
        if not (BAND_MIN <= v <= BAND_MAX):
            raise ValueError(f"{name} must be between {BAND_MIN} and {BAND_MAX} (10% to 500% of Medicare)")
    if lo > hi:
        raise ValueError("band_lo must not exceed band_hi")
    return float(lo), float(hi)


def classify(line: dict) -> tuple[str | None, str]:
    """Anchoring of one budget line: (anchor id or None for lines the sponsor does not pay, reason)."""
    if line["payer"] != "Sponsor":
        return None, "billed to insurance; not in the sponsor budget"
    sched = line.get("schedule")
    if line.get("amount") is None:
        if line.get("code"):
            return "open", "unpriced: code not in the loaded fee schedules (counted as $0, flagged)"
        return "open", "no site charge listed (counted as $0)"
    if sched in ("PFS", "CLFS"):
        if line.get("verified") and not line.get("placeholder"):
            return "public", ("CMS physician fee schedule at the site's locality" if sched == "PFS"
                              else "CMS clinical lab fee schedule, national amount")
        return "open", "placeholder price, not from a loaded CMS file"
    if sched == "Standard":
        if line.get("edited"):
            return "open", "edited away from the proposed standard"
        return "standard", "Concord proposed standard schedule"
    return "open", "no public or proposed anchor"


def _cost_type(line: dict) -> str:
    if line.get("amount") is None:
        return "unpriced"
    sched, cat = line.get("schedule"), (line.get("category") or "").lower()
    if sched == "CLFS" or cat == "labs":
        return "lab"
    if sched == "PFS":
        return "imaging" if cat == "imaging" else "physician"
    if line.get("standard_item") == "ip_dispense":
        return "pharmacy"
    return "per_visit"


def _phase(v: dict) -> str | None:
    if v["kind"] == "screening":
        return "screening"
    if v["kind"] == "treatment":
        return "treatment"
    if v["kind"] == "follow_up":
        return "eot" if "end of treatment" in v["label"].lower() or v["visit_id"] == "EOT" else "follow_up"
    if v["kind"] == "repeat" and v.get("occurrences"):
        return "treatment"  # a repeating dosing visit with a fixed count is inside the per-participant amount
    return None  # open-ended repeat visits are paid per occurrence, outside the per-participant amount


def annotate(b: dict, band_lo: float = BAND_DEFAULT[0], band_hi: float = BAND_DEFAULT[1]) -> dict:
    """Add anchoring, band (low/high) and breakdowns to a terms.budget() result, in place; returns it."""
    lo, hi = check_band(band_lo, band_hi)
    std = {i["id"]: i for i in b["standard_schedule"]}
    rate = std["overhead"]["amount"]
    coord_item = std["coordinator"]
    coord_anchor = "open" if coord_item["edited"] else "standard"
    over_item = std["overhead"]
    over_item["assumption"] = True
    over_item["assumption_note"] = OVERHEAD_NOTE
    if not over_item["label"].endswith("(assumption)"):
        over_item["label"] = f"{over_item['label']} (assumption)"  # printed this way on the term sheet too

    for v in b["visits"]:
        lo_sum = hi_sum = 0.0
        for l in v["lines"]:
            a, why = classify(l)
            l["anchor"], l["anchor_reason"] = a, why
            # Only lines priced from a loaded CMS file move with the band; placeholders keep their point value.
            banded = a == "public" and l["medicare_amount"] is not None
            l["banded"] = banded
            if l["amount"] is None:
                l["low"] = l["high"] = None
            elif banded:
                l["low"] = _r2(_r2(l["medicare_amount"] * lo) * l["count"])
                l["high"] = _r2(_r2(l["medicare_amount"] * hi) * l["count"])
            else:
                l["low"] = l["high"] = l["amount"]
            if l["low"] is not None:
                lo_sum += l["low"]
                hi_sum += l["high"]
        coord = v["coordinator"]
        for side, s in (("low", _r2(lo_sum)), ("high", _r2(hi_sum))):
            over = _r2(rate * (s + coord))
            v[f"research_{side}"] = s
            v[f"overhead_{side}"] = over
            v[f"visit_{side}"] = _r2(s + coord + over)

    # The per-participant schedule: every non-repeating visit once, and a repeating visit whose count the schedule
    # fixes that many times (terms.budget counts them the same way); open-ended repeats are priced per occurrence.
    fixed = [(v, v.get("occurrences") or 1) for v in b["visits"] if v["kind"] != "repeat" or v.get("occurrences")]
    t = b["totals"]
    t["per_participant_low"] = _r2(sum(v["visit_low"] * k for v, k in fixed))
    t["per_participant_high"] = _r2(sum(v["visit_high"] * k for v, k in fixed))
    for x in t["per_occurrence"]:
        v = next(v for v in b["visits"] if v["visit_id"] == x["visit_id"])
        x["low"], x["high"] = v["visit_low"], v["visit_high"]
    scr = next(v for v in b["visits"] if v["kind"] == "screening")
    t["screen_failure_low"], t["screen_failure_high"] = scr["visit_low"], scr["visit_high"]

    b["band"] = {"lo": lo, "hi": hi, "label": "assumption", "note": BAND_NOTE,
                 "n_banded_lines": sum(1 for v, _ in fixed for l in v["lines"] if l["banded"]),
                 "point_multiplier": b["multiplier"]}
    b["anchoring"] = _anchoring(b, fixed, coord_anchor)
    b["anchoring"]["public_sources"] = _public_sources(b)
    b["breakdowns"] = _breakdowns(b, fixed)
    b["pricing_basis"] = {
        "pfs": RVU_BASIS, "pfs_column": "NON-FAC PE RVU column of the CMS PPRRVU file (non-facility setting)",
        "opps_included": False, "lab": LAB_NOTE if b.get("clfs_loaded") else LAB_NOTE + " " + LAB_NOTE_PLACEHOLDER,
        "lab_varies_by_site": False,
    }
    return b


def _locality_text(loc: dict | None) -> str:
    if not loc:
        return "national amounts (no U.S. Medicare locality resolved)"
    return f"{loc['state']} locality {loc['code']} {loc['name'].title()}"


def _clfs_source() -> str | None:
    """The loaded CLFS file, named by its zip; the loader reads that file's RATE column (national payment rate)."""
    from concord.ratecard import medicare

    src = (medicare._cms().get("clfs") or {}).get("source")  # noqa: SLF001 - same package
    if not src:
        return None
    return src.split(" (")[0] + ", RATE column (2026 national payment rate, not geographically adjusted)"


def _public_sources(b: dict) -> list[str]:
    """Named CMS files, year and locality behind the 'Anchored to public rates' share."""
    out = []
    if b.get("pfs_source"):
        out.append(f"{b['pfs_source']}; at {_locality_text(b.get('locality'))}; conversion factor "
                   f"{b.get('conversion_factor')}")
    clfs = _clfs_source() if b.get("clfs_loaded") else None
    if clfs:
        out.append(clfs)
    return out


def _share(rows: list[tuple[str, float, float, float, str]]) -> tuple[float, float, float, list[dict]]:
    a = _r2(sum(r[1] for r in rows))
    lo = _r2(sum(r[2] for r in rows))
    hi = _r2(sum(r[3] for r in rows))
    comps: dict[str, dict] = {}
    for label, amt, l, h, _ in rows:
        c = comps.setdefault(label, {"label": label, "amount": 0.0, "low": 0.0, "high": 0.0, "n": 0})
        c["amount"] += amt
        c["low"] += l
        c["high"] += h
        c["n"] += 1
    out = [{**c, "amount": _r2(c["amount"]), "low": _r2(c["low"]), "high": _r2(c["high"])} for c in comps.values()]
    return a, lo, hi, out


def _anchoring(b: dict, fixed: list[tuple[dict, int]], coord_anchor: str) -> dict:
    """Per-participant sponsor dollars by anchor; the three amounts add up to totals.per_participant."""
    rows: dict[str, list[tuple[str, float, float, float, str]]] = {"public": [], "standard": [], "open": []}
    n_lines = {"public": 0, "standard": 0, "open": 0}
    comp_label = {"PFS": "Physician fee schedule lines", "CLFS": "Lab fee schedule lines",
                  "Standard": "Proposed standard per-visit fees"}
    for v, k in fixed:
        for l in v["lines"]:
            if l["anchor"] is None:
                continue
            n_lines[l["anchor"]] += 1
            amt = l["amount"] or 0.0
            if l["anchor"] == "open":
                lab = ("Placeholder prices" if l.get("placeholder") else "Edited standard items" if l.get("edited")
                       else "Unpriced or no site charge")
            else:
                lab = comp_label.get(l["schedule"] or "", l["schedule"] or "Other")
            rows[l["anchor"]].append((lab, amt * k, (l["low"] or 0.0) * k, (l["high"] or 0.0) * k, l["node_id"]))
        if v["coordinator"]:
            c = v["coordinator"] * k
            rows[coord_anchor].append(("Coordinator time" + (" (edited)" if coord_anchor == "open" else ""),
                                       c, c, c, v["visit_id"]))
        rows["open"].append(("Overhead % (assumption)", v["overhead"] * k, v["overhead_low"] * k,
                             v["overhead_high"] * k, v["visit_id"]))
    total = b["totals"]["per_participant"]
    total_lo, total_hi = b["totals"]["per_participant_low"], b["totals"]["per_participant_high"]
    pub = _share(rows["public"])
    std = _share(rows["standard"])
    opn = _share(rows["open"])
    # Cent rounding between the per-visit totals and the per-line sums goes to "open" so the three add up exactly.
    amounts = {"public": pub[0], "standard": std[0], "open": _r2(total - pub[0] - std[0])}
    lows = {"public": pub[1], "standard": std[1], "open": _r2(total_lo - pub[1] - std[1])}
    highs = {"public": pub[2], "standard": std[2], "open": _r2(total_hi - pub[2] - std[2])}
    comps = {"public": pub[3], "standard": std[3], "open": opn[3]}
    shares = []
    for a in ANCHORS:
        k = a["id"]
        shares.append({**a, "amount": amounts[k], "pct": round(100 * amounts[k] / total, 1) if total else 0.0,
                       "low": lows[k], "high": highs[k], "n_lines": n_lines[k], "components": comps[k]})
    return {"total": total, "scope": b["totals"]["per_participant_scope"], "shares": shares,
            "rounding_to_open": _r2(amounts["open"] - opn[0]),
            "note": "Per participant, sponsor-paid only. Coordinator time and overhead are counted per visit; the "
                    "three shares add up to the per-participant amount."}


def _breakdowns(b: dict, fixed: list[tuple[dict, int]]) -> dict:
    t = b["totals"]

    def group(items: dict[str, list[float]], labels: list[tuple[str, str]]) -> list[dict]:
        out = []
        for k, lab in labels:
            if k in items:
                a, l, h, n = items[k]
                out.append({"id": k, "label": lab, "amount": _r2(a), "low": _r2(l), "high": _r2(h), "n_lines": int(n)})
        return out

    def add(d: dict, k: str, a: float, l: float, h: float, n: int = 1) -> None:
        cur = d.setdefault(k, [0.0, 0.0, 0.0, 0])
        cur[0] += a
        cur[1] += l
        cur[2] += h
        cur[3] += n

    by_type: dict[str, list[float]] = {}
    by_phase: dict[str, list[float]] = {}
    for v, k in fixed:
        for l in v["lines"]:
            if l["payer"] != "Sponsor":
                continue
            add(by_type, _cost_type(l), (l["amount"] or 0.0) * k, (l["low"] or 0.0) * k, (l["high"] or 0.0) * k)
        if v["coordinator"]:
            add(by_type, "coordinator", v["coordinator"] * k, v["coordinator"] * k, v["coordinator"] * k)
        add(by_type, "overhead", v["overhead"] * k, v["overhead_low"] * k, v["overhead_high"] * k)
        ph = _phase(v)
        if ph:
            add(by_phase, ph, v["visit_total"] * k, v["visit_low"] * k, v["visit_high"] * k,
                sum(1 for l in v["lines"] if l["payer"] == "Sponsor"))
    one_time = [i for i in b["standard_schedule"] if i["unit"] == "per_site"]
    sponsor_n = sum(1 for v, _ in fixed for l in v["lines"] if l["payer"] == "Sponsor")
    ins_n = sum(1 for v, _ in fixed for l in v["lines"] if l["payer"] == "Insurance")
    anchor_rows = [{"id": s["id"], "label": s["label"], "amount": s["amount"], "low": s["low"], "high": s["high"],
                    "n_lines": s["n_lines"]} for s in b["anchoring"]["shares"]]
    return {
        "scope": t["per_participant_scope"],
        "payer": [
            {"id": "sponsor", "label": "Sponsor (research-only items, coordinator time, overhead)",
             "amount": t["per_participant"], "low": t["per_participant_low"], "high": t["per_participant_high"],
             "n_lines": sponsor_n},
            {"id": "insurance", "label": "Routine care billed to insurance (Medicare rates, for reference)",
             "amount": t["per_participant_insurance_medicare"], "low": t["per_participant_insurance_medicare"],
             "high": t["per_participant_insurance_medicare"], "n_lines": ins_n, "not_sponsor": True},
        ],
        "cost_type": group(by_type, COST_TYPES),
        "visit": group(by_phase, PHASES),
        "anchoring": anchor_rows,
        "outside": {
            "one_time_fees": {"label": "One-time fees, per site (start-up, IRB, pharmacy setup, close-out, archiving)",
                              "amount": t["per_site_one_time"], "n_items": len(one_time)},
            "per_occurrence": [{"label": x["label"], "amount": x["amount"], "low": x["low"], "high": x["high"]}
                               for x in t["per_occurrence"]],
        },
        "note": "Each grouping except 'who pays' adds up to the sponsor's per-participant amount. Insurance is a "
                "different payer; one-time and per-occurrence payments are outside the per-participant amount.",
    }
