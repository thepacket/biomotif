"""Alphabets, IUPAC codes, complements."""

from __future__ import annotations

# IUPAC nucleotide codes -> the set of bases each one stands for (DNA form).
IUPAC_DNA: dict[str, str] = {
    "A": "A", "C": "C", "G": "G", "T": "T", "U": "T",
    "R": "AG", "Y": "CT", "S": "CG", "W": "AT", "K": "GT", "M": "AC",
    "B": "CGT", "D": "AGT", "H": "ACT", "V": "ACG", "N": "ACGT",
}

# One-letter amino acid codes (20 standard + B Z X and * for stop, U selenocysteine, O pyrrolysine).
AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
PROTEIN_EXTRA = "BZXUO*"

_DNA_COMP = str.maketrans("ACGTRYSWKMBDHVNacgtryswkmbdhvn", "TGCAYRSWMKVHDBNtgcayrswmkvhdbn")
_RNA_COMP = str.maketrans("ACGURYSWKMBDHVNacguryswkmbdhvn", "UGCAYRSWMKVHDBNugcayrswmkvhdbn")


def complement(seq: str) -> str:
    """Complement a DNA (or RNA, if it contains U) sequence."""
    if "U" in seq.upper() and "T" not in seq.upper():
        return seq.translate(_RNA_COMP)
    return seq.translate(_DNA_COMP)


def revcomp(seq: str) -> str:
    return complement(seq)[::-1]


def transcribe(seq: str) -> str:
    """DNA coding strand -> RNA (T becomes U)."""
    return seq.replace("T", "U").replace("t", "u")


def reverse_transcribe(seq: str) -> str:
    return seq.replace("U", "T").replace("u", "t")


def normalize(seq: str, kind: str = "dna") -> str:
    """Upper-case; nucleotide sequences are stored with T so that DNA and RNA
    motifs match each other."""
    s = seq.upper()
    if kind in ("dna", "rna"):
        return s.replace("U", "T")
    return s


def guess_type(seq: str) -> str:
    """Guess 'dna', 'rna' or 'protein' from the letters in a sequence."""
    s = seq.upper()
    letters = set(s) - set("-*.")
    if not letters:
        return "dna"
    nuc = set("ACGTUN")
    if letters <= nuc or len(letters & nuc) / max(1, len(letters)) > 0.95 and all(
            s.count(c) / len(s) < 0.02 for c in letters - nuc):
        return "rna" if "U" in letters and "T" not in letters else "dna"
    if letters <= set(IUPAC_DNA) and len(letters - nuc) <= 3:
        return "dna"
    return "protein"


def is_nucleotide(kind: str) -> bool:
    return kind in ("dna", "rna")


def iupac_regex(pattern: str) -> str:
    """Turn an IUPAC nucleotide pattern into a regular expression (DNA form)."""
    out = []
    for c in pattern.upper():
        bases = IUPAC_DNA.get(c)
        if bases is None:
            raise ValueError(f"not an IUPAC nucleotide code: {c}")
        out.append(bases if len(bases) == 1 else f"[{bases}]")
    return "".join(out)


def expand_iupac(pattern: str) -> list[str]:
    """All concrete sequences matching an IUPAC pattern."""
    results = [""]
    for c in pattern.upper():
        bases = IUPAC_DNA.get(c, c)
        results = [r + b for r in results for b in bases]
    return results


def to_iupac(bases: set[str]) -> str:
    """The IUPAC code for a set of bases."""
    key = "".join(sorted(b.replace("U", "T") for b in bases))
    for code, members in IUPAC_DNA.items():
        if "".join(sorted(members)) == key and code != "U":
            return code
    return "N"
