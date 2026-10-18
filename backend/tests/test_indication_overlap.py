"""Portfolio overlap for an extra indication (concord.indications.sites): shared sites and months only.

The site-only path runs on a tiny DB built here (no network, no data dir needed); the lung check needs
data/concord.db and is skipped without it.
"""
import json
import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from concord import indications as ind
from concord.indications import sites
from concord.ingest.normalize import SCHEMA, site_key
from concord.paths import DB_PATH

SLUG = "breast-cancer"
SNAP = "2026-10-17"
LABEL = "site overlap only; eligibility overlap is available for lung cancer"
ELIGIBILITY_KEYS = {"o_pq", "o_qp", "overlap_informative", "criteria_diff", "upper_bound", "unreviewed_criteria",
                    "sparse_criteria", "eligible_share", "criteria", "eligibility_source", "no_criteria", "population",
                    "other_sponsor_trials_at_sites"}


def _trial(nct, sponsor, status, start, pc="2030-01-01"):
    return (nct, f"Trial {nct}", None, status, '["PHASE3"]', sponsor, "INDUSTRY", start, pc, "ESTIMATED", pc, 300,
            "ESTIMATED", 0, '["Breast Cancer"]', "[]", "", None, None, "ALL", 0, 0, "2026-10-01", SLUG)


def _site(fac, city, state="MA", country="United States"):
    sid, anon = site_key(fac, city, state, country)
    return (sid, "Anonymized site" if anon else fac, city, state, None, country, None, None, int(anon), 0)


@pytest.fixture()
def tiny(tmp_path, monkeypatch):
    monkeypatch.setattr(ind, "indications_dir", lambda: tmp_path)
    sites._audit_cached.cache_clear()
    con = sqlite3.connect(tmp_path / f"{SLUG}.db")
    con.executescript(SCHEMA + "CREATE TABLE fetch_meta (key TEXT PRIMARY KEY, value TEXT);")
    con.executemany("INSERT INTO fetch_meta VALUES (?, ?)", {
        "snapshot_date": SNAP, "fetched_at": f"{SNAP}T21:00:00+00:00", "source": "ClinicalTrials.gov API v2",
        "query": json.dumps(ind.fetch_query(SLUG))}.items())
    con.executemany("INSERT INTO trials VALUES (" + ",".join("?" * 24) + ")", [
        _trial("NCT00000001", "Acme", "RECRUITING", "2024-01-15"),
        _trial("NCT00000002", "Acme", "RECRUITING", "2025-07-01"),
        _trial("NCT00000003", "Acme", "ACTIVE_NOT_RECRUITING", "2023-01-01"),  # not recruiting at the snapshot
        _trial("NCT00000004", "Solo", "RECRUITING", "2025-01-01"),
    ])
    a, b, c = _site("Dana-Farber Cancer Institute", "Boston"), _site("Mayo Clinic", "Rochester", "MN"), \
        _site("Research Site", "Boston")
    con.executemany("INSERT INTO sites VALUES (?,?,?,?,?,?,?,?,?,?)", [a, b, c])
    con.executemany("INSERT INTO trial_sites VALUES (?,?,?)", [
        ("NCT00000001", a[0], "RECRUITING"), ("NCT00000001", b[0], "RECRUITING"), ("NCT00000001", c[0], None),
        ("NCT00000002", a[0], "RECRUITING"), ("NCT00000002", b[0], "WITHDRAWN"), ("NCT00000002", c[0], None),
        ("NCT00000003", a[0], None), ("NCT00000004", a[0], None)])
    con.commit()
    con.close()
    return {"dfci": a[0], "mayo": b[0], "anon": c[0]}


@pytest.fixture(scope="module")
def client():
    from concord.api.main import app
    return TestClient(app)


def _no_eligibility(obj):
    if isinstance(obj, dict):
        assert not (ELIGIBILITY_KEYS & obj.keys()), ELIGIBILITY_KEYS & obj.keys()
        for v in obj.values():
            _no_eligibility(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_eligibility(v)


def test_site_only_audit(tiny, client):
    r = client.get("/api/overlap", params={"sponsor": "Acme", "indication": SLUG})
    assert r.status_code == 200
    d = r.json()
    assert d["eligibility"] is False and d["eligibility_note"] == LABEL
    assert d["as_of"] == SNAP and d["basis"] == "registry"
    # Active not recruiting at the snapshot: not recruiting on it.
    assert [t["nct_id"] for t in d["trials"]] == ["NCT00000001", "NCT00000002"]
    (p,) = d["pairs"]
    # Dana-Farber is on both; Mayo is withdrawn from trial 2; the anonymized Boston pseudo-site is never shared.
    assert p["shared_site_ids"] == [tiny["dfci"]] and p["shared_sites"] == 1 and p["anonymized_same_city"] == 1
    # From the later start to the snapshot (concord.overlap.overlap_window(until=snapshot), as for lung).
    months = (date.fromisoformat(SNAP).toordinal() - date.fromisoformat("2025-07-01").toordinal()) / 30.44
    assert p["months_both_recruiting_estimated"] == round(months, 1) and p["both_recruiting_to"] == SNAP
    _no_eligibility(d)


def test_site_only_sponsors_and_list(tiny, client):
    s = client.get("/api/overlap/sponsors", params={"indication": SLUG}).json()
    assert [x["sponsor"] for x in s["sponsors"]] == ["Acme"] and s["sponsors"][0]["trials"] == 2
    assert s["eligibility_note"] == LABEL
    lst = client.get("/api/overlap/indications").json()
    slugs = [x["slug"] for x in lst["indications"]]
    assert slugs[0] == "lung" and SLUG in slugs and lst["site_only_label"] == LABEL


def test_site_only_refuses_other_dates_and_unknowns(tiny, client):
    assert client.get("/api/overlap", params={"sponsor": "Acme", "indication": SLUG,
                                              "as_of": "2025-01-01"}).status_code == 400
    assert client.get("/api/overlap/sponsors", params={"indication": "gout"}).status_code == 404
    assert client.get("/api/overlap", params={"sponsor": "Nobody", "indication": SLUG}).status_code == 404


def test_missing_indication_db_is_503(tmp_path, monkeypatch, client):
    monkeypatch.setattr(ind, "indications_dir", lambda: tmp_path)
    assert client.get("/api/overlap/sponsors", params={"indication": SLUG}).status_code == 503


@pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")
def test_lung_unchanged_by_indication_parameter(client):
    """Omitted and 'lung' are the same lung audit, byte for byte (with eligibility overlap)."""
    q = {"sponsor": "Regeneron Pharmaceuticals", "as_of": "2024-09-01", "region": "US"}
    a = client.get("/api/overlap", params=q)
    assert a.status_code == 200
    assert a.content == client.get("/api/overlap", params=q | {"indication": "lung"}).content
    assert "o_pq" in a.json()["pairs"][0] and "eligibility_note" not in a.json()
    s = client.get("/api/overlap/sponsors")
    assert s.content == client.get("/api/overlap/sponsors", params={"indication": "lung"}).content
