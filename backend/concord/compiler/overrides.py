"""Hand-encoded eligibility for the trials shown in the demo.

The rule-based parser is not reliable enough to put in front of a clinician, so trials
the demo shows are encoded by hand from their CT.gov eligibility text. Each criterion
keeps the sentence it came from. Reviewed by a person, not generated.

Currently: Regeneron's NSCLC portfolio recruiting in 2024 (the portfolio-clearing demo).
"""

from __future__ import annotations

from concord.compiler.eligibility import Criterion


def _c(id, kind, feature, op, value, label, source):
    return Criterion(id, kind, feature, op, value, label, f"[hand-encoded] {source}")


_STAGE_3_4 = ("stage IIIB or stage IIIC disease who are not candidates for surgical resection or definitive "
              "chemoradiation ... or stage IV (metastatic disease)")
_FIRST_LINE = "received no prior systemic treatment for recurrent or metastatic NSCLC"
_ECOG = "Eastern Cooperative Oncology Group (ECOG) performance status of <=1"
_CNS = "Active or untreated brain metastases or spinal cord compression"
_DRIVERS = ("tumors tested positive for actionable EGFR gene mutations, ALK gene translocations, or ROS1 fusions "
            "[excluded]")
_ILD = "History of interstitial lung disease ... or of pneumonitis within the last 5 years [excluded]"
_SMOKE = "Patients who have never smoked, defined as smoking <=100 cigarettes in a lifetime [excluded]"


def _first_line_io(pdl1_50: bool, never_smokers_excluded: bool) -> list[Criterion]:
    out = [
        _c("stage_iii", "inclusion", "stage", "in", ["III", "IV"], "Stage IIIB–IV, not for curative therapy", _STAGE_3_4),
        _c("tx_naive", "inclusion", "prior_lines", "==", 0, "First line", _FIRST_LINE),
        _c("ecog_01", "inclusion", "ecog", "<=", 1, "ECOG 0–1", _ECOG),
        _c("no_active_cns", "exclusion", "brain_mets_active", "==", True, "No active brain metastases", _CNS),
        _c("no_egfr", "exclusion", "egfr", "==", True, "No EGFR mutation", _DRIVERS),
        _c("no_alk", "exclusion", "alk", "==", True, "No ALK translocation", _DRIVERS),
        _c("no_ros1", "exclusion", "ros1", "==", True, "No ROS1 fusion", _DRIVERS),
        _c("no_ild", "exclusion", "ild_history", "==", True, "No ILD / pneumonitis", _ILD),
    ]
    if pdl1_50:
        out.append(_c("pdl1_high", "inclusion", "pdl1", ">=", 50, "PD-L1 TPS ≥ 50%",
                      "PD-L1 levels >= 50%, as determined by a CAP/CLIA accredited laboratory"))
    if never_smokers_excluded:
        out.append(_c("no_never_smoker", "exclusion", "never_smoker", "==", True, "Never-smokers excluded", _SMOKE))
    return out


OVERRIDES: dict[str, list[Criterion]] = {
    # Fianlimab + cemiplimab vs cemiplimab, 1L advanced NSCLC, PD-L1 >= 50%
    "NCT05785767": _first_line_io(pdl1_50=True, never_smokers_excluded=True),
    # Fianlimab + cemiplimab + chemotherapy vs cemiplimab + chemotherapy, 1L, any PD-L1
    "NCT05800015": _first_line_io(pdl1_50=False, never_smokers_excluded=False),
    # Cemiplimab + BNT116 vs cemiplimab, 1L, PD-L1 >= 50%
    "NCT05557591": _first_line_io(pdl1_50=True, never_smokers_excluded=True) + [
        _c("no_autoimmune", "exclusion", "autoimmune", "==", True, "No significant autoimmune disease",
           "Ongoing or recent (within 2 years) evidence of significant autoimmune disease [excluded]")],
    # Perioperative fianlimab + cemiplimab + chemotherapy, resectable stage II–IIIB
    "NCT06161441": [
        _c("resectable", "inclusion", "stage", "==", "early", "Resectable stage II–IIIB (N2)",
           "newly diagnosed, histologically confirmed, fully resectable stage II to IIIB (N2) NSCLC"),
        _c("ecog_01", "inclusion", "ecog", "<=", 1, "ECOG 0–1", "ECOG performance status of 0 or 1"),
        _c("no_egfr", "exclusion", "egfr", "==", True, "No EGFR mutation",
           "tumors with known EGFR gene mutations, ALK gene translocations [excluded]"),
        _c("no_alk", "exclusion", "alk", "==", True, "No ALK translocation",
           "tumors with known EGFR gene mutations, ALK gene translocations [excluded]"),
    ],
    # REGN5093 (METxMET), MET-altered advanced NSCLC
    "NCT04077099": [
        _c("stage_iii", "inclusion", "stage", "in", ["III", "IV"], "Advanced (unresectable or metastatic)",
           "Histologically confirmed advanced NSCLC that is unresectable or metastatic"),
        _c("met_req", "inclusion", "met", "==", True, "MET alteration", "Documented presence of MET alteration"),
        _c("ecog_01", "inclusion", "ecog", "<=", 1, "ECOG 0–1", "ECOG performance status of 0 or 1"),
        _c("no_active_cns", "exclusion", "brain_mets_active", "==", True, "No active brain metastases",
           "Untreated or active primary brain tumor, CNS metastases ... [excluded]"),
    ],
}
