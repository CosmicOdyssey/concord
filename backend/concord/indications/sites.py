"""Portfolio overlap for an extra indication: shared registered sites and months both recruiting only.

Same definitions as concord.overlap (recruiting on a date, registered site, shared site, the bounded enrollment
window), read from the indication's own SQLite file (concord.indications.db_path). No eligibility overlap is
computed: every eligibility field is absent (not 0) and responses carry SITE_ONLY_LABEL.

Only the snapshot date is served. The fetch holds trials open or active at the download, not the ones that closed
before it, so an earlier date would undercount; such dates are refused (ValueError -> 400).
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import date
from functools import lru_cache
from itertools import combinations

from concord import indications as ind
from concord import overlap as ov

DEFINITIONS = {
    "recruiting_on_date": ("on the snapshot (the download date): CT.gov status Recruiting or Enrolling by invitation; "
                           "Active not recruiting trials were fetched but are not recruiting on the snapshot"),
    "registered_sites": "trial_sites rows whose site status is not WITHDRAWN, in the region if one is given",
    "shared_sites": ("identifiable registered sites on both trials; anonymized per-city pseudo-sites are never counted "
                     "as shared"),
    "anonymized_same_city": ("cities where both trials list an anonymized site (facility unknown; not counted as "
                             "shared)"),
    "months_both_recruiting_estimated": ("from the later of the two registered start dates to the snapshot: both are "
                                         "listed as recruiting at the snapshot, so the overlap is bounded by it"),
    "eligibility_overlap": ind.SITE_ONLY_LABEL,
}


class UnknownIndication(Exception):
    """Not lung and not in concord.indications.INDICATIONS (the API answers 404)."""


def _check(slug: str) -> None:
    if slug not in ind.INDICATIONS:
        raise UnknownIndication(f"unknown indication {slug!r}; one of {[ind.LUNG, *ind.INDICATIONS]}")


def _con(slug: str) -> sqlite3.Connection:
    _check(slug)
    p = ind.db_path(slug)
    if not p.exists():
        raise FileNotFoundError(f"{p.name} missing: run python -m concord.indications.fetch --slug {slug}")
    con = sqlite3.connect(f"{p.resolve().as_uri()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def meta(slug: str) -> dict:
    con = _con(slug)
    m = dict(con.execute("SELECT key, value FROM fetch_meta").fetchall())
    n = con.execute("SELECT COUNT(*) FROM trials").fetchone()[0]
    con.close()
    return {"slug": slug, "label": ind.INDICATIONS[slug]["label"], "noun": ind.INDICATIONS[slug]["noun"],
            "snapshot_date": m["snapshot_date"], "fetched_at": m["fetched_at"], "source": m["source"],
            "query": json.loads(m["query"]), "trials": n, "eligibility": False, "label_note": ind.SITE_ONLY_LABEL}


def available() -> list[dict]:
    """Lung (always listed; eligibility overlap) and every extra indication whose DB file exists."""
    out = [{"slug": ind.LUNG, "label": "Lung cancer", "noun": "lung cancer", "eligibility": True}]
    for slug in ind.INDICATIONS:
        if ind.db_path(slug).exists():
            out.append(meta(slug))
    return out


def check_date(slug: str, as_of: str | None) -> str:
    snap = meta(slug)["snapshot_date"]
    if not as_of:
        return snap
    try:
        d = date.fromisoformat(as_of).isoformat()
    except ValueError:
        raise ValueError(f"as_of must be YYYY-MM-DD, got {as_of!r}") from None
    if d != snap:
        raise ValueError(f"{ind.INDICATIONS[slug]['label']} is a registry snapshot of {snap} (trials open or active "
                         f"at the download); other dates are not available ({ind.SITE_ONLY_LABEL})")
    return d


def _scope(region: str | None, rec: str, rsql: str) -> str:
    in_region = "" if not region else (
        f" AND EXISTS (SELECT 1 FROM trial_sites ts JOIN sites s USING(site_id) WHERE ts.nct_id=t.nct_id AND "
        f"{ov.SITE_ROW_OK.format(a='ts')} AND {rsql})")
    return f"t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND {rec}{in_region}"


def sponsors(slug: str, as_of: str | None = None, region: str | None = None, min_trials: int = 2) -> dict:
    """Industry lead sponsors with >= min_trials trials of the indication recruiting at the snapshot."""
    m = meta(slug)
    as_of = check_date(slug, as_of)
    rsql, rargs, label = ov.region_sql(region)
    rec, rec_args = ov.recruiting_clause(as_of, snap=m["snapshot_date"])
    scope = _scope(region, rec, rsql)
    con = _con(slug)
    rows = con.execute(f"""SELECT t.sponsor, COUNT(*) AS n FROM trials t WHERE {scope}
                           GROUP BY t.sponsor HAVING COUNT(*) >= ? ORDER BY n DESC, t.sponsor""",
                       rec_args + rargs + [min_trials]).fetchall()
    ident = {sp: (int(n), int(anon or 0)) for sp, n, anon in con.execute(f"""
            SELECT t.sponsor, COUNT(*), SUM(s.anonymized) FROM trials t
            JOIN trial_sites ts USING(nct_id) JOIN sites s USING(site_id)
            WHERE t.sponsor_class='INDUSTRY' AND t.sponsor IS NOT NULL AND {rec}
              AND {ov.SITE_ROW_OK.format(a='ts')} AND {rsql}
            GROUP BY t.sponsor""", rec_args + rargs)}
    con.close()

    def entry(r):
        n, anon = ident.get(r["sponsor"], (0, 0))
        return {"sponsor": r["sponsor"], "trials": r["n"], "site_rows": n,
                "identified_share": (round((n - anon) / n, 4) if n else None)}

    return {"indication": slug, "indication_label": m["label"], "eligibility": False,
            "eligibility_note": ind.SITE_ONLY_LABEL, "as_of": as_of, "snapshot_date": m["snapshot_date"],
            "basis": "registry", "region": region or None, "region_label": label,
            "sponsors": [entry(r) for r in rows]}


@lru_cache(maxsize=64)
def _audit_cached(slug: str, sponsor: str, as_of: str, region: str | None, mtime: float) -> str:
    return json.dumps(_audit(slug, sponsor, as_of, region))


def audit(slug: str, sponsor: str, as_of: str | None = None, region: str | None = None) -> dict:
    d = check_date(slug, as_of)
    return json.loads(_audit_cached(slug, sponsor, d, region or None, ind.db_path(slug).stat().st_mtime))


def _audit(slug: str, sponsor: str, as_of: str, region: str | None) -> dict:
    m = meta(slug)
    snap = m["snapshot_date"]
    snap_o = date.fromisoformat(snap).toordinal()
    rsql, rargs, label = ov.region_sql(region)
    rec, rec_args = ov.recruiting_clause(as_of, snap=snap)
    in_region = "" if not region else (
        f" AND EXISTS (SELECT 1 FROM trial_sites ts JOIN sites s USING(site_id) WHERE ts.nct_id=t.nct_id AND "
        f"{ov.SITE_ROW_OK.format(a='ts')} AND {rsql})")
    con = _con(slug)
    known = con.execute("SELECT COUNT(*) FROM trials WHERE sponsor=?", (sponsor,)).fetchone()[0]
    trows = con.execute(f"""
        SELECT t.nct_id, t.title, t.acronym, t.status, t.phases, t.start_date, t.primary_completion_date,
               t.primary_completion_type, t.completion_date, t.enrollment, t.enrollment_type, t.conditions
        FROM trials t WHERE t.sponsor=? AND {rec}{in_region}
        ORDER BY t.start_date, t.nct_id""", [sponsor] + rec_args + rargs).fetchall()
    not_yet = [{"nct_id": r[0], "start_date": r[1]} for r in con.execute(f"""
        SELECT t.nct_id, t.start_date FROM trials t WHERE t.sponsor=? AND t.status='NOT_YET_RECRUITING'{in_region}
        ORDER BY t.start_date, t.nct_id""", [sponsor] + rargs)]
    ids = [r["nct_id"] for r in trows]
    ph = ",".join("?" * len(ids))
    sites: dict[str, dict] = {}
    trial_sites: dict[str, list[str]] = defaultdict(list)
    for r in con.execute(f"""
            SELECT ts.nct_id, s.site_id, s.facility, s.city, s.state, s.country, s.anonymized
            FROM trial_sites ts JOIN sites s USING(site_id)
            WHERE ts.nct_id IN ({ph}) AND {ov.SITE_ROW_OK.format(a='ts')} AND {rsql}""", ids + rargs) if ids else []:
        trial_sites[r["nct_id"]].append(r["site_id"])
        sites.setdefault(r["site_id"], {"site_id": r["site_id"], "facility": r["facility"], "city": r["city"],
                                        "state": r["state"], "country": r["country"],
                                        "anonymized": bool(r["anonymized"])})
    con.close()
    identified = {sid for sid, s in sites.items() if not s["anonymized"]}

    trials, wins = [], []
    for r in trows:
        w = ov.window(r["start_date"], r["primary_completion_date"], r["completion_date"], r["status"], snap)
        wins.append(w)
        own = trial_sites[r["nct_id"]]
        own_id = [s for s in own if s in identified]
        trials.append({
            "nct_id": r["nct_id"], "title": r["title"], "acronym": r["acronym"], "status_now": r["status"],
            "phases": json.loads(r["phases"] or "[]"), "conditions": json.loads(r["conditions"] or "[]"),
            "start_date": r["start_date"], "primary_completion_date": r["primary_completion_date"],
            "primary_completion_type": r["primary_completion_type"], "completion_date": r["completion_date"],
            "recruiting_at_snapshot": w["recruiting_at_snapshot"],
            "enrollment_registered": r["enrollment"], "enrollment_type": r["enrollment_type"],
            "n_sites": len(own), "n_sites_identified": len(own_id), "n_sites_anonymized": len(own) - len(own_id),
            "site_ids": sorted(own, key=lambda s: (sites[s]["anonymized"], sites[s]["facility"] or "")),
        })

    pairs = []
    for i, j in combinations(range(len(trows)), 2):
        tp, tq = trials[i], trials[j]
        both = set(tp["site_ids"]) & set(tq["site_ids"])
        shared = sorted(both & identified, key=lambda s: (sites[s]["facility"] or "", s))
        w = ov.overlap_window(wins[i], wins[j], until=snap_o)
        pairs.append({
            "p": tp["nct_id"], "q": tq["nct_id"], "shared_sites": len(shared), "shared_site_ids": shared,
            "anonymized_same_city": len(both - identified),
            "months_both_recruiting_estimated": round((w[1] - w[0]) / ov.DAYS_PER_MONTH, 1) if w else 0.0,
            "both_recruiting_from": ov._iso(w[0]) if w else None, "both_recruiting_to": ov._iso(w[1]) if w else None,
            "both_recruiting_at_snapshot": tp["recruiting_at_snapshot"] and tq["recruiting_at_snapshot"],
        })

    return {
        "indication": slug, "indication_label": m["label"], "eligibility": False,
        "eligibility_note": ind.SITE_ONLY_LABEL,
        "source": {"name": m["source"], "query": m["query"], "fetched_at": m["fetched_at"], "trials": m["trials"]},
        "sponsor": sponsor, "sponsor_known": known > 0, "as_of": as_of, "snapshot_date": snap, "basis": "registry",
        "region": region, "region_label": label, "trials": trials, "pairs": pairs, "sites": sites,
        "not_yet_recruiting": not_yet, "n_sites": len(sites), "n_sites_anonymized": len(sites) - len(identified),
        "definitions": DEFINITIONS,
    }


def top_same_sponsor_shared(slug: str, k: int = 3) -> list[dict]:
    """Sponsors ranked by distinct identifiable sites shared by >= 2 of their own trials recruiting at the snapshot."""
    out = []
    for s in sponsors(slug)["sponsors"]:
        a = audit(slug, s["sponsor"])
        shared = set().union(*(p["shared_site_ids"] for p in a["pairs"])) if a["pairs"] else set()
        out.append({"sponsor": s["sponsor"], "trials": len(a["trials"]), "pairs": len(a["pairs"]),
                    "pairs_sharing": sum(p["shared_sites"] > 0 for p in a["pairs"]),
                    "distinct_shared_sites": len(shared),
                    "max_pair_shared_sites": max((p["shared_sites"] for p in a["pairs"]), default=0)})
    return sorted(out, key=lambda r: (-r["distinct_shared_sites"], r["sponsor"]))[:k]
