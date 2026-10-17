"""Portfolio overlap audit: where one sponsor's own concurrent NSCLC trials overlap.

    python -m concord.overlap --self-overlap-out data/findings/self_overlap.json

Descriptive only. Every number this module returns is a count, a date or a share of a
synthetic population; nothing here predicts enrollment speed, time-to-fill or a rate
(app rule). Definitions, shared by the API (concord.api.overlap) and the self-overlap
statistic:

  snapshot               the date of the registry download (latest last_update in the DB). Dates after
                         it are refused: the audit describes the registry and never projects forward.
  recruiting on a date   service.build's as-of rule, bounded by the registry status at the snapshot.
                         Estimated window: start <= date < start + ENROLL_FRACTION x (primary
                         completion - start) (completion date when primary completion is missing; 0.65
                         is an assumption, so the end is an estimate). Then the status CT.gov lists at
                         the snapshot overrides the estimate: RECRUITING / ENROLLING_BY_INVITATION
                         trials are recruiting on every date from their start through the snapshot;
                         any other status (active not recruiting, completed, terminated, suspended,
                         unknown) means the window closed by the snapshot; WITHDRAWN and
                         NOT_YET_RECRUITING trials never recruited. On the snapshot date itself this
                         reduces to the CT.gov status (a registered fact, no estimate). A trial with a
                         closed status that registers no completion date has no window (service.build
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
  criteria diff          matched by concept (the patient attribute a criterion restricts; driver-mutation
                         requirements, which combine with OR, form one concept), not by criterion id:
                         the two encoders use different ids for one idea (stage_adv vs stage_iv). A
                         shared concept is "same" when it selects the same synthetic patients.
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
from concord.compiler.eligibility import OR_GROUPS, Criterion, eligible_mask
from concord.compiler.overrides import DESIGN, OVERRIDES
from concord.model.recruitment import ENROLL_FRACTION
from concord.paths import DB_PATH, FINDINGS_DIR

OPEN_END = "2100-01-01"  # same stand-in as service.build for a trial with no completion date
DAYS_PER_MONTH = 30.44
UPPER_BOUND_DESIGNS = ("basket", "multi_cohort")
SITE_ROW_OK = "COALESCE({a}.site_status, '') <> 'WITHDRAWN'"
WORLD_LABEL = "All registered sites worldwide (ClinicalTrials.gov)"
SELF_OVERLAP_OUT = FINDINGS_DIR / "self_overlap.json"
# CT.gov statuses that mean "open to enrollment" at the snapshot, and those that mean it never opened.
OPEN_STATUSES = ("RECRUITING", "ENROLLING_BY_INVITATION")
NEVER_STATUSES = ("WITHDRAWN", "NOT_YET_RECRUITING")
DRIVER_CONCEPT = "driver requirement"  # OR_GROUPS criteria combine with OR: one concept
SPARSE_CRITERIA = 2  # a trial with this few encoded criteria admits most of the population


# ---------------------------------------------------------------- shared definitions

def _con() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise FileNotFoundError("concord.db missing: run scripts/pipeline.sh first")
    con = sqlite3.connect(f"{DB_PATH.resolve().as_uri()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


@lru_cache(maxsize=1)
def snapshot_date() -> str:
    """The registry download date: the latest last_update in the DB (today's date if none is recorded)."""
    con = _con()
    s = con.execute("SELECT MAX(last_update) FROM trials").fetchone()[0]
    con.close()
    return date.fromisoformat(s[:10]).isoformat() if s else date.today().isoformat()


def _sq(values: tuple[str, ...]) -> str:
    return ",".join(f"'{v}'" for v in values)


def recruiting_clause(as_of: str, a: str = "t", open_ended: bool = False, snap: str | None = None) -> tuple[str, list]:
    """(SQL, args) for "recruiting on as_of" (as_of <= snapshot): the estimated window bounded by the CT.gov
    status at the snapshot (module docstring). open_ended=True also admits closed-status trials that register no
    completion date (used only to list them as excluded). `snap` overrides the lung DB's snapshot (another
    indication's DB, concord.indications.sites)."""
    snap = snap or snapshot_date()
    pc = f"COALESCE({a}.primary_completion_date, {a}.completion_date)"
    est = (f"julianday({a}.start_date) + {ENROLL_FRACTION} * (julianday(COALESCE({pc}, '{OPEN_END}')) - "
           f"julianday({a}.start_date))")
    closed = f"MIN({est}, julianday(?)) > julianday(?)"
    if not open_ended:
        closed += f" AND {pc} IS NOT NULL"
    sql = (f"{a}.start_date IS NOT NULL AND {a}.start_date <= ? AND {a}.status NOT IN ({_sq(NEVER_STATUSES)}) "
           f"AND ({a}.status IN ({_sq(OPEN_STATUSES)}) OR ({closed}))")
    return sql, [as_of, snap, as_of]


def basis(as_of: str) -> str:
    """'registry': as_of is the snapshot, so recruiting = the CT.gov status; 'estimated': an earlier date."""
    return "registry" if as_of >= snapshot_date() else "estimated"


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
    """YYYY-MM-DD, at most the snapshot (default: the snapshot)."""
    snap = snapshot_date()
    if not as_of:
        return snap
    try:
        d = date.fromisoformat(as_of).isoformat()
    except ValueError:
        raise ValueError(f"as_of must be YYYY-MM-DD, got {as_of!r}") from None
    if d > snap:
        raise ValueError(f"as_of {d} is after the registry snapshot ({snap}): the audit describes what "
                         "ClinicalTrials.gov registers and does not project forward")
    return d


def window(start: str, primary_completion: str | None, completion: str | None, status: str | None = None,
           snapshot: str | None = None) -> dict:
    """Enrollment window [start, end) in ordinal days (end fractional). `estimate_end` is service.build's
    estimate (start + 0.65 x (primary completion - start)). With a status and a snapshot, `end` is bounded
    by the CT.gov status at the snapshot (module docstring): an open trial runs through the snapshot
    (end = snapshot + 1 day), any other status closes by the snapshot. Without them, end = the estimate."""
    s = date.fromisoformat(start).toordinal()
    ref_src = primary_completion or completion
    ref = date.fromisoformat(ref_src or OPEN_END).toordinal()
    est = s + ENROLL_FRACTION * (ref - s)
    end, open_now = est, False
    if status is not None and snapshot is not None:
        snap = date.fromisoformat(snapshot).toordinal()
        open_now = status in OPEN_STATUSES
        end = snap + 1 if open_now else min(est, snap)
    return {"start": s, "end": end, "estimate_end": None if ref_src is None else est,
            "open_ended": ref_src is None, "recruiting_at_snapshot": open_now,
            "bounded_by_status": status is not None and snapshot is not None and end != est,
            "basis": ("primary completion" if primary_completion else "completion date" if completion
                      else "no completion date registered (open-ended)")}


def _iso(ordinal: float) -> str:
    return date.fromordinal(int(math.floor(ordinal))).isoformat()


def overlap_window(w1: dict, w2: dict, since: int | None = None,
                   until: int | None = None) -> tuple[float, float] | None:
    """Ordinal [lo, hi) where both windows are open (optionally from `since` on, up to `until`), or None."""
    lo = max(w1["start"], w2["start"], since if since is not None else -math.inf)
    hi = min(w1["end"], w2["end"], until if until is not None else math.inf)
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


def concept(c: Criterion) -> str:
    """The patient attribute a criterion restricts. Driver-mutation requirements combine with OR
    (eligibility.OR_GROUPS), so together they are one concept."""
    return DRIVER_CONCEPT if c.id in OR_GROUPS else c.feature


def _by_concept(cs: list[Criterion]) -> dict[str, list[Criterion]]:
    out: dict[str, list[Criterion]] = {}
    for c in cs:
        out.setdefault(concept(c), []).append(c)
    return out


def _predicates(cs: list[Criterion]) -> list[tuple]:
    return sorted((c.kind, c.feature, c.op, json.dumps(c.value)) for c in cs)


def criteria_diff(cp: list[Criterion], cq: list[Criterion], pop: dict | None = None) -> dict:
    """Match by concept, not criterion id (hand-encoded and parsed criteria, and hand-encoded trials among
    themselves, use different ids for one idea: stage_adv / stage_iv, no_active_cns / no_active_brain_mets).
    A shared concept is `same` when both trials' criteria on it select the same synthetic patients (with
    `pop`), else when the predicates are identical. Ids index trials[].criteria."""
    gp, gq = _by_concept(cp), _by_concept(cq)
    shared = []
    for k, ps in gp.items():
        if k not in gq:
            continue
        qs = gq[k]
        same = (bool(np.array_equal(eligible_mask(ps, pop), eligible_mask(qs, pop))) if pop is not None
                else _predicates(ps) == _predicates(qs))
        shared.append({"concept": k, "p": [c.id for c in ps], "q": [c.id for c in qs], "same": same})
    return {"match": "concept",
            "only_p": [c.id for k, cs in gp.items() if k not in gq for c in cs],
            "only_q": [c.id for k, cs in gq.items() if k not in gp for c in cs],
            "shared": shared}


# ---------------------------------------------------------------- API: sponsors

def sponsors(as_of: str | None = None, region: str | None = None, min_trials: int = 2) -> dict:
    """Industry lead sponsors with >= min_trials lung trials recruiting on the date (with a registered
    site in the region, when one is given)."""
    as_of = check_date(as_of)
    rsql, rargs, label = region_sql(region)
    in_region = "" if not region else (
        f" AND EXISTS (SELECT 1 FROM trial_sites ts JOIN sites s USING(site_id) WHERE ts.nct_id=t.nct_id AND "
        f"{SITE_ROW_OK.format(a='ts')} AND {rsql})")
    rec, rec_args = recruiting_clause(as_of)
    con = _con()
    rows = con.execute(f"""
        SELECT t.sponsor, COUNT(*) AS n FROM trials t
        WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND {rec}{in_region}
        GROUP BY t.sponsor HAVING COUNT(*) >= ? ORDER BY n DESC, t.sponsor""",
                       rec_args + rargs + [min_trials]).fetchall()
    # Share of each sponsor's registered site rows that name a real site. Some sponsors (e.g. AstraZeneca)
    # anonymize every site ("Research Site"), so no site can be matched across their trials.
    ident: dict[str, tuple[int, int]] = {}
    for sp, n, anon in con.execute(f"""
            SELECT t.sponsor, COUNT(*), SUM(s.anonymized) FROM trials t
            JOIN trial_sites ts USING(nct_id) JOIN sites s USING(site_id)
            WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND {rec}
              AND {SITE_ROW_OK.format(a='ts')} AND {rsql}
            GROUP BY t.sponsor""", rec_args + rargs).fetchall():
        ident[sp] = (int(n), int(anon or 0))
    con.close()

    def entry(r):
        n, anon = ident.get(r["sponsor"], (0, 0))
        return {"sponsor": r["sponsor"], "trials": r["n"], "site_rows": n,
                "identified_share": (round((n - anon) / n, 4) if n else None)}

    return {"as_of": as_of, "snapshot_date": snapshot_date(), "basis": basis(as_of), "region": region or None,
            "region_label": label, "sponsors": [entry(r) for r in rows]}


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
    snap = snapshot_date()
    snap_o = date.fromisoformat(snap).toordinal()
    rec, rec_args = recruiting_clause(as_of)
    rec_open, rec_open_args = recruiting_clause(as_of, open_ended=True)
    con = _con()
    known = con.execute("SELECT COUNT(*) FROM trials WHERE sponsor=? AND is_lung=1", (sponsor,)).fetchone()[0]
    trows = con.execute(f"""
        SELECT t.nct_id, t.title, t.acronym, t.status, t.phases, t.sponsor, t.sponsor_class, t.start_date,
               t.primary_completion_date, t.primary_completion_type, t.completion_date, t.enrollment,
               t.enrollment_type, tm.criteria
        FROM trials t LEFT JOIN trial_model tm USING(nct_id)
        WHERE t.is_lung=1 AND t.sponsor=? AND {rec}{in_region}
        ORDER BY t.start_date, t.nct_id""", [sponsor] + rec_args + rargs).fetchall()
    # Closed-status trials with no completion date: no window can be estimated (open-status ones are counted).
    excluded_open_ended = [r[0] for r in con.execute(f"""
        SELECT t.nct_id FROM trials t
        WHERE t.is_lung=1 AND t.sponsor=? AND {rec_open} AND t.status NOT IN ({_sq(OPEN_STATUSES)})
          AND t.primary_completion_date IS NULL AND t.completion_date IS NULL{in_region}
        ORDER BY t.nct_id""", [sponsor] + rec_open_args + rargs)]
    # Listed as not yet recruiting at the snapshot (registered start, an anticipated date, on or before as_of
    # when as_of is earlier than the snapshot): never counted as recruiting.
    nyr_start = "" if as_of >= snap else " AND t.start_date <= ?"
    not_yet = [{"nct_id": r[0], "start_date": r[1]} for r in con.execute(f"""
        SELECT t.nct_id, t.start_date FROM trials t
        WHERE t.is_lung=1 AND t.sponsor=? AND t.status='NOT_YET_RECRUITING'{nyr_start}{in_region}
        ORDER BY t.start_date, t.nct_id""", [sponsor] + ([] if as_of >= snap else [as_of]) + rargs)]
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
                      AND t.is_lung=1 AND COALESCE(t.sponsor, '') <> ? AND {rec}""",
                                 chunk + [sponsor] + rec_args):
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
        w = window(r["start_date"], r["primary_completion_date"], r["completion_date"], r["status"], snap)
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
            "estimated_window_end": None if w["estimate_end"] is None else _iso(w["estimate_end"]),
            "window_basis": w["basis"], "open_ended": w["open_ended"],
            "recruiting_at_snapshot": w["recruiting_at_snapshot"],
            # The CT.gov status contradicts the estimate: still recruiting after the estimated end, or closed
            # before it. The status wins (the as-of rule above).
            "status_overrides_estimate": (w["estimate_end"] is not None and
                                          (w["estimate_end"] <= snap_o if w["recruiting_at_snapshot"]
                                           else w["estimate_end"] > snap_o)),
            "enrollment_registered": r["enrollment"], "enrollment_type": r["enrollment_type"],
            "n_sites": len(own), "n_sites_identified": len(own_id), "n_sites_anonymized": len(own) - len(own_id),
            "site_ids": sorted(own, key=lambda s: (sites[s]["anonymized"], -(sites[s]["other_sponsor_trials"] or 0),
                                                   sites[s]["facility"] or "")),
            "eligibility_source": src, "criteria": [x.to_dict() for x in c], "no_criteria": not c,
            "sparse_criteria": 0 < len(c) <= SPARSE_CRITERIA,
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
        # Bounded windows end by the snapshot (open trials run through it), so nothing here is projected.
        ov = overlap_window(wins[i], wins[j], until=snap_o)
        # Both list an anonymized site in the same city: same pseudo-site id, facility unknown. Not a shared site.
        anon_same_city = len((set(tp["site_ids"]) & set(tq["site_ids"])) - identified)
        pairs.append({
            "p": tp["nct_id"], "q": tq["nct_id"], "shared_sites": len(shared), "shared_site_ids": shared,
            "anonymized_same_city": anon_same_city,
            "o_pq": _round(o[i, j]), "o_qp": _round(o[j, i]),
            "overlap_informative": not (tp["no_criteria"] or tq["no_criteria"]),
            "months_both_recruiting_estimated": round((ov[1] - ov[0]) / DAYS_PER_MONTH, 1) if ov else 0.0,
            "both_recruiting_from": _iso(ov[0]) if ov else None, "both_recruiting_to": _iso(ov[1]) if ov else None,
            "both_recruiting_at_snapshot": tp["recruiting_at_snapshot"] and tq["recruiting_at_snapshot"],
            "open_ended": tp["open_ended"] or tq["open_ended"],
            "upper_bound": tp["upper_bound"] or tq["upper_bound"],
            "unreviewed_criteria": "rule-based parse" in (tp["eligibility_source"], tq["eligibility_source"]),
            "sparse_criteria": [t["nct_id"] for t in (tp, tq) if t["sparse_criteria"]],
            "criteria_diff": criteria_diff(crits[i], crits[j], pop),
        })

    return {
        "sponsor": sponsor, "sponsor_known": known > 0, "as_of": as_of, "snapshot_date": snap,
        "basis": basis(as_of), "region": region, "region_label": label,
        "trials": trials, "pairs": pairs, "sites": sites, "excluded_open_ended": excluded_open_ended,
        "not_yet_recruiting": not_yet,
        "n_sites": len(sites), "n_sites_anonymized": len(sites) - len(identified),
        "population": {"n": int(len(next(iter(pop.values())))), "seed": 7,
                       "note": "Synthetic advanced-NSCLC population; prevalences are rounded modeling "
                               "assumptions, not patient data."},
        "definitions": {
            "recruiting_on_date": (
                f"on the snapshot ({snap}): CT.gov status Recruiting or Enrolling by invitation. On an earlier date: "
                f"started by the date and inside the estimated window (start + {ENROLL_FRACTION} x (primary "
                f"completion - start)), bounded by the snapshot status: still recruiting at the snapshot = "
                f"recruiting since its start; any other status = closed by the snapshot; withdrawn or not yet "
                f"recruiting = never"),
            "basis": "'registry' when as_of is the snapshot (a registered fact); 'estimated' for earlier dates",
            "excluded_open_ended": "the sponsor's trials with a closed status that register no completion date "
                                   "at all (no window can be estimated); left out",
            "not_yet_recruiting": "the sponsor's trials CT.gov lists as Not yet recruiting at the snapshot (with "
                                  "a registered start on or before an earlier as_of); never counted as recruiting",
            "months_both_recruiting_estimated": "overlap of the two bounded windows, never past the snapshot",
            "registered_sites": "trial_sites rows whose site status is not WITHDRAWN, in the region if one is given",
            "shared_sites": "identifiable registered sites on both trials; anonymized per-city pseudo-sites are "
                            "never counted as shared",
            "anonymized_same_city": "cities where both trials list an anonymized site (facility unknown; not "
                                    "counted as shared)",
            "o_pq": "share of P's eligible synthetic patients who also meet Q's encoded criteria",
            "other_sponsor_trials_at_sites": "distinct lung trials of other lead sponsors (any sponsor class, any "
                                             "phase) recruiting on the date at the trial's identifiable sites",
            "upper_bound": "a required biomarker or cohort restriction the synthetic population can't represent",
            "unreviewed_criteria": "either trial's criteria come from the rule-based parse (not reviewed)",
            "sparse_criteria": f"trials in the pair with {SPARSE_CRITERIA} or fewer encoded criteria: most "
                               "synthetic patients pass them, so containment in them says little",
            "criteria_diff": "matched by concept (the attribute restricted; driver requirements are one concept); "
                             "ids index trials[].criteria; same = selects the same synthetic patients",
        },
    }


# ---------------------------------------------------------------- self-overlap statistic

def self_overlap(min_sites: int = 10, min_overlap: float = 0.8, since: str = "2015-01-01",
                 context_sites: int = 5, robust_min_criteria: int = 3) -> dict:
    """Same-sponsor pairs of industry NSCLC trials that ran at the same time, at the same sites, for
    nearly the same patients. Windows are bounded by the CT.gov status at the snapshot (module docstring) and
    the overlap must fall between `since` and the snapshot: nothing is projected forward."""
    since_o = date.fromisoformat(since).toordinal()
    snap = snapshot_date()
    snap_o = date.fromisoformat(snap).toordinal()
    con = _con()
    rows = con.execute(f"""
        SELECT t.nct_id, t.sponsor, t.status, t.phases, t.start_date, t.primary_completion_date,
               t.completion_date, tm.criteria
        FROM trials t LEFT JOIN trial_model tm USING(nct_id)
        WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND t.start_date IS NOT NULL
          AND t.status NOT IN ({_sq(NEVER_STATUSES)})
        ORDER BY t.sponsor, t.start_date, t.nct_id""").fetchall()
    site_sets: dict[str, set[str]] = defaultdict(set)
    for nct, sid in con.execute(f"""
            SELECT ts.nct_id, ts.site_id FROM trial_sites ts JOIN sites s USING(site_id) JOIN trials t USING(nct_id)
            WHERE t.is_lung=1 AND t.sponsor_class='INDUSTRY' AND s.anonymized=0 AND {SITE_ROW_OK.format(a='ts')}"""):
        site_sets[nct].add(sid)
    n_trials_db = con.execute("SELECT COUNT(*) FROM trials WHERE is_lung=1 AND sponsor_class='INDUSTRY'").fetchone()[0]
    n_never = con.execute(f"""SELECT COUNT(*) FROM trials WHERE is_lung=1 AND sponsor_class='INDUSTRY'
                              AND status IN ({_sq(NEVER_STATUSES)})""").fetchone()[0]
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
            m = eligible_mask(c, pop)
            info.append({"nct": r["nct_id"], "crit": c, "src": src, "mask": m, "share": float(m.mean()),
                         "win": window(r["start_date"], r["primary_completion_date"], r["completion_date"],
                                       r["status"], snap),
                         "status": r["status"], "phases": json.loads(r["phases"] or "[]"),
                         "ub": upper_bound_reasons(r["nct_id"])})
        o = service.overlap_matrix(np.array([x["mask"] for x in info]))
        for i, j in combinations(range(len(info)), 2):
            a, b = info[i], info[j]
            ov = overlap_window(a["win"], b["win"], since=since_o, until=snap_o)
            if not ov:
                continue
            tally["concurrent_pairs"] += 1
            shared = len(site_sets[a["nct"]] & site_sets[b["nct"]])
            if shared < context_sites:
                continue
            # An empty criteria list describes everyone (passes the overlap test trivially); a closed trial
            # with no completion date has no estimable window (it would run to the snapshot as an artifact).
            no_window = lambda t: t["win"]["open_ended"] and not t["win"]["recruiting_at_snapshot"]  # noqa: E731
            excluded = ("no_criteria" if not (a["crit"] and b["crit"]) else
                        "open_ended" if no_window(a) or no_window(b) else None)
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
            full = overlap_window(a["win"], b["win"], until=snap_o)
            p23 = all(any(x in ("PHASE2", "PHASE3") for x in t["phases"]) for t in (a, b))
            # o_PQ >= threshold: P's eligible patients nearly all qualify for Q, so Q is the container. A
            # container with few criteria admits most patients and makes containment close to automatic.
            containers = ([b["nct"]] if o[i, j] >= min_overlap else []) + ([a["nct"]] if o[j, i] >= min_overlap else [])
            n_crit = {a["nct"]: len(a["crit"]), b["nct"]: len(b["crit"])}
            hits.append({
                "sponsor": sponsor, "p": a["nct"], "q": b["nct"], "shared_sites": shared,
                "o_pq": _round(o[i, j]), "o_qp": _round(o[j, i]),
                "overlap_months_estimated": round((full[1] - full[0]) / DAYS_PER_MONTH, 1),
                "both_recruiting_from": _iso(full[0]), "both_recruiting_to": _iso(full[1]),
                "both_recruiting_at_snapshot": a["win"]["recruiting_at_snapshot"] and b["win"]["recruiting_at_snapshot"],
                "status_at_snapshot": {a["nct"]: a["status"], b["nct"]: b["status"]},
                "upper_bound": ub, "upper_bound_reasons": {a["nct"]: a["ub"], b["nct"]: b["ub"]},
                "eligibility_source": {a["nct"]: a["src"], b["nct"]: b["src"]},
                "n_criteria": n_crit,
                "eligible_share": {a["nct"]: _round(a["share"]), b["nct"]: _round(b["share"])},
                "containers": containers,
                # encoded criteria of the containing trial (the larger count when both directions qualify)
                "container_criteria": max(n_crit[c] for c in containers),
                "phases": {a["nct"]: a["phases"], b["nct"]: b["phases"]}, "both_phase2_or_3": p23,
            })
    hits.sort(key=lambda h: (-h["shared_sites"], h["sponsor"], h["p"], h["q"]))
    src_mix = defaultdict(int)
    for h in hits:
        s = sorted(h["eligibility_source"].values())
        src_mix["both hand-encoded" if s == ["hand-encoded"] * 2 else "both rule-based parse"
                if s == ["rule-based parse"] * 2 else "one of each"] += 1
    hand = [h for h in hits if set(h["eligibility_source"].values()) == {"hand-encoded"}]
    rich = [h for h in hits if h["container_criteria"] >= robust_min_criteria]
    sparse = [h for h in hits if h["container_criteria"] <= SPARSE_CRITERIA]
    n_hand_ub = sum(h["upper_bound"] for h in hand)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "snapshot_date": snap,
        "definition": (
            f"Same-sponsor pairs of NSCLC trials (is_lung = 1, industry lead sponsor, any phase; trials CT.gov lists "
            f"as withdrawn or not yet recruiting at the snapshot excluded) whose enrollment windows are both open on "
            f"some date between {since} and the registry snapshot ({snap}), that share >= {min_sites} identifiable "
            f"registered sites (worldwide; site rows withdrawn from the trial and anonymized per-city pseudo-sites "
            f"excluded), and whose eligibility overlap on the synthetic population is >= {min_overlap} in at least "
            f"one direction (o_PQ = share of P's eligible patients also eligible for Q: one population nearly "
            f"contained in the other). Window: start to start + {ENROLL_FRACTION} x (primary completion - start), "
            f"bounded by the CT.gov status at the snapshot (still recruiting = open through the snapshot; any other "
            f"status = closed by the snapshot), so nothing is projected past the snapshot. Excluded and counted "
            f"separately: pairs where either trial has no encoded criteria (an empty criteria list describes "
            f"everyone and passes the overlap test trivially) and pairs where either trial has a closed status and "
            f"registers no completion date at all (no window can be estimated)."),
        "parameters": {"min_shared_sites": min_sites, "min_overlap_one_direction": min_overlap, "since": since,
                       "until": snap, "context_min_shared_sites": context_sites, "enroll_fraction": ENROLL_FRACTION,
                       "robust_min_container_criteria": robust_min_criteria,
                       "population_n": int(len(next(iter(pop.values())))), "population_seed": 7},
        "headline": {
            "count": len(hand),
            "upper_bound_count": n_hand_ub,
            "sponsors": len({h["sponsor"] for h in hand}),
            "variant": "both_hand_encoded",
            "text": (f"{len(hand)} same-sponsor pairs where both trials' eligibility was hand-encoded and reviewed; "
                     f"in {n_hand_ub} of them at least one trial has a restriction the synthetic population cannot "
                     f"represent, so their overlap is a ceiling ({len(hand) - n_hand_ub} without that flag). The "
                     f"broad count ({len(hits)}) adds {len(hits) - len(hand)} pairs that rest on the unreviewed "
                     f"rule-based parse for at least one trial (the parse never sets the upper-bound flag, so those "
                     f"pairs are unflagged, not verified); {len(sparse)} of all {len(hits)} are 'contained' in a "
                     f"trial with {SPARSE_CRITERIA} or fewer encoded criteria. Lead with {len(hand)} and cite "
                     f"{len(hits)} only with these caveats."),
        },
        "count": tally["count_min_sites"],
        "upper_bound_count": tally["upper_bound_min_sites"],
        "sponsors_with_pairs": len(sponsors_hit),
        "count_both_phase2_or_3": sum(h["both_phase2_or_3"] for h in hits),
        "count_by_eligibility_source": dict(src_mix),
        "robustness": {
            "both_hand_encoded": {"count": len(hand), "upper_bound_count": n_hand_ub,
                                  "not_upper_bound_count": len(hand) - n_hand_ub,
                                  "definition": "both trials' criteria hand-encoded and reviewed (compiler.overrides)"},
            f"container_min_{robust_min_criteria}_criteria": {
                "count": len(rich), "upper_bound_count": sum(h["upper_bound"] for h in rich),
                "definition": (f"the containing trial (Q when o_PQ >= {min_overlap}) has >= {robust_min_criteria} "
                               f"encoded criteria, so containment is not automatic")},
            f"container_at_most_{SPARSE_CRITERIA}_criteria": {
                "count": len(sparse),
                "exactly_one_criterion": sum(h["container_criteria"] == 1 for h in hits),
                "definition": (f"the containing trial has <= {SPARSE_CRITERIA} encoded criteria: most synthetic "
                               f"patients pass it, so containment at >= {min_overlap} is close to automatic")},
        },
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
            "industry_lung_trials_withdrawn_or_not_yet_recruiting": n_never,
            "industry_lung_trials_considered": len(rows),
            "industry_sponsors_with_2plus_trials": sum(len(v) >= 2 for v in by_sponsor.values()),
            "considered_trials_with_mostly_anonymized_sites": sum(r["nct_id"] in mostly_anon for r in rows),
        },
        "notes": [
            "Descriptive: counts of registered sites, enrollment windows bounded by the registry status, and "
            "synthetic-population eligibility shares. Nothing here predicts enrollment speed, and no window runs "
            "past the snapshot.",
            "Lead with headline.count (both trials hand-encoded and reviewed). The broad count includes pairs that "
            "rest on the unreviewed rule-based parse; a parse that keeps only one or two criteria (e.g. 'ECOG 0-1' "
            "or 'Stage IV') admits most patients, so a population 'contained' in it says little (see robustness).",
            "upper_bound: either trial's hand-encoded design entry lists a required biomarker the population does "
            "not model, a basket or multi-cohort design, or any unmodeled restriction; the overlap shown is then a "
            "ceiling on the modeled populations, not a measurement.",
            "Overlap months are the full overlap of the two bounded windows up to the snapshot (not only the part "
            "after the cut-off date).",
            "Site lists are as registered on ClinicalTrials.gov at the snapshot; a site's activation dates are not "
            "public.",
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
          f"{res['sponsors_with_pairs']} sponsors; headline (both hand-encoded): {res['headline']['count']}; "
          f"robustness: {json.dumps(res['robustness'])}; context: {json.dumps(res['context'])}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
