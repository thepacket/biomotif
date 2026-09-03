/* Example requests for the assistant.

   These are deliberately things the library does NOT already contain. A single
   named motif needs no assistant — you click it in the list on the left. What
   needs writing is the composition: two elements in a spatial relationship, a
   library motif with an extra constraint, or a pattern specific to one lab's
   constructs. When a request does happen to match a library entry, the reply
   says so and offers it, which is the point of that line rather than its
   normal outcome.

   Every one is expressible in the language as it stands. There is no negation
   over a region and no arithmetic on a window, so nothing here asks for
   "containing no X" or "at least 40 percent GC". */

export const PROMPT_GROUPS = [
  {
    group: "Bacterial gene expression",
    alphabet: "dna",
    prompts: [
      "A sigma-70 promoter whose spacer is exactly 16 bases, one shorter than optimal",
      "A Shine-Dalgarno followed within 12 bases by GTG or TTG rather than ATG",
      "A CRP site 60 to 100 bases upstream of a -35 box, capturing both",
      "A LexA box immediately followed by a -10 box, an operator overlapping its promoter",
      "A ribosome binding site with an unusually long spacer of 12 to 18 bases",
      "Two -10 boxes within 40 bases of each other, a possible tandem promoter",
      "A rho-independent terminator whose stem is at least 9 pairs and whose U-tail is 8 or longer",
      "A promoter followed by a terminator between 100 and 400 bases later",
      "A TTGACA box with two mismatches followed 15 to 21 bases later by a perfect TATAAT",
      "A Shine-Dalgarno and a start codon with exactly seven bases between them",
    ],
  },
  {
    group: "Eukaryotic promoters",
    alphabet: "dna",
    prompts: [
      "A CCAAT box 40 to 90 bases upstream of a TATA box, capturing each",
      "A TATA box with a CACCC box within 60 bases on either side",
      "Three GC boxes within 200 bases, the signature of a housekeeping promoter",
      "Two p53 half-sites with no spacer at all, the tightest arrangement",
      "An E-box and a GATA site 10 to 40 bases apart, in that order",
      "A TATA box that fails the strict consensus but matches it with one mismatch",
      "Two AGGTCA half-sites as a direct repeat 1 to 5 bases apart, any nuclear receptor",
      "An NF-kB site within 100 bases of an AP-1 site",
      "An initiator element followed 28 to 32 bases later by a downstream promoter element",
      "A CCAAT box that occurs twice within 120 bases",
    ],
  },
  {
    group: "Translation and reading frames",
    alphabet: "dna",
    prompts: [
      "A Kozak context whose -3 position is a pyrimidine, so a weak start",
      "Any DNA that could encode the peptide HEXXH, written out as codon alternatives",
      "Any DNA that could encode WCGPC, the thioredoxin active site",
      "A start codon within 30 bases of a second start codon in the same frame",
      "Two stop codons in a row, in frame",
    ],
  },
  {
    group: "Splicing and the 3' end",
    alphabet: "dna",
    prompts: [
      "A 5' splice site whose exon side is CAG and whose intron side allows one mismatch",
      "A branch point 20 to 45 bases before a polypyrimidine tract of at least 12",
      "A poly(A) signal with a second poly(A) signal within 60 bases, a tandem site",
      "An intron shorter than 100 bases, a minimal one",
      "A polypyrimidine tract of at least 15 bases that is purely C and T",
      "A 3' splice site whose first exon base is a G",
    ],
  },
  {
    group: "RNA structure and stability",
    alphabet: "rna",
    prompts: [
      "A hairpin with a stem of 6 to 10 allowing one mismatched pair, and wobble pairs",
      "Two hairpins within 50 bases of each other",
      "An AU-rich element with exactly two overlapping AUUUA pentamers",
      "A G-quadruplex whose loops are all one or two bases, a tight one",
      "A stem-loop followed within 20 bases by a poly(A) signal",
      "A DRACH methylation site sitting inside the loop of a hairpin",
      "A let-7 seed match within 30 bases of an AU-rich element",
      "A CAGUGH loop on a stem of exactly five, allowing one mismatch in the stem",
      "A tetraloop of exactly four bases closed by a stem of at least six",
    ],
  },
  {
    group: "Protein motifs",
    alphabet: "protein",
    prompts: [
      "An N-glycosylation sequon within 20 residues of a cysteine pair",
      "A zinc finger followed by another within 30 residues, a tandem array",
      "A leucine zipper immediately preceded by a basic region, so a bZIP",
      "A CAAX box at the C-terminus whose last residue is serine or methionine, so farnesylated",
      "A TEV site followed within 12 residues by a polyhistidine tag",
      "Two EF-hand loops within 60 residues, a calcium binding pair",
      "An N-glycosylation sequon in the 30 residues before a KDEL",
      "A PDZ-binding motif preceded by a proline-rich stretch",
      "A furin site within 10 residues of a signal peptidase cleavage site",
      "Four consecutive residues that are all acidic, a charged patch",
      "A run of at least six glutamines, a polyQ tract",
      "A stretch where every third residue is a proline, a polyproline helix",
      "An RGD motif within 15 residues of a cysteine",
      "Two histidines exactly two residues apart followed by a glutamate",
    ],
  },
  {
    group: "Cloning, tags and CRISPR",
    alphabet: "dna",
    prompts: [
      "A SpCas9 target whose protospacer starts with GG, for stronger U6 transcription",
      "Two SpCas9 targets 20 to 60 bases apart, for a paired nickase",
      "A BsaI site followed within eight bases by a second BsaI site",
      "A His tag followed within 40 residues by a TEV site and then a FLAG tag",
      "A loxP site within 200 bases of a second loxP site",
      "A T7 promoter, then 10 to 40 bases, then a strong ribosome binding site and an ATG",
      "An EcoRI site and a HindIII site 200 to 800 bases apart, a cloneable insert",
      "A Golden Gate cassette whose overhang is exactly AATG, the standard coding start",
      "A Cas12a PAM followed by a protospacer that ends in a BsaI site",
      "An Illumina adapter preceded by a poly-A tail of at least 10 bases",
    ],
  },
  {
    group: "Repeats and structure",
    alphabet: "dna",
    prompts: [
      "A CAG repeat of at least 20 copies, past the pathogenic threshold",
      "A telomeric tract of at least five TTAGGG repeats",
      "A CA microsatellite of 10 to 30 copies",
      "Two Chi sites within 100 bases of each other",
      "A 12-RSS and a 23-RSS within 500 bases, a recombining pair",
      "An alternating CG tract of at least eight dinucleotides",
      "A perfect inverted repeat of at least eight bases with a spacer of up to 20",
      "A run of at least 12 adenines followed within 30 bases by a run of at least 12 thymines",
    ],
  },
];

export const PROMPT_COUNT = PROMPT_GROUPS.reduce((n, g) => n + g.prompts.length, 0);
