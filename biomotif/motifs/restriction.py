"""Restriction enzyme sites and digests."""

from __future__ import annotations

import re

from ..seq.alphabet import is_nucleotide, revcomp
from ..seq.record import Record
from .combinators import Iupac
from .search import search

_TYPE_IIS = re.compile(r"^([ACGTRYSWKMBDHVN]+)\((-?\d+)/(-?\d+)\)$", re.I)


def parse_site(spec: str) -> dict:
    """Parse a recognition site written the REBASE way.

    'G^AATTC'          cut on the top strand after G; the bottom strand cut mirrors it
    'GAT^ATC'          blunt when the cut sits in the middle
    'G^AATT_C'         explicit top (^) and bottom (_) cuts
    'GGTCTC(1/5)'      Type IIS: cuts 1 (top) and 5 (bottom) bases after the site
    """
    spec = spec.strip().upper()
    m = _TYPE_IIS.match(spec)
    if m:
        site, top, bottom = m.group(1), int(m.group(2)), int(m.group(3))
        return {"site": site, "cut_top": len(site) + top, "cut_bottom": len(site) + bottom, "kind": "IIS"}
    site = spec.replace("^", "").replace("_", "")
    if "^" not in spec:
        raise ValueError(f"restriction site {spec!r} has no cut mark (^)")
    top = spec.index("^")
    if "_" in spec:
        bottom = spec.replace("^", "").index("_")
    else:
        bottom = len(site) - top  # palindromic symmetry
    return {"site": site, "cut_top": top, "cut_bottom": bottom, "kind": "II"}


def overhang(info: dict) -> str:
    d = info["cut_bottom"] - info["cut_top"]
    if d == 0:
        return "blunt"
    return f"5' overhang of {d}" if d > 0 else f"3' overhang of {-d}"


def digest(target, enzymes: list, circular: bool = False) -> dict:
    """Digest a sequence with one or more enzymes.

    enzymes: list of (name, site_info) pairs from parse_site.
    Returns {"sites": [...], "cuts": [...], "fragments": [(start, end, length), ...]}.
    Fragment boundaries come from the top-strand cut positions.
    """
    record = target if isinstance(target, Record) else Record("seq", target)
    n = len(record.seq)
    sites = []
    cuts = set()
    for name, info in enzymes:
        pal = info["site"] == revcomp(info["site"])
        matcher = Iupac(info["site"])
        hits = search(matcher, record, strand="+" if pal else "both")
        seen = set()
        for h in hits:
            if h.strand == "+":
                top = h.start + info["cut_top"]
                bottom = h.start + info["cut_bottom"]
            else:
                top = h.end - info["cut_bottom"]
                bottom = h.end - info["cut_top"]
            key = (h.start, top)
            if key in seen:
                continue
            seen.add(key)
            if not circular and not (0 <= top <= n):
                continue
            top_pos = top % n if circular else top
            sites.append({"enzyme": name, "start": h.start, "end": h.end, "strand": h.strand,
                          "cut_top": top_pos, "cut_bottom": bottom % n if circular else bottom})
            cuts.add(top_pos)
    cut_list = sorted(c for c in cuts if 0 <= c <= n)
    fragments = []
    if circular:
        if not cut_list:
            fragments.append((0, n, n))
        else:
            for a, b in zip(cut_list, cut_list[1:]):
                fragments.append((a, b, b - a))
            first, last = cut_list[0], cut_list[-1]
            fragments.append((last, first, (n - last) + first))
    else:
        bounds = [0] + [c for c in cut_list if 0 < c < n] + [n]
        for a, b in zip(bounds, bounds[1:]):
            fragments.append((a, b, b - a))
    sites.sort(key=lambda s: (s["start"], s["enzyme"]))
    return {"sites": sites, "cuts": cut_list, "fragments": fragments}
