"""The motif library: every entry loads, describes itself and matches its example."""

import pytest

from motif.interpreter import make_interpreter
from motif.motifs.registry import REGISTRY, entries
from motif.motifs.restriction import parse_site
from motif.motifs.search import search
from motif.seq.alphabet import revcomp
from motif.seq.record import Record


# Loaded at import time so that parametrised tests can enumerate the registry.
_INTERP = make_interpreter()
_INTERP.eval_source("(use-library 'all)")


@pytest.fixture(scope="module")
def loaded():
    return _INTERP


def test_the_library_is_substantial(loaded):
    assert len(REGISTRY) > 400
    assert len({e.category for e in REGISTRY.values()}) > 40


def test_every_library_file_loads(loaded):
    sources = {e.source for e in REGISTRY.values() if e.source}
    assert sources >= {"prokaryote.mtf", "eukaryote.mtf", "plant.mtf",
                       "rna.mtf", "protein.mtf", "tags.mtf", "restriction.mtf"}


def test_every_entry_has_a_docstring(loaded):
    missing = [e.name for e in REGISTRY.values() if not e.doc.strip()]
    assert missing == []


def test_every_entry_describes_itself(loaded):
    for e in REGISTRY.values():
        assert isinstance(e.matcher.describe(), str)
        assert e.matcher.describe()


def test_every_entry_has_a_known_alphabet(loaded):
    for e in REGISTRY.values():
        assert e.alphabet in ("dna", "rna", "protein"), e.name


@pytest.mark.parametrize("name", sorted(n for n, e in REGISTRY.items() if e.example))
def test_examples_match_their_motif(loaded, name):
    """Every :example given in the library must be found by its own motif."""
    e = REGISTRY[name]
    kind = "protein" if e.alphabet == "protein" else "dna"
    rec = Record("example", e.example, type=kind)
    assert search(e.matcher, rec), f"{name}: {e.example} does not match {e.matcher.describe()}"


def test_every_entry_runs_without_error(loaded):
    """A motif that raises on a plain sequence is a broken motif."""
    dna = Record("d", "ACGTACGTTTAGGGCACGTGAATTCATGGCTAAGGAGGTATAATTTGACA" * 4)
    protein = Record("p", "MKWVTFISLLLLNGSAYSRGVFRRDTHKSEIAHRFKDLGEENFKDEVDKDEL" * 2,
                     type="protein")
    for e in REGISTRY.values():
        target = protein if e.alphabet == "protein" else dna
        search(e.matcher, target)   # must not raise


# ------------------------------------------------ restriction enzyme sanity

def test_restriction_sites_are_consistent(loaded):
    for e in entries(category="restriction"):
        info = e.meta
        assert info["site"], e.name
        assert 0 <= info["cut_top"] <= len(info["site"]) + 40, e.name


def test_palindromic_enzymes_have_symmetric_cuts(loaded):
    for e in entries(category="restriction"):
        info = e.meta
        if info["kind"] != "II" or info["site"] != revcomp(info["site"]):
            continue
        assert info["cut_top"] + info["cut_bottom"] == len(info["site"]), e.name


def test_well_known_enzyme_sites(loaded):
    expected = {"EcoRI": "GAATTC", "BamHI": "GGATCC", "HindIII": "AAGCTT",
                "NotI": "GCGGCCGC", "XhoI": "CTCGAG", "KpnI": "GGTACC",
                "SmaI": "CCCGGG", "PstI": "CTGCAG", "SalI": "GTCGAC",
                "NdeI": "CATATG", "NcoI": "CCATGG", "SpeI": "ACTAGT"}
    for name, site in expected.items():
        assert REGISTRY[name].meta["site"] == site


def test_enzymes_number_in_the_dozens(loaded):
    assert len(entries(category="restriction")) > 100


# ------------------------------------------------------ biological checks

def test_shine_dalgarno_finds_a_planted_rbs(loaded):
    seq = "CCCC" + "AAGGAGG" + "TATACAT" + "ATG" + "GCTGCT"
    hits = search(REGISTRY["ribosome-binding-site"].matcher, Record("s", seq), strand="+")
    assert hits and hits[0].bindings["start"][2] == "ATG"


def test_sigma70_promoter_needs_the_right_spacing(loaded):
    m = REGISTRY["sigma70-promoter"].matcher
    good = "TTGACA" + "N" * 0 + "ACGTACGTACGTACGTA" + "TATAAT"
    bad = "TTGACA" + "ACGT" + "TATAAT"
    assert search(m, Record("s", good), strand="+")
    assert not search(m, Record("s", bad), strand="+")


def test_loxp_is_the_canonical_34_mer(loaded):
    site = REGISTRY["loxp"].example
    assert len(site) == 34
    assert site[:13] == revcomp(site[-13:]), "the arms are inverted repeats"


def test_frt_is_34_bases(loaded):
    m = REGISTRY["frt"].matcher
    assert len(search(m, Record("s", "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC"))) == 1


def test_g_quadruplex_needs_four_g_tracts(loaded):
    m = REGISTRY["g-quadruplex"].matcher
    assert search(m, Record("s", "GGGTTAGGGTTAGGGTTAGGG"), strand="+")
    assert not search(m, Record("s", "GGGTTAGGGTTAGGG"), strand="+")


def test_kozak_needs_the_purine_and_the_g(loaded):
    m = REGISTRY["kozak"].matcher
    assert search(m, Record("s", "GCCACCATGG"), strand="+")
    assert not search(m, Record("s", "GCCCCCATGG"), strand="+"), "C at -3 is not a purine"
    assert not search(m, Record("s", "GCCACCATGA"), strand="+"), "A at +4 is not G"


def test_n_glycosylation_excludes_proline(loaded):
    m = REGISTRY["n-glycosylation"].matcher
    assert search(m, Record("p", "AANGSAA", type="protein"))
    assert not search(m, Record("p", "AANPSAA", type="protein"))


def test_pts1_must_be_at_the_c_terminus(loaded):
    m = REGISTRY["peroxisome-pts1"].matcher
    assert search(m, Record("p", "MAAAASKL", type="protein"))
    assert not search(m, Record("p", "MSKLAAAA", type="protein"))


def test_iron_responsive_element_needs_a_real_stem(loaded):
    m = REGISTRY["iron-responsive-element"].matcher
    from motif.seq.alphabet import revcomp as rc
    stem = "GGGGC"
    assert search(m, Record("s", stem + "CAGTGT" + rc(stem)), strand="+")
    assert not search(m, Record("s", "AAAAA" + "CAGTGT" + "AAAAA"), strand="+")


def test_rna_motifs_match_dna_spelling(loaded):
    m = REGISTRY["au-rich-element"].matcher
    assert search(m, Record("s", "CCAUUUACC"), strand="+")
    assert search(m, Record("s", "CCATTTACC"), strand="+")


def test_templates_are_flagged(loaded):
    assert not REGISTRY["umi-8"].scan
    assert not REGISTRY["pam-spcas9"].scan
    assert REGISTRY["loxp"].scan
    assert REGISTRY["tata-box"].scan


def test_scan_skips_templates(loaded):
    """A scan must not drown in motifs that match everywhere."""
    rec = Record("s", "ACGTACGTTTAGGGCACGTGAATTCATGGCTAAGGAGG" * 6)
    hits = loaded.eval_source(f'(scan (make-record "s" "{rec.seq}"))')
    all_hits = loaded.eval_source(f'(scan (make-record "s" "{rec.seq}") :all #t)')
    assert len(hits) < len(all_hits) / 3


def test_categories_are_lowercase_words(loaded):
    for e in REGISTRY.values():
        assert e.category == e.category.lower()
        assert " " not in e.category
