/* Build the example sequences. Every one is synthetic and reproducible:
   random background at a chosen GC content, with real consensus elements
   planted at known positions, so each demo has a known right answer.
   Regenerate with `npm run data`. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { revcomp } from "../web/src/engine.js";
import { translate } from "../web/src/library.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
mkdirSync(DATA, { recursive: true });

/** mulberry32: small, seeded and stable, so the data is the same everywhere. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/** Random background at a given GC fraction. */
function bg(r, n, gc = 0.5) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const x = r();
    out += x < (1 - gc) / 2 ? "A" : x < 0.5 ? "C" : x < 0.5 + gc / 2 ? "G" : "T";
  }
  return out;
}

const SENSE = [];
for (const a of "ACGT") for (const b of "ACGT") for (const c of "ACGT") {
  const codon = a + b + c;
  if (!["TAA", "TAG", "TGA"].includes(codon)) SENSE.push(codon);
}
/** A coding sequence of `aa` codons with no internal stop. */
function orf(r, aa, start = "ATG", stop = "TAA") {
  let out = start;
  for (let i = 0; i < aa - 2; i++) out += pick(r, SENSE);
  return out + stop;
}

function write(name, records, notes = "") {
  const lines = notes.trim().split("\n").map((l) => `; ${l}`);
  for (const [header, seq] of records) {
    lines.push(`>${header}`);
    for (let i = 0; i < seq.length; i += 70) lines.push(seq.slice(i, i + 70));
  }
  writeFileSync(join(DATA, name), lines.join("\n") + "\n");
  console.log(`  data/${name.padEnd(20)} ${records.length} record${records.length === 1 ? "" : "s"}`);
}

/* ------------------------------------------------------------- 1. operon */
{
  const r = rng(11);
  let seq = bg(r, 120, 0.45);
  seq += "TTGACA" + bg(r, 17, 0.45) + "TATAAT" + bg(r, 7, 0.45);
  for (const length of [95, 140, 70]) {
    seq += "AAGGAGG" + bg(r, 7, 0.45) + orf(r, length) + bg(r, 25, 0.45);
  }
  const stem = "GGGCGCGCCAGC";
  seq += stem + "TTCG" + revcomp(stem) + "TTTTTTTT" + bg(r, 60, 0.4);
  write("operon.fa", [["synthetic_operon promoter+3genes+terminator", seq]],
    "Synthetic bacterial operon. Sigma-70 promoter at 120, Shine-Dalgarno\nbefore each of three genes, intrinsic terminator near the 3' end.");
}

/* ------------------------------------------------- 2. eukaryotic promoters */
{
  const r = rng(23);
  const variants = ["TATAAAAG", "TATAAATG", "TATATAAG", "TATAAAAA", "TATTTATG", "TATAAATA"];
  const recs = [];
  for (let i = 1; i <= 12; i++) {
    let s = bg(r, 180, 0.42);
    if (i % 3 === 0) s += "CCAAT" + bg(r, 40, 0.5);
    if (i % 2 === 0) s += "GGGGCGGGGC" + bg(r, 25, 0.6);
    const hasTata = i <= 8;
    if (hasTata) s += pick(r, variants) + bg(r, 25, 0.45);
    s += "TCAGTCT" + bg(r, 30, 0.45) + "GCCACC" + "ATG" + "G" + orf(r, 60).slice(3);
    recs.push([`PROM${String(i).padStart(2, "0")} ${hasTata ? "TATA-containing" : "TATA-less"} synthetic promoter`, s]);
  }
  write("promoters.fa", recs,
    "Twelve synthetic core promoters. The first eight carry a TATA box,\nthe last four are TATA-less. All carry an initiator and a Kozak ATG.");
}

/* ------------------------------------------------------------- 3. plasmid */
{
  const r = rng(58);
  const mcs = "GAATTC" + "GCGGCCGC" + "TCTAGA" + "GGTACC" + "CTCGAG" + "GGATCC" + "AAGCTT" + "CTGCAG";
  const seq = bg(r, 300, 0.52) + "TAATACGACTCACTATAG" + bg(r, 12, 0.5) + "AAGGAGGATATACAT" +
    "ATG" + "CATCACCATCACCATCAC" + "GAAAACCTGTATTTTCAGGGC" + orf(r, 210).slice(3, -3) + "TAA" +
    mcs + bg(r, 250, 0.5) + "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG" + bg(r, 900, 0.55) +
    "ATAACTTCGTATAATGTATGCTATACGAAGTTAT" + bg(r, 400, 0.5);
  write("plasmid.fa", [["pSYN1 synthetic_expression_vector circular", seq]],
    "Synthetic expression plasmid: T7 promoter, RBS, His-TEV-ORF, a multiple\ncloning site, T7 terminator and a loxP site. Treat it as circular.");
}

/* -------------------------------------------------------------- 4. 3'UTRs */
{
  const r = rng(41);
  const recs = [];
  for (const [name, adds] of [
    ["TNF_like", ["TTATTTATTTATTATTTATT", "AATAAA"]],
    ["FTH_like", ["GGGGCCAGTGTGCCCC", "AATAAA"]],
    ["HIST_like", ["GGCTCTTTTCAGAGCC"]],
    ["MYC_like", ["CTACCTC", "ATTTA", "AATAAA"]],
    ["QUIET_like", ["AATAAA"]],
  ]) {
    let s = bg(r, 120, 0.38);
    for (const a of adds) s += a + bg(r, int(r, 40, 90), 0.38);
    recs.push([`${name} synthetic 3'UTR`, s + "GGACT" + bg(r, 30, 0.38)]);
  }
  write("utr3.fa", recs,
    "Synthetic 3' UTRs carrying an AU-rich element, an iron responsive element,\na histone stem-loop, a let-7 site and poly(A) signals.");
}

/* ------------------------------------------------------------ 5. proteins */
write("proteins.fa", [
  ["SECRETED01 signal peptide + N-glycosylation + KDEL",
   "MKWVTFISLLLLFSSAYSRGVFRRDTHKSEIAHRFKDLGEENFKALVLIAFAQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLTSSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALAKDEL"],
  ["KINASE01 glycine-rich loop + HRD + DFG",
   "MSGKEQLIYRVGDLLGEGSFGKVYKARHKETGQIVAIKIIDKTQLNPSSLQKLFREVRIMKMLNHPNIVKLFEVIETEKTLYLVMEYASGGEVFDYLVAHGRMKEKEARSKFRQIVSAVQYCHQKFIVHRDLKAENLLLDADMNIKIADFGFSNEFTVGGKLDTFCGSPPYAAPELFQGKKYDGPEVDVWSLGVILYTLVSGSLPFDGQNLKELRERVLRGKYRIPFYMSTDCENLLKRFLVLNPIKRGTLEQIMKDRWMNVGHEEEELKPYVEPLPDYKDPRRTELMVSMGYTREEIQDSLVGQRYNEVMATYLLLGYKSSELEGDTITLKPRPSADLTNSSTSSPHHKVQRSVSANQKQRRFSDQAGPAIPTSNSYSKKTQSNNAENKRPEEKKRSTSTGEKNGKNSGKKGSSLFSKFTSKFVRRNLSFRFARRSNSDDGVQPAKLGSVSQPAQKAGNKENAHLQ"],
  ["TAGGED01 His-TEV-FLAG-protein-PTS1",
   "MGSSHHHHHHSSGLVPRGSHMASMTGGQQMGRGSENLYFQGDYKDDDDKMANQVSKSAWAVLNGSTPLERGDSVKAAQKLLEEHGIKVDVCGPCRGDLTAEQKAALEDLIRSHGVKTFVSSTNKELSGSHHWQAGRVENLYFQSGSGSAKL"],
  ["NUCLEAR01 bipartite NLS + zinc fingers",
   "MDSREPKRKRSPSVEDSKKRKAETSVPSAVQSNGERRPFQCRICMRNFSRSDHLTTHIRTHTGEKPFACDICGRKFARSDERKRHTKIHLRQKDKKAEKSVPCPHCDRCFSRSDHLTTHIRTHTGEKPYKCPECGKSFSQSSNLQKHQRVHTGEKPYECGECGKAFSHSSDLIKHQRTHTGEKPYKCEECGKAFNRSSNLTTHKIIHTGEKPYKCEECGKAFNQSSTLTTHKIIHTGEKPYKCEECGKAFNQSSNLTTHKIIHSGEKKA"],
  ["MEMBRANE01 CAAX + palmitoylation",
   "MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHQYREQIKRVKDSDDVPMVLVGNKCDLAARTVESRQAQDLARSYGIPYIETSAKTRQGVEDAFYTLVREIRQHKLRKLNPPDESGPGCMSCKCVLS"],
], "Protein sequences. SECRETED01 is bovine serum albumin with a KDEL added;\nKINASE01, NUCLEAR01 and MEMBRANE01 are drawn from real kinase, zinc finger\nand Ras sequences; TAGGED01 is a synthetic construct with common tags.");

/* ------------------------------------------------------ 6. plant promoters */
{
  const r = rng(53);
  const recs = [];
  for (const [name, els] of [
    ["RD29A_like", ["TACCGACAT", "CACGTGGC", "TACCGACAT", "CACGTG"]],
    ["PR1_like", ["TTGACC", "TGACG", "TTGACT"]],
    ["RBCS_like", ["CCACGTGGCC", "GATAAG", "GGGCGG"]],
    ["CAB_like", ["AAAATATCT", "CACGTG", "GATAAG"]],
    ["AMY_like", ["TAACAAA", "CCTTTTG", "TATCCCA"]],
  ]) {
    let s = bg(r, 100, 0.34);
    for (const e of els) s += e + bg(r, int(r, 30, 80), 0.34);
    recs.push([`${name} synthetic plant promoter`, s + "TATATAA" + bg(r, 28, 0.34) + "AACAATGGCT"]);
  }
  write("plant_promoters.fa", recs,
    "Synthetic plant promoters carrying DRE/CRT, ABRE, W-box, G-box, I-box,\nevening element and gibberellin response elements.");
}

/* ------------------------------------------------------- 7. TATA site table */
{
  const sites = ["TATAAAAG", "TATAAATG", "TATATAAG", "TATAAAAA", "TATTTATG", "TATAAATA",
                 "TATAAAAG", "TATAAAAG", "TATAAATG", "TATATATA", "TATAAAAG", "TACAAAAG",
                 "TATAAAAG", "TATAAAAT", "TATAAAAG", "TATAAAAG", "TATTTAAG", "TATAAAAG",
                 "TATAAAAG", "TATAAAAA", "TATAAATG", "TATAAAAG", "TAAAAAAG", "TATAAAAG"];
  writeFileSync(join(DATA, "tata_sites.txt"),
    "; 24 aligned 8-mer TATA boxes, for building a position weight matrix.\n" +
    "; Synthetic, sampled around the Bucher consensus TATAWAWR.\n" + sites.join("\n") + "\n");
  console.log(`  data/tata_sites.txt      ${sites.length} sites`);
}

/* --------------------------------------------------------- 8. spliced gene */
{
  const r = rng(71);
  // Build the coding sequence first so the spliced product is a real protein,
  // then interrupt it the way a real gene does, at arbitrary points.
  const cds = "ATGG" + orf(r, 190).slice(4);
  const utr5 = bg(r, 60, 0.45) + "TATAAAAG" + bg(r, 26, 0.45) + "GCCACC";
  const utr3 = "AATAAA" + bg(r, 18, 0.4) + "TGTGTTTT" + bg(r, 40, 0.4);

  /** Slide to a point where the exon already ends in the MAG donor consensus,
      so no base has to be changed and the reading frame is untouched. */
  const donorCut = (near) => {
    for (let d = 0; d < 40; d++) {
      for (const cut of [near + d, near - d]) {
        if (cut > 6 && cut < cds.length - 6 && cds.slice(cut - 2, cut) === "AG" && "AC".includes(cds[cut - 3]))
          return cut;
      }
    }
    return near;
  };
  const cuts = [130, 270, 420].map(donorCut);
  let seq = utr5;
  const exons = [];
  let prev = 0;
  for (const [k, cut] of [...cuts, cds.length].entries()) {
    const exon = cds.slice(prev, cut);
    exons.push([seq.length, seq.length + exon.length]);
    seq += exon;
    prev = cut;
    if (k < cuts.length) {
      seq += "GTAAGT" + bg(r, int(r, 200, 400), 0.38) + "CTGAC" + "TTTTCTTTTCCTTTTCTTT" + "CAG";
    }
  }
  seq += utr3;
  const spliced = exons.map(([a, b]) => seq.slice(a, b)).join("");
  const protein = translate(spliced, { toStop: true });
  write("gene.fa", [["SYNGENE1 four exons, three GT-AG introns", seq]],
    "Synthetic eukaryotic gene: TATA promoter, four exons, three GT-AG introns\n" +
    "with branch points and polypyrimidine tracts, and a poly(A) site.\n" +
    `Spliced and translated it gives a ${protein.length} residue protein.`);
}
