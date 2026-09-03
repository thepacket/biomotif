"""Motif combinators.

Every matcher implements match_at(ctx, i, binds), a generator yielding
(end, binds) for each way the motif can match starting at position i of
ctx.seq. Backtracking falls out of the generator protocol: Seq tries the
next alternative of an earlier part whenever a later part fails.
"""

from __future__ import annotations

import math
import re

from ..seq.alphabet import IUPAC_DNA


def _q(s: str) -> str:
    return '"' + s.replace('"', '\\"') + '"'


class Matcher:
    """Base class. Subclasses set `describe` and `match_at`."""

    name: str | None = None

    def match_at(self, ctx, i: int, binds: dict):
        raise NotImplementedError

    def describe(self) -> str:
        return "#<matcher>"

    def first_set(self, ctx):
        """Set of characters that any match must start with, or None if unknown."""
        return None

    def lisp_repr(self) -> str:
        return f"#<motif {self.name}>" if self.name else f"#<motif {self.describe()}>"

    def __repr__(self) -> str:
        return self.lisp_repr()


def _norm(text: str, nuc: bool) -> str:
    t = text.upper()
    return t.replace("U", "T") if nuc else t


class Literal(Matcher):
    def __init__(self, text: str):
        if not isinstance(text, str):
            raise ValueError(f"literal must be a string, got {text!r}")
        self.text = text
        self._nuc = _norm(text, True)
        self._prot = text.upper()

    def pattern(self, ctx) -> str:
        return self._nuc if ctx.nuc else self._prot

    def match_at(self, ctx, i, binds):
        p = self.pattern(ctx)
        if ctx.seq.startswith(p, i):
            yield i + len(p), binds

    def first_set(self, ctx):
        p = self.pattern(ctx)
        return {p[0]} if p else None

    def describe(self):
        return _q(self.text)


class Iupac(Matcher):
    """A nucleotide pattern using IUPAC ambiguity codes (R Y S W K M B D H V N)."""

    def __init__(self, text: str):
        self.text = text
        self.sets = []
        for c in text.upper():
            bases = IUPAC_DNA.get(c)
            if bases is None:
                raise ValueError(f"iupac: not a nucleotide code: {c!r} in {text!r}")
            self.sets.append(frozenset(bases))

    def match_at(self, ctx, i, binds):
        seq = ctx.seq
        n = len(self.sets)
        if i + n > len(seq):
            return
        for k in range(n):
            if seq[i + k] not in self.sets[k]:
                return
        yield i + n, binds

    def first_set(self, ctx):
        return set(self.sets[0]) if self.sets else None

    def describe(self):
        return f"(iupac {_q(self.text)})"


class AnyOf(Matcher):
    def __init__(self, chars: str):
        self.chars = chars
        self._nuc = frozenset(_norm(chars, True))
        self._prot = frozenset(chars.upper())

    def _set(self, ctx):
        return self._nuc if ctx.nuc else self._prot

    def match_at(self, ctx, i, binds):
        if i < len(ctx.seq) and ctx.seq[i] in self._set(ctx):
            yield i + 1, binds

    def first_set(self, ctx):
        return set(self._set(ctx))

    def accepts(self, ctx, c):
        return c in self._set(ctx)

    def describe(self):
        return f"(any-of {_q(self.chars)})"


class NoneOf(Matcher):
    def __init__(self, chars: str):
        self.chars = chars
        self._nuc = frozenset(_norm(chars, True))
        self._prot = frozenset(chars.upper())

    def _set(self, ctx):
        return self._nuc if ctx.nuc else self._prot

    def match_at(self, ctx, i, binds):
        if i < len(ctx.seq) and ctx.seq[i] not in self._set(ctx):
            yield i + 1, binds

    def accepts(self, ctx, c):
        return c not in self._set(ctx)

    def describe(self):
        return f"(none-of {_q(self.chars)})"


class Any(Matcher):
    def match_at(self, ctx, i, binds):
        if i < len(ctx.seq):
            yield i + 1, binds

    def accepts(self, ctx, c):
        return True

    def describe(self):
        return "any"


class Seq(Matcher):
    def __init__(self, parts):
        self.parts = [coerce(p) for p in parts]

    def match_at(self, ctx, i, binds):
        parts = self.parts
        if not parts:
            yield i, binds
            return
        # Explicit stack of generators so deep sequences do not recurse.
        stack = [parts[0].match_at(ctx, i, binds)]
        while stack:
            k = len(stack) - 1
            nxt = next(stack[k], None)
            if nxt is None:
                stack.pop()
                continue
            j, b = nxt
            if k + 1 == len(parts):
                yield j, b
            else:
                stack.append(parts[k + 1].match_at(ctx, j, b))

    def first_set(self, ctx):
        # Only the first part constrains the start, and every matcher that can
        # match the empty string reports None, so this stays conservative.
        return self.parts[0].first_set(ctx) if self.parts else None

    def describe(self):
        return "(seq " + " ".join(p.describe() for p in self.parts) + ")"


class Alt(Matcher):
    def __init__(self, parts):
        self.parts = [coerce(p) for p in parts]

    def match_at(self, ctx, i, binds):
        for p in self.parts:
            yield from p.match_at(ctx, i, binds)

    def first_set(self, ctx):
        out = set()
        for p in self.parts:
            fs = p.first_set(ctx)
            if fs is None:
                return None
            out |= fs
        return out

    def describe(self):
        return "(alt " + " ".join(p.describe() for p in self.parts) + ")"


class Repeat(Matcher):
    """Greedy repetition of any matcher, min..max times (max None = unbounded)."""

    def __init__(self, inner, min: int = 0, max: int | None = None):
        self.inner = coerce(inner)
        self.min = min
        self.max = max
        if max is not None and max < min:
            raise ValueError("repeat: max is smaller than min")

    @staticmethod
    def _next(gen, pos):
        for j, b in gen:
            if j != pos:  # ignore zero-width matches, they would loop forever
                return j, b
        return None

    def match_at(self, ctx, i, binds):
        mn = self.min
        mx = self.max if self.max is not None else math.inf
        inner = self.inner
        stack = []  # (generator, pos_before, binds_before)
        pos, b = i, binds
        while True:
            if len(stack) < mx:
                gen = inner.match_at(ctx, pos, b)
                nxt = self._next(gen, pos)
                if nxt is not None:
                    stack.append((gen, pos, b))
                    pos, b = nxt
                    continue
            if len(stack) >= mn:
                yield pos, b
            while stack:
                gen, ppos, pb = stack[-1]
                nxt = self._next(gen, ppos)
                if nxt is not None:
                    pos, b = nxt
                    break
                stack.pop()
                pos, b = ppos, pb
                if len(stack) >= mn:
                    yield pos, b
            else:
                return

    def first_set(self, ctx):
        return self.inner.first_set(ctx) if self.min > 0 else None

    def describe(self):
        mx = "" if self.max is None else f" {self.max}"
        return f"(repeat {self.inner.describe()} {self.min}{mx})"


class CharRun(Matcher):
    """Fast path for repeating a single-character class: (run "AT" 2 4), (gap 20 35)."""

    def __init__(self, cls, min: int = 0, max: int | None = None, label: str | None = None):
        self.cls = cls  # Any, AnyOf or NoneOf
        self.min = min
        self.max = max
        self.label = label

    def match_at(self, ctx, i, binds):
        seq = ctx.seq
        n = len(seq)
        limit = n - i if self.max is None else min(self.max, n - i)
        count = 0
        accepts = self.cls.accepts
        while count < limit and accepts(ctx, seq[i + count]):
            count += 1
        for k in range(count, self.min - 1, -1):
            yield i + k, binds

    def first_set(self, ctx):
        return self.cls.first_set(ctx) if self.min > 0 else None

    def describe(self):
        if self.label:
            return self.label
        mx = "" if self.max is None else f" {self.max}"
        return f"(repeat {self.cls.describe()} {self.min}{mx})"


class Named(Matcher):
    def __init__(self, label: str, inner):
        self.label = label
        self.inner = coerce(inner)

    def match_at(self, ctx, i, binds):
        for j, b in self.inner.match_at(ctx, i, binds):
            nb = dict(b)
            nb[self.label] = (i, j)
            yield j, nb

    def first_set(self, ctx):
        return self.inner.first_set(ctx)

    def describe(self):
        return f"(named '{self.label} {self.inner.describe()})"


def _position_sets(m: Matcher, ctx):
    """Per-position character sets for a fixed-width matcher, or None."""
    if isinstance(m, Literal):
        return [frozenset(c) for c in m.pattern(ctx)]
    if isinstance(m, Iupac):
        return list(m.sets)
    if isinstance(m, AnyOf):
        return [m._set(ctx)]
    if isinstance(m, Any):
        return [None]
    if isinstance(m, (Tagged, Named)):
        return _position_sets(m.inner, ctx)
    if isinstance(m, Seq):
        out = []
        for p in m.parts:
            ps = _position_sets(p, ctx)
            if ps is None:
                return None
            out.extend(ps)
        return out
    if isinstance(m, CharRun) and m.max == m.min and isinstance(m.cls, (AnyOf, Any)):
        return _position_sets(m.cls, ctx) * m.min
    return None


class Fuzzy(Matcher):
    """A fixed-width pattern matched with up to k substitutions (Hamming distance)."""

    def __init__(self, k: int, inner):
        self.k = k
        self.inner = coerce(inner)
        self._cache = {}

    def _sets(self, ctx):
        key = ctx.nuc
        if key not in self._cache:
            ps = _position_sets(self.inner, ctx)
            if ps is None:
                raise ValueError("fuzzy: the inner motif must have a fixed width (literal, iupac, any-of, seq of those)")
            self._cache[key] = ps
        return self._cache[key]

    def match_at(self, ctx, i, binds):
        sets = self._sets(ctx)
        n = len(sets)
        seq = ctx.seq
        if i + n > len(seq):
            return
        errors = 0
        for p, s in enumerate(sets):
            if s is not None and seq[i + p] not in s:
                errors += 1
                if errors > self.k:
                    return
        nb = dict(binds)
        nb["$mismatches"] = binds.get("$mismatches", 0) + errors
        yield i + n, nb

    def describe(self):
        return f"(fuzzy {self.k} {self.inner.describe()})"


class Edit(Matcher):
    """A literal matched with up to k edits (substitutions, insertions, deletions)."""

    def __init__(self, k: int, text: str):
        self.k = k
        self.lit = Literal(text)

    def match_at(self, ctx, i, binds):
        p = self.lit.pattern(ctx)
        seq = ctx.seq
        m = len(p)
        k = self.k
        window = seq[i:i + m + k]
        # dp[r][c] = edit distance between p[:r] and window[:c]; column 0 anchored at i.
        prev = list(range(len(window) + 1))
        prev = [0] + [c for c in range(1, len(window) + 1)]
        rows = [prev]
        for r in range(1, m + 1):
            cur = [r]
            for c in range(1, len(window) + 1):
                cost = 0 if p[r - 1] == window[c - 1] else 1
                cur.append(min(prev[c] + 1, cur[c - 1] + 1, prev[c - 1] + cost))
            prev = cur
            rows.append(cur)
        last = rows[m]
        ends = [(last[c], c) for c in range(1, len(window) + 1) if last[c] <= k]
        ends.sort(key=lambda t: (t[0], -t[1]))
        seen = set()
        for d, c in ends:
            if c in seen:
                continue
            seen.add(c)
            nb = dict(binds)
            nb["$edits"] = binds.get("$edits", 0) + d
            yield i + c, nb

    def describe(self):
        return f"(edit {self.k} {_q(self.lit.text)})"


_PAIRS = {("A", "T"), ("T", "A"), ("G", "C"), ("C", "G")}
_WOBBLE = {("G", "T"), ("T", "G")}


class Hairpin(Matcher):
    """A stem-loop: a stem of stem_min..stem_max bases, a loop matched by `loop`,
    then the reverse complement of the stem. Binds stem5, loop and stem3."""

    def __init__(self, stem_min: int, stem_max: int, loop, wobble: bool = False, mismatches: int = 0):
        self.stem_min = stem_min
        self.stem_max = stem_max
        self.loop = coerce(loop)
        self.wobble = wobble
        self.mismatches = mismatches

    def _pairs(self, a: str, b: str) -> bool:
        errors = 0
        pairs = _PAIRS | _WOBBLE if self.wobble else _PAIRS
        for x, y in zip(a, reversed(b)):
            if (x, y) not in pairs:
                errors += 1
                if errors > self.mismatches:
                    return False
        return True

    def match_at(self, ctx, i, binds):
        seq = ctx.seq
        n = len(seq)
        for L in range(self.stem_max, self.stem_min - 1, -1):
            if i + 2 * L > n:
                continue
            stem = seq[i:i + L]
            for j, b in self.loop.match_at(ctx, i + L, binds):
                if j + L > n:
                    continue
                if self._pairs(stem, seq[j:j + L]):
                    nb = dict(b)
                    nb["stem5"] = (i, i + L)
                    nb["loop"] = (i + L, j)
                    nb["stem3"] = (j, j + L)
                    yield j + L, nb

    def describe(self):
        extra = (" :wobble #t" if self.wobble else "") + (f" :mismatches {self.mismatches}" if self.mismatches else "")
        return f"(hairpin (stem {self.stem_min} {self.stem_max}) {self.loop.describe()}{extra})"


class Pwm(Matcher):
    """A position weight matrix scored as log2 odds against a background.

    threshold is a relative score in [0, 1]: (score - min) / (max - min)."""

    def __init__(self, matrix: dict[str, list[float]], threshold: float = 0.8, name: str | None = None,
                 counts: dict[str, list[float]] | None = None):
        self.matrix = {k.upper().replace("U", "T"): list(v) for k, v in matrix.items()}
        self.letters = sorted(self.matrix)
        self.width = len(next(iter(self.matrix.values())))
        for k, v in self.matrix.items():
            if len(v) != self.width:
                raise ValueError("pwm: all rows must have the same length")
        self.threshold = threshold
        self.name = name
        self.counts = counts
        self.max_score = sum(max(self.matrix[l][p] for l in self.letters) for p in range(self.width))
        self.min_score = sum(min(self.matrix[l][p] for l in self.letters) for p in range(self.width))

    @classmethod
    def from_sites(cls, sites: list[str], pseudocount: float = 0.5, background: dict[str, float] | None = None,
                   threshold: float = 0.8, alphabet: str = "ACGT", name: str | None = None) -> "Pwm":
        sites = [s.upper().replace("U", "T") for s in sites]
        width = len(sites[0])
        if any(len(s) != width for s in sites):
            raise ValueError("pwm-from-sites: all sites must have the same length")
        counts = {l: [0.0] * width for l in alphabet}
        for s in sites:
            for p, c in enumerate(s):
                if c in counts:
                    counts[c][p] += 1
        bg = background or {l: 1.0 / len(alphabet) for l in alphabet}
        matrix = {}
        for l in alphabet:
            row = []
            for p in range(width):
                total = sum(counts[x][p] for x in alphabet) + pseudocount * len(alphabet)
                freq = (counts[l][p] + pseudocount) / total
                row.append(math.log2(freq / bg[l]))
            matrix[l] = row
        return cls(matrix, threshold, name, counts)

    def score(self, s: str) -> float:
        total = 0.0
        for p, c in enumerate(s):
            row = self.matrix.get(c)
            if row is None:
                total += self.min_score / self.width  # unknown letter: worst case
            else:
                total += row[p]
        return total

    def relative(self, score: float) -> float:
        span = self.max_score - self.min_score
        return (score - self.min_score) / span if span else 1.0

    def consensus(self) -> str:
        return "".join(max(self.letters, key=lambda l: self.matrix[l][p]) for p in range(self.width))

    def match_at(self, ctx, i, binds):
        if i + self.width > len(ctx.seq):
            return
        s = ctx.seq[i:i + self.width]
        sc = self.score(s)
        rel = self.relative(sc)
        if rel >= self.threshold:
            nb = dict(binds)
            nb["$score"] = round(sc, 3)
            nb["$relative"] = round(rel, 3)
            yield i + self.width, nb

    def describe(self):
        return f"(pwm {self.consensus()} :width {self.width} :threshold {self.threshold})"


class AtStart(Matcher):
    def match_at(self, ctx, i, binds):
        if i == 0:
            yield i, binds

    def describe(self):
        return "at-start"


class AtEnd(Matcher):
    def match_at(self, ctx, i, binds):
        if i == len(ctx.seq):
            yield i, binds

    def describe(self):
        return "at-end"


class Regex(Matcher):
    """Escape hatch: a Python regular expression anchored at the current position."""

    def __init__(self, pattern: str):
        self.pattern = pattern
        self.re = re.compile(pattern, re.I)

    def match_at(self, ctx, i, binds):
        m = self.re.match(ctx.seq, i)
        if m:
            nb = dict(binds)
            for k, v in m.groupdict().items():
                if v is not None:
                    nb[k] = m.span(k)
            yield m.end(), nb

    def describe(self):
        return f"(regex {_q(self.pattern)})"


class Custom(Matcher):
    """A user predicate on the candidate substring, tried from max down to min length."""

    def __init__(self, min: int, max: int, fn, label: str = "custom"):
        self.min = min
        self.max = max
        self.fn = fn
        self.label = label

    def match_at(self, ctx, i, binds):
        seq = ctx.seq
        for L in range(min(self.max, len(seq) - i), self.min - 1, -1):
            if self.fn(seq[i:i + L]):
                yield i + L, binds

    def describe(self):
        return f"({self.label} {self.min} {self.max})"


class Tagged(Matcher):
    """Wraps a matcher with a name (used by defmotif) without mutating it."""

    def __init__(self, inner, name: str):
        self.inner = coerce(inner)
        self.name = name

    def match_at(self, ctx, i, binds):
        return self.inner.match_at(ctx, i, binds)

    def first_set(self, ctx):
        return self.inner.first_set(ctx)

    def describe(self):
        return self.inner.describe()


def coerce(x) -> Matcher:
    """Strings become literals; lists become sequences."""
    if isinstance(x, Matcher):
        return x
    if isinstance(x, str):
        return Literal(x)
    if isinstance(x, list):
        return Seq(x)
    raise ValueError(f"not a motif: {x!r}")
