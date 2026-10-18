"""Any trial in Protocol to terms: add a trial by NCT ID, then give it a schedule of assessments.

1. add_trial(nct) fetches the study once from the public ClinicalTrials.gov API v2 (timeout, clear error for an
   unknown ID) and writes it to a gitignored cache under the data dir (terms_registry.cache_dir(), by default
   <data>/work/registry_cache/): <NCT>.study.json (the API response), <NCT>.json (the registry snapshot, written
   by concord.compiler.registry_snapshot.snapshot exactly as for SIENNA) and <NCT>.protocol.json (the schedule).
   Never the repo, never the database. Sites resolve to Medicare localities exactly as for SIENNA (concord.terms
   reads the snapshot through terms_registry; an unresolved locality stays unresolved).
2. The schedule comes from one of two routes:
   (a) the user's schedule of assessments as CSV (parse_soa_csv; columns visit, day or week, procedure, code,
       repeats; messy input accepted), or
   (b) a draft from the registry (draft_from_registry): visits from the outcome measures' time frames,
       procedures from named assessments in outcome measures, interventions and eligibility, mapped to codes ONLY
       through PROC_TABLE below, and only to codes present in the loaded CMS rate card. Every drafted visit and
       item says which registry field and words it was inferred from; anything unmappable stays unpriced and is
       listed.
3. Coverage: without the sponsor's protocol, routine care and research cannot be told apart from the registry.
   Every item of an added trial is rule RA, "research (assumed until reviewed)"; a reviewer marks routine care
   with the existing per-item overrides.

Decision support, not a fair-market-value legal opinion. No forecasting.
"""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

from concord import terms, terms_registry
from concord.compiler import registry_snapshot
from concord.ratecard import medicare

API = registry_snapshot.API
FETCH_TIMEOUT = 20  # seconds
NCT_RE = re.compile(r"^NCT\d{8}$")
DRAFT_LABEL = "Draft from the public record, not the sponsor's protocol"
CSV_LABEL = "Uploaded schedule of assessments (CSV, as supplied); not checked against the sponsor's protocol"
CONFIRM = "confirm against the protocol"
ASSUMED_RULE = "RA"
MAX_CSV_CHARS = 200_000
MAX_VISITS = 40
MAX_ROWS = 2_000
PFS_FILE = "CMS PFS 2026 Relative Value File (rvu26d.zip, PPRRVU)"
CLFS_FILE = "CMS CLFS 2026 Q4 file (clfs_cy2026_q4v1.zip)"
TEMPLATE_HEADER = ["visit", "day", "procedure", "code", "repeats"]


# ---------------------------------------------------------------- explicit procedure-to-code table

# (id, pattern, label, code or pricing, category, where it may come from). code: a CPT/HCPCS code, or
# "standard:<item>" (Concord's proposed standard schedule), "none" (no separate charge) or "unpriced".
# where: "outcome" (outcome measures), "elig" (eligibility criteria, placed at screening) or "both".
# A code is used only when the loaded CMS rate card has it; otherwise the item stays unpriced and is listed.
PROC_TABLE: list[tuple[str, str, str, str, str, str]] = [
    ("a1c", r"hba1c|glycated ha?emoglobin|glycosylated ha?emoglobin|ha?emoglobin a1c", "Hemoglobin A1c", "83036",
     "Labs", "both"),
    ("fpg", r"fasting (plasma |serum )?glucose|\bfpg\b", "Glucose, blood (fasting)", "82947", "Labs", "both"),
    ("lipids", r"cholesterol|\bldl\b|\bhdl\b|triglyceride|lipid panel|lipid profile", "Lipid panel", "80061", "Labs",
     "both"),
    ("creat", r"\begfr\b|glomerular filtration|serum creatinine|kidney function|renal function", "Creatinine, blood",
     "82565", "Labs", "both"),
    ("ualb", r"albumin[- ]?(to[- ])?creatinine ratio|\buacr\b|urin\w* albumin", "Albumin, urine (quantitative)",
     "82043", "Labs", "both"),
    ("ucreat", r"albumin[- ]?(to[- ])?creatinine ratio|\buacr\b", "Creatinine, urine (for the ratio)", "82570",
     "Labs", "both"),
    ("bnp", r"nt-?pro-?bnp|natriuretic peptide", "Natriuretic peptide (NT-proBNP)", "83880", "Labs", "both"),
    ("trop", r"troponin", "Troponin, quantitative", "84484", "Labs", "both"),
    # not "potassium-sparing diuretic" (a medication criterion, not a test)
    ("k", r"\bpotassium\b(?![- ]sparing)|hyperkal", "Potassium, serum", "84132", "Labs", "both"),
    ("cbc", r"complete blood count|ha?ematology|\bcbc\b|neutrophil count|platelet count", "Blood count with differential",
     "85025", "Labs", "both"),
    ("chem", r"chemistry|liver function|metabolic panel|\balt\b|\bast\b|bilirubin|transaminase", "Comprehensive chemistry panel",
     "80053", "Labs", "both"),
    ("tsh", r"\btsh\b|thyroid[- ]stimulating|thyroid function", "Thyroid stimulating hormone", "84443", "Labs", "both"),
    ("preg", r"pregnan|childbearing potential", "Pregnancy test, urine", "81025", "Labs", "elig"),
    ("hbv", r"hepatitis b", "Hepatitis B surface antigen", "87340", "Labs", "elig"),
    ("hcv", r"hepatitis c", "Hepatitis C antibody", "86803", "Labs", "elig"),
    ("hiv", r"\bhiv\b|human immunodeficiency virus", "HIV-1/2 antigen and antibody", "87389", "Labs", "elig"),
    ("ecg", r"\becg\b|\bekg\b|electrocardiogra|\bqtc\b", "Electrocardiogram, 12-lead, with interpretation", "93000",
     "Cardiac tests", "both"),
    # not the registry mislabel "echocardiogram (ECG)": that is an ECG, drafted by the row above
    ("echo", r"echocardiogra(?:m|phy)(?!\s*\(\s*(?:ECG|EKG)\s*\))|ejection fraction|\blvef\b",
     "Echocardiogram, complete, with Doppler", "93306",
     "Cardiac tests", "both"),
    ("6mw", r"6[- ]?minute walk|six[- ]minute walk|\b6mwd?t?\b", "Six-minute walk test", "94618", "Function tests",
     "both"),
    ("spiro", r"spirometr|\bfev1\b|forced expiratory", "Spirometry", "94010", "Function tests", "both"),
    ("ct_chest", r"recist|tumou?r (response|assessment)|objective response|progression[- ]free|radiographic progression"
                 r"|\bbicr\b", "CT chest with contrast (tumor assessment; CT assumed, RECIST allows CT or MRI)", "71260",
     "Imaging", "outcome"),
    ("ct_abd", r"recist|tumou?r (response|assessment)|objective response|progression[- ]free|radiographic progression"
               r"|\bbicr\b", "CT abdomen and pelvis with contrast (tumor assessment; CT assumed)", "74177", "Imaging",
     "outcome"),
    ("vitals", r"blood pressure|\bsbp\b|\bdbp\b|heart rate", "Blood pressure and heart rate (taken at the visit)", "none",
     "Measurements", "outcome"),
    ("anthro", r"\bweight\b|\bbmi\b|body mass index|waist", "Body weight, BMI and waist (measured at the visit)", "none",
     "Measurements", "outcome"),
    ("pro", r"questionnaire|quality of life|\bqol\b|kccq|kansas city cardiomyopathy|sf-?36|short[- ]form|eq-?5d|eortc"
            r"|\bqlq\b|iwqol|\bfact-[a-z]|patient[- ]reported|promis|health survey|symptom score",
     "Questionnaire administration", "standard:pro", "Questionnaires", "outcome"),
    ("pk", r"pharmacokinetic|\bpk\b|plasma concentration|serum concentration|trough|anti-drug antibod|\bada\b"
           r"|immunogenicity|neutrali[sz]ing antibod", "PK or antibody sample: process and ship", "standard:sample_kit",
     "Research samples", "outcome"),
    ("survival", r"overall survival|all-cause (death|mortality)|death from any cause|vital status",
     "Survival status contact", "standard:survival_contact", "Follow-up", "outcome"),
    ("events", r"time to first|hospitali[sz]ation|cardiovascular death|\bcv death|myocardial infarction|\bstroke\b"
               r"|heart failure event|\bmace\b|\bhhf\b|\bhfe\b|event-free|recurrence|disease progression|new-onset",
     "Clinical endpoint events: ascertainment and source documents", "unpriced", "Endpoint events", "outcome"),
    ("pcr", r"pathologic(al)? complete response|\bpcr\b",
     "Pathologic response of the surgical specimen (pCR) for the endpoint", "unpriced", "Endpoint events", "outcome"),
    ("ae", r"adverse event|\bteaes?\b|\bt?saes?\b|\baes?\b|tolerability",
     "Adverse-event review (part of each visit)", "none", "Safety", "outcome"),
]
_TABLE = [(i, re.compile(p, re.I), lab, code, cat, where) for i, p, lab, code, cat, where in PROC_TABLE]
NONE_NOTE = ("No separate Medicare code: part of the visit itself, covered by the per-visit coordinator time in the "
             "proposed standard schedule")


def _in_ratecard(code: str) -> str | None:
    """'PFS' or 'CLFS' when the loaded CMS rate card has an amount for this code, else None."""
    cms = medicare._cms()  # noqa: SLF001 - same package family
    row = cms.get("pfs", {}).get("codes", {}).get(code)
    if row and row.get("national"):
        return "PFS"
    if code in cms.get("clfs", {}).get("codes", {}):
        return "CLFS"
    return None


def descriptor_ref(code: str) -> str:
    """Where the CMS code descriptor is published. Concord shows its own short label: the CPT descriptor text is
    AMA-copyrighted and is not copied out of the CMS files."""
    sched = _in_ratecard(code)
    if sched == "PFS":
        return f"HCPCS {code}: descriptor in the {PFS_FILE}"
    if sched == "CLFS":
        return f"HCPCS {code}: descriptor in the {CLFS_FILE}"
    return f"HCPCS {code}: not in the loaded CMS rate card"


def _proc_from_table(tid: str, code_override: str | None = None) -> dict:
    """A protocol procedure for a table entry, with its pricing and descriptor citation."""
    _, _, label, code, cat, _ = next(t for t in _TABLE if t[0] == tid)
    code = code_override or code
    out = {"id": tid, "label": label, "category": cat}
    if code.startswith("standard:"):
        out["pricing"] = code
        out["mapping"] = f"Concord proposed standard schedule item '{code.split(':', 1)[1]}' (not a CMS code)"
    elif code == "none":
        out["pricing"] = "none"
        out["note"] = NONE_NOTE
        out["mapping"] = "No CMS code: " + NONE_NOTE[0].lower() + NONE_NOTE[1:]
    elif code == "unpriced":
        out["pricing"] = "unpriced"
        out["note"] = terms.UNPRICED_NOTE
        out["mapping"] = "No CPT code describes this; no published Medicare amount"
    elif _in_ratecard(code):
        out.update({"code": code, "pricing": "cpt", "mapping": descriptor_ref(code)})
    else:
        out.update({"pricing": "unpriced", "note": f"Code {code} is not in the loaded CMS rate card; left unpriced",
                    "mapping": descriptor_ref(code)})
    return out


def match_table(text: str, where: str) -> list[str]:
    """Table ids whose pattern matches the text, for a source ('outcome' or 'elig')."""
    return [t[0] for t in _TABLE if t[5] in (where, "both") and t[1].search(text or "")]


# ---------------------------------------------------------------- fetch and cache

def _check_nct(nct: str) -> str:
    n = (nct or "").strip().upper()
    if not NCT_RE.match(n):
        raise terms.TermsError(f"'{nct}' is not an NCT ID (NCT followed by 8 digits, e.g. NCT06541704)")
    return n


def fetch_study(nct: str, timeout: float = FETCH_TIMEOUT) -> dict:
    """The study record from the public ClinicalTrials.gov API v2."""
    req = urllib.request.Request(API.format(nct=nct), headers={"Accept": "application/json",
                                                               "User-Agent": "Concord protocol-to-terms"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - fixed https host
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):  # the API answers 404 for an unknown ID and 400 for one it cannot accept
            raise terms.NotFound(f"ClinicalTrials.gov has no study {nct}. Check the NCT ID.") from e
        raise terms.TermsError(f"ClinicalTrials.gov returned HTTP {e.code} for {nct}; try again later") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise terms.TermsError(f"Could not reach ClinicalTrials.gov ({e}); try again later") from e
    except json.JSONDecodeError as e:
        raise terms.TermsError(f"ClinicalTrials.gov sent an unreadable record for {nct}") from e
    got = data.get("protocolSection", {}).get("identificationModule", {}).get("nctId")
    if got != nct:
        raise terms.TermsError(f"ClinicalTrials.gov returned {got or 'no study'} for {nct}")
    return data


def _path(nct: str, kind: str):
    d = terms_registry.cache_dir()
    return d / (f"{nct}.json" if kind == "snapshot" else f"{nct}.{kind}.json")


def _write(path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def _clear() -> None:
    terms.load_protocol.cache_clear()
    terms_registry.snapshot.cache_clear()


def _now() -> str:
    """Version stamp of a written schedule (import.updated): the screen refetches prices when it changes."""
    return datetime.now(timezone.utc).isoformat()


def study(nct: str) -> dict | None:
    if not NCT_RE.match(nct or ""):
        return None
    p = _path(nct, "study")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load(nct: str) -> dict | None:
    """The cached schedule of an added trial (raw protocol file shape), or None. Read by terms.load_protocol."""
    if not NCT_RE.match(nct or ""):
        return None
    p = _path(nct, "protocol")
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def added() -> list[str]:
    d = terms_registry.cache_dir()
    if not d.exists():
        return []
    return sorted(p.name.split(".")[0] for p in d.glob("NCT*.protocol.json"))


def _dedupe_sites(st: dict) -> dict:
    """Locations that share a database site key (e.g. several anonymized 'Investigational Site' rows in one city)
    are one site, as in the database build (concord.ingest.normalize keeps one row per key)."""
    from concord.ingest.normalize import site_key
    ps = st["protocolSection"]
    locs = ps.get("contactsLocationsModule", {}).get("locations", [])
    seen, keep = set(), []
    for loc in locs:
        if loc.get("country") == "United States":
            k = site_key(loc.get("facility"), loc.get("city"), loc.get("state"), loc.get("country"))[0]
            if k in seen:
                continue
            seen.add(k)
        keep.append(loc)
    if len(keep) == len(locs):
        return st
    cl = {**ps.get("contactsLocationsModule", {}), "locations": keep}
    return {**st, "protocolSection": {**ps, "contactsLocationsModule": cl}}


def add_trial(nct: str, fetch=None) -> dict:
    """Fetch (once) and cache a trial, draft its schedule from the registry if it has none yet."""
    nct = _check_nct(nct)
    if (terms.PROTOCOL_DIR / f"{nct}.json").exists():
        return {"nct_id": nct, "status": "authored", "message": f"{nct} already has an authored schedule"}
    st = study(nct)
    fetched_now = st is None
    if st is None:
        st = (fetch or fetch_study)(nct)
        today = date.today().isoformat()
        st = {**st, "_concord": {"fetched": today, "source_url": API.format(nct=nct)}}
        _write(_path(nct, "study"), st)
    fetched = st.get("_concord", {}).get("fetched", date.today().isoformat())
    if not _path(nct, "snapshot").exists():
        snap = registry_snapshot.snapshot(_dedupe_sites(st), fetched)
        snap["note"] = ("Cached snapshot of the ClinicalTrials.gov record, fetched once when the trial was added by "
                        "NCT ID (not in the repo or the database). U.S. locations only (protocolSection."
                        "contactsLocationsModule.locations); site_id uses the database key.")
        _write(_path(nct, "snapshot"), snap)
    _clear()
    if not terms._site_rows(nct):  # noqa: SLF001 - the same site list every step reads
        for kind in ("study", "snapshot", "protocol"):
            _path(nct, kind).unlink(missing_ok=True)
        _clear()
        raise terms.TermsError(f"{nct} has no registered U.S. sites on ClinicalTrials.gov; Concord prices at a U.S. "
                               f"site's Medicare locality, so it cannot build a site budget")
    if load(nct) is None:
        _write(_path(nct, "protocol"), draft_from_registry(st))
    _clear()
    p = load(nct)
    return {"nct_id": nct, "status": "fetched" if fetched_now else "cached", "fetched": fetched,
            "source_url": API.format(nct=nct), "import": p["import"]}


# ---------------------------------------------------------------- registry draft

_UNIT_DAYS = {"day": 1.0, "week": 7.0, "month": 30.4375, "year": 365.25}
_UNIT_RE = r"(day|week|wk|month|year)s?"
_LIST_RE = re.compile(_UNIT_RE + r"\s*(-?\d+(?:\s*(?:,|and|or|&|to|through|-|–)\s*-?\d+)*)", re.I)
_NUM_UNIT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*-?\s*" + _UNIT_RE + r"\b(?!\s+(?:after|post|following|prior|before|of))",
                          re.I)
_BASELINE_RE = re.compile(r"baseline|randomi[sz]ation|\bday\s*1\b|\bweek\s*0\b|\bday\s*0\b", re.I)


def _unit(u: str) -> str:
    u = u.lower()
    return "week" if u.startswith("w") else u.rstrip("s")


def _day_of(n: float, unit: str) -> int:
    if unit == "day":
        return max(1, int(round(n)))
    if n == 0:
        return 1
    return int(round(n * _UNIT_DAYS[unit])) + 1


# "up to (approximately) 30 weeks", "through Week 52", "until Month 6": the END of an observation window, not a
# scheduled visit (a horizon).
_HORIZON_BEFORE_RE = re.compile(r"\b(?:up\s+to|through|thru|until|till)\s*(?:(?:approximately|approx\.?|about|around"
                                r"|~|a\s+maximum\s+of|maximum\s+of)\s*)?$", re.I)


def timepoints(text: str) -> list[tuple[int, str, str, bool]]:
    """(study day, unit, number, horizon) for each time point a time frame names. Baseline is day 1. horizon is
    True for the end of a window ('up to', 'through', 'until' N): not a scheduled visit."""
    out: list[tuple[int, str, str, bool]] = []
    t = text or ""
    if _BASELINE_RE.search(t):
        out.append((1, "day", "1", False))
    for m in _LIST_RE.finditer(t):
        unit = _unit(m.group(1))
        horizon = bool(_HORIZON_BEFORE_RE.search(t[: m.start()]))
        for num in re.findall(r"-?\d+", m.group(2)):
            n = float(num)
            if n < 0 or n * _UNIT_DAYS[unit] > 3660 * 1.1:
                continue
            out.append((_day_of(n, unit), unit, num, horizon))
    for m in _NUM_UNIT_RE.finditer(t):
        n, unit = float(m.group(1)), _unit(m.group(2))
        if n <= 0 or n * _UNIT_DAYS[unit] > 3660 * 1.1:
            continue
        out.append((_day_of(n, unit), unit, m.group(1), bool(_HORIZON_BEFORE_RE.search(t[: m.start()]))))
    return out


_VID_PREFIX = {"day": "D", "week": "W", "month": "M", "year": "Y"}


def _q(s: str, n: int = 160) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _inferred(field: str, quote: str) -> str:
    return f"inferred from the registry: {field} \"{_q(quote)}\" - {CONFIRM}"


def _is_cancer(ps: dict) -> bool:
    words = " ".join(ps.get("conditionsModule", {}).get("conditions", []) + [ps["identificationModule"].get(
        "briefTitle", "")])
    return bool(re.search(r"cancer|carcinoma|tumou?r|lymphoma|leuka?emia|myeloma|sarcoma|melanoma|neoplasm", words, re.I))


def draft_from_registry(st: dict) -> dict:
    """A cited draft schedule from the registry record (see module docstring, route b)."""
    ps = st["protocolSection"]
    ident, design = ps["identificationModule"], ps.get("designModule", {})
    nct = ident["nctId"]
    om = ps.get("outcomesModule", {})
    arms = ps.get("armsInterventionsModule", {})
    elig = ps.get("eligibilityModule", {}).get("eligibilityCriteria", "") or ""
    fetched = st.get("_concord", {}).get("fetched", date.today().isoformat())

    # Visits: screening, day 1, then each time point named in an outcome measure's time frame.
    points: dict[int, dict] = {}
    measures = []
    for key in ("primaryOutcomes", "secondaryOutcomes"):
        for i, o in enumerate(om.get(key, [])):
            field = f"outcomesModule.{key}[{i}]"
            tps = timepoints(o.get("timeFrame", ""))
            measures.append({"field": field, "measure": o.get("measure", ""), "description": o.get("description", ""),
                             "timeFrame": o.get("timeFrame", ""), "days": sorted({tp[0] for tp in tps})})
            for d, unit, num, horizon in tps:
                if d == 1:
                    continue
                pt = {"day": d, "unit": unit, "num": num, "field": f"{field}.timeFrame",
                      "quote": o.get("timeFrame", ""), "horizon": horizon}
                near = next((k for k in points if abs(k - d) <= 3), None)
                if near is None:
                    points[d] = pt
                elif points[near]["horizon"] and not horizon:  # a named time point outranks a window's end
                    points[near] = {**pt, "day": near}
    later = sorted(points)[: MAX_VISITS - 2]
    dropped = len(points) - len(later)
    first_tf = next((m for m in measures if 1 in m["days"]), None)
    visits = [{"id": "SCR", "label": "Screening (eligibility)", "short": "Scr", "kind": "screening", "day": -28,
               "day_end": -1, "window": "before Day 1 (timing not in the registry; Day -28 to -1 assumed)",
               "inferred": _inferred("eligibilityModule.eligibilityCriteria", next(
                   (ln.strip(" *-\t") for ln in elig.splitlines() if ln.strip(" *-\t") and not ln.strip().endswith(":")),
                   "eligibility criteria"))},
              {"id": "D1", "label": "Day 1 (baseline, first dose)", "short": "D1", "kind": "treatment", "day": 1,
               "minus": 0, "plus": 0, "window": "Day 1",
               "inferred": _inferred(f"{first_tf['field']}.timeFrame", first_tf["timeFrame"]) if first_tf else
               _inferred("armsInterventionsModule.interventions[0].name",
                         (arms.get("interventions") or [{}])[0].get("name", "study treatment"))}]
    day_to_vid = {1: "D1"}
    for d in later:
        pt = points[d]
        vid = f"{_VID_PREFIX[pt['unit']]}{pt['num']}"
        while any(v["id"] == vid for v in visits):
            vid += "b"
        label = f"{pt['unit'].capitalize()} {pt['num']}"
        if pt["horizon"]:
            # The end of an outcome's time frame: its items are drafted once there, with no coordinator time (not a
            # scheduled visit), and the label says so.
            visits.append({"id": vid, "label": f"Up to {label}: end of time frame, not a scheduled visit",
                           "short": f"≤{vid}", "kind": "treatment", "day": d, "minus": 0, "plus": 0,
                           "coordinator": False, "horizon": True,
                           "window": (f"Day {d}: the end of the outcome's time frame, not a scheduled visit; no "
                                      f"coordinator time - {CONFIRM}"),
                           "inferred": _inferred(pt["field"], pt["quote"])
                           + "; the time frame names only its end (a horizon), not a visit"})
        else:
            visits.append({"id": vid, "label": label, "short": vid, "kind": "treatment", "day": d, "minus": 0,
                           "plus": 0, "window": f"Day {d} (window not in the registry)",
                           "inferred": _inferred(pt["field"], pt["quote"])})
        day_to_vid[d] = vid

    def vids_for(days: list[int]) -> list[str]:
        out = []
        for d in days:
            k = min(day_to_vid, key=lambda x: abs(x - d))
            if abs(k - d) <= 3 and day_to_vid[k] not in out:
                out.append(day_to_vid[k])
        return out

    procs: dict[str, dict] = {}
    sched: dict[str, dict[str, str]] = {}  # proc id -> visit id -> reason
    unmapped: list[dict] = []
    sources: list[dict] = []

    def put(pid: str, proc: dict, vids: list[str], reason: str) -> None:
        procs.setdefault(pid, proc)
        for v in vids:
            sched.setdefault(pid, {}).setdefault(v, reason)

    last = visits[-1]["id"]
    for m in measures:
        text = f"{m['measure']} {m['description']}"
        hits = match_table(text, "outcome")
        vids = vids_for(m["days"])
        placed_last = not vids
        if placed_last:
            vids = [last]
        tf_note = (f"; the time frame \"{_q(m['timeFrame'], 80)}\" names no fixed time point, so it is placed at the "
                   f"last drafted visit (an assumption)" if placed_last else "")
        reason = _inferred(f"{m['field']}.measure", m["measure"]) + tf_note
        if hits:
            for h in hits:
                put(h, {**_proc_from_table(h), "inferred": reason}, vids, reason)
            sources.append({"field": f"{m['field']}.measure and .timeFrame",
                            "quote": _q(f"{m['measure']} / {m['timeFrame']}", 200),
                            "used_for": "Drafted: " + ", ".join(procs[h]["label"] for h in hits)})
        else:
            pid = f"om{len(unmapped) + 1}"
            label = _q(m["measure"], 90)
            put(pid, {"id": pid, "label": f"Outcome assessment: {label}", "short_label": label, "category": "Unmapped",
                      "pricing": "unpriced", "note": "Not in Concord's procedure-to-code table: left unpriced, to be "
                      "negotiated (never counted as zero)", "mapping": "Unmapped: no table entry matches",
                      "inferred": reason}, vids, reason)
            unmapped.append({"field": f"{m['field']}.measure", "quote": _q(m["measure"], 200),
                             "why": "no entry in Concord's procedure-to-code table matches; listed and left unpriced"})

    # Eligibility: named tests, at screening, one per table entry (the first criterion that names it).
    lines = [ln.strip(" *-\t") for ln in elig.splitlines() if ln.strip(" *-\t")]
    for ln in lines:
        for h in match_table(ln, "elig"):
            if h in sched and "SCR" in sched[h]:
                continue
            reason = _inferred("eligibilityModule.eligibilityCriteria", ln)
            put(h, {**_proc_from_table(h), "inferred": reason}, ["SCR"], reason)
            sources.append({"field": "eligibilityModule.eligibilityCriteria", "quote": _q(ln, 200),
                            "used_for": f"Drafted at screening: {procs[h]['label']}"})

    # Interventions: one administration line per route at Day 1, plus study-drug dispensing.
    ints = arms.get("interventions", [])
    routes: dict[str, tuple[str, str]] = {}
    cancer = _is_cancer(ps)
    for i, iv in enumerate(ints):
        name, desc = iv.get("name", ""), iv.get("description", "") or ""
        if iv.get("type") not in ("DRUG", "BIOLOGICAL") or re.search(r"placebo|rescue", name, re.I):
            if iv.get("type") not in ("DRUG", "BIOLOGICAL"):
                unmapped.append({"field": f"armsInterventionsModule.interventions[{i}]",
                                 "quote": _q(f"{iv.get('type')}: {name}", 200),
                                 "why": "a non-drug intervention; no code drafted, add it in the CSV if it is billed"})
            continue
        text = f"{name} {desc}"
        if re.search(r"subcutaneous|\bs\.?c\.?\b|intramuscular", text, re.I):
            routes.setdefault("sc", (f"armsInterventionsModule.interventions[{i}].description", desc or name))
        elif re.search(r"intravitreal", text, re.I):
            routes.setdefault("ivt", (f"armsInterventionsModule.interventions[{i}].description", desc or name))
        elif re.search(r"intravenous|\biv\b|infusion", text, re.I):
            routes.setdefault("iv", (f"armsInterventionsModule.interventions[{i}].description", desc or name))
        elif re.search(r"oral|tablet|capsule|by mouth", text, re.I):
            routes.setdefault("oral", (f"armsInterventionsModule.interventions[{i}].description", desc or name))
        else:
            routes.setdefault("unknown", (f"armsInterventionsModule.interventions[{i}].name", name))
    admin = {"sc": ("adm_sc", "Study drug injection, subcutaneous or intramuscular", "96372"),
             "ivt": ("adm_ivt", "Study drug intravitreal injection", "67028"),
             "iv": ("adm_iv", "Study drug IV infusion, first hour" + (" (anticancer agent)" if cancer else ""),
                    "96413" if cancer else "96365")}
    for r, (field, quote) in routes.items():
        reason = _inferred(field, quote) + ("; given at Day 1 only: the registry does not give the dosing interval, "
                                            "add the other dosing visits in the CSV")
        if r in admin:
            pid, label, code = admin[r]
            proc = {"id": pid, "label": label, "category": "Treatment", "inferred": reason}
            if _in_ratecard(code):
                proc.update({"code": code, "pricing": "cpt", "mapping": descriptor_ref(code)})
            else:
                proc.update({"pricing": "unpriced", "note": f"Code {code} is not in the loaded CMS rate card",
                             "mapping": descriptor_ref(code)})
            put(pid, proc, ["D1"], reason)
        elif r == "unknown":
            unmapped.append({"field": field, "quote": _q(quote, 200),
                             "why": "the registry does not say how the study drug is given; no administration code"})
        sources.append({"field": field, "quote": _q(quote, 200), "used_for": f"Study drug route: {r}"})
    if routes:
        f0, q0 = next(iter(routes.values()))
        reason = _inferred(f0, q0) + "; at Day 1 only (dosing interval not in the registry)"
        put("ip_disp", {"id": "ip_disp", "label": "Study drug preparation and dispensing", "category": "Treatment",
                        "pricing": "standard:ip_dispense", "mapping": "Concord proposed standard schedule item "
                        "'ip_dispense' (not a CMS code)", "inferred": reason}, ["D1"], reason)

    order = {v["id"]: i for i, v in enumerate(visits)}
    # items of one category together (the schedule grid and breakdowns group consecutive categories)
    cats = list(dict.fromkeys(p["category"] for p in procs.values()))
    proc_list = sorted(procs.values(), key=lambda p: cats.index(p["category"]))
    # one group per reason: an item placed at several visits from different registry fields keeps each quote
    schedule = []
    for pid, vs in sched.items():
        by_reason: dict[str, list[str]] = {}
        for v, why in vs.items():
            by_reason.setdefault(why, []).append(v)
        schedule.append({"proc": pid, "at": [{"visits": sorted(v, key=order.get), "rule": ASSUMED_RULE, "reason": why}
                                             for why, v in by_reason.items()]})
    used = {v for vs in sched.values() for v in vs}
    visits = [v for v in visits if v["id"] in used or v["id"] in ("SCR", "D1")]
    n_unpriced = sum(1 for p in proc_list if p["pricing"] == "unpriced")
    n_horizon = sum(1 for v in visits if v.get("horizon"))
    trial_title = ident.get("acronym") or ident.get("briefTitle", nct)
    conds = ps.get("conditionsModule", {}).get("conditions", [])
    masking = design.get("designInfo", {}).get("maskingInfo", {}).get("masking", "not given")
    out = _base(nct, trial_title, ps, conds, masking, fetched)
    out.update({
        "label": DRAFT_LABEL,
        "why_chosen": f"Added by NCT ID. The schedule is a draft from the ClinicalTrials.gov record (fetched {fetched}).",
        "per_participant_scope": (f"the {len(visits) - n_horizon} drafted visits (screening, day 1 and the time "
                                  f"points named in the registry's outcome measures)"
                                  + (f" and {n_horizon} end{'s' if n_horizon > 1 else ''} of an outcome's time frame "
                                     f"(items only, no coordinator time)" if n_horizon else "")
                                  + "; dosing visits between them are not in the registry"),
        "sources": sources[:60],
        "assumptions": [
            "The registry does not publish a schedule of assessments. Every visit and item here is inferred from "
            "registry fields (quoted on each) and must be confirmed against the protocol.",
            "Visit days come from outcome-measure time frames (a month is taken as 30.4 days); visit windows are "
            "not in the registry. Screening is placed at Day -28 to -1 (an assumption).",
            "A time frame that names only its end ('up to 30 weeks', 'through Week 52') is the end of an observation "
            "window, not a scheduled visit: its items are drafted once there, with no coordinator time.",
            "Study drug administration is drafted at Day 1 only: the registry rarely gives the dosing interval.",
            "Physician office visits (E/M), routine vitals and blood draws are not named in the registry and are not "
            "drafted; add them in the CSV.",
            "Codes come only from Concord's procedure-to-code table, and only codes present in the loaded CMS rate "
            "card are priced. Anything else is listed and left unpriced.",
            "Coverage: every item is research (assumed until reviewed); the registry cannot say what is routine "
            "care.",
        ] + ([f"{dropped} further time points were not drafted (at most {MAX_VISITS} visits)."] if dropped else []),
        "visits": visits, "procedures": proc_list, "schedule": schedule,
        "import": {"source": "registry_draft", "label": DRAFT_LABEL, "fetched": fetched,
                   "source_url": API.format(nct=nct), "n_visits": len(visits),
                   "n_items": sum(len(vs) for vs in sched.values()), "n_procedures": len(proc_list),
                   "n_unpriced_procedures": n_unpriced,
                   "n_unpriced_items": sum(len(vs) for pid, vs in sched.items() if procs[pid]["pricing"] == "unpriced"),
                   "unmapped": unmapped, "warnings": [], "coverage_note": COVERAGE_NOTE, "updated": _now()},
    })
    return out


COVERAGE_NOTE = ("Every item is research (assumed until reviewed): without the sponsor's protocol, routine care and "
                 "research cannot be told apart from the registry. Mark routine care with the per-item overrides.")


def _base(nct: str, title: str, ps: dict, conds: list[str], masking: str, fetched: str) -> dict:
    arms = ps.get("armsInterventionsModule", {})
    ints = arms.get("interventions", [])
    return {
        "schema": "concord.protocol/v1", "nct_id": nct, "authored": date.today().isoformat(),
        "short_title": _q(title, 140), "area": "Added trial", "condition": ", ".join(conds[:2]) or None,
        "practice_basis": "nothing: where the registry is silent the draft leaves the item out or unpriced",
        "arms": [{"label": f"{a.get('label', 'Arm')} ({(a.get('type') or '').replace('_', ' ').lower()})",
                  "text": _q(a.get("description") or ", ".join(a.get("interventionNames", [])), 200)}
                 for a in arms.get("armGroups", [])][:8],
        "dosing": _q("; ".join(f"{i.get('name')}: {i.get('description') or i.get('type')}" for i in ints[:4]), 300)
                  or "not in the registry",
        "masking": f"Registry masking: {masking}",
        "registry_notes": [f"Added by NCT ID from {API.format(nct=nct)}, fetched {fetched} (cached, not in the "
                           f"database)."],
        "standard_care_reference": [],
        "standard_care_source": ("Not used: coverage of an added trial is not decided from a standard-care reference; "
                                 "every item is research until a reviewer marks it routine."),
    }


# ---------------------------------------------------------------- SoA CSV (route a)

_HEAD = {"visit": ("visit", "visit name", "timepoint", "time point", "visit label"),
         "day": ("day", "study day", "days", "target day"),
         "week": ("week", "weeks", "study week", "wk"),
         "procedure": ("procedure", "assessment", "item", "activity", "procedure name"),
         "code": ("code", "cpt", "hcpcs", "cpt/hcpcs", "cpt code", "billing code"),
         "repeats": ("repeats", "repeat", "occurrences", "times", "count", "n")}
_CODE_RE = re.compile(r"^(?:\d{4}[0-9A-Z]|[A-Z]\d{4})$")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("﻿", "")).strip()


def _num(s: str) -> float | None:
    s = re.sub(r"[$,\s]", "", s or "")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def _parse_day(raw: str, col_is_week: bool) -> tuple[int | None, str | None, int]:
    """(study day, unit word, window +/- days) from messy text: '-28', 'Day 29 ±7', 'W4', 'Week 12', 'Month 6',
    '-28 to -1' (first number), or a bare number in a 'week' column."""
    s = _norm(raw).replace("−", "-").replace("–", "-")
    if not s:
        return None, None, 0
    win = 0
    mw = re.search(r"(?:±|\+/-|\+-)\s*(\d+)", s)
    if mw:
        win = int(mw.group(1))
        s = s[: mw.start()].strip()
    m = re.match(r"^(day|d|week|wk|w|month|m|year|y)[a-z]*\.?\s*(-?\d+(?:\.\d+)?)", s, re.I) or \
        re.match(r"^(-?\d+(?:\.\d+)?)\s*(day|d|week|wk|w|month|m|year|y)[a-z]*\b", s, re.I)
    if m:
        a, b = m.group(1), m.group(2)
        unit_s, num_s = (a, b) if not re.match(r"-?\d", a) else (b, a)
        u = unit_s.lower()[0]
        unit = {"d": "day", "w": "week", "m": "month", "y": "year"}[u]
        n = float(num_s)
    else:
        n0 = _num(s)
        if n0 is None:
            return None, None, win
        n, unit = n0, ("week" if col_is_week else "day")
    if unit == "day":
        return int(round(n)), "day", win
    return int(round(n * _UNIT_DAYS[unit])) + (1 if n >= 0 else 0), unit, win


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:24] or "item"


def parse_soa_csv(text: str) -> dict:
    """Parse a schedule of assessments CSV into visits, procedures and schedule rows, with warnings. Accepts a
    header row (any order, common synonyms) or none (visit, day, procedure, code, repeats); ';' or tab
    separators; blank visit cells carried down from the row above; '$', commas and spaces in numbers; days or
    weeks ('W4', 'Week 4', a 'week' column); '±7' windows."""
    if len(text) > MAX_CSV_CHARS:
        raise terms.TermsError(f"the CSV is longer than {MAX_CSV_CHARS:,} characters")
    text = text.replace("﻿", "")
    sample = text[:4000]
    delim = max([",", ";", "\t"], key=lambda d: sample.count(d))
    # Each row keeps its line in the user's file (blank and '#' comment lines are dropped, not renumbered), so
    # every "row N" citation and warning points at the line the user sees.
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    raw = [(reader.line_num, [_norm(c) for c in r]) for r in reader]
    numbered = [(ln, r) for ln, r in raw if any(r) and not r[0].startswith("#")]
    rows = [r for _, r in numbered]
    if not rows:
        raise terms.TermsError("the CSV is empty")
    if len(rows) > MAX_ROWS:
        raise terms.TermsError(f"the CSV has more than {MAX_ROWS:,} rows")
    cols: dict[str, int] = {}
    start = 0
    for hi, r in enumerate(rows[:10]):
        low = [c.lower().strip(" :*") for c in r]
        found = {}
        for key, names in _HEAD.items():
            for j, c in enumerate(low):
                if c in names or (key in ("visit", "procedure", "code") and any(c.startswith(n) for n in names[:1])):
                    found.setdefault(key, j)
        if "visit" in found and "procedure" in found:
            cols, start = found, hi + 1
            break
    warnings: list[str] = []
    if not cols:
        cols = {"visit": 0, "day": 1, "procedure": 2, "code": 3, "repeats": 4}
        warnings.append("No header row found: columns read as visit, day, procedure, code, repeats.")
    week_col = "day" not in cols and "week" in cols
    tcol = cols.get("day", cols.get("week"))

    def cell(r: list[str], k: str | None) -> str:
        j = cols.get(k) if k else None
        return r[j] if j is not None and j < len(r) else ""

    visits: dict[str, dict] = {}
    items: list[dict] = []
    cur = ""
    for n, r in numbered[start:]:
        v = cell(r, "visit") or cur
        proc = cell(r, "procedure")
        if not v or not proc:
            if any(r):
                warnings.append(f"Row {n}: no {'visit' if not v else 'procedure'}; skipped.")
            continue
        cur = v
        key = v.lower()
        vis = visits.setdefault(key, {"name": v, "day": None, "unit": None, "win": 0, "repeats": None, "row": n})
        raw_t = r[tcol] if tcol is not None and tcol < len(r) else ""
        if raw_t and vis["day"] is None:
            d, unit, win = _parse_day(raw_t, week_col)
            if d is None:
                warnings.append(f"Row {n}: could not read a day or week from '{raw_t}'.")
            else:
                vis.update({"day": d, "unit": unit, "win": win})
        rep_raw = cell(r, "repeats")
        if rep_raw:
            rep = _num(rep_raw)
            if rep is None or rep < 1 or rep != int(rep):
                warnings.append(f"Row {n}: repeats '{rep_raw}' is not a whole number of 1 or more; read as 1.")
            else:
                if vis["repeats"] not in (None, int(rep)):
                    warnings.append(f"Row {n}: visit '{v}' has different repeats on different rows; "
                                    f"the larger ({max(vis['repeats'], int(rep))}) is used.")
                vis["repeats"] = max(vis["repeats"] or 0, int(rep))
        code_raw = cell(r, "code").replace("$", "").strip()
        items.append({"visit": key, "procedure": proc, "code": code_raw, "row": n})
    if not items:
        raise terms.TermsError("no rows with both a visit and a procedure")
    if len(visits) > MAX_VISITS:
        raise terms.TermsError(f"more than {MAX_VISITS} visits")
    return {"visits": visits, "items": items, "warnings": warnings, "week_col": week_col}


NOT_A_VISIT_RE = re.compile(r"not a scheduled visit", re.I)


def protocol_from_csv(nct: str, text: str) -> dict:
    """The protocol file for an added trial from its uploaded schedule of assessments."""
    parsed = parse_soa_csv(text)
    warnings = parsed["warnings"]
    vis = list(parsed["visits"].values())
    prev = None
    for v in vis:  # a visit without a day goes right after the previous one
        if v["day"] is None:
            v["day"] = (prev + 1) if prev is not None else 1
            v["unit"] = "day"
            warnings.append(f"Visit '{v['name']}' has no day; placed at day {v['day']} (after the row above).")
        prev = v["day"]
    vis.sort(key=lambda v: (v["day"], v["row"]))
    scr = next((v for v in vis if re.search(r"screen", v["name"], re.I)), None) or (vis[0] if vis[0]["day"] < 1 else None)
    if scr is None:
        scr = vis[0]
        warnings.append(f"No screening visit (no visit named 'screening' or before day 1): '{scr['name']}' is used as "
                        f"the screening visit for the screen-failure payment.")
    ids: dict[str, str] = {}
    visits = []
    for v in vis:
        base = "SCR" if v is scr else re.sub(r"[^A-Za-z0-9]", "", v["name"].title())[:10] or "V"
        vid = base
        k = 2
        while vid in ids.values():
            vid, k = f"{base}{k}", k + 1
        ids[v["name"].lower()] = vid
        rep = v["repeats"] or 1
        win = f"Day {v['day']}" + (f" ±{v['win']}" if v["win"] else "")
        out = {"id": vid, "label": v["name"], "short": _q(v["name"], 12), "day": v["day"], "window": win,
               "minus": v["win"], "plus": v["win"], "inferred": f"from your CSV, row {v['row']}"}
        if v is scr:
            out.update({"kind": "screening"})
            out.pop("minus")
            out.pop("plus")
        elif rep > 1:
            out.update({"kind": "repeat", "occurrences": rep, "repeat": f"{rep} times per participant (CSV repeats)",
                        "short_window": f"x{rep}"})
        else:
            out["kind"] = "treatment"
        if v is not scr and NOT_A_VISIT_RE.search(v["name"]):  # e.g. an exported draft's end of a time frame
            out.update({"coordinator": False, "window": win + " (not a scheduled visit: no coordinator time)"})
        visits.append(out)
    std_ids = {i[0] for i in terms.STANDARD_ITEMS if i[3] not in ("as_incurred", "rate", "per_site", "per_visit")}
    procs: dict[tuple[str, str], dict] = {}
    sched: dict[str, list[tuple[str, str]]] = {}
    for it in parsed["items"]:
        vid = ids[it["visit"]]
        code = it["code"].upper().removeprefix("CPT").removeprefix("HCPCS").strip(" :#")
        code = re.sub(r"\.0+$", "", code)
        low = it["code"].strip().lower()
        if low.startswith(("standard:", "std:")):
            sid = low.split(":", 1)[1].strip()
            if sid not in std_ids:
                warnings.append(f"Row {it['row']}: unknown standard item '{sid}'; the item is left unpriced.")
                pricing, how = "unpriced", "unknown standard item"
            else:
                pricing, how = f"standard:{sid}", f"Concord proposed standard schedule item '{sid}' (from your CSV)"
            code = ""
        elif low in ("no-charge", "no charge", "none"):
            pricing, how, code = "none", "no site charge (from your CSV)", ""
        elif code and _CODE_RE.match(code):
            how = descriptor_ref(code) + " (code from your CSV)"
            if terms._price_code(code, None) is None:  # noqa: SLF001 - the budget prices with the same function
                pricing = "unpriced"
                how += "; no amount in the loaded CMS fee schedules, left unpriced"
                warnings.append(f"Row {it['row']}: code {code} is not in the loaded CMS fee schedules; left unpriced.")
            else:
                pricing = "cpt"
        else:
            if code:
                warnings.append(f"Row {it['row']}: '{it['code']}' is not a CPT/HCPCS code; mapped from the procedure "
                                f"name instead.")
            code = ""
            hits = match_table(it["procedure"], "outcome") or match_table(it["procedure"], "elig")
            if hits:
                tp = _proc_from_table(hits[0])
                pricing = tp["pricing"]
                code = tp.get("code", "")
                how = f"mapped from the procedure name by Concord's table: {tp['mapping']} - {CONFIRM}"
            else:
                pricing, how = "unpriced", "no code given and no table match: left unpriced"
        key = (it["procedure"].lower(), code or pricing)
        if key not in procs:
            pid = _slug(it["procedure"])
            while any(p["id"] == pid for p in procs.values()):
                pid += "_2"
            p = {"id": pid, "label": it["procedure"], "category": "Uploaded schedule", "pricing": pricing,
                 "mapping": how, "inferred": f"from your CSV, row {it['row']}"}
            if code and pricing in ("cpt", "unpriced"):  # an unpriced CSV code stays visible on the line
                p["code"] = code
            if pricing == "unpriced":
                p["note"] = (f"Code {code} is not in the loaded CMS fee schedules: research item left unpriced, to be "
                             f"negotiated (never counted as zero)" if code else terms.UNPRICED_NOTE)
            if pricing == "none":
                p["note"] = "No site charge (from your CSV)"
            procs[key] = p
        pid = procs[key]["id"]
        if any(v == vid for v, _ in sched.get(pid, [])):
            # the same procedure twice at one visit: a second procedure line
            key2 = (key[0] + " #2", key[1])
            if key2 not in procs:
                procs[key2] = {**procs[key], "id": procs[key]["id"] + "_x2", "label": it["procedure"] + " (second)"}
            pid = procs[key2]["id"]
        sched.setdefault(pid, []).append((vid, f"from your CSV, row {it['row']}"))
    order = {v["id"]: i for i, v in enumerate(visits)}
    schedule = [{"proc": pid, "at": [{"visits": sorted([v for v, _ in vs], key=order.get), "rule": ASSUMED_RULE,
                                      "reason": "Uploaded schedule, " + ", ".join(r for _, r in vs[:3])
                                                + (" …" if len(vs) > 3 else "") + ". Coverage: research (assumed "
                                                "until reviewed)."}]}
                for pid, vs in sched.items()]
    used = {v for vs in sched.values() for v, _ in vs}
    visits = [v for v in visits if v["id"] in used or v["kind"] == "screening"]
    st = study(nct)
    snap = terms_registry.snapshot(nct) or {}
    if st:
        ps = st["protocolSection"]
        ident = ps["identificationModule"]
        title = ident.get("acronym") or ident.get("briefTitle", nct)
        conds = ps.get("conditionsModule", {}).get("conditions", [])
        masking = ps.get("designModule", {}).get("designInfo", {}).get("maskingInfo", {}).get("masking", "not given")
        fetched = st.get("_concord", {}).get("fetched", "")
        base = _base(nct, title, ps, conds, masking, fetched)
    else:
        t = snap.get("trial", {})
        base = {"schema": "concord.protocol/v1", "nct_id": nct, "authored": date.today().isoformat(),
                "short_title": t.get("title", nct), "area": "Added trial", "condition": None,
                "practice_basis": "your uploaded schedule", "arms": [], "dosing": "see your schedule",
                "masking": "not given", "registry_notes": [], "standard_care_reference": [],
                "standard_care_source": "Not used for an uploaded schedule."}
    n_fixed = sum((v.get("occurrences") or 1) for v in visits)
    n_items = sum(len(vs) for vs in sched.values())
    plist = list(procs.values())
    by_id = {p["id"]: p for p in plist}
    base.update({
        "label": CSV_LABEL,
        "why_chosen": "Added by NCT ID; schedule of assessments uploaded as CSV.",
        "per_participant_scope": f"the {len(visits)} visits of the uploaded schedule ({n_fixed} visit occurrences "
                                 f"counting repeats)",
        "sources": [{"field": "Uploaded CSV", "quote": f"{len(parsed['items'])} rows, {len(visits)} visits",
                     "used_for": "Visits, procedures and codes, as supplied"}],
        "assumptions": ["Visits, procedures and codes are as uploaded; Concord did not check them against the "
                        "sponsor's protocol.",
                        "Items without a code are mapped from their names only through Concord's procedure-to-code "
                        "table (marked on each); anything else is left unpriced.",
                        "Each visit carries the proposed per-visit coordinator time, except a visit whose name says "
                        "'not a scheduled visit'.",
                        "Coverage: every item is research (assumed until reviewed)."],
        "visits": visits, "procedures": plist, "schedule": schedule,
        "import": {"source": "csv", "label": CSV_LABEL, "fetched": (st or {}).get("_concord", {}).get("fetched"),
                   "source_url": API.format(nct=nct),
                   "n_visits": len(visits), "n_items": n_items, "n_procedures": len(plist),
                   "n_unpriced_procedures": sum(1 for p in plist if p["pricing"] == "unpriced"),
                   "n_unpriced_items": sum(len(vs) for pid, vs in sched.items() if by_id[pid]["pricing"] == "unpriced"),
                   "unmapped": [{"field": f"CSV: {p['label']}", "quote": p["label"], "why": p["mapping"]}
                                for p in plist if p["pricing"] == "unpriced"],
                   "warnings": warnings, "coverage_note": COVERAGE_NOTE, "updated": _now()},
    })
    return base


def _require_added(nct: str) -> str:
    nct = _check_nct(nct)
    if (terms.PROTOCOL_DIR / f"{nct}.json").exists():
        raise terms.TermsError(f"{nct} has an authored schedule; a CSV can be uploaded for an added trial only")
    if study(nct) is None and terms_registry.snapshot(nct) is None:
        raise terms.NotFound(f"{nct} has not been added; add it by NCT ID first")
    return nct


def upload_soa(nct: str, text: str) -> dict:
    nct = _require_added(nct)
    p = protocol_from_csv(nct, text)
    terms.load_protocol.cache_clear()
    _validate(nct, p)
    _write(_path(nct, "protocol"), p)
    _clear()
    return {"nct_id": nct, "import": p["import"]}


def _validate(nct: str, p: dict) -> None:
    """Make sure terms can expand the schedule before it replaces the cached one."""
    path = _path(nct, "protocol")
    old = path.read_text(encoding="utf-8") if path.exists() else None
    try:
        _write(path, p)
        _clear()
        terms.load_protocol(nct)
    except (KeyError, ValueError) as e:
        if old is not None:
            path.write_text(old, encoding="utf-8", newline="\n")
        _clear()
        raise terms.TermsError(f"the schedule could not be read: {e}") from e


def reset_draft(nct: str) -> dict:
    nct = _require_added(nct)
    st = study(nct)
    if st is None:
        raise terms.NotFound(f"no cached registry record for {nct}")
    p = draft_from_registry(st)
    _write(_path(nct, "protocol"), p)
    _clear()
    return {"nct_id": nct, "import": p["import"]}


# ---------------------------------------------------------------- export and template

def export_csv(nct: str) -> str:
    """Any trial's schedule in the template format (round-trips through parse_soa_csv)."""
    p = terms.load_protocol(nct)
    procs = {x["id"]: x for x in p["procedures"]}
    vis = {v["id"]: v for v in p["visits"]}
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(TEMPLATE_HEADER)
    for v in p["visits"]:
        rep = vis[v["id"]].get("occurrences") if v["kind"] == "repeat" else None
        day = v.get("day", "")  # follow-up and open-ended visits may have none; the importer places them in order
        nodes = [n for n in p["nodes"] if n["visit"] == v["id"]]
        if not nodes:  # keep the visit (and its coordinator time) through a re-import
            w.writerow([v["label"], day, EMPTY_VISIT, "no-charge", rep or ""])
        for n in nodes:
            x = procs[n["procedure"]]
            pr = x["pricing"]
            code = (x.get("code") or "") if pr in ("cpt", "unpriced") else pr if pr.startswith("standard:") else (
                "no-charge" if pr == "none" else "")
            w.writerow([v["label"], day, x["label"], code, rep or ""])
    return buf.getvalue()


EMPTY_VISIT = "Visit (no items listed)"


def template_csv() -> str:
    return ("visit,day,procedure,code,repeats\n"
            "# One row per procedure at a visit. day: study day (Day 1 = first dose) or write W4 / Week 4 / Month 6.\n"
            "# code: CPT/HCPCS (optional), standard:<item> for a proposed standard fee, or no-charge.\n"
            "# repeats: how many times that visit happens per participant (optional, default 1).\n"
            "Screening,-28,\"Office visit, new patient\",99204,\n"
            "Screening,-28,Blood count with differential,85025,\n"
            "Screening,-28,ECG,93000,\n"
            "Day 1,1,Study drug injection,96372,\n"
            "Day 1,1,Study drug preparation and dispensing,standard:ip_dispense,\n"
            "Dosing visit,W4,Study drug injection,96372,12\n"
            "Week 52,W52,Questionnaire,standard:pro,\n"
            "Week 52,W52,Protocol-specific test without a code,,\n")
