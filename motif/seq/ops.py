"""Sequence operations: translation, composition, k-mers, Tm, distances, alignment."""

from __future__ import annotations

from .alphabet import IUPAC_DNA

# NCBI translation tables (standard = 1, bacterial/plastid = 11, vertebrate mitochondrial = 2).
_BASES = "TCAG"
_STANDARD = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
_VERT_MITO = "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG"
_YEAST_MITO = "FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG"

CODON_TABLES: dict[int, dict[str, str]] = {}
START_CODONS: dict[int, list[str]] = {
    1: ["ATG"],
    2: ["ATT", "ATC", "ATA", "ATG", "GTG"],
    3: ["ATA", "ATG", "GTG"],
    11: ["ATG", "GTG", "TTG"],
}
TABLE_NAMES = {1: "standard", 2: "vertebrate mitochondrial", 3: "yeast mitochondrial", 11: "bacterial and plastid"}


def _build(aa: str) -> dict[str, str]:
    table = {}
    i = 0
    for a in _BASES:
        for b in _BASES:
            for c in _BASES:
                table[a + b + c] = aa[i]
                i += 1
    return table


CODON_TABLES[1] = _build(_STANDARD)
CODON_TABLES[11] = _build(_STANDARD)
CODON_TABLES[2] = _build(_VERT_MITO)
CODON_TABLES[3] = _build(_YEAST_MITO)

STOP_CODONS = {t: sorted(c for c, a in tbl.items() if a == "*") for t, tbl in CODON_TABLES.items()}


def codon_table(table: int = 1) -> dict[str, str]:
    if table not in CODON_TABLES:
        raise ValueError(f"unknown translation table {table}; known: {sorted(CODON_TABLES)}")
    return CODON_TABLES[table]


def translate(seq: str, table: int = 1, frame: int = 0, to_stop: bool = False, start_as_met: bool = False) -> str:
    """Translate a DNA/RNA sequence. Ambiguous codons give X."""
    tbl = codon_table(table)
    s = seq.upper().replace("U", "T")
    out = []
    for i in range(frame, len(s) - 2, 3):
        codon = s[i:i + 3]
        aa = tbl.get(codon)
        if aa is None:
            aa = _ambiguous_codon(codon, tbl)
        if start_as_met and not out and codon in START_CODONS.get(table, ["ATG"]):
            aa = "M"
        if aa == "*" and to_stop:
            break
        out.append(aa)
    return "".join(out)


def _ambiguous_codon(codon: str, tbl: dict[str, str]) -> str:
    options = [""]
    for c in codon:
        bases = IUPAC_DNA.get(c)
        if bases is None:
            return "X"
        options = [o + b for o in options for b in bases]
    aas = {tbl[o] for o in options}
    return aas.pop() if len(aas) == 1 else "X"


def gc_content(seq: str) -> float:
    s = seq.upper()
    n = sum(1 for c in s if c in "ACGTU")
    if n == 0:
        return 0.0
    return sum(1 for c in s if c in "GCS") / n


def gc_skew(seq: str) -> float:
    s = seq.upper()
    g, c = s.count("G"), s.count("C")
    return (g - c) / (g + c) if g + c else 0.0


def kmers(seq: str, k: int) -> list[str]:
    return [seq[i:i + k] for i in range(len(seq) - k + 1)]


def kmer_counts(seq: str, k: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    for km in kmers(seq, k):
        counts[km] = counts.get(km, 0) + 1
    return counts


def melting_temp(seq: str, method: str = "auto") -> float:
    """Melting temperature in Celsius.

    'wallace': Tm = 2(A+T) + 4(G+C), the rule of thumb for short primers.
    'basic':   Tm = 64.9 + 41 (G+C-16.4)/N, for longer oligos (Marmur/Doty style).
    'auto' picks wallace below 14 nt and basic otherwise.
    """
    s = seq.upper().replace("U", "T")
    n = len(s)
    if n == 0:
        return 0.0
    at = sum(1 for c in s if c in "AT")
    gc = sum(1 for c in s if c in "GC")
    if method == "wallace" or (method == "auto" and n < 14):
        return 2.0 * at + 4.0 * gc
    return 64.9 + 41.0 * (gc - 16.4) / n


def molecular_weight(seq: str, kind: str = "dna") -> float:
    """Approximate molecular weight in Daltons (single-stranded linear)."""
    s = seq.upper()
    if kind == "protein":
        w = {"A": 71.08, "R": 156.19, "N": 114.10, "D": 115.09, "C": 103.14, "E": 129.12, "Q": 128.13,
             "G": 57.05, "H": 137.14, "I": 113.16, "L": 113.16, "K": 128.17, "M": 131.19, "F": 147.18,
             "P": 97.12, "S": 87.08, "T": 101.10, "W": 186.21, "Y": 163.18, "V": 99.13}
        return sum(w.get(c, 110.0) for c in s if c != "*") + 18.02
    if kind == "rna":
        w = {"A": 329.2, "C": 305.2, "G": 345.2, "U": 306.2, "T": 306.2}
        return sum(w.get(c, 320.0) for c in s) + 159.0
    w = {"A": 313.2, "C": 289.2, "G": 329.2, "T": 304.2, "U": 304.2}
    return sum(w.get(c, 309.0) for c in s) - 61.96


def hamming(a: str, b: str) -> int:
    if len(a) != len(b):
        raise ValueError("hamming distance needs strings of equal length")
    return sum(1 for x, y in zip(a, b) if x != y)


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def align(a: str, b: str, mode: str = "global", match: int = 2, mismatch: int = -1, gap: int = -2):
    """Needleman-Wunsch (global) or Smith-Waterman (local) alignment.

    Returns (score, aligned_a, aligned_b, start_a, start_b)."""
    n, m = len(a), len(b)
    local = mode == "local"
    score = [[0] * (m + 1) for _ in range(n + 1)]
    trace = [[0] * (m + 1) for _ in range(n + 1)]  # 0 stop, 1 diag, 2 up, 3 left
    if not local:
        for i in range(1, n + 1):
            score[i][0] = i * gap
            trace[i][0] = 2
        for j in range(1, m + 1):
            score[0][j] = j * gap
            trace[0][j] = 3
    best, best_pos = 0, (0, 0)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            diag = score[i - 1][j - 1] + (match if a[i - 1] == b[j - 1] else mismatch)
            up = score[i - 1][j] + gap
            left = score[i][j - 1] + gap
            s, t = diag, 1
            if up > s:
                s, t = up, 2
            if left > s:
                s, t = left, 3
            if local and s <= 0:
                s, t = 0, 0
            score[i][j] = s
            trace[i][j] = t
            if local and s > best:
                best, best_pos = s, (i, j)
    i, j = best_pos if local else (n, m)
    final = best if local else score[n][m]
    out_a, out_b = [], []
    while i > 0 or j > 0:
        t = trace[i][j]
        if t == 0:
            break
        if t == 1:
            out_a.append(a[i - 1]); out_b.append(b[j - 1]); i -= 1; j -= 1
        elif t == 2:
            out_a.append(a[i - 1]); out_b.append("-"); i -= 1
        else:
            out_a.append("-"); out_b.append(b[j - 1]); j -= 1
    return final, "".join(reversed(out_a)), "".join(reversed(out_b)), i, j


def is_palindrome(seq: str) -> bool:
    """True for a sequence equal to its own reverse complement (a restriction-site style palindrome)."""
    from .alphabet import revcomp
    s = seq.upper()
    return len(s) > 0 and s == revcomp(s)


def orfs(seq: str, min_length: int = 30, table: int = 1, starts: list[str] | None = None,
         both_strands: bool = True, longest_only: bool = True):
    """Find open reading frames on a DNA sequence.

    Yields dicts with start, end (0-based, end exclusive, on the forward strand),
    strand ('+' or '-'), frame (0..2), the codon sequence and its translation.
    min_length is in nucleotides, including the stop codon.
    """
    from .alphabet import revcomp
    tbl = codon_table(table)
    starts = [s.upper() for s in (starts or START_CODONS.get(table, ["ATG"]))]
    s = seq.upper().replace("U", "T")
    n = len(s)
    for strand, text in (("+", s), ("-", revcomp(s))) if both_strands else (("+", s),):
        for frame in range(3):
            i = frame
            while i + 3 <= n:
                codon = text[i:i + 3]
                if codon in starts:
                    j = i + 3
                    while j + 3 <= n and tbl.get(text[j:j + 3], "X") != "*":
                        j += 3
                    if j + 3 <= n:  # has a stop
                        end = j + 3
                        if end - i >= min_length:
                            protein = translate(text[i:end], table, 0, to_stop=True, start_as_met=True)
                            if strand == "+":
                                fs, fe = i, end
                            else:
                                fs, fe = n - end, n - i
                            yield {"start": fs, "end": fe, "strand": strand, "frame": frame,
                                   "seq": text[i:end], "protein": protein}
                        i = end if longest_only else i + 3
                        continue
                i += 3
