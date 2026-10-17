"""Eligibility compiler: free-text criteria -> machine-checkable predicates.

Each criterion is a small predicate over synthetic patient features, with the
source sentence kept as provenance. The MVP extractor is rule-based (regex over
CT.gov eligibility text); an LLM-assisted parser can replace `extract_criteria`
behind the same output shape, still gated by a human review screen.

`f_P` (eligible fraction) and `o_PQ` (overlap) are estimated on a synthetic
NSCLC population; see `population.py`.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class Criterion:
    id: str
    kind: str  # "inclusion" | "exclusion"
    feature: str
    op: str  # "==", "!=", "<=", ">=", "in"
    value: object
    label: str
    source: str  # sentence from the protocol that produced it

    def to_dict(self) -> dict:
        return asdict(self)


# (id, kind, regex over a criteria sentence, feature, op, value, label)
RULES: list[tuple] = [
    ("egfr_req", "inclusion", r"\bEGFR\b.{0,60}(mutation|mutant|exon 19|L858R|positive|sensitizing)", "egfr", "==", True,
     "EGFR-mutant"),
    ("alk_req", "inclusion", r"\bALK\b.{0,40}(rearrange|fusion|positive|translocation)", "alk", "==", True, "ALK-positive"),
    ("ros1_req", "inclusion", r"\bROS1\b.{0,40}(rearrange|fusion|positive)", "ros1", "==", True, "ROS1-positive"),
    ("kras_g12c_req", "inclusion", r"KRAS\s*G12C", "kras_g12c", "==", True, "KRAS G12C"),
    ("met_req", "inclusion", r"\bMET\b.{0,40}(exon 14|amplif)", "met", "==", True, "MET alteration"),
    ("her2_req", "inclusion", r"\b(HER2|ERBB2)\b.{0,40}(mutation|mutant|exon 20)", "her2", "==", True, "HER2-mutant"),
    ("pdl1_high", "inclusion", r"PD-?L1.{0,60}(≥|>=|\\>=|greater than or equal to|at least)\s*50\s*%", "pdl1", ">=", 50,
     "PD-L1 TPS ≥ 50%"),
    ("pdl1_pos", "inclusion", r"PD-?L1.{0,60}(≥|>=|\\>=|greater than or equal to|at least)\s*1\s*%", "pdl1", ">=", 1,
     "PD-L1 TPS ≥ 1%"),
    ("squamous", "inclusion", r"(?<!non-)(?<!non )(?<!non)\bsquamous\b", "histology", "==", "squamous", "Squamous histology"),
    ("nonsquamous", "inclusion", r"non-?\s?squamous", "histology", "==", "nonsquamous", "Non-squamous histology"),
    ("stage_iv", "inclusion", r"(stage\s*(IV|4)|metastatic)", "stage", "==", "IV", "Stage IV / metastatic"),
    ("stage_iii", "inclusion", r"(stage\s*III|unresectable.{0,20}locally advanced|locally advanced.{0,20}unresectable)",
     "stage", "in", ["III", "IV"], "Stage III or IV"),
    ("ecog_01", "inclusion", r"(ECOG|performance status).{0,40}(0\s*(or|-|to|–)\s*1|≤\s*1|<=\s*1|\\<=\s*1)", "ecog", "<=", 1,
     "ECOG 0–1"),
    ("ecog_02", "inclusion", r"(ECOG|performance status).{0,40}(0\s*(-|to|–)\s*2|≤\s*2|<=\s*2|\\<=\s*2)", "ecog", "<=", 2,
     "ECOG 0–2"),
    ("tx_naive", "inclusion", r"(treatment[- ]na[iï]ve|no prior systemic|first[- ]line|previously untreated|"
     r"not received prior systemic)", "prior_lines", "==", 0, "Treatment-naive"),
    ("prior_platinum", "inclusion", r"(progress\w*|prior|previously).{0,80}(platinum|chemotherapy)", "prior_lines", ">=", 1,
     "≥1 prior line"),
    ("no_active_cns", "exclusion", r"(active|untreated|symptomatic).{0,40}(brain|CNS|central nervous system) metast",
     "brain_mets_active", "==", True, "No active brain metastases"),
    ("no_prior_io", "exclusion", r"prior.{0,60}(anti-?PD-?1|anti-?PD-?L1|immune checkpoint|immunotherapy)",
     "prior_io", "==", True, "No prior checkpoint inhibitor"),
    ("no_ild", "exclusion", r"(interstitial lung disease|pneumonitis)", "ild_history", "==", True, "No ILD / pneumonitis"),
    ("no_autoimmune", "exclusion", r"active autoimmune", "autoimmune", "==", True, "No active autoimmune disease"),
]

# When two rules on the same feature both fire, keep the stricter one.
SUPERSEDES = {"pdl1_high": "pdl1_pos", "stage_iv": "stage_iii", "ecog_01": "ecog_02"}


def _split(text: str) -> list[tuple[str, str]]:
    """Split CT.gov criteria text into (section, sentence) pairs."""
    section, out = "inclusion", []
    for line in re.split(r"\n+|(?<=\.)\s+(?=[A-Z*])", text or ""):
        line = line.strip(" *-\t\\")
        if not line:
            continue
        low = line.lower()
        if low.startswith("exclusion criteria"):
            section = "exclusion"
            continue
        if low.startswith("inclusion criteria"):
            section = "inclusion"
            continue
        out.append((section, line))
    return out


def extract_criteria(text: str) -> list[Criterion]:
    found: dict[str, Criterion] = {}
    for section, sentence in _split(text):
        for rid, kind, pattern, feature, op, value, label in RULES:
            if rid in found or not re.search(pattern, sentence, re.I):
                continue
            # Inclusion rules only fire in the inclusion section (and vice versa), except
            # biomarker requirements, which some protocols state in exclusion as negations.
            if kind != section:
                continue
            found[rid] = Criterion(rid, kind, feature, op, value, label, sentence[:300])
    for strict, loose in SUPERSEDES.items():
        if strict in found:
            found.pop(loose, None)
    if "tx_naive" in found:
        found.pop("prior_platinum", None)
    if "squamous" in found and "nonsquamous" in found:
        found.pop("squamous"); found.pop("nonsquamous")
    return list(found.values())


def _eval(c: Criterion, pop: dict[str, np.ndarray]) -> np.ndarray:
    v = pop[c.feature]
    if c.op == "==":
        m = v == c.value
    elif c.op == "!=":
        m = v != c.value
    elif c.op == "<=":
        m = v <= c.value
    elif c.op == ">=":
        m = v >= c.value
    elif c.op == "in":
        m = np.isin(v, c.value)
    else:
        raise ValueError(c.op)
    return ~m if c.kind == "exclusion" else m


# Driver requirements that co-occur in one protocol are almost always alternatives
# ("EGFR, ALK or ROS1 positive") or separate cohorts, so they combine with OR.
OR_GROUPS = {"egfr_req", "alk_req", "ros1_req", "kras_g12c_req", "met_req", "her2_req"}
MIN_F = 0.005  # floor so one mis-parsed criterion cannot zero out a trial


def eligible_mask(criteria: list[Criterion], pop: dict[str, np.ndarray], drop: str | None = None) -> np.ndarray:
    n = len(next(iter(pop.values())))
    mask = np.ones(n, dtype=bool)
    drivers = np.zeros(n, dtype=bool)
    any_driver = False
    for c in criteria:
        if c.id == drop:
            continue
        if c.id in OR_GROUPS:
            drivers |= _eval(c, pop)
            any_driver = True
        else:
            mask &= _eval(c, pop)
    return mask & drivers if any_driver else mask


def eligible_fraction(criteria: list[Criterion], pop: dict[str, np.ndarray], drop: str | None = None) -> float:
    return max(float(eligible_mask(criteria, pop, drop).mean()), MIN_F)
