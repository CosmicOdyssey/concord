"""Schedule-of-assessments DAG (master doc §4.1).

A protocol compiles to (i) capability requirements, (ii) a coverage label per node
and (iii) a per-patient budget priced from Medicare codes. The MVP has one
hand-authored demo protocol; the schema is what an LLM-assisted parser of full
protocol PDFs would fill later.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Coverage = Literal["routine", "research"]


class Visit(BaseModel):
    id: str
    label: str
    day: int


class Node(BaseModel):
    id: str
    visit: str
    procedure: str
    code: str  # CPT / HCPCS
    capabilities: list[str] = []
    coverage: Coverage
    rationale: str  # why it got that coverage label (reviewed, not authored, by the site)


class Edge(BaseModel):
    src: str  # visit id
    dst: str
    window_min_days: int
    window_max_days: int


class Protocol(BaseModel):
    id: str
    title: str
    nct_id: str | None = None
    visits: list[Visit]
    nodes: list[Node]
    edges: list[Edge]

    def requirements(self) -> list[str]:
        return sorted({c for n in self.nodes for c in n.capabilities})


def _cycle(i: int, day: int, extra: list[Node] | None = None) -> tuple[Visit, list[Node]]:
    v = f"C{i}D1"
    nodes = [
        Node(id=f"{v}-visit", visit=v, procedure="Established patient visit", code="99214", coverage="routine",
             rationale="Pre-dose assessment is standard of care for docetaxel."),
        Node(id=f"{v}-cbc", visit=v, procedure="CBC with differential", code="85025", coverage="routine",
             rationale="Standard pre-chemotherapy labs."),
        Node(id=f"{v}-cmp", visit=v, procedure="Comprehensive metabolic panel", code="80053", coverage="routine",
             rationale="Standard pre-chemotherapy labs."),
        Node(id=f"{v}-doce", visit=v, procedure="Chemotherapy IV infusion, first hour (docetaxel)", code="96413",
             capabilities=["infusion"], coverage="routine",
             rationale="Docetaxel is the standard-of-care comparator backbone; administration billable under NCD 310.1."),
        Node(id=f"{v}-drugx", visit=v, procedure="Sequential IV infusion (investigational Drug X)", code="96417",
             capabilities=["infusion", "ip_pharmacy"], coverage="research",
             rationale="Investigational product administration; sponsor pays."),
    ]
    return Visit(id=v, label=f"Cycle {i} Day 1", day=day), nodes + (extra or [])


def demo_protocol() -> Protocol:
    visits = [Visit(id="SCR", label="Screening", day=-28)]
    nodes = [
        Node(id="SCR-visit", visit="SCR", procedure="New patient visit, high complexity", code="99205",
             coverage="routine", rationale="Oncology consult for second-line therapy is standard of care."),
        Node(id="SCR-ct-chest", visit="SCR", procedure="CT chest with contrast", code="71260", capabilities=["ct"],
             coverage="routine", rationale="Baseline staging is standard of care."),
        Node(id="SCR-ct-abd", visit="SCR", procedure="CT abdomen/pelvis with contrast", code="74177",
             capabilities=["ct"], coverage="routine", rationale="Baseline staging is standard of care."),
        Node(id="SCR-mri", visit="SCR", procedure="MRI brain with and without contrast", code="70553",
             capabilities=["mri"], coverage="routine", rationale="Brain imaging is standard staging in advanced NSCLC."),
        Node(id="SCR-ngs", visit="SCR", procedure="Targeted NGS panel, 5–50 genes (central lab)", code="81445",
             capabilities=["central_lab_shipping", "tissue_handling"], coverage="research",
             rationale="Protocol-mandated central confirmation; sponsor pays."),
        Node(id="SCR-pdl1", visit="SCR", procedure="Immunohistochemistry, PD-L1 (central)", code="88342",
             capabilities=["tissue_handling"], coverage="research", rationale="Protocol-specific central IHC."),
        Node(id="SCR-ecg", visit="SCR", procedure="12-lead ECG", code="93000", capabilities=["ecg"],
             coverage="research", rationale="Required by protocol for QTc baseline, not by standard care."),
        Node(id="SCR-tsh", visit="SCR", procedure="TSH", code="84443", coverage="research",
             rationale="Protocol-specific baseline."),
        Node(id="SCR-hcg", visit="SCR", procedure="Serum pregnancy test", code="84702", coverage="research",
             rationale="Required for trial enrollment."),
        Node(id="SCR-cbc", visit="SCR", procedure="CBC with differential", code="85025", coverage="routine",
             rationale="Standard pre-treatment labs."),
        Node(id="SCR-cmp", visit="SCR", procedure="Comprehensive metabolic panel", code="80053", coverage="routine",
             rationale="Standard pre-treatment labs."),
    ]
    day = 1
    for i in range(1, 7):
        extra = []
        if i in (1, 2):
            extra.append(Node(id=f"C{i}D1-pk", visit=f"C{i}D1", procedure="PK blood draw", code="36415",
                              capabilities=["pk_processing"], coverage="research",
                              rationale="Pharmacokinetic sampling for the investigational product."))
        if i == 1:
            extra.append(Node(id="C1D1-ecg", visit="C1D1", procedure="12-lead ECG (post-dose)", code="93000",
                              capabilities=["ecg"], coverage="research", rationale="Protocol QTc monitoring."))
        v, n = _cycle(i, day, extra)
        visits.append(v)
        nodes += n
        day += 21
    visits.insert(2, Visit(id="C1D8", label="Cycle 1 Day 8", day=8))
    nodes += [
        Node(id="C1D8-visit", visit="C1D8", procedure="Established patient visit", code="99213", coverage="research",
             rationale="Protocol-mandated toxicity check not required by standard care."),
        Node(id="C1D8-cbc", visit="C1D8", procedure="CBC with differential", code="85025", coverage="research",
             rationale="Protocol-mandated."),
    ]
    for wk, cov in ((6, "routine"), (12, "routine"), (18, "research")):
        vid = f"IMG-W{wk}"
        visits.append(Visit(id=vid, label=f"Tumor assessment week {wk}", day=wk * 7))
        why = ("Response assessment at this interval is standard of care." if cov == "routine"
               else "Scan more frequent than standard care; sponsor pays.")
        nodes += [
            Node(id=f"{vid}-ct-chest", visit=vid, procedure="CT chest with contrast", code="71260",
                 capabilities=["ct", "central_imaging_upload"], coverage=cov, rationale=why),
            Node(id=f"{vid}-ct-abd", visit=vid, procedure="CT abdomen/pelvis with contrast", code="74177",
                 capabilities=["ct", "central_imaging_upload"], coverage=cov, rationale=why),
        ]
    visits += [Visit(id="EOT", label="End of treatment", day=day), Visit(id="FU30", label="30-day safety follow-up",
                                                                        day=day + 30)]
    nodes += [
        Node(id="EOT-visit", visit="EOT", procedure="Established patient visit", code="99214", coverage="routine",
             rationale="End-of-therapy assessment is standard care."),
        Node(id="EOT-ecg", visit="EOT", procedure="12-lead ECG", code="93000", capabilities=["ecg"],
             coverage="research", rationale="Protocol QTc monitoring."),
        Node(id="EOT-cbc", visit="EOT", procedure="CBC with differential", code="85025", coverage="routine",
             rationale="Standard labs."),
        Node(id="FU30-visit", visit="FU30", procedure="Established patient visit", code="99213", coverage="research",
             rationale="Safety follow-up required by protocol."),
    ]
    visits.sort(key=lambda v: v.day)
    edges = [Edge(src=a.id, dst=b.id, window_min_days=max(0, b.day - a.day - 3), window_max_days=b.day - a.day + 3)
             for a, b in zip(visits, visits[1:])]
    return Protocol(id="demo-nsclc-2l", title="Demo: Phase III Drug X + docetaxel vs docetaxel, 2L advanced NSCLC",
                    visits=visits, nodes=nodes, edges=edges)
