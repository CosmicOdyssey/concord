from concord.compiler.eligibility import eligible_fraction, extract_criteria
from concord.compiler.population import synthetic_population
from concord.compiler.protocol import demo_protocol
from concord.ratecard.medicare import per_patient_budget

TEXT = """Inclusion Criteria:

* Histologically confirmed stage IV non-squamous NSCLC
* Documented EGFR exon 19 deletion or L858R mutation, or ALK rearrangement
* ECOG performance status 0 or 1

Exclusion Criteria:

* Active or untreated brain metastases
* History of interstitial lung disease
"""


def test_extracts_expected_criteria_with_provenance():
    ids = {c.id: c for c in extract_criteria(TEXT)}
    assert {"stage_iv", "nonsquamous", "egfr_req", "alk_req", "ecog_01", "no_active_cns", "no_ild"} <= set(ids)
    assert "brain" in ids["no_active_cns"].source


def test_driver_requirements_are_or_combined():
    pop = synthetic_population(20_000)
    crit = extract_criteria(TEXT)
    both = eligible_fraction(crit, pop)
    egfr_only = eligible_fraction([c for c in crit if c.id != "alk_req"], pop)
    assert both > egfr_only > 0.005


def test_demo_protocol_budget_only_prices_research_nodes():
    proto = demo_protocol()
    b = per_patient_budget(proto, "Massachusetts", "United States")
    assert b["procedure_lines"] and all(n.coverage == "research" for n in proto.nodes
                                        if n.id in {l["node"] for l in b["procedure_lines"]})
    assert b["locality_factor"] > 1.0
    assert not b["unpriced_codes"]
