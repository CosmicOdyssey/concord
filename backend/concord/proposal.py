"""Site proposal check and counter-proposal export (built on concord.terms).

A site sends a price list for a protocol: one row per item, "item or code, amount" (the site's price per
occurrence). Each row is matched to the protocol's budget lines at the selected site, by CPT/HCPCS/CLFS code
first, then by item label (case-insensitive; Concord's procedure and standard-schedule labels and ids, plus a
short list of common names for the standard items), and flagged:

- Coded procedure and lab lines: the justified range is the Medicare amount at the site's locality (CMS 2026
  PFS, locality-adjusted; CMS 2026 CLFS, national) times a band. The band is an ASSUMPTION the user sets
  (default 100% to 150% of Medicare), not market data. Flags: above range, below range, in range.
- Non-procedure lines (coordinator time, per-visit fees, pharmacy, start-up and other one-time fees,
  overhead, anything on the proposed standard schedule): "needs itemized justification", with Concord's
  proposed standard amount shown as a reference labelled "proposed standard (not market data)".
- Anything else: "not in this protocol's schedule".

Medicare amounts are benchmarks that inform fair-value reasoning in sponsor-site negotiation. Nothing here
predicts time, speed or enrollment. Decision support. Not a fair-market-value legal opinion.
"""

from __future__ import annotations

import csv
import html
import io
import math
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from concord import terms

SAMPLE_DIR = terms.PROTOCOL_DIR / "samples"
SAMPLE_SUFFIX = "_SYNTHETIC_site-proposal.csv"
SAMPLE_LABEL = ("SYNTHETIC sample: an invented site proposal to demonstrate the check. Not a real site's prices "
                "and not market data.")
_SYNTHETIC_MARK = re.compile(r"^[ \t﻿]*#.*\bSYNTHETIC\b", re.M)

BAND_DEFAULT = (1.0, 1.5)
BAND_MIN, BAND_MAX = 0.1, 5.0
BAND_LABEL = "assumption"
REF_LABEL = "proposed standard (not market data)"
MAX_CSV_CHARS = 200_000
MAX_ROWS = 500
MAX_AMOUNT = 10_000_000.0

FLAGS = {
    "above": "above range",
    "below": "below range",
    "in_range": "in range",
    "justify": "needs itemized justification",
    "unmatched": "not in this protocol's schedule",
}
FLAG_ORDER = ("above", "below", "justify", "unmatched", "in_range")

# Common names a site uses for the standard (non-procedure) items. Matching aid only: every matched row
# says how it matched ("code", "label" or "common name").
ALIASES: dict[str, tuple[str, ...]] = {
    "startup": ("start up", "startup", "start up fee", "startup fee", "study start up", "study start up fee",
                "study startup", "study startup fee", "site initiation", "site initiation visit",
                "regulatory start up"),
    "irb": ("irb", "irb fee", "irb review", "irb review fee", "central irb", "irb submission"),
    "pharmacy_setup": ("pharmacy setup", "pharmacy set up", "pharmacy fee", "pharmacy setup fee",
                       "pharmacy start up", "investigational pharmacy fee", "ids setup"),
    "closeout": ("close out", "closeout", "close out fee", "closeout fee", "study close out"),
    "archiving": ("archiving", "archive", "archiving fee", "record storage", "records archiving"),
    "coordinator": ("coordinator", "coordinator fee", "coordinator time", "per visit fee", "visit fee",
                    "data entry", "study coordinator"),
    "ip_dispense": ("drug dispensing", "dispensing fee", "study drug dispensing", "pharmacy dispensing"),
    "sample_kit": ("sample processing", "sample shipping", "lab kit processing", "pk sample processing"),
    "tissue": ("tissue retrieval", "archival tissue"),
    "image_upload": ("image upload", "scan upload", "central imaging upload"),
    "pro": ("questionnaire", "questionnaires", "pro administration"),
    "survival_contact": ("survival contact", "survival follow up call", "long term follow up contact"),
    "overhead": ("overhead", "indirect", "indirect costs", "institutional overhead", "f a",
                 "facilities and administrative"),
    "screen_fail": ("screen failure", "screen fail", "screen failure fee", "screening failure"),
}


class ProposalError(terms.TermsError):
    """Bad proposal input (empty, too large, bad band)."""


# ---------------------------------------------------------------- parsing

# A comma in an amount only groups thousands ('1,250.00'); '6,50' or '1,2345' is not a number here. In a
# semicolon-separated file a decimal comma ('6,50', '1.234,50') is read instead (see parse_amount).
_AMOUNT = re.compile(r"^(?:usd)?\s*\$?\s*(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)\s*(?P<pct>%)?\s*(?:usd)?$",
                     re.I)
_AMOUNT_DECIMAL_COMMA = re.compile(r"^(?:usd)?\s*\$?\s*(?P<num>\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2})\s*(?P<pct>%)?\s*"
                                   r"(?:usd)?$", re.I)
# A header row: its amount cell names a column ('amount', 'Proposed price', 'USD') or its item cell does
# ('item_or_code', 'Code', 'Description'). Any other unreadable first row is listed as an error, never dropped.
_HDR_WORD = (r"(?:amounts?|prices?|costs?|fees?|asks?|proposed|proposal|usd|total|rate|value|charge|site|s|per|each|"
             r"unit|occurrence|visit|in|dollars)")
_HEADER_AMT = re.compile(rf"{_HDR_WORD}(?: {_HDR_WORD})*")  # fullmatch on _norm() text: words split by one space
_HEADER_ITEM = re.compile(r"^(?:items?|codes?|item or code|code or item|item code|code item|description|service|"
                          r"procedure|line item|name|cpt|hcpcs|cpt code|cpt hcpcs|cpt hcpcs code|budget item)$")
_GROUPED = re.compile(r"^\$?\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*%?$")
_CODE_ONLY = re.compile(r"^(?:\d{5}|[A-Z]\d{4}|\d{4}[A-Z])$")
_CODE_TOKEN = re.compile(r"(?<![A-Z0-9])(\d{5}|[A-Z]\d{4}|\d{4}[A-Z])(?![A-Z0-9])")


def parse_amount(s: str, decimal_comma: bool = False) -> tuple[float, bool] | None:
    """'$1,234.50' -> (1234.5, False); '30%' -> (30.0, True); None if it is not a plain non-negative amount.
    A comma only groups thousands ('6,50' -> None). With decimal_comma (a semicolon-separated file) '6,50' -> 6.5
    and '1.234,50' -> 1234.5."""
    s = (s or "").strip()
    m = _AMOUNT_DECIMAL_COMMA.match(s) if decimal_comma else None
    if m:
        num = m.group("num").replace(".", "").replace(",", ".")
    else:
        m = _AMOUNT.match(s)
        if not m:
            return None
        num = m.group("num").replace(",", "")
    try:
        v = float(num)
    except ValueError:
        return None
    if not math.isfinite(v):
        return None
    return v, bool(m.group("pct"))


def _split(fields: list[str]) -> tuple[str, str, bool] | None:
    """Item and amount from one CSV record. The amount is the last field; an unquoted amount with thousands
    separators ('$1,234.50' written without quotes) arrives as several fields and is put back together."""
    f = [x.strip() for x in fields]
    while f and f[-1] == "":
        f.pop()
    if len(f) < 2:
        return None
    for k in range(1, len(f) - 1):
        joined = ",".join(f[k:])
        if _GROUPED.match(joined) and all(re.fullmatch(r"\d{3}(?:\.\d+)?\s*%?", x) for x in f[k + 1:]):
            return ", ".join(x for x in f[:k] if x), joined, True
    return ", ".join(x for x in f[:-1] if x), f[-1], False


def _delimiter(body: list[str]) -> str:
    """Tab if the first record has one; semicolon when most of the first records split on ';' into two or more
    fields (so '85025;6,50' is not read as comma-separated); otherwise comma."""
    first = body[0] if body else ""
    if "\t" in first:
        return "\t"
    head = body[:20]
    semi = sum(1 for ln in head if ";" in ln and len(next(csv.reader([ln], delimiter=";"), [])) >= 2)
    return ";" if head and semi * 2 > len(head) else ","


def _is_header(item: str, amt_s: str) -> bool:
    return bool(_HEADER_AMT.fullmatch(_norm(amt_s)) or amt_s.strip() in ("$", "($)") or _HEADER_ITEM.match(_norm(item)))


def parse_csv(text: str) -> dict:
    """Rows of a site proposal. Tolerates a header row, '#' comment lines, blank lines, a UTF-8 BOM, '$',
    thousands separators (quoted or not), '%', and semicolon or tab separators. Returns
    {"rows": [{row, item, amount, percent, raw, rejoined}], "errors": [{row, text, error}], "header": bool}."""
    if text is None or not str(text).strip():
        raise ProposalError("the proposal is empty: paste CSV text or upload a CSV file")
    text = str(text)
    if len(text) > MAX_CSV_CHARS:
        raise ProposalError(f"the proposal is too large (over {MAX_CSV_CHARS:,} characters)")
    text = text.lstrip("﻿")
    lines = text.splitlines()
    body = [ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
    delim = _delimiter(body)
    decimal_comma = delim == ";"
    rows, errors, header = [], [], False
    seen_data = False
    for lineno, ln in enumerate(lines, start=1):
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        rec = next(csv.reader([ln], delimiter=delim, skipinitialspace=True), [])
        sp = _split(rec)
        if sp is None:
            errors.append({"row": lineno, "text": ln.strip()[:200], "error": "expected two columns: item or code, amount"})
            continue
        item, amt_s, rejoined = sp
        parsed = parse_amount(amt_s, decimal_comma)
        if parsed is None:
            if not seen_data and not header and _is_header(item, amt_s):
                header = True  # a header row such as "item_or_code,amount"
                continue
            errors.append({"row": lineno, "text": ln.strip()[:200],
                           "error": f"amount '{amt_s[:40]}' is not a number (use e.g. 1250 or $1,250.00)"})
            continue
        if not item:
            errors.append({"row": lineno, "text": ln.strip()[:200], "error": "no item or code"})
            continue
        v, pct = parsed
        if v > MAX_AMOUNT:
            errors.append({"row": lineno, "text": ln.strip()[:200], "error": "amount over $10,000,000"})
            continue
        seen_data = True
        rows.append({"row": lineno, "item": item[:200], "amount": v, "percent": pct, "raw": amt_s[:40],
                     "rejoined": rejoined, "decimal_comma": decimal_comma and "," in amt_s})
        if len(rows) > MAX_ROWS:
            raise ProposalError(f"too many rows (over {MAX_ROWS})")
    return {"rows": rows, "errors": errors, "header": header}


# ---------------------------------------------------------------- matching

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower().replace("&", " and ")).strip()


def _label_index(proto: dict, std: dict[str, dict]) -> dict[str, tuple[str, str, str]]:
    """normalized text -> (kind 'proc' | 'std', id, method)."""
    idx: dict[str, tuple[str, str, str]] = {}
    for iid, names in ALIASES.items():
        if iid in std:
            for n in names:
                idx.setdefault(_norm(n), ("std", iid, "common name"))
    for it in std.values():  # standard labels and ids beat common names
        idx[_norm(it["label"])] = ("std", it["id"], "label")
        idx[_norm(it["id"])] = ("std", it["id"], "label")
    for x in proto["procedures"]:  # protocol labels and ids beat both
        idx[_norm(x["label"])] = ("proc", x["id"], "label")
        idx[_norm(x["id"])] = ("proc", x["id"], "label")
    return idx


def _codes_in(item: str) -> list[str]:
    s = item.strip().upper()
    if _CODE_ONLY.match(s):
        return [s]
    out = []
    for c in _CODE_TOKEN.findall(s):
        if c not in out:
            out.append(c)
    return out


def _year(src: str | None) -> int | None:
    m = re.search(r"(20\d{2})", src or "")
    return int(m.group(1)) if m else None


def _file(src: str | None) -> str | None:
    m = re.search(r"([\w.\-]+\.zip)", src or "")
    return m.group(1) if m else None


def _cents(x: float) -> int:
    return int(Decimal(str(x)).scaleb(2).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _times(amount: float, factor: float) -> float:
    """amount x factor rounded half-up to the cent in decimal arithmetic (107.63 x 1.5 = 161.445 -> 161.45)."""
    return float((Decimal(str(amount)) * Decimal(str(factor))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _code_lines(b: dict) -> dict[str, dict]:
    """One entry per code in the budget: Medicare amount at the site, provenance, which procedures carry it
    and how many scheduled occurrences the sponsor pays (research) or insurance is billed (routine)."""
    out: dict[str, dict] = {}
    for v in b["visits"]:
        for ln in v["lines"]:
            code = ln.get("code")
            if not code:
                continue
            e = out.setdefault(code, {"code": code, "procedures": [], "labels": [], "medicare": ln["medicare_amount"],
                                      "schedule": ln["schedule"], "source": ln["source"], "formula": ln["formula"],
                                      "placeholder": ln["placeholder"], "verified": ln["verified"],
                                      "sponsor_visits": 0, "insurance_visits": 0, "note": ln.get("note")})
            if ln["procedure_id"] not in e["procedures"]:
                e["procedures"].append(ln["procedure_id"])
                e["labels"].append(ln["label"])
            e["sponsor_visits" if ln["payer"] == "Sponsor" else "insurance_visits"] += 1
            # the term-sheet line whose step-by-step price the UI shows (line_detail.py): the first sponsor-paid
            # occurrence of the code, else its first occurrence
            if "node_id" not in e or (ln["payer"] == "Sponsor" and not e["node_sponsor"]):
                e["node_id"], e["node_sponsor"] = ln["node_id"], ln["payer"] == "Sponsor"
    return out


def _cms_source(e: dict, loc: dict | None) -> dict:
    src = e["source"] or ""
    if e["schedule"] == "PFS":
        where = f"{loc['name']} ({loc['state']} locality {loc['code']})" if loc else "national (no locality resolved)"
        # the UI shows how the amount is built as a step-by-step table (node_id -> line_detail.py); the one-line
        # formula stays in the "formula" key and in the printable export
        text = f"CMS PFS {_year(src) or ''} ({_file(src) or 'RVU file'}), {where}, code {e['code']}".replace("  ", " ")
        return {"schedule": "PFS", "file": _file(src), "year": _year(src), "locality": where, "code": e["code"],
                "formula": e["formula"], "title": src, "text": text}
    if e["schedule"] == "CLFS":
        where = "national (CLFS is not geographically adjusted)"
        if e["placeholder"]:
            text = (f"Placeholder (assumption, not a CMS file): approximate national amount for code {e['code']}; "
                    f"{e['source'] or ''}")
        else:
            text = f"CMS CLFS {_year(src) or ''} ({_file(src) or 'CLFS file'}), {where}, code {e['code']}".replace("  ", " ")
        return {"schedule": "CLFS", "file": _file(src), "year": _year(src), "locality": where, "code": e["code"],
                "formula": None, "title": src, "text": text}
    return {"schedule": e["schedule"], "file": None, "year": None, "locality": None, "code": e["code"],
            "formula": None, "title": src, "text": src or "no CMS source"}


def _band(band_low: float, band_high: float) -> tuple[float, float]:
    for name, v in (("band_low", band_low), ("band_high", band_high)):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ProposalError(f"{name} must be a number")
    lo, hi = float(band_low), float(band_high)
    if not (BAND_MIN <= lo <= hi <= BAND_MAX):
        raise ProposalError("the band must satisfy 10% <= low <= high <= 500% of Medicare")
    return lo, hi


def band_text(lo: float, hi: float) -> str:
    return (f"Assumption: the justified range for a coded procedure or lab line is the Medicare amount at the "
            f"site's locality x {lo * 100:.0f}% to {hi * 100:.0f}% (editable; default "
            f"{BAND_DEFAULT[0] * 100:.0f}% to {BAND_DEFAULT[1] * 100:.0f}%). The band is a negotiating assumption, "
            f"not market data.")


def check(nct: str, site_id: str, csv_text: str, band_low: float = BAND_DEFAULT[0],
          band_high: float = BAND_DEFAULT[1], multiplier: float = 1.0, overrides: dict[str, str] | None = None,
          standard: dict[str, float] | None = None) -> dict:
    """Check a site's proposal against the protocol's budget lines at that site."""
    lo, hi = _band(band_low, band_high)
    parsed = parse_csv(csv_text)
    b = terms.budget(nct, site_id, multiplier, overrides, standard)
    p = terms.load_protocol(nct)
    loc = b["locality"]
    std = {it["id"]: it for it in b["standard_schedule"]}
    procs = {x["id"]: x for x in p["procedures"]}
    codes = _code_lines(b)
    idx = _label_index(p, std)
    first_row: dict[str, int] = {}
    out_rows = []
    errors = list(parsed["errors"])
    for r in parsed["rows"]:
        row = {"row": r["row"], "item": r["item"], "ask": r["amount"], "ask_raw": r["raw"], "percent": r["percent"],
               "ask_rate": False,
               "flag": "unmatched", "flag_label": FLAGS["unmatched"], "kind": None, "match": None, "method": None,
               "matched_label": None, "code": None, "medicare": None, "range_low": None, "range_high": None,
               "outside_by": 0.0, "reference": None, "reference_unit": None, "reference_label": None,
               "source": None, "node_id": None, "notes": []}
        if r["rejoined"]:
            row["notes"].append("amount read from unquoted thousands separators; check it")
        if r.get("decimal_comma"):
            row["notes"].append(f"amount '{r['raw']}' read with a decimal comma (semicolon-separated file); check it")
        found = _codes_in(r["item"])
        hit_codes = [c for c in found if c in codes]
        target: tuple[str, str, str] | None = None
        if len(hit_codes) == 1:
            target = ("code", hit_codes[0], "code")
        else:
            lab = idx.get(_norm(r["item"]))
            if lab is None and found:
                # "71260 CT chest with contrast": try the text without its code tokens
                rest = _CODE_TOKEN.sub(" ", r["item"].upper())
                lab = idx.get(_norm(rest))
            if lab:
                kind, iid, method = lab
                if kind == "proc" and procs[iid].get("code") and procs[iid]["code"] in codes:
                    target = ("code", procs[iid]["code"], method)
                    row["matched_label"] = procs[iid]["label"]
                elif kind == "proc" and procs[iid]["pricing"].startswith("standard:"):
                    target = ("std", procs[iid]["pricing"].split(":", 1)[1], method)
                    row["matched_label"] = procs[iid]["label"]
                elif kind == "std":
                    target = ("std", iid, method)
            if target is None:
                if len(hit_codes) > 1:
                    row["notes"].append(f"more than one protocol code in the item ({', '.join(hit_codes)}); "
                                        f"put one item per row")
                elif found:
                    row["notes"].append(f"code {', '.join(found)} is not in this protocol's schedule")
        if target and target[0] == "code":
            e = codes[target[1]]
            key = f"code:{e['code']}"
            row.update({"kind": "lab" if e["schedule"] == "CLFS" else "procedure", "match": e["code"],
                        "method": target[2], "code": e["code"],
                        "matched_label": row["matched_label"] or " / ".join(e["labels"]),
                        "source": _cms_source(e, loc), "node_id": e["node_id"]})
            if r["percent"]:
                errors.append({"row": r["row"], "text": f"{r['item']}, {r['raw']}"[:200],
                               "error": "a percentage is only meaningful for the overhead rate; give a dollar amount"})
                continue
            if e["medicare"] is None:
                row.update({"flag": "justify", "flag_label": FLAGS["justify"]})
                row["notes"].append("no Medicare amount loaded for this code; ask for an itemized justification")
            else:
                med = float(e["medicare"])
                low, high = _times(med, lo), _times(med, hi)
                a = _cents(r["amount"])
                flag = "above" if a > _cents(high) else "below" if a < _cents(low) else "in_range"
                row.update({"medicare": med, "range_low": low, "range_high": high, "flag": flag,
                            "flag_label": FLAGS[flag],
                            "outside_by": ((a - _cents(high)) if flag == "above" else
                                           (_cents(low) - a) if flag == "below" else 0) / 100,
                            "placeholder": bool(e["placeholder"])})
                if e["placeholder"]:
                    row["notes"].append("lab amount is a placeholder (assumption), not from a CMS file")
            n_sp, n_ins = e["sponsor_visits"], e["insurance_visits"]
            row["coverage"] = {"sponsor_visits": n_sp, "insurance_visits": n_ins}
            if n_sp == 0:
                row["notes"].append(f"routine care at every scheduled occurrence in this protocol: billable to "
                                    f"insurance under {terms.NCD}, so the sponsor pays none of it unless a reviewer "
                                    f"overrides the label")
        elif target and target[0] == "std":
            it = std[target[1]]
            key = f"std:{it['id']}"
            ref = b["totals"]["screen_failure"] if it["unit"] == "as_incurred" else it["amount"]
            ask = r["amount"]
            if it["unit"] == "rate":
                if not r["percent"] and ("$" in r["raw"] or ask > 100):
                    # '$30000' or '30000' is a flat overhead fee in dollars, not a rate
                    row["notes"].append("overhead given as a dollar amount; Concord's standard is a rate of research "
                                        "items and coordinator time")
                else:
                    row["ask_rate"] = True
                    if not r["percent"] and ask >= 1:
                        row["notes"].append(f"read as {ask:g}% (no % sign given)")
                    ask = ask / 100.0 if (r["percent"] or ask >= 1) else ask
                    row["ask"] = round(ask, 4)
            elif r["percent"]:
                row["notes"].append("a percentage is only meaningful for the overhead rate; read as dollars")
            row.update({"kind": "non_procedure", "match": it["id"], "method": target[2],
                        "matched_label": row["matched_label"] or it["label"], "flag": "justify",
                        "flag_label": FLAGS["justify"], "reference": ref, "reference_unit": it["unit_label"],
                        "reference_rate": it["unit"] == "rate", "reference_label": REF_LABEL,
                        "reference_edited": bool(it["edited"]),
                        "source": {"schedule": "Standard", "file": None, "year": None, "locality": None, "code": None,
                                   "formula": None, "title": terms.STANDARD_SOURCE,
                                   "text": (f"{terms.STANDARD_SOURCE}; {it['label']}"
                                            + (" (screening visit payment at this site)" if it["unit"] == "as_incurred"
                                               else "") + (" (edited)" if it["edited"] else ""))}})
        else:
            key = None
            if row["flag_label"] == FLAGS["unmatched"]:
                row["notes"].insert(0, "ask the site which protocol item this covers")
        if key:
            if key in first_row:
                row["notes"].append(f"same item as row {first_row[key]}")
            else:
                first_row[key] = r["row"]
        out_rows.append(row)

    counts = {k: sum(1 for x in out_rows if x["flag"] == k) for k in FLAGS}
    coded = [x for x in out_rows if x["range_low"] is not None]
    total_ask = round(sum(x["ask"] for x in coded), 2)
    tot_lo = round(sum(x["range_low"] for x in coded), 2)
    tot_hi = round(sum(x["range_high"] for x in coded), 2)
    outside = sorted((x for x in coded if x["flag"] in ("above", "below")), key=lambda x: (-x["outside_by"], x["row"]))
    pfs = terms.medicare._cms().get("pfs", {})  # noqa: SLF001 - same package
    clfs = terms.medicare._cms().get("clfs", {})  # noqa: SLF001
    return {
        "nct_id": nct, "short_title": p["short_title"], "label": p["label"], "disclaimer": terms.DISCLAIMER,
        # a '# ... SYNTHETIC ...' comment line (the shipped sample has one) marks invented prices everywhere downstream
        "synthetic": bool(_SYNTHETIC_MARK.search(csv_text or "")), "synthetic_label": SAMPLE_LABEL,
        "site": b["site"], "locality": loc, "band": {"low": lo, "high": hi, "label": BAND_LABEL,
                                                       "text": band_text(lo, hi)},
        "multiplier": b["multiplier"], "pfs_source": pfs.get("source"), "clfs_source": clfs.get("source"),
        "conversion_factor": pfs.get("conversion_factor"), "standard_source": terms.STANDARD_SOURCE,
        "reference_label": REF_LABEL, "rows": out_rows, "errors": errors, "header": parsed["header"],
        "summary": {
            "n_rows": len(out_rows), "n_errors": len(errors), "counts": counts,
            "coded": {"n": len(coded), "total_ask": total_ask, "range_low": tot_lo, "range_high": tot_hi,
                      "above_by": round(sum(x["outside_by"] for x in coded if x["flag"] == "above"), 2),
                      "below_by": round(sum(x["outside_by"] for x in coded if x["flag"] == "below"), 2),
                      "position": ("above" if _cents(total_ask) > _cents(tot_hi) else
                                   "below" if _cents(total_ask) < _cents(tot_lo) else "in_range") if coded else None},
            "top_outside": [{"row": x["row"], "item": x["item"], "code": x["code"], "ask": x["ask"],
                             "range_low": x["range_low"], "range_high": x["range_high"], "flag": x["flag"],
                             "outside_by": x["outside_by"]} for x in outside[:3]],
        },
        "flags": FLAGS, "generated": date.today().isoformat(),
    }


# ---------------------------------------------------------------- synthetic sample

def sample_path(nct: str) -> Path:
    return SAMPLE_DIR / f"{nct}{SAMPLE_SUFFIX}"


def sample(nct: str) -> dict:
    terms.load_protocol(nct)
    path = sample_path(nct)
    if not path.exists():
        raise terms.NotFound(f"no synthetic sample proposal for {nct}")
    return {"nct_id": nct, "filename": path.name, "synthetic": True, "label": SAMPLE_LABEL,
            "csv": path.read_text(encoding="utf-8")}


# ---------------------------------------------------------------- counter-proposal export

_EXTRA_CSS = """
.flag{display:inline-block;font-size:11px;font-weight:700;padding:0 6px;border-radius:999px;white-space:nowrap}
.f-above{background:#fde9e7;color:#8f2316}.f-below{background:#e7eefc;color:#1d3f8a}.f-in_range{background:#e3f0e8;
color:#22573c}.f-justify{background:#fff4e0;color:#774a08}.f-unmatched{background:#eceff3;color:#3c4b57}
.kv{display:flex;flex-wrap:wrap;gap:6px 18px;margin:6px 0 4px}.kv b{font-variant-numeric:tabular-nums}
"""


def _m(x: float | None) -> str:
    return terms._money(x)  # noqa: SLF001 - same package


def _ask_text(r: dict) -> str:
    if r.get("ask_rate"):
        return f"{r['ask'] * 100:.1f}%".replace(".0%", "%")
    return _m(r["ask"])


def _range_text(r: dict) -> str:
    if r["range_low"] is not None:
        return f"{_m(r['range_low'])} to {_m(r['range_high'])}"
    if r["reference"] is not None:
        ref = (f"{r['reference'] * 100:.0f}%" if r.get("reference_rate") else _m(r["reference"]))
        return f"{ref} {r['reference_unit']}, {REF_LABEL}"
    return "-"


def _insurance_only(r: dict) -> bool:
    """Routine care at every scheduled occurrence: billed to insurance (NCD 310.1), never a sponsor cost."""
    return (r.get("coverage") or {}).get("sponsor_visits") == 0


def response_text(r: dict) -> str:
    """The counter-proposal's mechanical response to one line."""
    f = r["flag"]
    if f in ("above", "below", "in_range") and _insurance_only(r):
        return f"Routine care billed to insurance under {terms.NCD}, not to the sponsor; range shown for reference"
    if f == "above":
        return f"Above the justified range by {_m(r['outside_by'])}: counter at or below {_m(r['range_high'])}, or ask for an itemized justification"
    if f == "below":
        return f"Below the justified range by {_m(r['outside_by'])}: no counter needed; confirm the amount covers the site's cost"
    if f == "in_range":
        return "Within the justified range"
    if f == "justify":
        return "Ask for an itemized justification (time, staff, cost basis)"
    return "Not in this protocol's schedule: ask the site which protocol item this covers"


def counter_proposal_html(res: dict, detail: str = "simple") -> str:
    """Printable counter-proposal (browser print to PDF). Simple: summary and flagged lines; detailed: every
    line. All user-provided text (items, amounts as typed) is escaped."""
    e = html.escape
    s, loc, sm = res["site"], res["locality"], res["summary"]
    c, cd = sm["counts"], sm["coded"]
    detailed = detail == "detailed"
    synthetic = bool(res.get("synthetic"))
    rows = res["rows"] if detailed else [r for r in res["rows"] if r["flag"] != "in_range"]
    by_row = {r["row"]: r for r in res["rows"]}
    loc_text = (f"{loc['name']} ({loc['state']} locality {loc['code']}); {loc['method']}" if loc
                else "national amounts (no Medicare locality resolved)")
    h: list[str] = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' "
                    f"content='width=device-width,initial-scale=1'><link rel='icon' href='data:,'>"
                    f"<title>{'SYNTHETIC: ' if synthetic else ''}Counter-proposal {e(res['nct_id'])}</title>"
                    f"<style>{terms._CSS}{_EXTRA_CSS}</style></head><body>"]  # noqa: SLF001
    w = h.append
    w("<div class='noprint'><button onclick='window.print()'>Print or save as PDF</button></div>")
    w(f"<h1>{'SYNTHETIC: ' if synthetic else ''}Counter-proposal: {e(res['nct_id'])} at {e(s['label'])}</h1>")
    if synthetic:
        w(f"<div class='banner synth'>SYNTHETIC sample proposal: invented prices to demonstrate the check. Not a "
          f"proposal from {e(s['label'])}, and not market data.</div>")
    w(f"<div class='banner'>{e(terms.DISCLAIMER)}</div>")
    w(f"<p><span class='tag'>Illustrative protocol</span> {e(res['label'])}. Not the sponsor's protocol. "
      f"Generated {e(res['generated'])} by Concord. Every line states where its number comes from. "
      f"{'Every line of the proposal is listed.' if detailed else 'Flagged lines only; lines within the justified range are counted in the summary.'}</p>")
    w("<h2>1. Site, locality and assumption</h2><ul>")
    for li in (f"Protocol: {res['nct_id']}, {res['short_title']}",
               f"Site: {s['label']}" + (f" {s['zip']}" if s.get("zip") else ""),
               f"Medicare locality: {loc_text}",
               f"Physician fee schedule: {res['pfs_source'] or 'not loaded'}; conversion factor "
               f"{res['conversion_factor']}",
               f"Clinical lab fee schedule: {res['clfs_source'] or 'not loaded (lab amounts are placeholders)'}",
               res["band"]["text"],
               f"Non-procedure lines: Concord's proposed standard amount is shown as a reference, labelled "
               f"'{REF_LABEL}'. Source: {res['standard_source']}."):
        w(f"<li>{e(li)}</li>")
    w("</ul><h2>2. Summary</h2><div class='kv'>")
    for k in FLAG_ORDER:
        w(f"<span><span class='flag f-{k}'>{e(FLAGS[k])}</span> <b>{c[k]}</b></span>")
    w("</div><ul>")
    if cd["n"]:
        w(f"<li>Coded procedure and lab lines ({cd['n']}): the site asks <b>{_m(cd['total_ask'])}</b> in total (one "
          f"occurrence of each); the justified range totals <b>{_m(cd['range_low'])} to {_m(cd['range_high'])}</b>. "
          f"Above the range top by {_m(cd['above_by'])} in total; below the range bottom by {_m(cd['below_by'])}.</li>")
    for t in sm["top_outside"]:
        routine = _insurance_only(by_row.get(t["row"], {}))
        w(f"<li>Row {t['row']}: {e(t['item'])} asks {_m(t['ask'])} against {_m(t['range_low'])} to "
          f"{_m(t['range_high'])} ({e(FLAGS[t['flag']])} by {_m(t['outside_by'])})"
          + (f"; routine care billed to insurance under {e(terms.NCD)}, not to the sponsor" if routine else "")
          + "</li>")
    if sm["n_errors"]:
        w(f"<li>{sm['n_errors']} row(s) could not be read (listed at the end).</li>")
    w("</ul>")
    w(f"<h2>3. {'Every line' if detailed else 'Flagged lines'}</h2><div class='tw wide'><table><thead><tr>"
      "<th class='n'>Row</th><th>Site item</th><th>Matched to</th><th class='n'>Site ask</th>"
      "<th>Justified range or reference</th><th>Flag</th><th>Response</th></tr></thead><tbody>")
    for r in rows:
        matched = (f"{r['code']} · {r['matched_label']}" if r["code"] else r["matched_label"]) or "-"
        how = f" (by {r['method']})" if r["method"] else ""
        w(f"<tr class='main'><td class='n'>{r['row']}</td><td>{e(r['item'])}</td><td>{e(matched)}{e(how)}</td>"
          f"<td class='n'>{e(_ask_text(r))}</td><td>{e(_range_text(r))}</td>"
          f"<td><span class='flag f-{e(r['flag'])}'>{e(r['flag_label'])}</span></td><td>{e(response_text(r))}</td></tr>")
        src = r["source"]["text"] if r["source"] else "No source: the item is not in this protocol's schedule"
        if r["source"] and r["source"]["formula"]:
            src += f": {r['source']['formula']}"
        if r["medicare"] is not None:
            src = (f"Medicare {_m(r['medicare'])} x {res['band']['low'] * 100:.0f}% to "
                   f"{res['band']['high'] * 100:.0f}% (band: {BAND_LABEL}). Source: {src}")
        notes = "; ".join(r["notes"])
        w(f"<tr class='sub'><td></td><td colspan='6' class='prov'>{e(src)}"
          + (f"<br>Note: {e(notes)}" if notes else "") + "</td></tr>")
    if not rows:
        w("<tr><td></td><td colspan='6'>No flagged lines.</td></tr>")
    w("</tbody></table></div>")
    if res["errors"]:
        w("<h2>Rows that could not be read</h2><ul>")
        for x in res["errors"]:
            w(f"<li>Row {x['row']}: <span class='mono'>{e(x['text'])}</span>: {e(x['error'])}</li>")
        w("</ul>")
    w("<h2>Sources and assumptions</h2><ul>")
    w(f"<li>{e(res['band']['text'])}</li>")
    w(f"<li>Medicare amounts are benchmarks that inform fair-value reasoning in sponsor-site negotiation. They are "
      f"not the sponsor's price and not market data.</li>")
    w(f"<li>{e(REF_LABEL.capitalize())}: {e(res['standard_source'])}.</li>")
    w("<li>PFS amounts are non-facility amounts (global service), locality-adjusted with the CMS GPCIs; CLFS amounts "
      "are national limitation amounts.</li>")
    w("<li>Codes are shown with Concord's own short labels, not AMA CPT descriptors.</li></ul>")
    w(f"<p><i>{e(terms.DISCLAIMER)}</i> <span class='tag'>Illustrative protocol</span></p></body></html>")
    return "".join(h)
