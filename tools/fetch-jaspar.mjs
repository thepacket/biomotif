/* Build library/jaspar.mtf from JASPAR's CORE collection.

   Why this file exists. The rest of the library describes a binding site with a
   consensus string — one spelling, with ambiguity codes for the positions that
   vary. That is how the sites are written in textbooks, and it throws away what
   the experiments measured: that some positions matter far more than others. A
   position weight matrix keeps it. So for every transcription factor the
   library already names, this adds the measured matrix beside the rule of
   thumb, and a handful of factors from groups the library barely covers.

   The selection is stated in SELECTION below rather than left to taste, and
   every entry carries its JASPAR id and PubMed reference, so each one can be
   checked against the source.

   Run with `npm run jaspar`. It needs the network; nothing else does, and the
   result is committed, so no build or test depends on JASPAR being up.

   JASPAR is released under CC BY 4.0. See CONTRIBUTING.md.
*/

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "library", "jaspar.mtf");
const RELEASE = "2024";
const PFM_URL = `https://jaspar.elixir.no/download/data/${RELEASE}/CORE/JASPAR${RELEASE}_CORE_non-redundant_pfms_jaspar.txt`;
const API = "https://jaspar.elixir.no/api/v1/matrix";

/* Every factor here is one the library already describes with a consensus
   string. `library` names that entry so the two can be read together, and
   `note` says what the factor does, since a JASPAR profile carries no prose. */
const SELECTION = [
  ["TBP",     "tata-box",       "Binds the TATA box and positions the rest of the transcription machinery. The measured matrix shows how strongly the first four positions are fixed and how loose the rest is."],
  ["TP53",    "p53-response-element", "The tumour suppressor p53, which halts the cell cycle or triggers cell death after DNA damage. Its site is two half-sites, and the matrix shows both."],
  ["CTCF",    "ctcf-core",      "Anchors the loops that organise chromosomes, and its orientation decides which loops form."],
  ["RELA",    "nfkb-site",      "A subunit of NF-kappaB, which switches on inflammatory and immune genes."],
  ["FOS",     "ap1-site",       "Half of the AP-1 pair, which responds to growth signals and stress."],
  ["JUNB",    "ap1-site",       "The other half of an AP-1 pair. Fos and Jun proteins bind DNA only as a couple."],
  ["CREB1",   "cre",            "Carries the response to cyclic AMP, the signal a cell uses to react to hormones."],
  ["MAX",     "e-box-myc",      "The obligatory partner of MYC; the pair drives genes for growth and division."],
  ["MYOD1",   "e-box-myod",     "Turns cells into muscle. It reads a different E-box spelling from the MYC pair."],
  ["USF1",    "e-box",          "Reads the same CACGTG core as MYC/MAX, which is why an E-box alone does not say which factor binds."],
  ["GATA1",   "gata-site",      "Drives red blood cell development. The GATA core is invariant; the matrix shows how much the flanks matter."],
  ["SP1",     "gc-box",         "Binds the GC box found in the promoters of housekeeping genes."],
  ["HSF1",    "heat-shock-element", "Switches on the heat shock response. It binds as a trio, which is why the site is a repeat."],
  ["ESR1",    "estrogen-response-element", "The oestrogen receptor. Its site is two half-sites facing each other with three bases between."],
  ["NR3C1",   "glucocorticoid-response-element", "The glucocorticoid receptor, the target of steroid anti-inflammatories."],
  ["STAT1",   "gas-element",    "Carries interferon signals from the cell surface to the genes."],
  ["POU2F1",  "octamer",        "Binds the octamer motif, prominent in immune and developmental genes."],
  ["ELK1",    "ets-site",       "An ETS factor. All of them read a GGA core, and the matrix shows what distinguishes them."],
  ["RUNX1",   "runx-site",      "Required for blood cell formation, and disrupted in several leukaemias."],
  ["SRF",     "carg-box",       "Reads the CArG box and links cell shape and growth signals to gene activity."],
  ["MEF2A",   "mef2-site",      "Drives muscle and neuronal genes from an AT-rich site."],
  ["HIF1A",   "hif-response-element", "The oxygen sensor: it accumulates when oxygen is short and switches on the response."],
  ["NFE2L2",  "antioxidant-response-element", "Also called NRF2, it turns on the defences against oxidative damage."],
  ["HNF1A",   "hnf1-site",      "A liver factor; mutations in it cause a hereditary form of diabetes."],
  ["NFYA",    "caat-box",       "Binds the CCAAT box as part of a three-protein complex."],
  ["REST",    null,             "Silences neuronal genes in cells that are not neurons. Its site is unusually long, which the matrix shows well."],
  ["ZEB1",    null,             "Drives the switch from an epithelial to a migratory cell state, central to how tumours spread."],
];

/* A few groups the rest of the library barely reaches. Fungi, insects and
   nematodes get one well-known factor each rather than a survey. */
const WIDER = [
  ["GAL4",   "fungi",      "gal4-uas",  "The yeast factor behind the GAL4/UAS system used to drive genes on demand in flies and fish."],
  ["ABF1",   "fungi",      null,        "A general yeast factor involved in transcription, replication and silencing."],
  ["twi",    "insects",    null,        "Twist, which sets up the muscle layer in the fly embryo."],
  ["Dfd",    "insects",    null,        "Deformed, a Hox factor that gives a body segment its identity."],
  ["dl",     "insects",    null,        "Dorsal, the fly counterpart of NF-kappaB, which patterns the embryo's back-to-front axis."],
  ["blmp-1", "nematodes",  null,        "A worm factor controlling the timing of developmental stages."],
  ["daf-12", "nematodes",  null,        "Decides whether a worm develops normally or enters a stress-resistant dormant state."],
  ["MYB77",  "plants",     "myb-core",  "An Arabidopsis MYB factor acting in the auxin response."],
  ["WRKY40", "plants",     "w-box",     "A WRKY factor; the family reads the W-box that drives plant defence genes."],
];

/* --------------------------------------------------------------- fetching */

async function pfms() {
  const text = await (await fetch(PFM_URL)).text();
  const out = new Map();
  let id = null, name = null, rows = {};
  for (const line of text.split("\n")) {
    if (line.startsWith(">")) {
      if (id) out.set(id, { id, name, rows });
      const [matrixId, matrixName] = line.slice(1).trim().split(/\s+/);
      id = matrixId; name = matrixName; rows = {};
    } else if (/^[ACGT]\s*\[/.test(line)) {
      const base = line[0];
      rows[base] = line.slice(line.indexOf("[") + 1, line.lastIndexOf("]")).trim().split(/\s+/).map(Number);
    }
  }
  if (id) out.set(id, { id, name, rows });
  return out;
}

async function metadata(id) {
  try {
    const r = await fetch(`${API}/${id}/?format=json`);
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
}

/** Position counts to log2 odds against an even background, the same
    conversion pwm-from-sites does, so the two kinds of matrix agree. */
function logOdds(rows, pseudocount = 0.5) {
  const bases = ["A", "C", "G", "T"];
  const width = rows.A.length;
  const out = {};
  for (const b of bases) out[b] = [];
  for (let p = 0; p < width; p++) {
    const total = bases.reduce((s, b) => s + rows[b][p], 0) + pseudocount * 4;
    for (const b of bases) {
      out[b].push(Math.log2(((rows[b][p] + pseudocount) / total) / 0.25));
    }
  }
  return out;
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const wrap = (text, width, indent) => {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + w.length + 1 > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? indent + l : l)).join("\n");
};

/* A matrix scores every position of every sequence, so the threshold decides
   everything. A blanket relative score is meaningless across matrices of
   different widths and sharpness: 0.85 makes a 7-position matrix fire every few
   hundred bases and a 33-position one almost never. So each threshold is set
   here against chance — the level at which random DNA of even composition would
   produce roughly one match in every CHANCE_PER bases. */
const CHANCE_PER = 10_000;
const SAMPLES = 400_000;

/** Returns the threshold and the rate it actually achieves. A short matrix
    cannot be as specific as a long one — six positions can distinguish at best
    one sequence in 4,096, so no threshold makes it rare — and the docstring
    reports what it really does rather than what was asked for. */
function calibrate(m) {
  const bases = ["A", "C", "G", "T"];
  const width = m.A.length;
  let lo = 0, hi = 0;
  for (let p = 0; p < width; p++) {
    const col = bases.map((b) => m[b][p]);
    lo += Math.min(...col);
    hi += Math.max(...col);
  }

  // xorshift32: an LCG's low bits are periodic and would bias the sample.
  let x = 2463534242;
  const nextBase = () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x >>> 30;
  };
  const scores = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    let total = 0;
    for (let p = 0; p < width; p++) total += m[bases[nextBase()]][p];
    scores[i] = total;
  }
  scores.sort();

  const index = Math.floor(SAMPLES * (1 - 1 / CHANCE_PER));
  const cut = scores[Math.min(SAMPLES - 1, index)];
  const relative = Math.max(0.5, Math.min(0.995, (cut - lo) / (hi - lo)));
  const score = lo + relative * (hi - lo);
  // How often that threshold is actually reached.
  let above = 0;
  for (let i = SAMPLES - 1; i >= 0 && scores[i] >= score; i--) above++;
  const perBases = above ? Math.round(SAMPLES / above) : CHANCE_PER;
  return { threshold: Math.round(relative * 1000) / 1000, perBases };
}

function entry({ jid, factor, rows, note, library, species, pubmed, kind }) {
  const m = logOdds(rows);
  const width = m.A.length;
  const { threshold, perBases } = calibrate(m);
  const consensus = Array.from({ length: width }, (_, p) =>
    ["A", "C", "G", "T"].reduce((a, b) => (m[a][p] >= m[b][p] ? a : b))).join("");
  const doc = `${note} Measured from ${kind || "experiment"} data rather than written as a consensus, ` +
    `so each position carries its own weight. Best-scoring sequence: ${consensus}. ` +
    `At its threshold, random DNA gives about one match per ${perBases.toLocaleString()} bases — ` +
    `which is as specific as ${width} positions allow.`;
  const matrix = ["A", "C", "G", "T"]
    .map((b) => `      (${b} ${m[b].map((x) => x.toFixed(3)).join(" ")})`).join("\n");
  const ref = `JASPAR ${jid}${pubmed ? `, PubMed ${pubmed}` : ""}` + (species ? `; ${species}` : "");
  return `(defmotif ${slug(factor)}-matrix\n` +
    `  "${wrap(doc, 84, "   ")}"\n` +
    `  (pwm (\n${matrix})\n    :threshold ${threshold})\n` +
    `  :category 'tfbs :alphabet 'dna${library ? `\n  ;; the library's consensus version of this site is ${library}` : ""}\n` +
    `  :ref "${ref}")\n`;
}

/* ------------------------------------------------------------------- main */

const all = await pfms();
console.log(`  ${all.size} profiles in JASPAR ${RELEASE} CORE non-redundant`);

// Keep the highest version of each base id, indexed by factor name.
const byName = new Map();
for (const p of all.values()) {
  const [base, version] = p.id.split(".");
  const key = p.name.toUpperCase();
  const prev = byName.get(key);
  if (!prev || Number(version) > Number(prev.id.split(".")[1]) || base > prev.id.split(".")[0]) {
    if (!prev || Number(version) >= Number(prev.id.split(".")[1])) byName.set(key, p);
  }
}

const wanted = [
  ...SELECTION.map(([f, lib, note]) => ({ factor: f, library: lib, note })),
  ...WIDER.map(([f, group, lib, note]) => ({ factor: f, library: lib, note, group })),
];

const entries = [];
const missing = [];
for (const w of wanted) {
  const p = byName.get(w.factor.toUpperCase());
  if (!p) { missing.push(w.factor); continue; }
  const meta = await metadata(p.id);
  entries.push(entry({
    jid: p.id, factor: p.name, rows: p.rows, note: w.note, library: w.library,
    species: (meta.species || []).map((s) => s.name).join(", "),
    pubmed: (meta.pubmed_ids || [])[0],
    kind: meta.type,
  }));
  console.log(`  ${p.id.padEnd(10)} ${p.name}`);
}

const header = `;;; jaspar.mtf -- position weight matrices from the JASPAR CORE collection.
;;;
;;; Generated by \`npm run jaspar\` from JASPAR ${RELEASE}; do not edit by hand.
;;;
;;; The rest of the library writes a binding site as a consensus — one spelling
;;; with ambiguity codes. That is how the sites appear in textbooks, and it
;;; discards what the experiments measured: that some positions matter far more
;;; than others. These keep it. Each one is the measured matrix for a factor the
;;; library already describes as a consensus, so the two can be read together.
;;;
;;; Every entry names its JASPAR id and the paper behind it, so it can be
;;; checked against the source. JASPAR is released under CC BY 4.0.
;;; Reference: Rauluseviciute et al. 2024, Nucleic Acids Res 52:D174 (JASPAR 2024).

`;
writeFileSync(OUT, header + entries.join("\n"));
console.log(`\n  wrote ${entries.length} matrices to library/jaspar.mtf`);
if (missing.length) console.log(`  not found in CORE: ${missing.join(", ")}`);
