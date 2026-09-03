"""Searching a sequence with a matcher, on either strand."""

from __future__ import annotations

from ..seq.alphabet import is_nucleotide, normalize, revcomp, guess_type
from ..seq.record import Record
from .combinators import Matcher, coerce


class MatchContext:
    __slots__ = ("seq", "kind", "nuc")

    def __init__(self, seq: str, kind: str):
        self.seq = seq
        self.kind = kind
        self.nuc = is_nucleotide(kind)


class Match:
    __slots__ = ("motif", "start", "end", "strand", "seq", "bindings", "record", "score", "extra")

    def __init__(self, motif, start, end, strand, seq, bindings, record=None, score=None, extra=None):
        self.motif = motif          # name (str) of the motif
        self.start = start          # 0-based, forward-strand coordinates, relative to the record
        self.end = end              # exclusive
        self.strand = strand        # '+' or '-'
        self.seq = seq              # the matched text as read on its strand
        self.bindings = bindings    # name -> (start, end, text) in forward coordinates
        self.record = record
        self.score = score
        self.extra = extra or {}

    @property
    def abs_start(self) -> int:
        return self.start + (self.record.offset if self.record else 0)

    @property
    def abs_end(self) -> int:
        return self.end + (self.record.offset if self.record else 0)

    def __len__(self) -> int:
        return self.end - self.start

    def lisp_repr(self) -> str:
        rec = f" {self.record.name}" if self.record is not None else ""
        score = f" score={self.score}" if self.score is not None else ""
        return f"#<match {self.motif}{rec} {self.abs_start}-{self.abs_end} {self.strand} \"{self.seq}\"{score}>"

    def __repr__(self) -> str:
        return self.lisp_repr()


def _motif_name(m: Matcher) -> str:
    return m.name if m.name else m.describe()


def _make_match(m, ctx, i, j, binds, strand, n, record, original):
    if strand == "+":
        start, end = i, j
    else:
        start, end = n - j, n - i
    bindings = {}
    score = None
    extra = {}
    for k, v in binds.items():
        if isinstance(k, str) and k.startswith("$"):
            if k == "$score":
                score = v
            else:
                extra[k[1:]] = v
            continue
        a, b = v
        if strand == "+":
            bindings[k] = (a, b, original[a:b])
        else:
            bindings[k] = (n - b, n - a, ctx.seq[a:b])
    text = original[start:end] if strand == "+" else ctx.seq[i:j]
    return Match(_motif_name(m), start, end, strand, text, bindings, record, score, extra)


def search(matcher, target, strand: str = "both", overlap: bool = True, kind: str | None = None,
           limit: int | None = None) -> list[Match]:
    """Find every match of `matcher` in `target` (a string or Record).

    strand: 'both', '+' (forward) or '-' (reverse complement). Protein targets are
    always searched forward. With overlap=False the scan resumes after each match.
    """
    m = coerce(matcher)
    record = target if isinstance(target, Record) else None
    raw = target.seq if record is not None else target
    kind = kind or (record.type if record is not None else guess_type(raw))
    text = normalize(raw, kind)
    n = len(text)
    strands = ["+"] if not is_nucleotide(kind) else (["+", "-"] if strand == "both" else [strand])
    results = []
    seen: set = set()
    for s in strands:
        seq = text if s == "+" else revcomp(text)
        ctx = MatchContext(seq, kind)
        fs = m.first_set(ctx)
        i = 0
        while i <= n:
            if fs is not None:
                # jump to the next position whose character can start a match
                while i < n and seq[i] not in fs:
                    i += 1
                if i >= n:
                    break
            found = None
            for j, b in m.match_at(ctx, i, {}):
                if j > i:
                    found = (j, b)
                    break
            if found is None:
                i += 1
                continue
            j, b = found
            hit = _make_match(m, ctx, i, j, b, s, n, record, text)
            # A palindromic motif matches the same span on both strands. That is
            # one site read twice, so report it once, on the forward strand.
            if not (hit.strand == "-" and (hit.start, hit.end, hit.seq) in seen):
                results.append(hit)
                seen.add((hit.start, hit.end, hit.seq))
            if limit is not None and len(results) >= limit:
                return results
            i = i + 1 if overlap else j
    results.sort(key=lambda r: (r.start, r.strand))
    return results


def matches_full(matcher, text: str, kind: str | None = None) -> bool:
    """True if the whole string is matched by the motif."""
    m = coerce(matcher)
    kind = kind or guess_type(text)
    ctx = MatchContext(normalize(text, kind), kind)
    n = len(ctx.seq)
    return any(j == n for j, _ in m.match_at(ctx, 0, {}))


def matches_at(matcher, text: str, kind: str | None = None) -> bool:
    """True if the motif matches at the start of the string (prefix match)."""
    m = coerce(matcher)
    kind = kind or guess_type(text)
    ctx = MatchContext(normalize(text, kind), kind)
    return next(m.match_at(ctx, 0, {}), None) is not None
