"""PROSITE pattern syntax -> matchers.

    N-{P}-[ST]-{P}          N, then anything but P, then S or T, then not P
    C-x(2,4)-C-x(3)-H       x is any residue; (n) and (n,m) repeat
    <M-x(5)                 '<' anchors at the N-terminus
    [KRHQSA]-[DENQ]-E-L>    '>' anchors at the C-terminus
"""

from __future__ import annotations

import re

from .combinators import Any, AnyOf, AtEnd, AtStart, CharRun, Literal, NoneOf, Seq, Repeat

_ELEMENT = re.compile(r"^(<)?(\[[A-Z]+\]|\{[A-Z]+\}|[A-Zx])(?:\((\d+)(?:,(\d+))?\))?(>)?$")


def prosite(pattern: str) -> Seq:
    text = pattern.strip().rstrip(".").replace(" ", "")
    parts = []
    for raw in text.split("-"):
        m = _ELEMENT.match(raw)
        if not m:
            raise ValueError(f"prosite: cannot parse element {raw!r} in {pattern!r}")
        start, elem, lo, hi, end = m.groups()
        if start:
            parts.append(AtStart())
        if elem == "x":
            cls = Any()
        elif elem.startswith("["):
            cls = AnyOf(elem[1:-1])
        elif elem.startswith("{"):
            cls = NoneOf(elem[1:-1])
        else:
            cls = Literal(elem)
        if lo is not None:
            lo_i = int(lo)
            hi_i = int(hi) if hi is not None else lo_i
            if isinstance(cls, Literal):
                parts.append(Repeat(cls, lo_i, hi_i))
            else:
                label = f"x({lo}{',' + hi if hi else ''})" if elem == "x" else None
                parts.append(CharRun(cls, lo_i, hi_i, label))
        else:
            parts.append(cls)
        if end:
            parts.append(AtEnd())
    seq = Seq(parts)
    seq.describe = lambda: f'(prosite "{pattern}")'  # type: ignore[method-assign]
    return seq
