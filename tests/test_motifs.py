"""The matching engine: combinators, search, PWMs, PROSITE, restriction."""

import pytest

from biomotif.motifs import combinators as C
from biomotif.motifs.prosite import prosite
from biomotif.motifs.restriction import digest, overhang, parse_site
from biomotif.motifs.search import matches_full, search
from biomotif.seq.record import Record


def spans(matches):
    return [(m.start, m.end, m.strand) for m in matches]


def texts(matches):
    return [m.seq for m in matches]


# ------------------------------------------------------------ literals

def test_literal_matches_both_strands():
    assert spans(search("ACGT", "TTACGTTT")) == [(2, 6, "+")]
    assert spans(search("AAAA", "TTTTGG")) == [(0, 4, "-")]


def test_literal_is_case_insensitive_and_u_tolerant():
    assert len(search("acgt", "TTACGTTT")) == 1
    assert len(search("ACGU", "TTACGTTT")) == 1


def test_palindrome_is_reported_once():
    hits = search("GAATTC", "TTGAATTCTT")
    assert len(hits) == 1
    assert hits[0].strand == "+"


def test_strand_restriction():
    assert search("AAAA", "TTTTGG", strand="+") == []
    assert len(search("AAAA", "TTTTGG", strand="-")) == 1


# --------------------------------------------------------------- IUPAC

def test_iupac():
    assert spans(search(C.Iupac("GCN"), "AAGCTAA", strand="+")) == [(2, 5, "+")]
    assert len(search(C.Iupac("TATAWAWR"), "TATAAAAG", strand="+")) == 1
    assert search(C.Iupac("TATAWAWR"), "TATTTATG", strand="+") == []


def test_iupac_rejects_a_bad_code():
    with pytest.raises(ValueError):
        C.Iupac("ATGZ")


# ------------------------------------------------------------- classes

def test_any_of_and_none_of():
    assert len(search(C.AnyOf("AT"), "ACAT", strand="+")) == 3
    assert len(search(C.NoneOf("AT"), "ACAT", strand="+")) == 1
    assert len(search(C.Any(), "ACGT", strand="+")) == 4


# ------------------------------------------------------ seq, alt, repeat

def test_seq_with_a_gap():
    m = C.Seq(["ATG", C.CharRun(C.Any(), 3, 5), "TAG"])
    assert spans(search(m, "ATGCCCTAG", strand="+")) == [(0, 9, "+")]
    assert spans(search(m, "ATGCCCCCTAG", strand="+")) == [(0, 11, "+")]
    assert search(m, "ATGCCCCCCTAG", strand="+") == [], "gap of 6 is outside 3..5"


def test_seq_backtracks():
    # The greedy gap must give back characters so that the tail can match.
    m = C.Seq(["A", C.CharRun(C.Any(), 0, 10), "TTT"])
    hits = search(m, "ACGTTTGG", strand="+")
    assert hits[0].seq == "ACGTTT"


def test_alt():
    m = C.Alt(["AAA", "GGG"])
    assert len(search(m, "AAAGGG", strand="+")) == 2


def test_repeat_bounds():
    m = C.Repeat(C.Literal("CAG"), 3, 4)
    assert texts(search(m, "CAGCAGCAGCAGCAG", strand="+"))[0] == "CAGCAGCAGCAG"
    assert search(C.Repeat(C.Literal("CAG"), 6), "CAGCAG", strand="+") == []


def test_repeat_is_greedy_then_yields():
    m = C.Seq([C.Repeat(C.Literal("A"), 1, 5), "AG"])
    assert texts(search(m, "AAAAG", strand="+"))[0] == "AAAAG"


def test_charrun_fast_path():
    m = C.CharRun(C.AnyOf("CT"), 4, 8)
    assert texts(search(m, "GGCTCTCTCTGG", strand="+"))[0] == "CTCTCTCT"


# ---------------------------------------------------------------- named

def test_named_captures():
    m = C.Seq([C.Named("a", "ATG"), C.CharRun(C.Any(), 3, 3), C.Named("b", "TAG")])
    hit = search(m, "ATGCCCTAG", strand="+")[0]
    assert hit.bindings["a"][2] == "ATG"
    assert hit.bindings["b"][2] == "TAG"


def test_captures_are_in_forward_coordinates_on_the_reverse_strand():
    m = C.Seq([C.Named("a", "ATG"), C.Named("b", "CCC")])
    hit = search(m, "TTGGGCATTT")[0]           # revcomp contains ATGCCC
    assert hit.strand == "-"
    start, end, text = hit.bindings["a"]
    assert text == "ATG"
    assert 0 <= start < end <= len(hit.record.seq if hit.record else "TTGGGCATTT")


# --------------------------------------------------------------- fuzzy

def test_fuzzy_counts_mismatches():
    hits = search(C.Fuzzy(1, "AGGAGG"), "CCAGGAGGTTAGGTGG", strand="+")
    by_text = {h.seq: h.extra["mismatches"] for h in hits}
    assert by_text["AGGAGG"] == 0
    assert by_text["AGGTGG"] == 1


def test_fuzzy_respects_its_budget():
    assert search(C.Fuzzy(0, "AAAA"), "AAAT", strand="+") == []
    assert len(search(C.Fuzzy(1, "AAAA"), "AAAT", strand="+")) == 1


def test_fuzzy_needs_a_fixed_width():
    with pytest.raises(ValueError):
        search(C.Fuzzy(1, C.Repeat(C.Literal("A"), 1, 4)), "AAAA", strand="+")


def test_edit_allows_indels():
    hits = search(C.Edit(1, "GAATTC"), "GAATC", strand="+")   # one deletion
    assert hits and hits[0].extra["edits"] == 1


# ------------------------------------------------------------- hairpin

def test_hairpin_requires_real_pairing():
    m = C.Hairpin(4, 6, C.CharRun(C.Any(), 4, 4))
    # AAAA cannot pair with GGGG, so this is a run of bases, not a stem-loop.
    assert search(m, "AAAATTTTGGGG", strand="+") == []
    # GGCC is its own reverse complement, so this one is a real hairpin.
    assert len(search(m, "GGCCTTTTGGCC", strand="+")) == 1


def test_hairpin_matches_a_real_stem_loop():
    stem = "GGGCGC"
    from biomotif.seq.alphabet import revcomp
    seq = "AA" + stem + "TTTT" + revcomp(stem) + "AA"
    m = C.Hairpin(4, 8, C.CharRun(C.Any(), 3, 6))
    hit = search(m, seq, strand="+")[0]
    assert hit.bindings["stem5"][2] == stem
    assert hit.bindings["loop"][2] == "TTTT"
    assert hit.bindings["stem3"][2] == revcomp(stem)


def test_hairpin_wobble_pairs():
    # G:U pairs are allowed only when wobble is on.
    seq = "GGGG" + "TTTT" + "TCCC"
    assert search(C.Hairpin(4, 4, C.CharRun(C.Any(), 4, 4)), seq, strand="+") == []
    assert len(search(C.Hairpin(4, 4, C.CharRun(C.Any(), 4, 4), wobble=True), seq, strand="+")) == 1


# ------------------------------------------------------------ anchors

def test_anchors():
    assert len(search(C.Seq([C.AtStart(), "AAA"]), "AAAGGG", strand="+")) == 1
    assert search(C.Seq([C.AtStart(), "GGG"]), "AAAGGG", strand="+") == []
    assert len(search(C.Seq(["GGG", C.AtEnd()]), "AAAGGG", strand="+")) == 1


# --------------------------------------------------------------- PROSITE

def test_prosite_n_glycosylation():
    m = prosite("N-{P}-[ST]-{P}")
    rec = Record("p", "AANGSAAANPSAA", type="protein")
    hits = search(m, rec)
    assert [h.seq for h in hits] == ["NGSA"], "the NPS site is excluded by {P}"


def test_prosite_repeat_counts():
    m = prosite("C-x(2,4)-C")
    rec = Record("p", "CAAC", type="protein")
    assert len(search(m, rec)) == 1
    assert search(m, Record("p", "CAC", type="protein")) == []


def test_prosite_anchors():
    rec = Record("p", "MAAAKDEL", type="protein")
    assert len(search(prosite("K-D-E-L>"), rec)) == 1
    assert search(prosite("<K-D-E-L"), rec) == []
    assert len(search(prosite("<M-A-A"), rec)) == 1


def test_prosite_rejects_nonsense():
    with pytest.raises(ValueError):
        prosite("N-{P-[ST]")


# -------------------------------------------------------------------- PWM

def test_pwm_from_sites():
    sites = ["TATAAA"] * 8 + ["TATAAT"] * 2
    m = C.Pwm.from_sites(sites, threshold=0.9)
    assert m.consensus() == "TATAAA"
    assert m.width == 6
    assert m.relative(m.score("TATAAA")) == pytest.approx(1.0)
    assert m.relative(m.score("GCGCGC")) < 0.2


def test_pwm_scores_positions_differently():
    # Position 1 is invariant, position 6 is not.
    sites = ["TATAAA"] * 9 + ["TATAAT"]
    m = C.Pwm.from_sites(sites)
    assert m.score("TATAAT") > m.score("GATAAA")


def test_pwm_search_reports_a_score():
    m = C.Pwm.from_sites(["TATAAA"] * 10, threshold=0.9)
    hit = search(m, "GGGTATAAAGGG", strand="+")[0]
    assert hit.seq == "TATAAA"
    assert hit.score is not None


def test_pwm_rejects_ragged_input():
    with pytest.raises(ValueError):
        C.Pwm.from_sites(["AAAA", "AAA"])


# ----------------------------------------------------------------- search

def test_matches_full():
    assert matches_full(C.Iupac("ATGN"), "ATGC")
    assert not matches_full(C.Iupac("ATG"), "ATGC")


def test_overlap_control():
    assert len(search("AA", "AAAA", strand="+")) == 3
    assert len(search("AA", "AAAA", strand="+", overlap=False)) == 2


def test_limit():
    assert len(search("A", "AAAAA", strand="+", limit=2)) == 2


def test_record_offsets_flow_into_matches():
    r = Record("chr", "TTTTGAATTCTTTT")
    sub = r.sub(2, 12)
    hit = search("GAATTC", sub)[0]
    assert hit.start == 2, "relative to the sub-record"
    assert hit.abs_start == 4, "relative to the parent"


# ------------------------------------------------------------ restriction

def test_parse_site_overhangs():
    assert overhang(parse_site("G^AATTC")) == "5' overhang of 4"
    assert overhang(parse_site("GGTAC^C")) == "3' overhang of 4"
    assert overhang(parse_site("CCC^GGG")) == "blunt"
    assert overhang(parse_site("GGTCTC(1/5)")) == "5' overhang of 4"
    assert overhang(parse_site("GTGCAG(16/14)")) == "3' overhang of 2"


def test_parse_site_needs_a_cut_mark():
    with pytest.raises(ValueError):
        parse_site("GAATTC")


def test_digest_linear():
    seq = "AAAA" + "GAATTC" + "TTTT" + "GAATTC" + "CCCC"
    d = digest(seq, [("EcoRI", parse_site("G^AATTC"))])
    assert d["cuts"] == [5, 15]
    assert [f[2] for f in d["fragments"]] == [5, 10, 9]


def test_digest_circular_wraps():
    seq = "AAAA" + "GAATTC" + "TTTTTTTTTT" + "GAATTC" + "CCCC"
    d = digest(seq, [("EcoRI", parse_site("G^AATTC"))], circular=True)
    assert sum(f[2] for f in d["fragments"]) == len(seq)
    assert len(d["fragments"]) == 2


def test_digest_type_iis_cuts_outside_the_site():
    seq = "AAAAA" + "GGTCTC" + "ACGTACGTACGT"
    d = digest(seq, [("BsaI", parse_site("GGTCTC(1/5)"))])
    assert d["sites"][0]["cut_top"] == 5 + 6 + 1


def test_digest_finds_non_palindromic_sites_on_both_strands():
    from biomotif.seq.alphabet import revcomp
    seq = "AAAAA" + revcomp("GGTCTC") + "AAAAAAAAAA"
    d = digest(seq, [("BsaI", parse_site("GGTCTC(1/5)"))])
    assert d["sites"] and d["sites"][0]["strand"] == "-"
