"""Findings content. Skipped when the data has not been built."""
import pytest

from concord.paths import DB_PATH

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="data/concord.db not built")


def test_findings_have_three_sections_with_sources():
    from concord.findings import build
    d = build()
    assert [f["id"] for f in d["findings"]] == ["congestion", "allocation", "implication"]
    for f in d["findings"]:
        assert f["headline"] and f["status"] in ("final", "provisional", "missing")
        if f["status"] != "missing":
            assert f["tables"] and f["sources"]
