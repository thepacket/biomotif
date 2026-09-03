"""Build the example data. Every sequence is synthetic and reproducible:
random background at a chosen GC content, with real consensus elements planted
at known positions. Re-run with `python tools/make_data.py` to regenerate."""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from biomotif.seq.alphabet import revcomp  # noqa: E402
from biomotif.seq.ops import translate  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(DATA, exist_ok=True)


def bg(rng, n, gc=0.5):
    return "".join(rng.choices("ACGT", [(1 - gc) / 2, gc / 2, gc / 2, (1 - gc) / 2], k=n))


def orf(rng, aa, start="ATG", stop="TAA"):
    """A coding sequence of `aa` codons with no internal stop."""
    codons = [c for c in (a + b + d for a in "ACGT" for b in "ACGT" for d in "ACGT")
              if c not in ("TAA", "TAG", "TGA")]
    return start + "".join(rng.choices(codons, k=aa - 2)) + stop


def write(name, records, notes=""):
    path = os.path.join(DATA, name)
    with open(path, "w") as f:
        if notes:
            f.write("".join(f"; {line}\n" for line in notes.strip().splitlines()))
        for header, seq in records:
            f.write(f">{header}\n")
            for i in range(0, len(seq), 70):
                f.write(seq[i:i + 70] + "\n")
    print(f"{path}  {len(records)} records")


# --------------------------------------------------------------- 1. operon
rng = random.Random(11)
parts = []
seq = bg(rng, 120, 0.45)
p35, p10 = "TTGACA", "TATAAT"
seq += p35 + bg(rng, 17, 0.45) + p10 + bg(rng, 7, 0.45)
gene_starts = []
for length in (95, 140, 70):
    seq += "AAGGAGG" + bg(rng, 7, 0.45)
    gene_starts.append(len(seq))
    seq += orf(rng, length) + bg(rng, 25, 0.45)
stem = "GGGCGCGCCAGC"
seq += stem + "TTCG" + revcomp(stem) + "TTTTTTTT" + bg(rng, 60, 0.4)
write("operon.fa", [("synthetic_operon promoter+3genes+terminator", seq)],
      "Synthetic bacterial operon. Sigma-70 promoter at 120, Shine-Dalgarno\n"
      "before each of three genes, intrinsic terminator near the 3' end.")

# ------------------------------------------------- 2. eukaryotic promoters
rng = random.Random(23)
recs = []
tata_variants = ["TATAAAAG", "TATAAATG", "TATATAAG", "TATAAAAA", "TATTTATG", "TATAAATA"]
for i in range(1, 13):
    has_tata = i <= 8
    s = bg(rng, 180, 0.42)
    if i % 3 == 0:
        s += "CCAAT" + bg(rng, 40, 0.5)
    if i % 2 == 0:
        s += "GGGGCGGGGC" + bg(rng, 25, 0.6)
    if has_tata:
        s += rng.choice(tata_variants) + bg(rng, 25, 0.45)
    s += "TCAGTCT"                      # initiator
    s += bg(rng, 30, 0.45)
    s += "GCCACC" + "ATG" + "G"         # Kozak + start
    s += orf(rng, 60)[3:]
    recs.append((f"PROM{i:02d} {'TATA-containing' if has_tata else 'TATA-less'} synthetic promoter", s))
write("promoters.fa", recs,
      "Twelve synthetic core promoters. The first eight carry a TATA box,\n"
      "the last four are TATA-less. All carry an initiator and a Kozak ATG.")

# --------------------------------------------------------------- 3. plasmid
rng = random.Random(58)
mcs = ("GAATTC" "GCGGCCGC" "TCTAGA" "GGTACC" "CTCGAG" "GGATCC" "AAGCTT" "CTGCAG")
his = "CATCACCATCACCATCAC"
tev = "GAAAACCTGTATTTTCAGGGC"
plasmid = (bg(rng, 300, 0.52)
           + "TAATACGACTCACTATAG"          # T7 promoter
           + bg(rng, 12, 0.5)
           + "AAGGAGGATATACAT"             # RBS
           + "ATG" + his + tev
           + orf(rng, 210)[3:-3]
           + "TAA"
           + mcs
           + bg(rng, 250, 0.5)
           + "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG"   # T7 terminator
           + bg(rng, 900, 0.55)
           + "ATAACTTCGTATAATGTATGCTATACGAAGTTAT"                  # loxP
           + bg(rng, 400, 0.5))
write("plasmid.fa", [("pSYN1 synthetic_expression_vector circular", plasmid)],
      "Synthetic expression plasmid: T7 promoter, RBS, His-TEV-ORF, a multiple\n"
      "cloning site, T7 terminator and a loxP site. Treat it as circular.")

# ---------------------------------------------------------------- 4. 3'UTRs
rng = random.Random(41)
recs = []
for i, (name, adds) in enumerate([
    ("TNF_like", ["TTATTTATTTATTATTTATT", "AATAAA"]),
    ("FTH_like", ["GGGGCCAGTGTGCCCC", "AATAAA"]),
    ("HIST_like", ["GGCTCTTTTCAGAGCC"]),
    ("MYC_like", ["CTACCTC", "ATTTA", "AATAAA"]),
    ("QUIET_like", ["AATAAA"]),
], 1):
    s = bg(rng, 120, 0.38)
    for a in adds:
        s += a + bg(rng, rng.randint(40, 90), 0.38)
    s += "GGACT" + bg(rng, 30, 0.38)
    recs.append((f"{name} synthetic 3'UTR", s))
write("utr3.fa", recs,
      "Synthetic 3' UTRs carrying an AU-rich element, an iron responsive element,\n"
      "a histone stem-loop, a let-7 site and poly(A) signals.")

# -------------------------------------------------------------- 5. proteins
proteins = [
    ("SECRETED01 signal peptide + N-glycosylation + KDEL",
     "MKWVTFISLLLLFSSAYSRGVFRRDTHKSEIAHRFKDLGEENFKALVLIAFAQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLTSSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALAKDEL"),
    ("KINASE01 P-loop + HRD + DFG",
     "MSGKEQLIYRVGDLLGEGSFGKVYKARHKETGQIVAIKIIDKTQLNPSSLQKLFREVRIMKMLNHPNIVKLFEVIETEKTLYLVMEYASGGEVFDYLVAHGRMKEKEARSKFRQIVSAVQYCHQKFIVHRDLKAENLLLDADMNIKIADFGFSNEFTVGGKLDTFCGSPPYAAPELFQGKKYDGPEVDVWSLGVILYTLVSGSLPFDGQNLKELRERVLRGKYRIPFYMSTDCENLLKRFLVLNPIKRGTLEQIMKDRWMNVGHEEEELKPYVEPLPDYKDPRRTELMVSMGYTREEIQDSLVGQRYNEVMATYLLLGYKSSELEGDTITLKPRPSADLTNSSTSSPHHKVQRSVSANQKQRRFSDQAGPAIPTSNSYSKKTQSNNAENKRPEEKKRSTSTGEKNGKNSGKKGSSLFSKFTSKFVRRNLSFRFARRSNSDDGVQPAKLGSVSQPAQKAGNKENAHLQ"),
    ("TAGGED01 His-TEV-FLAG-protein-PTS1",
     "MGSSHHHHHHSSGLVPRGSHMASMTGGQQMGRGSENLYFQGDYKDDDDKMANQVSKSAWAVLNGSTPLERGDSVKAAQKLLEEHGIKVDVCGPCRGDLTAEQKAALEDLIRSHGVKTFVSSTNKELSGSHHWQAGRVENLYFQSGSGSAKL"),
    ("NUCLEAR01 bipartite NLS + zinc fingers",
     "MDSREPKRKRSPSVEDSKKRKAETSVPSAVQSNGERRPFQCRICMRNFSRSDHLTTHIRTHTGEKPFACDICGRKFARSDERKRHTKIHLRQKDKKAEKSVPCPHCDRCFSRSDHLTTHIRTHTGEKPYKCPECGKSFSQSSNLQKHQRVHTGEKPYECGECGKAFSHSSDLIKHQRTHTGEKPYKCEECGKAFNRSSNLTTHKIIHTGEKPYKCEECGKAFNQSSTLTTHKIIHTGEKPYKCEECGKAFNQSSNLTTHKIIHSGEKKA"),
    ("MEMBRANE01 CAAX + palmitoylation",
     "MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHQYREQIKRVKDSDDVPMVLVGNKCDLAARTVESRQAQDLARSYGIPYIETSAKTRQGVEDAFYTLVREIRQHKLRKLNPPDESGPGCMSCKCVLS"),
]
write("proteins.fa", proteins,
      "Protein sequences. SECRETED01 is bovine serum albumin with a KDEL added;\n"
      "KINASE01 and NUCLEAR01 and MEMBRANE01 are drawn from real kinase, zinc finger\n"
      "and Ras sequences; TAGGED01 is a synthetic construct with common tags.")

# --------------------------------------------------------- 6. plant promoters
rng = random.Random(53)
recs = []
elements = {
    "RD29A_like": ["TACCGACAT", "CACGTGGC", "TACCGACAT", "CACGTG"],
    "PR1_like": ["TTGACC", "TGACG", "TTGACT"],
    "RBCS_like": ["CCACGTGGCC", "GATAAG", "GGGCGG"],
    "CAB_like": ["AAAATATCT", "CACGTG", "GATAAG"],
    "AMY_like": ["TAACAAA", "CCTTTTG", "TATCCCA"],
}
for name, els in elements.items():
    s = bg(rng, 100, 0.34)
    for e in els:
        s += e + bg(rng, rng.randint(30, 80), 0.34)
    s += "TATATAA" + bg(rng, 28, 0.34) + "AACAATGGCT"
    recs.append((f"{name} synthetic plant promoter", s))
write("plant_promoters.fa", recs,
      "Synthetic plant promoters carrying DRE/CRT, ABRE, W-box, G-box, I-box,\n"
      "evening element and gibberellin response elements.")

# ------------------------------------------------------- 7. TATA site table
rng = random.Random(67)
sites = ["TATAAAAG", "TATAAATG", "TATATAAG", "TATAAAAA", "TATTTATG", "TATAAATA",
         "TATAAAAG", "TATAAAAG", "TATAAATG", "TATATATA", "TATAAAAG", "TACAAAAG",
         "TATAAAAG", "TATAAAAT", "TATAAAAG", "TATAAAAG", "TATTTAAG", "TATAAAAG",
         "TATAAAAG", "TATAAAAA", "TATAAATG", "TATAAAAG", "TAAAAAAG", "TATAAAAG"]
with open(os.path.join(DATA, "tata_sites.txt"), "w") as f:
    f.write("; 24 aligned 8-mer TATA boxes, for building a position weight matrix.\n")
    f.write("; Synthetic, sampled around the Bucher consensus TATAWAWR.\n")
    for s in sites:
        f.write(s + "\n")
print(f"{os.path.join(DATA, 'tata_sites.txt')}  {len(sites)} sites")

# -------------------------------------------------------- 8. spliced gene
# Build the coding sequence first so that the spliced product is a real protein,
# then interrupt it with introns the way a real gene does: at arbitrary points,
# not only at codon boundaries.
rng = random.Random(71)
cds = "ATGG" + orf(rng, 190)[4:]                      # 190 codons, second codon starts G
                                                      # so the Kozak context is complete
utr5 = bg(rng, 60, 0.45) + "TATAAAAG" + bg(rng, 26, 0.45) + "GCCACC"
utr3 = "AATAAA" + bg(rng, 18, 0.4) + "TGTGTTTT" + bg(rng, 40, 0.4)

def donor_cut(cds, near):
    """Slide to the nearest point where the exon already ends in the MAG donor
    consensus, so no base has to be changed and the reading frame is untouched."""
    for d in range(0, 40):
        for cut in (near + d, near - d):
            if 6 < cut < len(cds) - 6 and cds[cut - 2:cut] == "AG" and cds[cut - 3] in "AC":
                return cut
    return near


cuts = [donor_cut(cds, n) for n in (130, 270, 420)]    # where introns interrupt the CDS
seq = utr5
exon_spans, intron_spans = [], []
prev = 0
for k, cut in enumerate(cuts + [len(cds)]):
    exon = cds[prev:cut]
    exon_spans.append((len(seq), len(seq) + len(exon)))
    seq += exon
    prev = cut
    if k < len(cuts):
        intron = "GTAAGT" + bg(rng, rng.randint(200, 400), 0.38) + "CTGAC" \
                 + "TTTTCTTTTCCTTTTCTTT" + "CAG"
        intron_spans.append((len(seq), len(seq) + len(intron)))
        seq += intron
seq += utr3

spliced = "".join(seq[a:b] for a, b in exon_spans)
protein = translate(spliced, to_stop=True)   # spliced holds the exons, which are the CDS
write("gene.fa", [("SYNGENE1 four exons, three GT-AG introns", seq)],
      f"Synthetic eukaryotic gene: TATA promoter, four exons, three GT-AG introns\n"
      f"with branch points and polypyrimidine tracts, and a poly(A) site.\n"
      f"Spliced and translated it gives a {len(protein)} residue protein.")
