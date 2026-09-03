"""Sequence operations: alphabets, translation, composition, alignment, I/O."""

import pytest

from biomotif.seq import alphabet as A
from biomotif.seq import io as IO
from biomotif.seq import ops as O


def test_complement_and_revcomp():
    assert A.complement("ACGT") == "TGCA"
    assert A.revcomp("ACGT") == "ACGT"
    assert A.revcomp("AAGCTT") == "AAGCTT", "HindIII site is palindromic"
    assert A.revcomp("GGATCC") == "GGATCC"
    assert A.revcomp("ATGC") == "GCAT"


def test_complement_handles_rna():
    assert A.complement("ACGU") == "UGCA"
    assert A.revcomp("ACGU") == "ACGU"


def test_complement_keeps_ambiguity():
    assert A.complement("RYSWKMN") == "YRSWMKN"


def test_transcription():
    assert A.transcribe("ATGGCT") == "AUGGCU"
    assert A.reverse_transcribe("AUGGCU") == "ATGGCT"


def test_guess_type():
    assert A.guess_type("ATGCATGCATGC") == "dna"
    assert A.guess_type("AUGCAUGCAUGC") == "rna"
    assert A.guess_type("MKWVTFISLLLLFSSAYSRG") == "protein"


def test_iupac_expansion():
    assert A.expand_iupac("AR") == ["AA", "AG"]
    assert len(A.expand_iupac("NN")) == 16
    assert A.iupac_regex("ARY") == "A[AG][CT]"
    assert A.to_iupac({"A", "G"}) == "R"
    assert A.to_iupac({"A", "C", "G", "T"}) == "N"


def test_translation_standard():
    assert O.translate("ATGGCTTAA") == "MA*"
    assert O.translate("ATGGCTTAA", to_stop=True) == "MA"
    assert O.translate("ATGGCT", frame=1) == "W", "frame 1 reads TGG then runs out"
    assert O.translate("AUGGCU") == "MA", "U is read as T"


def test_translation_tables_differ():
    # AGA is arginine in the standard code and a stop in vertebrate mitochondria.
    assert O.translate("AGA", table=1) == "R"
    assert O.translate("AGA", table=2) == "*"
    # CTA is leucine everywhere but the yeast mitochondrial code, where it is threonine.
    assert O.translate("CTA", table=1) == "L"
    assert O.translate("CTA", table=3) == "T"


def test_translation_of_ambiguous_codons():
    assert O.translate("CTN") == "L", "every CTN codon is leucine"
    assert O.translate("ATN") == "X", "ATN spans isoleucine and methionine"
    assert O.translate("NNN") == "X"


def test_start_codons_by_table():
    assert O.START_CODONS[1] == ["ATG"]
    assert set(O.START_CODONS[11]) == {"ATG", "GTG", "TTG"}


def test_gc_content():
    assert O.gc_content("GGCC") == 1.0
    assert O.gc_content("ATAT") == 0.0
    assert O.gc_content("ATGC") == 0.5
    assert O.gc_content("") == 0.0
    assert O.gc_skew("GGGC") == 0.5


def test_kmers():
    assert O.kmers("ATGC", 2) == ["AT", "TG", "GC"]
    assert O.kmer_counts("AAAA", 2) == {"AA": 3}


def test_melting_temp():
    # Wallace rule for a short oligo: 2(A+T) + 4(G+C)
    assert O.melting_temp("ATATATATAT", method="wallace") == 20.0
    assert O.melting_temp("GCGCGCGCGC", method="wallace") == 40.0
    assert O.melting_temp("A" * 30) < O.melting_temp("G" * 30)


def test_distances():
    assert O.hamming("ACGT", "ACGA") == 1
    assert O.edit_distance("kitten", "sitting") == 3
    assert O.edit_distance("ACGT", "ACGT") == 0
    with pytest.raises(ValueError):
        O.hamming("AC", "ACG")


def test_alignment_global():
    score, a, b, _, _ = O.align("ACGT", "ACGT")
    assert a == b == "ACGT"
    assert score == 8


def test_alignment_with_a_gap():
    score, a, b, _, _ = O.align("ACGT", "AGT")
    assert "-" in b
    assert a == "ACGT"


def test_alignment_local_finds_the_shared_part():
    score, a, b, _, _ = O.align("TTTTACGTACGTTTTT", "GGGACGTACGTGGG", mode="local")
    assert "ACGTACGT" in a
    assert "ACGTACGT" in b


def test_palindrome():
    assert O.is_palindrome("GAATTC")
    assert O.is_palindrome("GGATCC")
    assert not O.is_palindrome("GAATTG")


def test_molecular_weight():
    # A 20-mer of DNA is a little over 6 kDa; a G-rich strand outweighs an A-rich one.
    assert 5800 < O.molecular_weight("ACGT" * 5, "dna") < 6600
    assert O.molecular_weight("G" * 20, "dna") > O.molecular_weight("C" * 20, "dna")
    assert O.molecular_weight("AAAA", "protein") > O.molecular_weight("AA", "protein")
    assert O.molecular_weight("W", "protein") > O.molecular_weight("G", "protein")


def test_orfs_finds_a_planted_gene():
    cds = "ATG" + "GCT" * 40 + "TAA"
    seq = "TTTTT" + cds + "GGGGG"
    found = list(O.orfs(seq, min_length=60))
    assert any(o["start"] == 5 and o["end"] == 5 + len(cds) and o["strand"] == "+" for o in found)
    hit = next(o for o in found if o["start"] == 5)
    assert hit["protein"] == "M" + "A" * 40


def test_orfs_searches_the_reverse_strand():
    cds = "ATG" + "GCT" * 40 + "TAA"
    seq = "TTTTT" + A.revcomp(cds) + "GGGGG"
    found = list(O.orfs(seq, min_length=60))
    assert any(o["strand"] == "-" for o in found)


def test_fasta_roundtrip(tmp_path):
    from biomotif.seq.record import Record
    recs = [Record("a", "ACGT" * 30, description="first"), Record("b", "TTTT")]
    path = tmp_path / "x.fa"
    IO.write_fasta(str(path), recs)
    back = IO.read_fasta(str(path))
    assert [r.name for r in back] == ["a", "b"]
    assert back[0].seq == "ACGT" * 30
    assert back[0].description == "first"


def test_fasta_skips_comments():
    text = "; a note\n>one\nACGT\nACGT\n>two\nTTTT\n"
    recs = IO.parse_fasta(text)
    assert len(recs) == 2
    assert recs[0].seq == "ACGTACGT"


def test_record_sub_keeps_offsets():
    from biomotif.seq.record import Record
    r = Record("chr", "AAAACCCCGGGG")
    s = r.sub(4, 8)
    assert s.seq == "CCCC"
    assert s.offset == 4
    assert s.sub(1, 3).offset == 5
