/* Example requests for the assistant. Each is a question someone would
   actually ask at a bench, and between them they exercise every part of the
   motif language: consensus and ambiguity, gaps and spacing, approximate
   matching, real base pairing, PROSITE syntax, and composite elements whose
   parts have to be reported separately. */

export const PROMPT_GROUPS = [
  {
    group: "Bacterial gene expression",
    alphabet: "dna",
    prompts: [
      "A sigma-70 promoter with the -35 and -10 boxes 17 bases apart, allowing one mismatch in each",
      "A Shine-Dalgarno sequence 6 to 10 bases before a start codon",
      "An intrinsic terminator: a GC-rich hairpin followed by at least six uridines",
      "A sigma-54 promoter, the -24 and -12 elements with their fixed spacing",
      "An extended -10 promoter carrying the TG motif and no -35 box",
      "A LexA box, the SOS operator, allowing two mismatches",
      "A CRP site: two TGTGA half-sites six bases apart, capturing each one",
      "A lac operator allowing three mismatches from the O1 sequence",
      "A start codon that may be ATG, GTG or TTG with a strong ribosome binding site in front of it",
      "A promoter and a terminator within 400 bases of each other, so I can spot a short operon",
    ],
  },
  {
    group: "Eukaryotic promoters",
    alphabet: "dna",
    prompts: [
      "A TATA box 25 to 35 bases upstream of an initiator element",
      "A CCAAT box and a GC box both within 120 bases of a TATA box",
      "A p53 response element: two decameric half-sites with up to 13 bases between them",
      "An estrogen response element, two AGGTCA half-sites inverted with a three base spacer",
      "A heat shock element, three inverted nGAAn units in a row",
      "An NF-kB site allowing one mismatch",
      "A GATA site within 50 bases of an E-box, capturing both",
      "A CTCF core motif on either strand, since its orientation decides which loops form",
      "A retinoic acid element: two AGGTCA half-sites as a direct repeat five bases apart",
      "A composite of a CACCC box, a CCAAT box and a TATA box in that order within 120 bases",
    ],
  },
  {
    group: "Translation and reading frames",
    alphabet: "dna",
    prompts: [
      "A Kozak context with a purine at -3 and a G at +4",
      "An upstream open reading frame: a start codon, up to 60 codons, then a stop",
      "A slippery heptamer for a ribosomal frameshift followed by a hairpin within 10 bases",
      "Any codon that could encode the peptide HEXXH, so I can find zinc metalloproteases in DNA",
      "A stop codon immediately followed by a second in-frame stop, a tandem stop",
    ],
  },
  {
    group: "Splicing and the 3' end",
    alphabet: "dna",
    prompts: [
      "A 5' splice site: an exon ending in AG followed by GTAAGT",
      "A 3' splice site: a polypyrimidine tract of at least 10 pyrimidines then AG",
      "A branch point adenosine 18 to 40 bases before a 3' splice site",
      "A complete GT-AG intron between 80 and 2000 bases long",
      "A poly(A) signal followed by a GU-rich downstream element within 30 bases",
      "A purine-rich exonic splicing enhancer",
      "A minor spliceosome U12-type donor site",
    ],
  },
  {
    group: "RNA structure and stability",
    alphabet: "rna",
    prompts: [
      "A hairpin with a stem of at least 8 base pairs and a loop of 4 to 8, allowing wobble pairs",
      "A GNRA tetraloop closed by a stem of at least 5 base pairs",
      "An iron responsive element: a CAGUGH loop sitting on a stem that really pairs",
      "An AU-rich element with at least three overlapping AUUUA pentamers",
      "An RNA G-quadruplex, four G-tracts separated by short loops",
      "A histone 3' stem-loop",
      "A Pumilio response element",
      "A let-7 seed match in a U-rich context",
      "A DRACH methylation site with a GGACU core",
      "A stem-loop whose loop is exactly seven bases, the size that can kiss another loop",
    ],
  },
  {
    group: "Protein motifs",
    alphabet: "protein",
    prompts: [
      "An N-glycosylation sequon that is not followed by proline",
      "A classical bipartite nuclear localisation signal",
      "A C2H2 zinc finger, the two cysteines and two histidines that hold the zinc",
      "A leucine zipper: leucines every seventh residue over four heptads",
      "A CAAX prenylation box at the very C-terminus",
      "An EF-hand calcium binding loop",
      "A P-loop nucleotide binding motif",
      "A furin cleavage site",
      "A TEV protease site followed by a glycine or a serine",
      "A class I PDZ-binding motif at the extreme C-terminus",
      "A KDEL or HDEL retention signal at the C-terminus",
      "A peroxisomal targeting signal, an SKL-like tripeptide at the C-terminus",
      "The HRD and DFG motifs of a protein kinase, within 40 residues of each other",
      "A leucine-rich nuclear export signal",
      "A PEST region: a proline, glutamate, serine and threonine rich stretch flanked by basic residues",
    ],
  },
  {
    group: "Cloning, tags and CRISPR",
    alphabet: "dna",
    prompts: [
      "A SpCas9 target: 20 bases starting with G followed by an NGG PAM, capturing the guide",
      "A Cas12a target: a TTTV PAM followed by a 23 base protospacer",
      "A Golden Gate cassette: a BsaI site, one spacer base, then the four base overhang",
      "A His tag followed by a TEV site within 30 residues",
      "A loxP site allowing two mismatches",
      "An insert flanked by EcoRI and HindIII with neither site occurring inside it",
      "An Illumina TruSeq adapter read-through at the 3' end of a read",
      "A T7 promoter followed by a ribosome binding site within 40 bases",
      "Any BsaI or BsmBI site, so I can check a part is domesticated for Golden Gate",
      "A pair of primers-length windows 100 to 400 bases apart, both 40 to 60 percent GC",
    ],
  },
  {
    group: "Repeats and chromosome features",
    alphabet: "dna",
    prompts: [
      "A CAG trinucleotide repeat of at least 10 copies",
      "A telomeric tract, at least three TTAGGG repeats in a row",
      "A CA dinucleotide microsatellite of at least eight copies",
      "A DNA G-quadruplex with loops of one to seven bases",
      "A 12-RSS: the heptamer, exactly 12 spacer bases, then the nonamer",
      "An alternating purine-pyrimidine tract long enough to flip to Z-DNA",
      "A Chi site, the RecBCD recombination hotspot",
    ],
  },
];

export const PROMPT_COUNT = PROMPT_GROUPS.reduce((n, g) => n + g.prompts.length, 0);
