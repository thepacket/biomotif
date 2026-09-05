/* Walkthroughs: the tool taught on a real sequence, one step at a time.

   Each lesson names the sequence it needs and a list of steps. A step does
   one thing — loads a motif, or scans — and says what to look for once it
   has. The text is written for the same reader as the explanation pane, and
   it is data, so a lesson can be checked: the offline one runs in a test,
   with the number of matches each step should find. */

export const LESSONS = [
  {
    id: "operon",
    title: "A bacterial gene, from promoter to terminator",
    intro: "Uses the built-in operon, so it works without a connection. A synthetic sequence with real signals planted " +
      "in it: a promoter, three genes each with its ribosome binding site, and a terminator at the end.",
    seq: { demo: "operon" },
    steps: [
      { title: "Find the promoter",
        motif: "sigma70-promoter",
        text: "A bacterial promoter is two short boxes a fixed distance apart: TTGACA, then 15 to 19 bases of anything, then TATAAT. " +
          "The library's version allows one mismatch in each box, because real promoters rarely match the textbook exactly.",
        look: "One match, starting at position 121. In the table, each named part is reported separately — box35, spacer, box10 — " +
          "so you can see which bases played which role. The verdict says shuffling the sequence never produces this: it is real.",
        expect: 1 },
      { title: "Find where each gene starts being translated",
        motif: "shine-dalgarno",
        text: "Before every bacterial gene is a short signal the ribosome grabs onto, AGGAGG or close to it, a few bases before the ATG.",
        look: "Three matches, one per gene. Chance would give well under one. Note where they sit relative to the promoter: " +
          "all after it, as they should be.",
        expect: 3 },
      { title: "See what a bad pattern looks like",
        motif: "start-codon",
        text: "ATG marks the start of a protein — and any three-base pattern occurs by accident every sixty bases or so.",
        look: "Over a hundred matches, and the verdict says chance alone would give about as many. This is the most important " +
          "thing the pane tells you: a pattern this short finds nothing, however many times it matches.",
        expect: 125 },
      { title: "Put two signals together",
        motif: "(seq (named 'sd \"AGGAGG\") (gap 4 10) (named 'start \"ATG\"))",
        text: "The fix for a short pattern is context. This asks for the ribosome signal, then 4 to 10 bases of anything, then ATG: " +
          "a start codon that a ribosome could actually reach.",
        look: "Three matches — exactly the three real gene starts — and a chance figure of zero. Composition is how a weak " +
          "signal becomes a strong one.",
        expect: 3 },
      { title: "Find the terminator by its shape",
        motif: "rho-independent-terminator",
        text: "Transcription stops at a hairpin: a stretch of bases that folds back and pairs with itself, followed by a run of T. " +
          "This motif checks the pairing, not just the letters.",
        look: "One match near the end, at 1189. The table names the two halves of the stem and the loop between them. " +
          "Try it on the plasmid example afterwards: the T7 terminator is the same shape.",
        expect: 1 },
      { title: "Scan everything",
        scan: true,
        text: "Finally, run every applicable pattern in the library at once.",
        look: "A long list. The pane above the results explains why it is a list of things to look at, not a list of findings: " +
          "most short patterns turn up by accident. The picture draws each place once, however many patterns land on it." },
    ],
  },
  {
    id: "beta-globin",
    title: "The human beta-globin promoter",
    intro: "Fetches the HBB gene from Ensembl with 200 bases of the DNA before it, where the promoter is. " +
      "The textbook promoter is three boxes at known positions; this walk finds each, and shows why the textbook is not enough.",
    seq: { fetch: "ENST00000335295", source: "ensembl", upstream: 200 },
    steps: [
      { title: "Look for the textbook TATA box",
        motif: "tata-box",
        text: "The TATA box is the best-known promoter element, about 30 bases before the start. Its consensus is TATAWAWR, " +
          "where W is A or T and R is A or G. The gene starts at position 201, so the box should be near position 170.",
        look: "One match — at 1368, deep inside the gene, and nowhere near 170. The verdict says chance would give about one anyway. " +
          "The real promoter is missed entirely." },
      { title: "Allow one letter to differ",
        motif: "(fuzzy 1 (iupac \"TATAWAWR\"))",
        text: "fuzzy lets a fixed-width pattern differ in a given number of letters.",
        look: "The first match is at 169: CATAAAAG, 32 bases before the start. That is the real HBB TATA box, and it begins with C. " +
          "A consensus is a summary of many sites, not a rule any one of them must obey. But look at the rest: thirty-odd matches, " +
          "and chance would give about nineteen. Loosening a pattern finds the real site at the cost of many false ones." },
      { title: "Find the CCAAT box",
        motif: "(iupac \"CCAAT\")",
        text: "About 75 bases before the start, a second protein binds at CCAAT.",
        look: "A match at 125, which is 76 before the start — and three others. Five letters occur by accident every kilobase or so, " +
          "and the verdict says as much. Position is what makes this one credible, not the match itself." },
      { title: "Find the CACCC box",
        motif: "(iupac \"CCACACCC\")",
        text: "Further out, at about 90 before the start, is the site for KLF1, the factor that makes this gene a red-cell gene.",
        look: "One match at 108, 93 before the start, and a chance figure near zero: eight specific bases are rare by accident." },
      { title: "Ask for all three in order",
        motif: "(seq (named 'cacc \"CCACACCC\") (gap 5 20) (named 'ccaat \"CCAAT\") (gap 30 50) (named 'tata (fuzzy 1 (iupac \"TATAWAWR\"))))",
        text: "A promoter is not one box but an arrangement. This asks for the three at the spacings the textbook gives, each named.",
        look: "Exactly one match, from 108 to 176, and chance gives zero. The table reports which bases played each part. " +
          "The loose TATA pattern that found thirty sites on its own is now pinned to the one that belongs." },
      { title: "Compare the measured version",
        motif: "tbp-matrix",
        text: "The library also has the TATA-binding protein's site as JASPAR measured it: a weight matrix that scores every " +
          "position rather than accepting or rejecting a letter.",
        look: "Two matches, both inside the gene, each with a score; the promoter's own box is not among them. Even a measured " +
          "matrix is a summary. The lesson of this promoter is that the sequence is the evidence and the consensus is the guide." },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) ?? null;
