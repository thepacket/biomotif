/* Words the explanation pane uses that its reader may not know.

   The pane is written for someone who does not know the biology, and it
   still has to say "strand" and "consensus", because those are the words.
   Each gets a definition on hover or on keyboard focus, at its first
   appearance in a passage, so a reader who knows them is not nagged and a
   reader who does not is never more than a glance from an answer. */

const d = (pattern, def) => ({ re: new RegExp(`\\b(${pattern})\\b`, "i"), def });

export const TERMS = [
  d("strands?", "DNA is two strands wound together, running in opposite directions. A pattern on one strand appears reversed and complemented on the other, which is why both are searched."),
  d("opposite strand|reverse complement", "The other strand of the DNA, read in its own direction. Its letters are the complements — A for T, G for C — of the first strand's, in reverse order."),
  d("consensus", "The most common letter at each position across many examples of a site, written as a single sequence. A real site usually differs from it in a letter or two."),
  d("ambiguity codes?|IUPAC", "One-letter codes for a choice of bases: W is A or T, R is A or G, Y is C or T, N is any base."),
  d("(?:position )?weight matrix|matrix", "A table giving a score for each base at each position of a site, built from measured examples. It scores a candidate rather than accepting or rejecting it outright."),
  d("promoters?", "The stretch of DNA just before a gene, where the machinery that copies the gene into RNA binds and starts."),
  d("upstream", "Before a gene, on the side from which it is read. Position −30 is 30 bases before the start."),
  d("start site", "The position where copying a gene into RNA begins. Positions in a promoter are counted backwards from it."),
  d("codons?|three-letter codes?", "Three bases that together specify one amino acid, or a stop."),
  d("reading frames?", "One of the three ways to group a strand's bases into codons. Shifting by one base gives an entirely different protein, so there are six frames across the two strands."),
  d("restriction enzymes?", "A protein that cuts DNA wherever a particular short sequence occurs, usually four to eight bases long. Named for the bacterium it came from."),
  d("shuffled|scrambled|scrambling", "The same bases in random order: the composition is kept and the arrangement destroyed, so whatever survives is explained by composition alone."),
  d("mismatch(?:es)?", "A position where the sequence has a different letter from the one the pattern asks for."),
  d("stem-loop|hairpin|stem", "A strand folded back on itself so that two stretches pair up, leaving an unpaired loop at the tip. RNA does this constantly; it is a shape, not only a sequence."),
  d("transcribed|copied into RNA|transcript", "Made into RNA. A gene does nothing until it is copied into an RNA molecule, and only one strand of it is copied."),
  d("bases?", "One of the four letters of DNA — A, C, G or T — with U standing in for T in RNA."),
  d("amino acids?|residues?", "One of the twenty building blocks of a protein, each written as a single letter."),
  d("open reading frames?", "A stretch that could encode a protein: a start codon, then whole codons, then a stop, with no stop in between."),
  d("ladder", "A mixture of DNA pieces of known sizes, run beside the samples so that the size of any band can be read off."),
  d("assembly", "One particular version of a species' reference genome. Positions shift between versions, so a position is only meaningful with its assembly named."),
  d("GC-rich|AT-rich", "Describes the balance of the four bases. G pairs with C using three bonds and A with T using two, so GC-rich DNA is harder to pull apart."),
  d("plasmid", "A small circular DNA molecule, separate from the chromosome, that bacteria carry and that laboratories use to ferry genes around."),
  d("kb", "Kilobase: a thousand bases."),
];

const escapeDef = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let serial = 0;

/** Wrap the first appearance of each known term in `html` with its definition.
    Only text between tags is touched, so markup already there is safe, and a
    term inside another term's definition is never annotated: the scan resumes
    after the wrapped text and never enters it. */
export function annotate(html, terms = TERMS) {
  const unused = new Set(terms);
  const wrapText = (text) => {
    // The earliest appearance of any term still unexplained, then the rest.
    let best = null;
    for (const t of unused) {
      const m = t.re.exec(text);
      if (m && (!best || m.index < best.m.index)) best = { t, m };
    }
    if (!best) return text;
    const { t, m } = best;
    unused.delete(t);
    const id = `def-${++serial}`;
    const wrapped = `<span class="term" tabindex="0" aria-describedby="${id}">${m[1]}` +
                    `<span class="term-def" role="tooltip" id="${id}">${escapeDef(t.def)}</span></span>`;
    return text.slice(0, m.index) + wrapped + wrapText(text.slice(m.index + m[0].length));
  };
  return html.split(/(<[^>]+>)/).map((piece) => (piece.startsWith("<") ? piece : wrapText(piece))).join("");
}
