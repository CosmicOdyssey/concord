"""Synthetic advanced-NSCLC population for estimating f_P and o_PQ without PHI.

Every prevalence here is a modeling assumption (rounded figures in the range
reported for U.S. advanced NSCLC), listed in PREVALENCE so the UI can show
them and the sensitivity analysis can perturb them. Not clinical data.
"""

from __future__ import annotations

import numpy as np

PREVALENCE = {
    "nonsquamous": 0.75,
    "stage_iv_given_advanced": 0.75,
    "egfr_in_nonsq": 0.15,
    "alk_in_nonsq": 0.05,
    "ros1_in_nonsq": 0.015,
    "kras_g12c_in_nonsq": 0.13,
    "met_in_nonsq": 0.03,
    "her2_in_nonsq": 0.02,
    "pdl1_ge50": 0.30,
    "pdl1_1_49": 0.33,
    "ecog": [0.35, 0.45, 0.15, 0.05],  # ECOG 0,1,2,3+
    "prior_lines": [0.45, 0.35, 0.20],  # 0, 1, 2+ lines when screened
    "prior_io_given_treated": 0.70,
    "brain_mets_active": 0.10,
    "ild_history": 0.05,
    "autoimmune": 0.05,
}
SOURCE_NOTE = "Synthetic population; prevalences are rounded modeling assumptions, not patient data."


def synthetic_population(n: int = 50_000, seed: int = 7, prev: dict | None = None) -> dict[str, np.ndarray]:
    p = {**PREVALENCE, **(prev or {})}
    rng = np.random.default_rng(seed)
    nonsq = rng.random(n) < p["nonsquamous"]
    histology = np.where(nonsq, "nonsquamous", "squamous")
    stage = np.where(rng.random(n) < p["stage_iv_given_advanced"], "IV", "III")

    # Driver alterations are (approximately) mutually exclusive: draw one category.
    drivers = ["egfr", "alk", "ros1", "kras_g12c", "met", "her2"]
    probs = np.array([p[f"{d}_in_nonsq"] for d in drivers])
    cat = rng.choice(len(drivers) + 1, size=n, p=np.append(probs, 1 - probs.sum()))
    pop: dict[str, np.ndarray] = {d: (cat == i) & nonsq for i, d in enumerate(drivers)}
    # Squamous tumors rarely carry targetable drivers; a small residual rate keeps overlaps nonzero.
    pop["egfr"] |= (~nonsq) & (rng.random(n) < 0.02)

    u = rng.random(n)
    pdl1 = np.where(u < p["pdl1_ge50"], rng.integers(50, 101, n),
                    np.where(u < p["pdl1_ge50"] + p["pdl1_1_49"], rng.integers(1, 50, n), 0))
    prior_lines = rng.choice(3, size=n, p=p["prior_lines"])
    pop.update(
        histology=histology,
        stage=stage,
        pdl1=pdl1,
        ecog=rng.choice(4, size=n, p=p["ecog"]),
        prior_lines=prior_lines,
        prior_io=(prior_lines > 0) & (rng.random(n) < p["prior_io_given_treated"]),
        brain_mets_active=rng.random(n) < p["brain_mets_active"],
        ild_history=rng.random(n) < p["ild_history"],
        autoimmune=rng.random(n) < p["autoimmune"],
    )
    return pop
