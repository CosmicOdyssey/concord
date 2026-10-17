import json

import pytest

from concord.compiler import overrides
from concord.compiler.eligibility import OR_GROUPS, eligible_fraction, eligible_mask
from concord.compiler.overrides import DEMO_PATH, DESIGN, DESIGNS, OVERRIDES
from concord.compiler.population import synthetic_population
from concord.paths import DATA_DIR

REGENERON = {"NCT05785767", "NCT05800015", "NCT05557591", "NCT06161441", "NCT04077099"}
DEMO = json.loads(DEMO_PATH.read_text(encoding="utf-8"))
POP = synthetic_population(20_000)


def test_demo_file_and_regeneron_trials_are_all_loaded():
    assert len(DEMO) == 146
    assert set(DEMO) | REGENERON == set(OVERRIDES) == set(DESIGN)
    assert not set(DEMO) & REGENERON
    assert len(OVERRIDES) == 151


def test_demo_file_matches_demo_trial_list_when_present():
    path = DATA_DIR / "demo_trials.json"
    if not path.exists():
        pytest.skip(f"{path} not present")
    assert set(json.loads(path.read_text(encoding="utf-8"))) == set(DEMO)


@pytest.mark.parametrize("nct", sorted(OVERRIDES))
def test_every_override_evaluates_on_the_synthetic_population(nct):
    crit = OVERRIDES[nct]
    assert crit, "no criteria"
    assert len({c.id for c in crit}) == len(crit), "duplicate criterion ids"
    for c in crit:
        assert c.kind in ("inclusion", "exclusion")
        assert c.feature in POP, c.feature
        assert c.source.startswith("[hand-encoded] ")
        if c.id in OR_GROUPS:
            assert c.kind == "inclusion" and c.value is True
    mask = eligible_mask(crit, POP)
    assert mask.shape == (20_000,)
    assert 0 < eligible_fraction(crit, POP) <= 1


@pytest.mark.parametrize("nct", sorted(DESIGN))
def test_every_design_entry_is_valid(nct):
    d = DESIGN[nct]
    assert set(d) == {"design", "design_reason", "unmodeled", "requires_unmodeled_biomarker", "confidence"}
    assert d["design"] in DESIGNS
    assert d["confidence"] in ("high", "medium", "low")
    assert isinstance(d["unmodeled"], list) and isinstance(d["requires_unmodeled_biomarker"], bool)
    assert d["design_reason"].strip()


def test_regeneron_entries_win_and_are_single_population():
    for nct in REGENERON:
        assert DESIGN[nct]["design"] == "single_population" and DESIGN[nct]["confidence"] == "high"
        assert DESIGN[nct]["unmodeled"] == [] and DESIGN[nct]["requires_unmodeled_biomarker"] is False


def test_demo_design_labels_are_carried_through():
    for nct, e in DEMO.items():
        assert DESIGN[nct]["design"] == e["design"]
        assert [c.id for c in OVERRIDES[nct]] == [c["id"] for c in e["criteria"]]


def test_module_tolerates_missing_demo_file(tmp_path):
    assert overrides._load_demo(tmp_path / "missing.json") == {}
