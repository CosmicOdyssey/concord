"""Findings page API (concord.api.findings). The router tests use a temporary FINDINGS_DIR and need
no database; the contract test reads the repo's data/findings/findings.json and is skipped without it."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from concord import paths
from concord.api import findings as F

STATUSES = {"final", "provisional", "missing"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "FINDINGS_DIR", tmp_path)
    app = FastAPI()
    app.include_router(F.router)
    return TestClient(app), tmp_path


def test_missing_files_are_404_with_a_message(client):
    c, _ = client
    r = c.get("/api/findings")
    assert r.status_code == 404 and "python -m concord.findings" in r.json()["detail"]
    r = c.get("/api/findings/self-overlap")
    assert r.status_code == 404 and "self_overlap.json" in r.json()["detail"]


# The shape the portfolio overlap audit (python -m concord.overlap) writes, trimmed: a `headline` object (the
# count to lead with: pairs whose eligibility was hand-encoded and reviewed), the broad top-level `count`,
# `upper_bound_count` and `sponsors_with_pairs`, the definition and the parameters. Values from its current run.
SELF_OVERLAP_SHAPE = {
    "generated_at": "2026-10-17T07:54:12+00:00",
    "snapshot_date": "2026-10-16",
    "definition": "Same-sponsor pairs of NSCLC trials ... that share >= 10 identifiable registered sites ...",
    "parameters": {"min_shared_sites": 10, "min_overlap_one_direction": 0.8, "since": "2015-01-01",
                   "until": "2026-10-16", "context_min_shared_sites": 5, "enroll_fraction": 0.65,
                   "robust_min_container_criteria": 3, "population_n": 20000, "population_seed": 7},
    "headline": {"count": 21, "upper_bound_count": 19, "sponsors": 10, "variant": "both_hand_encoded",
                 "text": "21 same-sponsor pairs where both trials' eligibility was hand-encoded and reviewed; "
                         "in 19 of them at least one trial has a restriction ..."},
    "count": 134,
    "upper_bound_count": 42,
    "sponsors_with_pairs": 27,
    "count_both_phase2_or_3": 114,
    "context": {"count_at_min_5_shared_sites": 358},
    "notes": ["Descriptive: counts of registered sites ... Nothing here predicts enrollment speed."],
    "pairs": [{"sponsor": "S", "p": "NCT00000001", "q": "NCT00000002", "shared_sites": 113,
               "o_pq": 0.7697, "o_qp": 1.0}],
}
# The audit's first run had no headline object; the note then leads with the broad count.
SELF_OVERLAP_COUNT_ONLY = {k: v for k, v in SELF_OVERLAP_SHAPE.items() if k != "headline"}


def test_serves_files_verbatim(client):
    c, d = client
    doc = {"generated_at": "x", "rule": "r", "findings": [{"id": "congestion", "headline": "beta ≈ 0.09"}]}
    (d / "findings.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    (d / "self_overlap.json").write_text(json.dumps(SELF_OVERLAP_SHAPE), encoding="utf-8")
    assert c.get("/api/findings").json() == doc
    assert c.get("/api/findings/self-overlap").json() == SELF_OVERLAP_SHAPE


def _note_count(got: dict) -> int | None:
    """The count FindingsView's related note leads with (frontend findingsApi.overlapNote): headline.count, else
    the top-level count; None for a plain headline sentence."""
    h = got.get("headline")
    if isinstance(h, str):
        return None
    if isinstance(h, dict) and isinstance(h.get("count"), int):
        return h["count"]
    return got.get("count")


@pytest.mark.parametrize("shape,expected", [(SELF_OVERLAP_SHAPE, 21), (SELF_OVERLAP_COUNT_ONLY, 134)])
def test_self_overlap_has_the_fields_the_related_note_reads(client, shape, expected):
    """Guard the fields the related note reads, on the audit's real file shapes."""
    c, d = client
    (d / "self_overlap.json").write_text(json.dumps(shape), encoding="utf-8")
    got = c.get("/api/findings/self-overlap").json()
    assert _note_count(got) == expected
    assert isinstance(got["definition"], str)
    assert {"min_shared_sites", "min_overlap_one_direction"} <= set(got["parameters"])


real_overlap = paths.FINDINGS_DIR / "self_overlap.json"


@pytest.mark.skipif(not real_overlap.exists(), reason="data/findings/self_overlap.json not written yet")
def test_repo_self_overlap_matches_the_related_note_contract():
    got = json.loads(real_overlap.read_text(encoding="utf-8"))
    if isinstance(got.get("headline"), str):
        assert got["headline"].strip()
        return
    n = _note_count(got)
    assert isinstance(n, int) and n >= 0
    h = got.get("headline")
    if isinstance(h, dict):
        assert isinstance(h.get("text", ""), str)
        assert isinstance(h.get("sponsors", 0), int) and isinstance(h.get("upper_bound_count", 0), int)


def test_sources_are_marked_available_only_when_the_checkout_has_them(client):
    c, d = client
    doc = {"findings": [{"id": "x", "sources": [{"label": "paths", "path": "backend/concord/paths.py"},
                                                {"label": "elsewhere", "path": "backend/concord/no_such_file.py"},
                                                {"label": "outside", "path": "../../etc/hosts"}]}]}
    (d / "findings.json").write_text(json.dumps(doc), encoding="utf-8")
    got = c.get("/api/findings").json()["findings"][0]["sources"]
    assert [s["available"] for s in got] == [True, False, False]
    assert [s["label"] for s in got] == ["paths", "elsewhere", "outside"]
    r = c.get("/api/findings/source", params={"path": "backend/concord/no_such_file.py"})
    assert r.status_code == 404 and "not available in this checkout" in r.json()["detail"]


def test_invalid_json_is_500(client):
    c, d = client
    (d / "findings.json").write_text("{not json", encoding="utf-8")
    assert c.get("/api/findings").status_code == 500


def test_source_serves_only_cited_repo_files(client):
    c, d = client
    cited = "backend/concord/paths.py"
    doc = {"findings": [{"id": "x", "sources": [{"label": "paths", "path": cited},
                                                {"label": "outside", "path": "../../etc/hosts"}]}]}
    (d / "findings.json").write_text(json.dumps(doc), encoding="utf-8")
    r = c.get("/api/findings/source", params={"path": cited})
    assert r.status_code == 200 and "FINDINGS_DIR" in r.text
    assert r.headers["content-type"].startswith("text/plain")
    # Not cited, or cited but outside the repo: refused.
    assert c.get("/api/findings/source", params={"path": "backend/concord/service.py"}).status_code == 404
    assert c.get("/api/findings/source", params={"path": "../../etc/hosts"}).status_code == 404


real = paths.FINDINGS_DIR / "findings.json"


@pytest.mark.skipif(not real.exists(), reason="data/findings/findings.json not generated")
def test_repo_findings_match_the_page_contract():
    """What FindingsView renders: ids, statuses, CI charts, tables with in-range highlight rows, sources."""
    d = json.loads(real.read_text(encoding="utf-8"))
    assert isinstance(d["rule"], str) and d["rule"]
    assert [f["id"] for f in d["findings"]] == ["congestion", "allocation", "implication"]
    for f in d["findings"]:
        assert f["status"] in STATUSES and f["title"] and f["headline"]
        chart = f.get("chart")
        if chart:
            assert chart["type"] == "ci" and isinstance(chart["reference"]["value"], (int, float))
            for it in chart["items"]:
                assert it["lo"] <= it["estimate"] <= it["hi"]
        for t in f.get("tables", []):
            assert all(len(row) == len(t["columns"]) for row in t["rows"]), t["id"]
            if t.get("highlight_row") is not None:
                assert 0 <= t["highlight_row"] < len(t["rows"])
        for s in f.get("sources", []):
            assert s["label"] and s["path"]


@pytest.mark.skipif(not paths.DB_PATH.exists(), reason="data/concord.db not built")
def test_registered_on_the_app():
    from concord.api.main import app
    routes = set(app.openapi()["paths"])
    assert {"/api/findings", "/api/findings/self-overlap", "/api/findings/source"} <= routes
    if real.exists():
        c = TestClient(app)
        assert c.get("/api/findings").json()["findings"][0]["id"] == "congestion"
        src = c.get("/api/findings").json()["findings"][0]["sources"][0]["path"]
        if (paths.ROOT / src).is_file():
            assert c.get("/api/findings/source", params={"path": src}).status_code == 200
