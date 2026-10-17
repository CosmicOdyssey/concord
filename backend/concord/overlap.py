"""Portfolio overlap audit: where one sponsor's own concurrent NSCLC trials overlap.

    python -m concord.overlap --self-overlap-out data/findings/self_overlap.json

Descriptive only. Every number this module returns is a count, a date or a share of a
synthetic population; nothing here predicts enrollment speed, time-to-fill or a rate
(app rule). Definitions, shared by the API (concord.api.overlap) and the self-overlap
statistic:

  recruiting on a date   status is not WITHDRAWN and start <= date < start + ENROLL_FRACTION x
                         (primary completion - start): service.build's as-of rule (completion date
                         when primary completion is missing). The window end is an estimate (0.65 of
                         start -> primary completion is an assumption). Unlike service.build, a trial
                         that registers no completion date at all has no window here (service.build
                         runs it to OPEN_END, which keeps 2005 trials "recruiting" in 2024): it is left
                         out and listed in the audit's excluded_open_ended.
  registered site        a trial_sites row whose site status is not WITHDRAWN (a withdrawn site never
                         took part). Region filters apply to the site's country/state.
  shared site            a registered site on both trials that is identifiable: sites registered
                         anonymously ("Research Site") are collapsed to one pseudo-site per city at
                         ingest, so they cannot be matched across trials and are never counted as
                         shared (or in other-sponsor counts).
  eligibility overlap    o_PQ = share of P's eligible synthetic patients also eligible for Q
                         (service.overlap_matrix on the 20k synthetic population). Criteria are
                         hand-encoded (compiler.overrides) where available, else the rule-based parse
                         in trial_model.criteria. A trial with no criteria at all describes everyone,
                         so its overlaps are not informative and are marked so.
  upper bound            either trial's DESIGN entry marks a required biomarker the population does not
                         model, a basket or multi-cohort design, or lists any unmodeled restriction.
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from functools import lru_cache
from itertools import combinations

import numpy as np

from concord import service
from concord.compiler.eligibility import Criterion, eligible_mask
from concord.compiler.overrides import DESIGN, OVERRIDES
from concord.model.recruitment import ENROLL_FRACTION
from concord.paths import DB_PATH, FINDINGS_DIR

OPEN_END = "2100-01-01"  # same stand-in as service.build for a trial with no completion date
DAYS_PER_MONTH = 30.44
UPPER_BOUND_DESIGNS = ("basket", "multi_cohort")
SITE_ROW_OK = "COALESCE({a}.site_status, '') <> 'WITHDRAWN'"
WORLD_LABEL = "All registered sites worldwide (ClinicalTrials.gov)"
SELF_OVERLAP_OUT = FINDINGS_DIR / "self_overlap.json"


# ---------------------------------------------------------------- shared definitions

def _con() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError("concord.db missing: run scripts/pipeline.sh first")
    con = sqlite3.connect(f"{DB_PATH.resolve().as_uri()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def recruiting_sql(a: str = "t", open_ended: bool = False) -> str:
    """Two parameters: (as_of, as_of). service.build's as-of rule; open_ended=False (default) also
    requires a registered completion date, so the window is defined."""
    sql = (f"{a}.status NOT IN ('WITHDRAWN') AND {a}.start_date <= ? AND julianday({a}.start_date) + "
           f"{ENROLL_FRACTION} * (julianday(COALESCE({a}.primary_completion_date, {a}.completion_date, "
           f"'{OPEN_END}')) - julianday({a}.start_date)) > julianday(?)")
    return sql if open_ended else f"{sql} AND COALESCE({a}.primary_completion_date, {a}.completion_date) IS NOT NULL"


def region_sql(region: str | None, a: str = "s") -> tuple[str, list, str]:
    """(SQL over sites alias `a`, args, label). None or "" = every registered site worldwide."""
    if not region:
        return "1=1", [], WORLD_LABEL
    if region not in service.REGIONS:
        raise ValueError(f"unknown region {region}; one of {list(service.REGIONS)} or empty for worldwide")
    states = service.REGIONS[region]
    sql = f"{a}.country='United States'"
    if states:
        sql += f" AND {a}.state IN ({','.join('?' * len(states))})"
        return sql, list(states), f"{region} (U.S. sites in {len(states)} states)"
    return sql, [], "All U.S. sites"


def check_date(as_of: str | None) -> str:
    if not as_of:
        return date.today().isoformat()
    try:
        return date.fromisoformat(as_of).isoformat()
    except ValueError:
        raise ValueError(f"as_of must be YYYY-MM-DD, got {as_of!r}")


def window(start: str, primary_completion: str | None, completion: str | None) -> dict:
    """Estimated enrollment window [start, end) in ordinal days (end fractional), as in service.build."""
    s = date.fromisoformat(start).toordinal()
    ref_src = primary_completion or completion
    ref = date.fromisoformat(ref_src or OPEN_END).toordinal()
    end = s + ENROLL_FRACTION * (ref - s)
    return {"start": s, "end": end, "open_ended": ref_src is None,
            "basis": ("primary completion" if primary_completion else "completion date" if completion
                      else "no completion date registered (open-ended)")}


def _iso(ordinal: float) -> str:
    return date.fromordinal(int(math.floor(ordinal))).isoformat()


def overlap_window(w1: dict, w2: dict, since: int | None = None) -> tuple[float, float] | None:
    """Ordinal [lo, hi) where both windows are open (optionally from `since` on), or None."""
    lo = max(w1["start"], w2["start"], since if since is not None else -math.inf)
    hi = min(w1["end"], w2["end"])
    return (lo, hi) if hi > lo else None


def criteria_for(nct_id: str, parsed_json: str | None) -> tuple[list[Criterion], str]:
    if nct_id in OVERRIDES:
        return OVERRIDES[nct_id], "hand-encoded"
    return [Criterion(**c) for c in json.loads(parsed_json or "[]")], "rule-based parse"


def upper_bound_reasons(nct_id: str) -> list[str]:
    d = DESIGN.get(nct_id)
    if not d:
        return []
    out = []
    if d.get("requires_unmodeled_biomarker"):
        out.append("requires a biomarker the synthetic population does not model")
    if d.get("design") in UPPER_BOUND_DESIGNS:
        out.append(f"{d['design'].replace('_', '-')} design: cohorts the single population cannot represent")
    if d.get("unmodeled"):
        n = len(d["unmodeled"])
        out.append(f"{n} restriction{'s' if n != 1 else ''} not modeled")
    return out


def _same(a: Criterion, b: Criterion) -> bool:
    return (a.kind, a.feature, a.op, json.dumps(a.value)) == (b.kind, b.feature, b.op, json.dumps(b.value))


def criteria_diff(cp: list[Criterion], cq: list[Criterion]) -> dict:
    """Match on criterion id. `shared_differs`: same id, different predicate (e.g. other stage list)."""
    ip, iq = {c.id: c for c in cp}, {c.id: c for c in cq}
    shared = [i for i in ip if i in iq]
    return {"only_p": [i for i in ip if i not in iq], "only_q": [i for i in iq if i not in ip],
            "shared": shared, "shared_differs": [i for i in shared if not _same(ip[i], iq[i])]}


# ---------------------------------------------------------------- API: sponsors

def sponsors(as_of: str | None = None, region: str | None = None, min_trials: int = 2) -> dict:
    """Industry lead sponsors with >= min_trials lung trials recruiting on the date (with a registered
    site in the region, when one is given)."""
    as_of = check_date(as_of)
    rsql, rargs, label = region_sql(region)
    in_region = "" if not region else (
        f" AND EXISTS (SELECT 1 FROM trial_sites ts JOIN sites s USING(site_id) WHERE ts.nct_id=t.nct_id AND "
        f"{SITE_ROW_OK.format(a='ts')} AND {rsql})")
    con = _con()
    rows = con.execute(f"""
        SELECT t.sponsor, COUNT(*) AS n FROM trials t
        WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND {recruiting_sql()}{in_region}
        GROUP BY t.sponsor HAVING COUNT(*) >= ? ORDER BY n DESC, t.sponsor""",
                       [as_of, as_of] + rargs + [min_trials]).fetchall()
    con.close()
    return {"as_of": as_of, "region": region or None, "region_label": label,
            "sponsors": [{"sponsor": r["sponsor"], "trials": r["n"]} for r in rows]}


# ---------------------------------------------------------------- API: the audit

def _round(x: float) -> float:
    return round(float(x), 4)


@lru_cache(maxsize=64)
def _audit_cached(sponsor: str, as_of: str, region: str | None) -> str:
    return json.dumps(_audit(sponsor, as_of, region))


def audit(sponsor: str, as_of: str | None = None, region: str | None = None) -> dict:
    return json.loads(_audit_cached(sponsor, check_date(as_of), region or None))


def _audit(sponsor: str, as_of: str, region: str | None) -> dict:
    rsql, rargs, label = region_sql(region)
    in_region = "" if not region else (
        f" AND EXISTS (SELECT 1 FROM trial_sites ts JOIN sites s USING(site_id) WHERE ts.nct_id=t.nct_id AND "
        f"{SITE_ROW_OK.format(a='ts')} AND {rsql})")
    con = _con()
    known = con.execute("SELECT COUNT(*) FROM trials WHERE sponsor=? AND is_lung=1", (sponsor,)).fetchone()[0]
    trows = con.execute(f"""
        SELECT t.nct_id, t.title, t.acronym, t.status, t.phases, t.sponsor, t.sponsor_class, t.start_date,
               t.primary_completion_date, t.primary_completion_type, t.completion_date, t.enrollment,
               t.enrollment_type, tm.criteria
        FROM trials t LEFT JOIN trial_model tm USING(nct_id)
        WHERE t.is_lung=1 AND t.sponsor=? AND {recruiting_sql()}{in_region}
        ORDER BY t.start_date, t.nct_id""", [sponsor, as_of, as_of] + rargs).fetchall()
    excluded_open_ended = [r[0] for r in con.execute(f"""
        SELECT t.nct_id FROM trials t
        WHERE t.is_lung=1 AND t.sponsor=? AND {recruiting_sql(open_ended=True)}
          AND t.primary_completion_date IS NULL AND t.completion_date IS NULL{in_region}
        ORDER BY t.nct_id""", [sponsor, as_of, as_of] + rargs)]
    ids = [r["nct_id"] for r in trows]
    ph = ",".join("?" * len(ids))

    # Registered sites of the sponsor's trials (in region).
    sites: dict[str, dict] = {}
    trial_sites: dict[str, list[str]] = defaultdict(list)
    for r in con.execute(f"""
            SELECT ts.nct_id, s.site_id, s.facility, s.city, s.state, s.country, s.anonymized
            FROM trial_sites ts JOIN sites s USING(site_id)
            WHERE ts.nct_id IN ({ph}) AND {SITE_ROW_OK.format(a='ts')} AND {rsql}""", ids + rargs) if ids else []:
        trial_sites[r["nct_id"]].append(r["site_id"])
        sites.setdefault(r["site_id"], {"site_id": r["site_id"], "facility": r["facility"], "city": r["city"],
                                        "state": r["state"], "country": r["country"],
                                        "anonymized": bool(r["anonymized"])})
    identified = {sid for sid, s in sites.items() if not s["anonymized"]}

    # Other sponsors' lung trials (any sponsor class, any phase) recruiting on the date at those sites.
    others_at: dict[str, set[str]] = defaultdict(set)
    other_class: dict[str, str] = {}
    if identified:
        sid_list = sorted(identified)
        for i in range(0, len(sid_list), 900):
            chunk = sid_list[i:i + 900]
            for r in con.execute(f"""
                    SELECT ts.site_id, t.nct_id, t.sponsor_class FROM trial_sites ts JOIN trials t USING(nct_id)
                    WHERE ts.site_id IN ({','.join('?' * len(chunk))}) AND {SITE_ROW_OK.format(a='ts')}
                      AND t.is_lung=1 AND COALESCE(t.sponsor, '') <> ? AND {recruiting_sql()}""",
                                 chunk + [sponsor, as_of, as_of]):
                others_at[r["site_id"]].add(r["nct_id"])
                other_class[r["nct_id"]] = r["sponsor_class"]
    for sid in sites:
        sites[sid]["other_sponsor_trials"] = len(others_at[sid]) if sid in identified else None
    con.close()

    pop = service.population()
    crits, sources, masks, wins, trials = [], [], [], [], []
    for r in trows:
        c, src = criteria_for(r["nct_id"], r["criteria"])
        m = eligible_mask(c, pop)
        w = window(r["start_date"], r["primary_completion_date"], r["completion_date"])
        crits.append(c); sources.append(src); masks.append(m); wins.append(w)
        own = trial_sites[r["nct_id"]]
        own_id = [s for s in own if s in identified]
        other = set().union(*(others_at[s] for s in own_id)) if own_id else set()
        d = DESIGN.get(r["nct_id"])
        reasons = upper_bound_reasons(r["nct_id"])
        trials.append({
            "nct_id": r["nct_id"], "title": r["title"], "acronym": r["acronym"], "status_now": r["status"],
            "phases": json.loads(r["phases"] or "[]"), "start_date": r["start_date"],
            "primary_completion_date": r["primary_completion_date"],
            "primary_completion_type": r["primary_completion_type"], "completion_date": r["completion_date"],
            "estimated_window_end": _iso(w["end"]), "window_basis": w["basis"], "open_ended": w["open_ended"],
            "enrollment_registered": r["enrollment"], "enrollment_type": r["enrollment_type"],
            "n_sites": len(own), "n_sites_identified": len(own_id), "n_sites_anonymized": len(own) - len(own_id),
            "site_ids": sorted(own, key=lambda s: (sites[s]["anonymized"], -(sites[s]["other_sponsor_trials"] or 0),
                                                   sites[s]["facility"] or "")),
            "eligibility_source": src, "criteria": [x.to_dict() for x in c], "no_criteria": not c,
            "eligible_share": _round(m.mean()),
            "design": d.get("design") if d else None, "design_reason": d.get("design_reason") if d else None,
            "unmodeled": list(d.get("unmodeled") or []) if d else [],
            "requires_unmodeled_biomarker": bool(d.get("requires_unmodeled_biomarker")) if d else False,
            "design_confidence": d.get("confidence") if d else None,
            "upper_bound": bool(reasons), "upper_bound_reasons": reasons,
            "other_sponsor_trials_at_sites": len(other),
            "other_sponsor_trials_at_sites_industry": sum(other_class[n] == "INDUSTRY" for n in other),
        })

    o = service.overlap_matrix(np.array(masks)) if masks else np.zeros((0, 0))
    pairs = []
    for i, j in combinations(range(len(trows)), 2):
        tp, tq = trials[i], trials[j]
        shared = sorted(set(tp["site_ids"]) & set(tq["site_ids"]) & identified,
                        key=lambda s: (-(sites[s]["other_sponsor_trials"] or 0), sites[s]["facility"] or ""))
        ov = overlap_window(wins[i], wins[j])
        # Both list an anonymized site in the same city: same pseudo-site id, facility unknown. Not a shared site.
        anon_same_city = len((set(tp["site_ids"]) & set(tq["site_ids"])) - identified)
        pairs.append({
            "p": tp["nct_id"], "q": tq["nct_id"], "shared_sites": len(shared), "shared_site_ids": shared,
            "anonymized_same_city": anon_same_city,
            "o_pq": _round(o[i, j]), "o_qp": _round(o[j, i]),
            "overlap_informative": not (tp["no_criteria"] or tq["no_criteria"]),
            "months_both_recruiting_estimated": round((ov[1] - ov[0]) / DAYS_PER_MONTH, 1) if ov else 0.0,
            "both_recruiting_from": _iso(ov[0]) if ov else None, "both_recruiting_to": _iso(ov[1]) if ov else None,
            "open_ended": tp["open_ended"] or tq["open_ended"],
            "upper_bound": tp["upper_bound"] or tq["upper_bound"],
            "criteria_diff": criteria_diff(crits[i], crits[j]),
        })

    return {
        "sponsor": sponsor, "sponsor_known": known > 0, "as_of": as_of, "region": region, "region_label": label,
        "trials": trials, "pairs": pairs, "sites": sites, "excluded_open_ended": excluded_open_ended,
        "n_sites": len(sites), "n_sites_anonymized": len(sites) - len(identified),
        "population": {"n": int(len(next(iter(pop.values())))), "seed": 7,
                       "note": "Synthetic advanced-NSCLC population; prevalences are rounded modeling "
                               "assumptions, not patient data."},
        "definitions": {
            "recruiting_on_date": f"status not WITHDRAWN and start <= date < start + {ENROLL_FRACTION} x (primary "
                                  "completion - start); the window end is an estimate",
            "excluded_open_ended": "the sponsor's trials started by the date that register no completion date at "
                                   "all (no window can be estimated); left out",
            "registered_sites": "trial_sites rows whose site status is not WITHDRAWN, in the region if one is given",
            "shared_sites": "identifiable registered sites on both trials; anonymized per-city pseudo-sites are "
                            "never counted as shared",
            "anonymized_same_city": "cities where both trials list an anonymized site (facility unknown; not "
                                    "counted as shared)",
            "o_pq": "share of P's eligible synthetic patients who also meet Q's encoded criteria",
            "other_sponsor_trials_at_sites": "distinct lung trials of other lead sponsors (any sponsor class, any "
                                             "phase) recruiting on the date at the trial's identifiable sites",
            "upper_bound": "a required biomarker or cohort restriction the synthetic population can't represent",
            "criteria_diff": "criterion ids; details in trials[].criteria",
        },
    }


# ---------------------------------------------------------------- self-overlap statistic

def self_overlap(min_sites: int = 10, min_overlap: float = 0.8, since: str = "2015-01-01",
                 context_sites: int = 5) -> dict:
    """Same-sponsor pairs of industry NSCLC trials that ran at the same time, at the same sites, for
    nearly the same patients."""
    since_o = date.fromisoformat(since).toordinal()
    con = _con()
    rows = con.execute("""
        SELECT t.nct_id, t.sponsor, t.phases, t.start_date, t.primary_completion_date, t.completion_date,
               tm.criteria
        FROM trials t LEFT JOIN trial_model tm USING(nct_id)
        WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND t.start_date IS NOT NULL
          AND t.status NOT IN ('WITHDRAWN')
        ORDER BY t.sponsor, t.start_date, t.nct_id""").fetchall()
    site_sets: dict[str, set[str]] = defaultdict(set)
    for nct, sid in con.execute(f"""
            SELECT ts.nct_id, ts.site_id FROM trial_sites ts JOIN sites s USING(site_id) JOIN trials t USING(nct_id)
            WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND s.anonymized=0 AND {SITE_ROW_OK.format(a='ts')}"""):
        site_sets[nct].add(sid)
    n_trials_db = con.execute("SELECT COUNT(*) FROM trials WHERE is_lung=1 AND sponsor_class='INDUSTRY'").fetchone()[0]
    # Trials whose registered sites are mostly anonymized cannot show shared sites (count is a floor for them).
    mostly_anon = {nct for nct, n, a in con.execute(f"""
            SELECT ts.nct_id, COUNT(*), SUM(s.anonymized) FROM trial_sites ts JOIN sites s USING(site_id)
            JOIN trials t USING(nct_id) WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY'
              AND {SITE_ROW_OK.format(a='ts')} GROUP BY ts.nct_id""") if a > n / 2}
    con.close()

    pop = service.population()
    by_sponsor: dict[str, list] = defaultdict(list)
    for r in rows:
        by_sponsor[r["sponsor"]].append(r)

    tally = defaultdict(int)
    hits, sponsors_hit = [], set()
    for sponsor, rs in by_sponsor.items():
        if len(rs) < 2:
            continue
        info = []
        for r in rs:
            c, src = criteria_for(r["nct_id"], r["criteria"])
            info.append({"nct": r["nct_id"], "crit": c, "src": src, "mask": eligible_mask(c, pop),
                         "win": window(r["start_date"], r["primary_completion_date"], r["completion_date"]),
                         "phases": json.loads(r["phases"] or "[]"), "ub": upper_bound_reasons(r["nct_id"])})
        o = service.overlap_matrix(np.array([x["mask"] for x in info]))
        for i, j in combinations(range(len(info)), 2):
            a, b = info[i], info[j]
            ov = overlap_window(a["win"], b["win"], since=since_o)
            if not ov:
                continue
            tally["concurrent_pairs"] += 1
            shared = len(site_sets[a["nct"]] & site_sets[b["nct"]])
            if shared < context_sites:
                continue
            # An empty criteria list describes everyone (passes the overlap test trivially); a window with no
            # completion date runs to the 2100 stand-in, so "open after 2015" would be an artifact.
            excluded = ("no_criteria" if not (a["crit"] and b["crit"]) else
                        "open_ended" if a["win"]["open_ended"] or b["win"]["open_ended"] else None)
            close = max(o[i, j], o[j, i]) >= min_overlap
            ub = bool(a["ub"] or b["ub"])
            for k, thr in (("min_sites", min_sites), ("context_sites", context_sites)):
                if shared < thr:
                    continue
                tally[f"concurrent_pairs_{k}"] += 1
                if close and excluded:
                    tally[f"excluded_{excluded}_{k}"] += 1
                elif close:
                    tally[f"count_{k}"] += 1
                    tally[f"upper_bound_{k}"] += ub
            if shared < min_sites or excluded or not close:
                continue
            sponsors_hit.add(sponsor)
            full = overlap_window(a["win"], b["win"])
            p23 = all(any(x in ("PHASE2", "PHASE3") for x in t["phases"]) for t in (a, b))
            hits.append({
                "sponsor": sponsor, "p": a["nct"], "q": b["nct"], "shared_sites": shared,
                "o_pq": _round(o[i, j]), "o_qp": _round(o[j, i]),
                "overlap_months_estimated": round((full[1] - full[0]) / DAYS_PER_MONTH, 1),
                "both_recruiting_from": _iso(full[0]), "both_recruiting_to": _iso(full[1]),
                "upper_bound": ub, "upper_bound_reasons": {a["nct"]: a["ub"], b["nct"]: b["ub"]},
                "eligibility_source": {a["nct"]: a["src"], b["nct"]: b["src"]},
                "phases": {a["nct"]: a["phases"], b["nct"]: b["phases"]}, "both_phase2_or_3": p23,
            })
    hits.sort(key=lambda h: (-h["shared_sites"], h["sponsor"], h["p"], h["q"]))
    src_mix = defaultdict(int)
    for h in hits:
        s = sorted(h["eligibility_source"].values())
        src_mix["both hand-encoded" if s == ["hand-encoded"] * 2 else "both rule-based parse"
                if s == ["rule-based parse"] * 2 else "one of each"] += 1
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "definition": (
            f"Same-sponsor pairs of NSCLC trials (is_lung = 1, industry lead sponsor, status not WITHDRAWN, any "
            f"phase) whose estimated enrollment windows (start to start + {ENROLL_FRACTION} x (primary completion "
            f"- start)) are both open on some date on or after {since}, that share >= {min_sites} identifiable "
            f"registered sites (worldwide; site rows withdrawn from the trial and anonymized per-city pseudo-sites "
            f"excluded), and whose eligibility overlap on the synthetic population is >= {min_overlap} in at least "
            f"one direction (o_PQ = share of P's eligible patients also eligible for Q: one population nearly "
            f"contained in the other). Excluded and counted separately: pairs where either trial has no encoded "
            f"criteria (an empty criteria list describes everyone and passes the overlap test trivially) and pairs "
            f"where either trial registers no completion date at all (its window would run to the 2100-01-01 "
            f"stand-in, so 'open after {since}' would be an artifact)."),
        "parameters": {"min_shared_sites": min_sites, "min_overlap_one_direction": min_overlap, "since": since,
                       "context_min_shared_sites": context_sites, "enroll_fraction": ENROLL_FRACTION,
                       "population_n": int(len(next(iter(pop.values())))), "population_seed": 7},
        "count": tally["count_min_sites"],
        "upper_bound_count": tally["upper_bound_min_sites"],
        "sponsors_with_pairs": len(sponsors_hit),
        "count_both_phase2_or_3": sum(h["both_phase2_or_3"] for h in hits),
        "count_by_eligibility_source": dict(src_mix),
        "context": {
            f"count_at_min_{context_sites}_shared_sites": tally["count_context_sites"],
            f"upper_bound_count_at_min_{context_sites}_shared_sites": tally["upper_bound_context_sites"],
            "concurrent_same_sponsor_pairs_since": tally["concurrent_pairs"],
            f"concurrent_pairs_sharing_min_{min_sites}_sites": tally["concurrent_pairs_min_sites"],
            f"concurrent_pairs_sharing_min_{context_sites}_sites": tally["concurrent_pairs_context_sites"],
            f"excluded_no_criteria_at_min_{min_sites}_sites": tally["excluded_no_criteria_min_sites"],
            f"excluded_no_criteria_at_min_{context_sites}_sites": tally["excluded_no_criteria_context_sites"],
            f"excluded_open_ended_window_at_min_{min_sites}_sites": tally["excluded_open_ended_min_sites"],
            f"excluded_open_ended_window_at_min_{context_sites}_sites": tally["excluded_open_ended_context_sites"],
            "industry_lung_trials_in_db": n_trials_db,
            "industry_lung_trials_considered": len(rows),
            "industry_sponsors_with_2plus_trials": sum(len(v) >= 2 for v in by_sponsor.values()),
            "considered_trials_with_mostly_anonymized_sites": sum(r["nct_id"] in mostly_anon for r in rows),
        },
        "notes": [
            "Descriptive: counts of registered sites, estimated enrollment windows and synthetic-population "
            "eligibility shares. Nothing here predicts enrollment speed.",
            "upper_bound: either trial's hand-encoded design entry lists a required biomarker the population does "
            "not model, a basket or multi-cohort design, or any unmodeled restriction; the overlap shown is then a "
            "ceiling on the modeled populations, not a measurement.",
            "Overlap months are the full overlap of the two estimated windows (not only the part after the "
            "cut-off date).",
            "Site lists are as registered on ClinicalTrials.gov today; a site's activation dates are not public.",
            "The count is a floor: sponsors that register their sites anonymously ('Research Site'; see "
            "context.considered_trials_with_mostly_anonymized_sites) cannot show identifiable shared sites, and "
            "different lead-sponsor strings of one company are not merged.",
        ],
        "pairs": hits,
    }


def main(argv: list[str] | None = None) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--self-overlap-out", default=str(SELF_OVERLAP_OUT))
    ap.add_argument("--min-sites", type=int, default=10)
    ap.add_argument("--min-overlap", type=float, default=0.8)
    ap.add_argument("--since", default="2015-01-01")
    args = ap.parse_args(argv)
    res = self_overlap(args.min_sites, args.min_overlap, args.since)
    from pathlib import Path
    out = Path(args.self_overlap_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"self-overlap pairs: {res['count']} (upper bound {res['upper_bound_count']}) across "
          f"{res['sponsors_with_pairs']} sponsors; context: {json.dumps(res['context'])}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
